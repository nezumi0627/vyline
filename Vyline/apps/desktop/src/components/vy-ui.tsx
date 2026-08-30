import {
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { lineAvatarUrl } from "@/utils/lineMedia";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ControlSize = "sm" | "md" | "lg";

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  disabled,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      className={cn("vy-button", className)}
    >
      {children}
    </button>
  );
}

export function TextField({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cn("vy-text-field", className)}
    />
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("vy-settings-row", className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--vy-text)]">{title}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

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
      data-state={checked ? "checked" : "unchecked"}
      className="vy-switch-hit"
    >
      <span className="vy-switch-track" aria-hidden>
        <span className="vy-switch-thumb" />
      </span>
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
