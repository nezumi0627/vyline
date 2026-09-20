/**
 * アクティブ通話セッション管理 + WebSocket PCM ブリッジ
 */

import type { ServerWebSocket } from "bun";
import type { CallSession, CallSessionState } from "@vyline/protocol/stack/call";
import type { PcmFrame } from "@vyline/protocol/stack/call";
import { bufferSource, type AudioSource } from "@vyline/protocol/stack/call";
import { decodeCallVideoFrame, type CallVideoState } from "@vyline/types";
import { createDirectCallSession } from "./sessionFactory.js";
import type { VylineClient } from "@vyline/protocol";
import { randomUUID } from "node:crypto";
import { childLogger } from "../logger.js";
import type { DesktopProfile } from "@vyline/protocol";

const log = childLogger("call:manager");
const MAX_PCM_FRAME_BYTES = 64 * 1024;
const MAX_MIC_QUEUE_FRAMES = 100;
const MAX_WS_CLIENTS_PER_CALL = 8;
const MAX_VIDEO_CLIENTS_PER_CALL = 4;
const CALL_CLIENT_ERROR = "call operation failed";

export interface CallSessionSnapshot {
  sessionId: string;
  accountId: string;
  to: string;
  kind: "AUDIO" | "VIDEO";
  state: CallSessionState;
  transport: "planet" | "andromeda" | "unknown";
  startedAt: number;
  video: CallVideoState;
  error?: string;
}

interface ManagedCall {
  sessionId: string;
  accountId: string;
  to: string;
  kind: "AUDIO" | "VIDEO";
  session: CallSession;
  state: CallSessionState;
  transport: "planet" | "andromeda" | "unknown";
  startedAt: number;
  error?: string;
  wsClients: Set<ServerWebSocket<CallWsData>>;
  videoClients: Set<ServerWebSocket<CallWsData>>;
  micQueue: PcmFrame[];
  micWaiters: Array<(f: PcmFrame | null) => void>;
  micClosed: boolean;
  sendTask?: Promise<void>;
  recvTask?: Promise<void>;
  startTask?: Promise<void>;
  micFrames: number;
  remoteFrames: number;
}

export interface CallWsData {
  accountId: string;
  sessionId: string;
  media: "audio" | "video";
  videoEnabled?: boolean;
}

const sessions = new Map<string, ManagedCall>();
const byAccount = new Map<string, Set<string>>();
const acquiringAccounts = new Set<string>();

function reserveAccount(accountId: string): () => void {
  if (acquiringAccounts.has(accountId)) throw new Error("通話の接続処理中です");
  acquiringAccounts.add(accountId);
  return () => acquiringAccounts.delete(accountId);
}

function micSource(call: ManagedCall): AudioSource {
  return {
    async *frames(opts?: { signal?: AbortSignal }) {
      const signal = opts?.signal;
      while (!signal?.aborted && !call.micClosed) {
        const frame = await new Promise<PcmFrame | null>((resolve) => {
          if (call.micQueue.length > 0) {
            resolve(call.micQueue.shift()!);
            return;
          }
          call.micWaiters.push(resolve);
        });
        if (!frame) break;
        yield frame;
      }
    },
  };
}

function pushMic(call: ManagedCall, frame: PcmFrame) {
  const waiter = call.micWaiters.shift();
  if (waiter) waiter(frame);
  else {
    if (call.micQueue.length >= MAX_MIC_QUEUE_FRAMES) call.micQueue.shift();
    call.micQueue.push(frame);
  }
}

function broadcastState(call: ManagedCall) {
  const msg = JSON.stringify({
    type: "state",
    state: call.session.state,
    sessionId: call.sessionId,
    transport: call.transport,
    error: call.error,
  });
  for (const ws of call.wsClients) {
    try {
      ws.send(msg);
    } catch {
      /* */
    }
  }
}

function broadcastPcm(call: ManagedCall, pcm: ArrayBuffer) {
  for (const ws of call.wsClients) {
    if (ws.data.media !== "audio") continue;
    try {
      ws.send(pcm);
    } catch {
      /* */
    }
  }
}

function broadcastVideoState(call: ManagedCall) {
  const remoteEnabled = [...call.videoClients].some((ws) => ws.data.videoEnabled === true);
  for (const ws of call.videoClients) {
    try {
      ws.send(
        JSON.stringify({
          type: "state",
          sessionId: call.sessionId,
          state: call.session.state,
          transport: call.transport,
          error: call.error,
          video: {
            available: call.kind === "VIDEO",
            localEnabled: ws.data.videoEnabled === true,
            remoteEnabled: remoteEnabled && ws.data.videoEnabled !== true,
          },
        }),
      );
    } catch {
      /* disconnected client */
    }
  }
}

function broadcastVideo(
  call: ManagedCall,
  packet: Uint8Array,
  sender: ServerWebSocket<CallWsData>,
) {
  for (const ws of call.videoClients) {
    if (ws === sender || ws.data.videoEnabled !== true) continue;
    try {
      ws.send(packet);
    } catch {
      /* disconnected client */
    }
  }
}

function attachSessionEvents(call: ManagedCall) {
  call.session.on("state", (s) => {
    call.state = s;
    broadcastState(call);
    broadcastVideoState(call);
  });
  call.session.on("ended", (reason) => {
    log.info(
      {
        sessionId: call.sessionId,
        reason,
        durationSec: Math.round((Date.now() - call.startedAt) / 1000),
        micFrames: call.micFrames,
        remoteFrames: call.remoteFrames,
      },
      "call ended",
    );
    // Notify connected clients before removing the session from the registry.
    broadcastState(call);
    setTimeout(() => cleanupCall(call.sessionId), 300);
  });
  call.session.on("error", (err) => {
    call.error = CALL_CLIENT_ERROR;
    call.state = call.session.state;
    log.warn({ sessionId: call.sessionId, err }, "call session error");
    broadcastState(call);
  });
}

async function runCallStart(call: ManagedCall): Promise<void> {
  const { sessionId } = call;
  try {
    await call.session.start();
    if (!sessions.has(sessionId)) return;
    call.state = call.session.state;
    if (call.session.state === "in-call") {
      await startMediaLoops(call);
    }
    if (!sessions.has(sessionId)) return;
    broadcastState(call);
    log.info(
      {
        sessionId,
        accountId: call.accountId,
        to: call.to,
        transport: call.transport,
        state: call.state,
      },
      "call session ready",
    );
  } catch (err) {
    if (!sessions.has(sessionId)) return;
    call.state = call.session.state;
    call.error = CALL_CLIENT_ERROR;
    broadcastState(call);
    log.warn({ sessionId, err }, "call start failed");
  }
}

async function startMediaLoops(call: ManagedCall) {
  const countingMic: AudioSource = {
    async *frames(opts?: { signal?: AbortSignal }) {
      for await (const frame of micSource(call).frames(opts)) {
        call.micFrames++;
        yield frame;
      }
    },
  };
  call.sendTask = call.session.sendStream(countingMic).catch((err) => {
    log.warn({ err, sessionId: call.sessionId }, "sendStream ended");
    // A closed transport can leave the session in-call unless we end it.
    if (call.session.state === "in-call") {
      void call.session.end("media-error").catch(() => undefined);
    }
  });

  call.recvTask = (async () => {
    for await (const frame of call.session.received()) {
      call.remoteFrames++;
      const buf = frame.samples.buffer.slice(
        frame.samples.byteOffset,
        frame.samples.byteOffset + frame.samples.byteLength,
      );
      broadcastPcm(call, buf as ArrayBuffer);
    }
    // Normal receive-loop completion means the remote transport ended.
    if (call.session.state === "in-call") {
      await call.session.end("remote-ended").catch(() => undefined);
    }
  })().catch((err) => {
    log.warn({ err, sessionId: call.sessionId }, "receive loop ended");
    if (call.session.state === "in-call") {
      void call.session.end("remote-ended").catch(() => undefined);
    }
  });
}

export async function startManagedCall(opts: {
  accountId: string;
  client: VylineClient;
  to: string;
  kind?: "AUDIO" | "VIDEO";
  desktopProfile?: DesktopProfile;
}): Promise<CallSessionSnapshot> {
  const kind = opts.kind ?? "AUDIO";
  const release = reserveAccount(opts.accountId);
  try {
    const existing = [...(byAccount.get(opts.accountId) ?? [])]
      .map((id) => sessions.get(id))
      .find((c) => {
        if (!c) return false;
        const s = c.session.state;
        if (s === "ended" || s === "failed") {
          cleanupCall(c.sessionId);
          return false;
        }
        return true;
      });
    if (existing) {
      throw new Error(`通話中: sessionId=${existing.sessionId}`);
    }

    const created = await createDirectCallSession(opts.client, {
      to: opts.to,
      kind,
      ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
    });
    const session = created.session;
    const sessionId = randomUUID();
    const transport = created.transportKind;

    const call: ManagedCall = {
      sessionId,
      accountId: opts.accountId,
      to: opts.to,
      kind,
      session,
      state: "idle",
      transport,
      startedAt: Date.now(),
      wsClients: new Set(),
      micQueue: [],
      micWaiters: [],
      micClosed: false,
      micFrames: 0,
      remoteFrames: 0,
      videoClients: new Set(),
    };

    sessions.set(sessionId, call);
    if (!byAccount.has(opts.accountId)) byAccount.set(opts.accountId, new Set());
    byAccount.get(opts.accountId)!.add(sessionId);

    attachSessionEvents(call);

    call.startTask = runCallStart(call);
    broadcastState(call);
    log.info(
      {
        sessionId,
        accountId: opts.accountId,
        to: opts.to,
        transport,
        device: created.wire.deviceDetails.device,
      },
      "call session created",
    );

    return snapshot(call);
  } finally {
    release();
  }
}

export async function endManagedCall(sessionId: string, reason = "user-ended"): Promise<void> {
  const call = sessions.get(sessionId);
  if (!call) return;
  call.micClosed = true;
  for (const w of call.micWaiters) w(null);
  try {
    await call.session.end(reason);
  } catch (err) {
    log.warn({ sessionId, err }, "call end error");
  }
  cleanupCall(sessionId);
}

function cleanupCall(sessionId: string) {
  const call = sessions.get(sessionId);
  if (!call) return;
  call.micClosed = true;
  for (const w of call.micWaiters) w(null);
  for (const ws of call.wsClients) {
    try {
      ws.close();
    } catch {
      /* */
    }
  }
  call.videoClients.clear();
  sessions.delete(sessionId);
  const accountSessions = byAccount.get(call.accountId);
  accountSessions?.delete(sessionId);
  if (accountSessions?.size === 0) byAccount.delete(call.accountId);
}

export function getCallSnapshot(sessionId: string): CallSessionSnapshot | null {
  const call = sessions.get(sessionId);
  return call ? snapshot(call) : null;
}

/** アカウント境界を含めて取得する。BFFからはこの関数を優先して使う。 */
export function getCallSnapshotForAccount(
  accountId: string,
  sessionId: string,
): CallSessionSnapshot | null {
  const call = sessions.get(sessionId);
  return call?.accountId === accountId ? snapshot(call) : null;
}

export async function endManagedCallForAccount(
  accountId: string,
  sessionId: string,
  reason = "user-ended",
): Promise<boolean> {
  const call = sessions.get(sessionId);
  if (!call || call.accountId !== accountId) return false;
  await endManagedCall(sessionId, reason);
  return true;
}

/** Stop all media loops before an account session is removed. */
export async function endManagedCallsForAccount(
  accountId: string,
  reason = "account-removed",
): Promise<number> {
  const sessionIds = [...(byAccount.get(accountId) ?? [])];
  await Promise.all(sessionIds.map((sessionId) => endManagedCall(sessionId, reason)));
  if (byAccount.get(accountId)?.size === 0) byAccount.delete(accountId);
  return sessionIds.length;
}

export function listAccountCalls(accountId: string): CallSessionSnapshot[] {
  const ids = byAccount.get(accountId);
  if (!ids) return [];
  return [...ids]
    .map((id) => sessions.get(id))
    .filter(Boolean)
    .map((c) => snapshot(c!));
}

function snapshot(call: ManagedCall): CallSessionSnapshot {
  return {
    sessionId: call.sessionId,
    accountId: call.accountId,
    to: call.to,
    kind: call.kind,
    state: call.session.state,
    transport: call.transport,
    startedAt: call.startedAt,
    video: {
      available: call.kind === "VIDEO",
      localEnabled: false,
      remoteEnabled: [...call.videoClients].some((ws) => ws.data.videoEnabled === true),
    },
    ...(call.error ? { error: call.error } : {}),
  };
}

export function attachCallWebSocket(ws: ServerWebSocket<CallWsData>) {
  const call = sessions.get(ws.data.sessionId);
  if (!call || call.accountId !== ws.data.accountId) {
    ws.close(4403, "invalid session");
    return;
  }
  if (call.wsClients.size >= MAX_WS_CLIENTS_PER_CALL) {
    ws.close(4429, "too many call clients");
    return;
  }
  if (ws.data.media === "video") {
    if (call.kind !== "VIDEO") {
      ws.close(4406, "video is not enabled for this call");
      return;
    }
    if (call.videoClients.size >= MAX_VIDEO_CLIENTS_PER_CALL) {
      ws.close(4429, "too many video clients");
      return;
    }
    call.videoClients.add(ws);
  }
  call.wsClients.add(ws);
  ws.send(
    JSON.stringify({
      type: "state",
      state: call.session.state,
      sessionId: call.sessionId,
      transport: call.transport,
      error: call.error,
    }),
  );
  if (ws.data.media === "video") broadcastVideoState(call);
}

/** ブラウザからの PCM Int16LE mono @48kHz */
export function ingestCallMicPcm(sessionId: string, data: ArrayBuffer) {
  const call = sessions.get(sessionId);
  if (!call || call.session.state !== "in-call") return;
  if (data.byteLength === 0 || data.byteLength > MAX_PCM_FRAME_BYTES || data.byteLength % 2 !== 0)
    return;
  const samples = new Int16Array(data);
  pushMic(call, { samples, sampleRate: 48000, channels: 1 });
}

/**
 * ブラウザからのVP8映像フレームを検証して、同じ通話の映像socketへ中継する。
 * フレームをキューイング・蓄積せず、遅い受信者はWebSocket側のbackpressureに任せる。
 */
export function ingestCallVideoPacket(ws: ServerWebSocket<CallWsData>, data: ArrayBuffer): void {
  if (ws.data.media !== "video") return;
  const call = sessions.get(ws.data.sessionId);
  if (!call || call.accountId !== ws.data.accountId || call.session.state !== "in-call") return;
  if (data.byteLength > 0x400000) return;
  let frame: ReturnType<typeof decodeCallVideoFrame>;
  try {
    frame = decodeCallVideoFrame(new Uint8Array(data));
  } catch {
    return;
  }
  if (frame.sourceMid !== undefined) return;
  if (ws.data.videoEnabled !== true) return;
  broadcastVideo(call, data.byteLength ? new Uint8Array(data) : new Uint8Array(), ws);
}

function setVideoEnabled(ws: ServerWebSocket<CallWsData>, enabled: boolean): void {
  if (ws.data.media !== "video") return;
  const call = sessions.get(ws.data.sessionId);
  if (!call || call.accountId !== ws.data.accountId || call.kind !== "VIDEO") return;
  ws.data.videoEnabled = enabled;
  broadcastVideoState(call);
}

/** テスト用: 440Hz トーンを数秒送る（Desktop 準拠の通話エンコード検証） */
export async function sendTestTone(sessionId: string, durationMs = 2000): Promise<void> {
  const call = sessions.get(sessionId);
  if (!call || call.session.state !== "in-call") throw new Error("not in-call");
  const total = Math.floor((48000 * durationMs) / 1000);
  const samples = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    samples[i] = Math.floor(Math.sin((2 * Math.PI * 440 * i) / 48000) * 8000);
  }
  await call.session.sendStream(bufferSource({ samples, sampleRate: 48000, frameDurationMs: 20 }));
}

export const callWebSocketHandler = {
  open(ws: ServerWebSocket<CallWsData>) {
    attachCallWebSocket(ws);
  },
  message(ws: ServerWebSocket<CallWsData>, message: string | Buffer) {
    if (typeof message === "string") {
      try {
        const j = JSON.parse(message) as { type?: string; enabled?: boolean };
        if (j.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
        else if (j.type === "video" && typeof j.enabled === "boolean")
          setVideoEnabled(ws, j.enabled);
      } catch {
        /* */
      }
      return;
    }
    const buf =
      message instanceof Buffer
        ? message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength)
        : message;
    if (ws.data.media === "video") ingestCallVideoPacket(ws, buf as ArrayBuffer);
    else ingestCallMicPcm(ws.data.sessionId, buf as ArrayBuffer);
  },
  close(ws: ServerWebSocket<CallWsData>) {
    const call = sessions.get(ws.data.sessionId);
    if (call) {
      call.wsClients.delete(ws);
      call.videoClients.delete(ws);
      if (ws.data.media === "video") broadcastVideoState(call);
    }
  },
};
