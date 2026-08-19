/**
 * アクティブ通話セッション管理 + WebSocket PCM ブリッジ
 */

import type { ServerWebSocket } from "bun";
import type { CallSession, CallSessionState } from "@vyline/protocol/stack/call";
import type { PcmFrame } from "@vyline/protocol/stack/call";
import { bufferSource, type AudioSource } from "@vyline/protocol/stack/call";
import { createDirectCallSession } from "./sessionFactory.js";
import type { VylineClient } from "@vyline/protocol";
import { randomUUID } from "node:crypto";
import { childLogger } from "../logger.js";
import type { DesktopProfile } from "@vyline/protocol";

const log = childLogger("call:manager");

export interface CallSessionSnapshot {
  sessionId: string;
  accountId: string;
  to: string;
  kind: "AUDIO" | "VIDEO";
  state: CallSessionState;
  transport: "planet" | "andromeda" | "unknown";
  startedAt: number;
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
  micQueue: PcmFrame[];
  micWaiters: Array<(f: PcmFrame | null) => void>;
  micClosed: boolean;
  sendTask?: Promise<void>;
  recvTask?: Promise<void>;
  startTask?: Promise<void>;
}

export interface CallWsData {
  accountId: string;
  sessionId: string;
}

const sessions = new Map<string, ManagedCall>();
const byAccount = new Map<string, Set<string>>();

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
  else call.micQueue.push(frame);
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
    try {
      ws.send(pcm);
    } catch {
      /* */
    }
  }
}

function attachSessionEvents(call: ManagedCall) {
  call.session.on("state", (s) => {
    call.state = s;
    broadcastState(call);
  });
  call.session.on("ended", (reason) => {
    log.info({ sessionId: call.sessionId, reason }, "call ended");
    cleanupCall(call.sessionId);
  });
  call.session.on("error", (err) => {
    call.error = err.message;
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
    call.error = err instanceof Error ? err.message : String(err);
    broadcastState(call);
    log.warn({ sessionId, err }, "call start failed");
  }
}

async function startMediaLoops(call: ManagedCall) {
  call.sendTask = call.session
    .sendStream(micSource(call))
    .catch((err) => log.warn({ err, sessionId: call.sessionId }, "sendStream ended"));

  call.recvTask = (async () => {
    for await (const frame of call.session.received()) {
      const buf = frame.samples.buffer.slice(
        frame.samples.byteOffset,
        frame.samples.byteOffset + frame.samples.byteLength,
      );
      broadcastPcm(call, buf as ArrayBuffer);
    }
  })().catch((err) => log.warn({ err, sessionId: call.sessionId }, "receive loop ended"));
}

export async function startManagedCall(opts: {
  accountId: string;
  client: VylineClient;
  to: string;
  kind?: "AUDIO" | "VIDEO";
  desktopProfile?: DesktopProfile;
}): Promise<CallSessionSnapshot> {
  const kind = opts.kind ?? "AUDIO";
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
  sessions.delete(sessionId);
  byAccount.get(call.accountId)?.delete(sessionId);
}

export function getCallSnapshot(sessionId: string): CallSessionSnapshot | null {
  const call = sessions.get(sessionId);
  return call ? snapshot(call) : null;
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
    ...(call.error ? { error: call.error } : {}),
  };
}

export function attachCallWebSocket(ws: ServerWebSocket<CallWsData>) {
  const call = sessions.get(ws.data.sessionId);
  if (!call || call.accountId !== ws.data.accountId) {
    ws.close(4403, "invalid session");
    return;
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
}

/** ブラウザからの PCM Int16LE mono @48kHz */
export function ingestCallMicPcm(sessionId: string, data: ArrayBuffer) {
  const call = sessions.get(sessionId);
  if (!call || call.session.state !== "in-call") return;
  const samples = new Int16Array(data);
  if (samples.length === 0) return;
  pushMic(call, { samples, sampleRate: 48000, channels: 1 });
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
        const j = JSON.parse(message) as { type?: string };
        if (j.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch {
        /* */
      }
      return;
    }
    const buf =
      message instanceof Buffer
        ? message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength)
        : message;
    ingestCallMicPcm(ws.data.sessionId, buf as ArrayBuffer);
  },
  close(ws: ServerWebSocket<CallWsData>) {
    const call = sessions.get(ws.data.sessionId);
    call?.wsClients.delete(ws);
  },
};
