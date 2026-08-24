import { useLayoutEffect } from "react";
import { useStore } from "@/lib/store";

/** Applies the active VyTheme + display settings to the document root. */
export function ThemeApplier() {
  const theme = useStore((s) => s.theme);
  const fontScale = useStore((s) => s.settings.fontScale);
  const compact = useStore((s) => s.settings.compactDensity);
  const animationMode = useStore((s) => s.settings.animationMode);

  useLayoutEffect(() => {
    const r = document.documentElement;
    const map: Record<string, string> = {
      "--vy-bg": theme.bg,
      "--vy-surface": theme.surface,
      "--vy-surface-2": theme.surface2,
      "--vy-sidebar": theme.sidebar,
      "--vy-text": theme.text,
      "--vy-text-dim": theme.textDim,
      "--vy-accent": theme.accent,
      "--vy-accent-contrast": theme.accentContrast,
      "--vy-border": theme.border,
      "--vy-msg-in": theme.msgIn,
      "--vy-msg-out": theme.msgOut,
      "--vy-msg-in-text": theme.msgInText,
      "--vy-msg-out-text": theme.msgOutText,
      "--vy-radius": `${theme.radius}rem`,
      "--vy-message-radius": `${theme.radius}rem`,
      "--vy-chat-bg": theme.chatBg,
      "--vy-chat-pattern": String(theme.pattern),
    };
    for (const [k, v] of Object.entries(map)) r.style.setProperty(k, v);
    if (theme.chatImage) {
      r.style.setProperty("--vy-chat-image", `url(${theme.chatImage})`);
    } else {
      r.style.removeProperty("--vy-chat-image");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.bg);
  }, [theme]);

  useLayoutEffect(() => {
    // 文字サイズのみ（ルート rem をいじるとレイアウト全体が拡大してしまう）
    const scale = Number.isFinite(fontScale) ? fontScale : 1;
    document.documentElement.style.setProperty("--vy-font-scale", String(scale));
    document.documentElement.style.fontSize = "";
    document.documentElement.dataset.fontScale = String(scale);
  }, [fontScale]);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("vy-compact", compact);
    document.documentElement.dataset.compact = compact ? "1" : "0";
  }, [compact]);

  useLayoutEffect(() => {
    document.documentElement.dataset.animationMode = animationMode ?? "vyline";
  }, [animationMode]);

  return null;
}
