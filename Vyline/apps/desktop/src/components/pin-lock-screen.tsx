import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { usePrivacyStore } from "../stores/privacyStore";
import { cn } from "@/lib/utils";
import { IconLock } from "@/components/icons";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

export function PinLockScreen() {
  const unlock = usePrivacyStore((s) => s.unlock);
  const pinLength = useStore((s) => s.settings.pin.length);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState(false);
  const entryRef = useRef("");

  async function submit(value: string) {
    const ok = await unlock(value);
    if (!ok) {
      setError(true);
      setTimeout(() => {
        setError(false);
        entryRef.current = "";
        setEntry("");
      }, 600);
    }
  }

  function push(k: string) {
    if (error) return;
    if (k === "back") {
      entryRef.current = entryRef.current.slice(0, -1);
      setEntry(entryRef.current);
      return;
    }
    if (k === "") return;
    if (entryRef.current.length >= 32) return;
    const next = entryRef.current + k;
    entryRef.current = next;
    setEntry(next);
    // 数字PINは固定長、パスワードは Enter で送信するためここでは満たした時のみ
    if (pinLength > 0 && next.length >= pinLength) submit(next);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (error) return;
      if (/^[0-9]$/.test(e.key)) push(e.key);
      else if (e.key === "Backspace") push("back");
      else if (e.key === "Enter" && entryRef.current.length > 0) submit(entryRef.current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinLength, error]);

  function onPasswordChange(value: string) {
    if (error) return;
    entryRef.current = value;
    setEntry(value);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--vy-bg)] px-6">
      <div className="flex flex-col items-center">
        <div
          className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl text-[var(--vy-accent-contrast)]"
          style={{ background: "var(--vy-accent)" }}
        >
          <IconLock size={30} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--vy-text)]">Vyline</h1>
        <p className="mt-2 text-sm text-[var(--vy-text-dim)]">パスコードを入力してロックを解除</p>

        <div className={cn("mt-8 flex gap-3", error && "animate-[vy-shake_0.4s]")}>
          {Array.from({ length: pinLength }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-3.5 w-3.5 rounded-full border transition-colors",
                i < entry.length ? "bg-[var(--vy-accent)]" : "bg-transparent",
                error
                  ? "border-[var(--vy-danger)]"
                  : "border-[color-mix(in_oklab,var(--vy-text-dim)_60%,transparent)]",
              )}
              style={i < entry.length && !error ? { borderColor: "var(--vy-accent)" } : undefined}
            />
          ))}
        </div>
        <p className="mt-3 h-5 text-xs text-[var(--vy-danger)]">
          {error ? "パスコードが違います" : ""}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-4">
          {KEYS.map((k, i) => (
            <button
              key={i}
              type="button"
              disabled={k === ""}
              onClick={() => push(k)}
              aria-label={k === "back" ? "1文字削除" : k === "" ? undefined : `数字 ${k}`}
              className={cn(
                "flex h-16 w-16 items-center justify-center rounded-full text-2xl font-medium transition-colors outline-none",
                k === "" && "pointer-events-none opacity-0",
                k !== "" &&
                  "text-[var(--vy-text)] hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] active:scale-95",
              )}
            >
              {k === "back" ? "⌫" : k}
            </button>
          ))}
        </div>

        <input
          type="password"
          value={entry}
          onChange={(e) => onPasswordChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && entryRef.current.length > 0) submit(entryRef.current);
          }}
          placeholder="パスワードでも可"
          aria-label="パスワード入力"
          autoFocus
          className="mt-6 w-56 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
        />
        <p className="mt-6 text-xs text-[var(--vy-text-dim)]">ヒント: デモ用パスコードは 1234</p>
      </div>
    </div>
  );
}
