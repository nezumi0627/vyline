import { useState } from "react";
import { cn } from "@/lib/utils";
import { lineAvatarUrl } from "@/utils/lineMedia";

export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vy-surface)]",
        checked
          ? "bg-[var(--vy-accent)]"
          : "bg-[color-mix(in_oklab,var(--vy-text-dim)_35%,transparent)]",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

export function Avatar({
  glyph,
  color,
  size = 44,
  online,
  ring,
  imageUrl,
  icon,
}: {
  glyph: string;
  color: string;
  size?: number;
  online?: boolean;
  ring?: boolean;
  imageUrl?: string;
  /** 文字の代わりに表示するアイコン（Keepメモ など） */
  icon?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const showImg = imageUrl && !broken;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {showImg ? (
        <img
          src={lineAvatarUrl(imageUrl!)}
          alt=""
          onError={() => setBroken(true)}
          className={cn(
            "h-full w-full rounded-full object-cover",
            ring && "ring-2 ring-[var(--vy-accent)] ring-offset-2 ring-offset-[var(--vy-surface)]",
          )}
        />
      ) : (
        <span
          className={cn(
            "flex items-center justify-center rounded-full font-semibold",
            ring && "ring-2 ring-[var(--vy-accent)] ring-offset-2 ring-offset-[var(--vy-surface)]",
          )}
          style={{
            width: size,
            height: size,
            background: `linear-gradient(145deg, ${color}, color-mix(in oklab, ${color} 55%, #000))`,
            fontSize: size * 0.5,
          }}
          aria-hidden
        >
          {icon ?? glyph}
        </span>
      )}
      {online && (
        <span
          className="absolute right-0 bottom-0 rounded-full border-2"
          style={{
            width: size * 0.28,
            height: size * 0.28,
            background: "#3fd07d",
            borderColor: "var(--vy-surface)",
          }}
        />
      )}
    </span>
  );
}
