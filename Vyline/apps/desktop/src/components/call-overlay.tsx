import { useEffect, useState } from "react";
import { Avatar } from "@/components/vy-ui";
import { IconPhone, IconVideo, IconMic, IconMicOff } from "@/components/icons";
import type { CallUiState } from "@/utils/callAllowlist";

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function statusLabel(state: CallUiState, kind: "voice" | "video"): string {
  switch (state) {
    case "starting":
      return "発信準備中…";
    case "acquiring":
      return "ルート取得中…";
    case "connecting":
      return "接続中…";
    case "ringing":
      return "呼び出し中…（相手の応答を待っています）";
    case "in-call":
      return kind === "video" ? "ビデオ通話中" : "通話中";
    case "ending":
      return "終了中…";
    case "failed":
      return "接続失敗";
    case "ended":
      return "通話終了";
    default:
      return "準備中…";
  }
}

export function CallOverlay({
  kind,
  name,
  glyph,
  color,
  imageUrl,
  state,
  error,
  transport,
  onClose,
  onMutedChange,
}: {
  kind: "voice" | "video";
  name: string;
  glyph: string;
  color: string;
  imageUrl?: string;
  state: CallUiState;
  error?: string;
  transport?: string;
  onClose: () => void;
  onMutedChange?: (muted: boolean) => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const connected = state === "in-call";

  useEffect(() => {
    if (!connected) {
      setSeconds(0);
      return;
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => {
    onMutedChange?.(muted);
  }, [muted, onMutedChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="vy-fade-in fixed inset-0 z-[60] flex flex-col items-center justify-between bg-[var(--vy-bg)]/95 px-6 py-12 backdrop-blur-xl">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <div className="relative">
          {!connected && state !== "failed" && (
            <span
              className="absolute -inset-3 animate-ping rounded-full"
              style={{ background: `color-mix(in oklab, ${color} 30%, transparent)` }}
              aria-hidden
            />
          )}
          <Avatar glyph={glyph} color={color} size={128} imageUrl={imageUrl} />
        </div>
        <div>
          <h2 className="text-2xl font-bold">{name}</h2>
          <p className="mt-2 text-sm text-[var(--vy-text-dim)]">
            {error ?? statusLabel(state, kind)}
          </p>
          {transport && !error && (
            <p className="mt-1 text-xs text-[var(--vy-text-dim)] opacity-70">
              transport: {transport}
            </p>
          )}
          {connected && (
            <p
              className="mt-1 font-mono text-lg tabular-nums"
              style={{ color: "var(--vy-accent)" }}
            >
              {fmt(seconds)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "ミュート解除" : "ミュート"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-text)] transition-transform hover:scale-105 active:scale-95"
        >
          {muted ? <IconMicOff size={22} /> : <IconMic size={22} />}
        </button>
        {kind === "video" && (
          <button
            type="button"
            aria-label="カメラ切替"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-text)] transition-transform hover:scale-105 active:scale-95"
          >
            <IconVideo size={22} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="通話を終了"
          className="flex h-16 w-16 rotate-[135deg] items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
          style={{ background: "var(--vy-danger)" }}
        >
          <IconPhone size={26} />
        </button>
      </div>
    </div>
  );
}
