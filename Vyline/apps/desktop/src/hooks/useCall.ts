/**
 * useCall — backend 通話セッション + WebSocket PCM ブリッジ
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { isNoAnswerCallFailure, type ActiveCall, type CallUiState } from "@/utils/callAllowlist";

const PCM_FRAME_BYTES = 1920; // 960 samples × 2 @ 48kHz mono 20ms

function friendlyCallError(msg: string): string {
  if (isNoAnswerCallFailure(msg)) return "応答なし";
  if (msg.includes("SIP")) return `通話サーバー応答エラー: ${msg}`;
  return msg;
}

function mapState(s: string): CallUiState {
  if (
    s === "idle" ||
    s === "acquiring" ||
    s === "connecting" ||
    s === "ringing" ||
    s === "in-call" ||
    s === "no-answer" ||
    s === "ending" ||
    s === "ended" ||
    s === "failed"
  ) {
    return s;
  }
  return "failed";
}

export function useCall(accountId: string | null) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackTimeRef = useRef(0);
  const mutedRef = useRef(false);
  const generationRef = useRef(0);
  const callRef = useRef(call);
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const micStartedRef = useRef(false);

  const cleanupMedia = useCallback(() => {
    micStartedRef.current = false;
    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    playbackTimeRef.current = 0;
  }, []);

  const endCall = useCallback(async () => {
    generationRef.current++;
    const sessionId = call?.sessionId;
    cleanupMedia();
    if (sessionId) {
      try {
        await api.line.callEnd(accountId!, sessionId);
      } catch {
        /* */
      }
    }
    setCall(null);
  }, [accountId, call?.sessionId, cleanupMedia]);

  useEffect(() => {
    if (call?.state !== "no-answer") return;
    const timer = window.setTimeout(() => void endCall(), 1_000);
    return () => window.clearTimeout(timer);
  }, [call?.state, endCall]);

  const startMicPipeline = useCallback((ws: WebSocket, generation: number) => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (
        generationRef.current !== generation ||
        wsRef.current !== ws ||
        ws.readyState !== WebSocket.OPEN
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      micStreamRef.current = stream;
      const ctx = audioCtxRef.current ?? new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      micProcessorRef.current = processor;
      processor.onaudioprocess = (ev) => {
        if (ws.readyState !== WebSocket.OPEN || mutedRef.current) return;
        const input = ev.inputBuffer.getChannelData(0);
        const out = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i] ?? 0));
          out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(out.buffer);
      };
      source.connect(processor);
      processor.connect(ctx.destination);
    })().catch(() => {
      /* mic optional */
    });
  }, []);

  const playRemotePcm = useCallback((buf: ArrayBuffer) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const samples = new Int16Array(buf);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      floats[i] = (samples[i] ?? 0) / 0x8000;
    }
    const audioBuf = ctx.createBuffer(1, floats.length, 48000);
    audioBuf.copyToChannel(floats, 0);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    const t = Math.max(ctx.currentTime, playbackTimeRef.current);
    src.start(t);
    playbackTimeRef.current = t + audioBuf.duration;
  }, []);

  const connectWs = useCallback(
    async (sessionId: string, accId: string, generation: number) => {
      let ticket: string;
      try {
        const result = await api.line.callWsTicket(accId, sessionId);
        if (generationRef.current !== generation) return;
        if (!result.ok || !result.ticket)
          throw new Error(result.error ?? "通話接続を認証できませんでした");
        ticket = result.ticket;
      } catch (error) {
        if (generationRef.current !== generation) return;
        setCall((prev) =>
          prev?.sessionId === sessionId
            ? {
                ...prev,
                state: "failed",
                error: error instanceof Error ? error.message : "通話接続に失敗しました",
              }
            : prev,
        );
        return;
      }
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const url = `${scheme}://${location.host}/line/${encodeURIComponent(accId)}/call/ws?sessionId=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(ticket)}`;
      const ws = new WebSocket(url);
      let latestState: CallUiState | null = null;
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        if (generationRef.current !== generation) return;
        if (typeof ev.data === "string") {
          try {
            const j = JSON.parse(ev.data) as {
              type?: string;
              state?: string;
              error?: string;
              transport?: string;
            };
            if (j.type === "state" && j.state) {
              const nextState = mapState(j.state);
              if (generationRef.current !== generation) return;
              const transport =
                j.transport === "planet" || j.transport === "andromeda" || j.transport === "unknown"
                  ? j.transport
                  : undefined;
              const noAnswer = nextState === "failed" && isNoAnswerCallFailure(j.error);
              latestState = noAnswer ? "no-answer" : nextState;
              setCall((prev) =>
                prev
                  ? {
                      ...prev,
                      state: noAnswer ? "no-answer" : nextState,
                      ...(transport ? { transport } : {}),
                      ...(noAnswer
                        ? { error: undefined }
                        : j.error
                          ? { error: friendlyCallError(j.error) }
                          : {}),
                    }
                  : prev,
              );
              if (nextState === "in-call" && !micStartedRef.current) {
                micStartedRef.current = true;
                startMicPipeline(ws, generation);
              } else if (nextState === "ended" || nextState === "failed") {
                cleanupMedia();
              }
            }
          } catch {
            /* */
          }
          return;
        }
        if (ev.data instanceof ArrayBuffer && ev.data.byteLength >= PCM_FRAME_BYTES / 4) {
          playRemotePcm(ev.data);
        }
      };
      ws.onopen = () => {
        if (generationRef.current !== generation || wsRef.current !== ws) return;
        ws.send(JSON.stringify({ type: "ping" }));
      };
      ws.onclose = () => {
        if (
          generationRef.current !== generation ||
          wsRef.current !== ws ||
          latestState === "ended" ||
          latestState === "failed" ||
          latestState === "no-answer"
        ) {
          return;
        }
        setCall((prev) =>
          prev?.sessionId === sessionId &&
          prev.state !== "ended" &&
          prev.state !== "failed" &&
          prev.state !== "no-answer"
            ? { ...prev, state: "failed", error: "通話サーバーとの接続が切れました" }
            : prev,
        );
        cleanupMedia();
      };
    },
    [cleanupMedia, playRemotePcm, startMicPipeline],
  );

  const startCall = useCallback(
    async (to: string, kind: "voice" | "video") => {
      if (!accountId) return { ok: false as const, error: "not logged in" };
      const generation = ++generationRef.current;
      setCall({
        sessionId: "",
        to,
        kind,
        state: "starting",
      });
      const callType = kind === "video" ? "VIDEO" : "AUDIO";
      let res: Awaited<ReturnType<typeof api.line.callStart>>;
      try {
        res = await api.line.callStart(accountId, to, callType);
      } catch (error) {
        if (generationRef.current !== generation)
          return { ok: false as const, error: "call cancelled" };
        const errorMessage = error instanceof Error ? error.message : String(error);
        const noAnswer = isNoAnswerCallFailure(errorMessage);
        setCall({
          sessionId: "",
          to,
          kind,
          state: noAnswer ? "no-answer" : "failed",
          ...(noAnswer ? {} : { error: friendlyCallError(errorMessage) }),
        });
        return { ok: false as const, error: errorMessage };
      }
      if (generationRef.current !== generation) {
        if (res.ok && "session" in res && res.session) {
          void api.line.callEnd(accountId, res.session.sessionId).catch(() => undefined);
        }
        return { ok: false as const, error: "call cancelled" };
      }
      if (!res.ok || !("session" in res) || !res.session) {
        const errMsg = !res.ok && "error" in res ? res.error : "call start failed";
        const noAnswer = isNoAnswerCallFailure(errMsg);
        setCall({
          sessionId: "",
          to,
          kind,
          state: noAnswer ? "no-answer" : "failed",
          ...(noAnswer ? {} : { error: errMsg ? friendlyCallError(errMsg) : "call start failed" }),
        });
        return { ok: false as const, error: errMsg };
      }
      const active: ActiveCall = {
        sessionId: res.session.sessionId,
        to,
        kind,
        state: mapState(res.session.state),
        transport: res.session.transport,
        error: res.session.error ? friendlyCallError(res.session.error) : undefined,
      };
      setCall(active);
      audioCtxRef.current = new AudioContext({ sampleRate: 48000 });
      void connectWs(res.session.sessionId, accountId, generation);
      return { ok: true as const, session: res.session };
    },
    [accountId, connectWs],
  );

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
  }, []);

  useEffect(
    () => () => {
      generationRef.current++;
      const sessionId = callRef.current?.sessionId;
      cleanupMedia();
      if (sessionId && accountId) {
        void api.line.callEnd(accountId, sessionId).catch(() => undefined);
      }
    },
    [accountId, cleanupMedia],
  );

  return { call, startCall, endCall, setMuted, isInCall: call?.state === "in-call" };
}
