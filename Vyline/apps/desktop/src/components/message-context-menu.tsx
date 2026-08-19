import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem = {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  /** 子メニュー（クリックで掘り下げ） */
  children?: MenuItem[];
};

export function MessageContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + rect.width > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8;
    if (nx < 8) nx = 8;
    if (ny < 8) ny = 8;
    setPos({ x: nx, y: ny });
  }, [x, y, items.length]);

  useEffect(() => {
    // 開いた直後の同じ contextmenu / pointerdown で即閉じないよう遅延登録
    let attached = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: Event) => {
      if (!attached) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const attachTimer = window.setTimeout(() => {
      attached = true;
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("contextmenu", onDown, true);
    }, 16);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.clearTimeout(attachTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // 子メニューのドリルダウン（stack の先頭が現在表示中の項目）
  const [stack, setStack] = useState<MenuItem[][]>([items]);
  const current = stack[stack.length - 1] ?? items;
  const isRoot = stack.length === 1;
  useEffect(() => {
    setStack([items]);
  }, [items]);

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="presentation">
      <div
        ref={ref}
        role="menu"
        aria-label="操作メニュー"
        className="vy-scale-in absolute min-w-52 overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] py-1.5 shadow-2xl"
        style={{ left: pos.x, top: pos.y, transformOrigin: "top left" }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!isRoot && (
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setStack((s) => s.slice(0, -1));
            }}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-xs text-[var(--vy-text-dim)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
          >
            <span>←</span>
            戻る
          </button>
        )}
        {current.map((it, i) => (
          <button
            key={`${it.label}-${i}`}
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (it.children?.length) {
                setStack((s) => [...s, it.children!]);
              } else {
                it.onClick?.();
                onClose();
              }
            }}
            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] focus-visible:outline-none ${
              it.danger ? "text-[var(--vy-danger)]" : "text-[var(--vy-text)]"
            }`}
          >
            <span className={it.danger ? "text-[var(--vy-danger)]" : "text-[var(--vy-text-dim)]"}>
              {it.icon}
            </span>
            {it.label}
            {it.children?.length ? (
              <span className="ml-auto text-[var(--vy-text-dim)]">›</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
