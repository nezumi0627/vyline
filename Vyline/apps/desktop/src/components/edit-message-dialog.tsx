import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose, IconEdit } from "@/components/icons";

interface EditMessageDialogProps {
  initialText: string;
  onSave: (newText: string) => Promise<void> | void;
  onClose: () => void;
}

export function EditMessageDialog({ initialText, onSave, onClose }: EditMessageDialogProps) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // マウント時にテキストエリアをフォーカスし末尾にカーソルを合わせる
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === initialText.trim() || saving) return;
    try {
      setSaving(true);
      await onSave(trimmed);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter or Enter (without Shift if preferred)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      void handleSave();
    }
  };

  const hasChanged = text.trim().length > 0 && text.trim() !== initialText.trim();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="メッセージを編集"
    >
      {/* 背景オーバーレイ */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* モーダル本体 */}
      <div className="vy-scale-in relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-2xl transition-all">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-[var(--vy-border)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--vy-text)]">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--vy-accent)_15%,transparent)] text-[var(--vy-accent)]">
              <IconEdit size={16} />
            </span>
            <span>メッセージを編集</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
          >
            <IconClose size={16} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-5">
          <label htmlFor="edit-message-input" className="sr-only">
            編集後のメッセージ
          </label>
          <textarea
            id="edit-message-input"
            ref={textareaRef}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力…"
            className="vy-scroll max-h-60 w-full resize-y rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3 text-sm leading-relaxed text-[var(--vy-text)] outline-none transition-all placeholder:text-[var(--vy-text-dim)] focus:border-[var(--vy-accent)] focus:ring-1 focus:ring-[var(--vy-accent)]"
          />

          <div className="mt-2 flex items-center justify-between text-xs text-[var(--vy-text-dim)]">
            <span>Enter / Ctrl+Enter で保存 · Esc でキャンセル</span>
            <span>{text.length} 文字</span>
          </div>
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--vy-text)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanged || saving}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium text-[var(--vy-accent-contrast)] transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--vy-accent)" }}
          >
            {saving ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span>保存中…</span>
              </>
            ) : (
              <span>保存する</span>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
