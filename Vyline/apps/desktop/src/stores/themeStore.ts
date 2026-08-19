/**
 * stores/themeStore.ts — VyTheme（着せ替え）
 *
 * CSS 変数をランタイムで差し替え、チャット背景・半径なども変更可能。
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VyThemeId = "telegram-night" | "line-dark" | "soft-day" | "custom";

export type VyThemeTokens = {
  accent: string;
  surface0: string;
  surface1: string;
  surface2: string;
  msgIn: string;
  msgOut: string;
  textPrimary: string;
  textSecondary: string;
  chatBgImage?: string | null;
  messageRadiusPx: number;
};

const PRESETS: Record<Exclude<VyThemeId, "custom">, VyThemeTokens> = {
  "telegram-night": {
    accent: "#2aabee",
    surface0: "#0e1621",
    surface1: "#17212b",
    surface2: "#242f3d",
    msgIn: "#182533",
    msgOut: "#2b5278",
    textPrimary: "#f5f5f5",
    textSecondary: "#8b9aab",
    chatBgImage: null,
    messageRadiusPx: 14,
  },
  "line-dark": {
    accent: "#06c755",
    surface0: "#111111",
    surface1: "#1a1a1a",
    surface2: "#2a2a2a",
    msgIn: "#262626",
    msgOut: "#1a3d2e",
    textPrimary: "#f0f0f0",
    textSecondary: "#9a9a9a",
    chatBgImage: null,
    messageRadiusPx: 16,
  },
  "soft-day": {
    accent: "#2aabee",
    surface0: "#e8eef4",
    surface1: "#f7f9fb",
    surface2: "#ffffff",
    msgIn: "#ffffff",
    msgOut: "#d3eaf8",
    textPrimary: "#1a2330",
    textSecondary: "#5a6b7d",
    chatBgImage: null,
    messageRadiusPx: 14,
  },
};

function applyTokens(t: VyThemeTokens): void {
  if (typeof document === "undefined") return;
  const r = document.documentElement;
  const radiusRem = `${t.messageRadiusPx / 16}rem`;

  // 既存 Vyline 互換
  r.style.setProperty("--vy-accent-primary", t.accent);
  r.style.setProperty("--vy-accent-secondary", t.accent);
  r.style.setProperty("--vy-accent-hover", t.accent);
  r.style.setProperty("--vy-surface-0", t.surface0);
  r.style.setProperty("--vy-surface-1", t.surface1);
  r.style.setProperty("--vy-surface-2", t.surface2);
  r.style.setProperty("--vy-bg-primary", t.surface0);
  r.style.setProperty("--vy-bg-secondary", t.surface1);
  r.style.setProperty("--vy-bg-tertiary", t.surface2);
  r.style.setProperty("--vy-bg-chat", t.surface0);
  r.style.setProperty("--vy-msg-in", t.msgIn);
  r.style.setProperty("--vy-msg-out", t.msgOut);
  r.style.setProperty("--vy-text-primary", t.textPrimary);
  r.style.setProperty("--vy-text-secondary", t.textSecondary);
  r.style.setProperty("--vy-message-radius", `${t.messageRadiusPx}px`);

  // VyTheme 互換エイリアス
  r.style.setProperty("--vy-bg", t.surface0);
  r.style.setProperty("--vy-surface", t.surface1);
  r.style.setProperty("--vy-sidebar", t.surface1);
  r.style.setProperty("--vy-text", t.textPrimary);
  r.style.setProperty("--vy-text-dim", t.textSecondary);
  r.style.setProperty("--vy-accent", t.accent);
  r.style.setProperty("--vy-accent-contrast", "#ffffff");
  r.style.setProperty("--vy-border", "rgba(255,255,255,0.07)");
  r.style.setProperty("--vy-msg-in-text", t.textPrimary);
  r.style.setProperty("--vy-msg-out-text", "#ffffff");
  r.style.setProperty("--vy-radius", radiusRem);
  r.style.setProperty("--vy-chat-bg", t.surface0);
  r.style.setProperty("--vy-chat-pattern", "1");

  if (t.chatBgImage) {
    r.style.setProperty("--vy-chat-bg-image", `url(${JSON.stringify(t.chatBgImage)})`);
    r.style.setProperty("--vy-chat-image", `url(${JSON.stringify(t.chatBgImage)})`);
  } else {
    r.style.removeProperty("--vy-chat-bg-image");
    r.style.removeProperty("--vy-chat-image");
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.surface0);
}

type ThemeState = {
  themeId: VyThemeId;
  custom: VyThemeTokens;
  setThemeId: (id: VyThemeId) => void;
  setCustom: (partial: Partial<VyThemeTokens>) => void;
  applyActive: () => void;
  activeTokens: () => VyThemeTokens;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: "telegram-night",
      custom: { ...PRESETS["telegram-night"] },
      setThemeId: (id) => {
        set({ themeId: id });
        get().applyActive();
      },
      setCustom: (partial) => {
        set((s) => ({ custom: { ...s.custom, ...partial }, themeId: "custom" }));
        get().applyActive();
      },
      activeTokens: () => {
        const s = get();
        if (s.themeId === "custom") return s.custom;
        return PRESETS[s.themeId];
      },
      applyActive: () => {
        applyTokens(get().activeTokens());
      },
    }),
    {
      name: "vyline:theme",
      onRehydrateStorage: () => (state) => {
        state?.applyActive();
      },
    },
  ),
);

export const VY_THEME_PRESETS = PRESETS;
