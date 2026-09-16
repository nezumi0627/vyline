import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useControllerDialogSnapshot } from "@/ui/controller-dialog";
import { isComposeMode, useDesignSystemStore } from "@/ui/design-system-store";
import { useControllerPresentation } from "@/ui/native-controller-surface";

/**
 * Legacy/Nezu DOM fallback for `requestControllerConfirm` / `requestControllerPrompt`.
 * Compose modes render the snapshot in Kotlin; the DOM modes previously fell back
 * to blocking `window.confirm`/`window.prompt` inline at each call site.
 */
export function LegacyControllerDialogHost() {
  const mode = useDesignSystemStore((state) => state.mode);
  const snapshot = useControllerDialogSnapshot();
  const controller = useControllerPresentation();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isComposeMode(mode) || controller || !snapshot) return;
    // autoFocus is intentionally avoided (a11y lint + competing focus owners);
    // move initial focus imperatively to the requested first control instead.
    const target = snapshot.prompt
      ? inputRef.current
      : snapshot.cancelFirst
        ? cancelRef.current
        : acceptRef.current;
    target?.focus();
  }, [mode, controller, snapshot]);

  if (isComposeMode(mode) || controller || !snapshot) return null;

  const dialog = snapshot;
  const close = (value: string | null) => {
    // Dynamically imported to avoid a render-time cycle with the store snapshot.
    void import("@/ui/controller-dialog").then((module) =>
      module.closeControllerDialog(dialog.id, value),
    );
  };

  return createPortal(
    <div
      className="vy-fade-in fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(null);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={dialog.title ?? "確認"}
        aria-describedby="legacy-controller-dialog-text"
        className="vy-scale-in w-full max-w-sm rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-5 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close(null);
          }
        }}
      >
        {dialog.title && (
          <h2 className="text-base font-semibold text-[var(--vy-text)]">{dialog.title}</h2>
        )}
        <p
          id="legacy-controller-dialog-text"
          className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--vy-text)]"
        >
          {dialog.text}
        </p>
        {dialog.prompt && (
          <input
            ref={inputRef}
            defaultValue={dialog.value}
            aria-label="入力"
            className="mt-3 w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm text-[var(--vy-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
            onKeyDown={(event) => {
              if (event.key === "Enter") close(inputRef.current?.value ?? dialog.value);
            }}
          />
        )}
        <div
          className={`mt-4 flex gap-2 ${dialog.cancelFirst ? "flex-col-reverse sm:flex-row-reverse" : "flex-col sm:flex-row"} sm:justify-end`}
        >
          <button
            type="button"
            ref={cancelRef}
            // Cancel-first focus order is an explicit per-dialog opt-in; the DOM
            // order stays accept/cancel so screen readers keep a stable reading.
            onClick={() => close(null)}
            className="min-h-11 flex-1 rounded-xl border border-[var(--vy-border)] px-4 py-2 text-sm font-medium text-[var(--vy-text)] transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
          >
            キャンセル
          </button>
          <button
            type="button"
            ref={acceptRef}
            onClick={() =>
              close(dialog.prompt ? (inputRef.current?.value ?? dialog.value) : "")
            }
            className="min-h-11 flex-1 rounded-xl bg-[var(--vy-accent)] px-4 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
          >
            {dialog.acceptLabel ?? "実行"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
