import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { IconClose, IconCopyCode, IconSpark } from "@/components/icons";

export function AgentIActionDialog({
  title,
  prompt,
  onClose,
  onApply,
}: {
  title: string;
  prompt: string;
  onClose: () => void;
  onApply?: (text: string) => void;
}) {
  const accountId = useStore((s) => s.accountId);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setError("ログインが必要です");
      setLoading(false);
      return;
    }
    void api.agentI
      .chat(accountId, prompt)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.text) throw new Error(res.error ?? "回答を返しませんでした");
        setResult(res.text);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, prompt]);

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-lg rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <IconSpark size={18} />
          <h2 className="min-w-0 flex-1 text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full p-1.5 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
          >
            <IconClose size={17} />
          </button>
        </div>
        <div className="mt-4 min-h-28 whitespace-pre-wrap rounded-xl bg-[var(--vy-surface-2)] p-3 text-sm leading-relaxed">
          {loading ? "Agent I が処理中…" : error || result}
        </div>
        {!loading && !error && result && (
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(result)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs"
            >
              <IconCopyCode size={14} /> コピー
            </button>
            {onApply && (
              <button
                type="button"
                onClick={() => {
                  onApply(result);
                  onClose();
                }}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)]"
                style={{ background: "var(--vy-accent)" }}
              >
                下書きに反映
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
