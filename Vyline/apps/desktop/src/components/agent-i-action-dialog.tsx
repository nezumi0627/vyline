import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { IconClose, IconCopyCode, IconSpark } from "@/components/icons";

export function AgentIActionDialog({
  title,
  prompt,
  sourceText,
  onClose,
  onApply,
}: {
  title: string;
  prompt: string;
  sourceText?: string;
  onClose: () => void;
  onApply?: (text: string) => void;
}) {
  const accountId = useStore((s) => s.accountId);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [instruction, setInstruction] = useState("自然な文章に校正してください");

  const proofreadPrompt = () => {
    const source = sourceText?.trim().slice(0, 3000) ?? "";
    const request = instruction.trim().slice(0, 400);
    return [
      "あなたは短文メッセージの編集者です。元の文章の意味を保ち、ユーザーの指示だけを実行してください。",
      "出力は変更後の文章だけにしてください。解説、前置き、箇条書き、引用符は不要です。",
      "できるだけ短くし、変更が不要なら元の文章をそのまま返してください。目安は800文字以内です。",
      `ユーザーの指示: ${request}`,
      `元の文章:\n${source}`,
    ].join("\n\n");
  };

  const request = (requestPrompt: string) => {
    setLoading(true);
    setError("");
    setResult("");
    void api.agentI
      .chat(accountId!, requestPrompt)
      .then((res) => {
        if (!res.ok || !res.text) throw new Error(res.error ?? "回答を返しませんでした");
        setResult(res.text);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (sourceText) {
      setLoading(false);
      return;
    }
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
  }, [accountId, prompt, sourceText]);

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
        {sourceText && (
          <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3">
            <label className="text-xs font-semibold" htmlFor="agent-i-edit-instruction">
              AIへの指示
            </label>
            <p className="mt-1 text-[11px] text-[var(--vy-text-dim)]">
              例: 英語にしてください / 敬語にしてください / 数字を漢字に変えて /
              計算して答えだけにして
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="agent-i-edit-instruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                maxLength={400}
                className="min-w-0 flex-1 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={loading || !instruction.trim() || !accountId}
                onClick={() => request(proofreadPrompt())}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
                style={{ background: "var(--vy-accent)" }}
              >
                {loading ? "処理中…" : "実行"}
              </button>
            </div>
          </div>
        )}
        {sourceText ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="min-h-28 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--vy-text-dim)]">元の文章</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{sourceText}</p>
            </div>
            <div className="min-h-28 rounded-xl border border-[var(--vy-accent)]/50 bg-[var(--vy-surface-2)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--vy-accent)]">変更後</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {loading
                  ? "Agent I が処理中…"
                  : error || result || "指示を入力して実行してください"}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 min-h-28 whitespace-pre-wrap rounded-xl bg-[var(--vy-surface-2)] p-3 text-sm leading-relaxed">
            {loading ? "Agent I が処理中…" : error || result}
          </div>
        )}
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
