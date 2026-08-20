/**
 * stores/settingsStore.ts — ローカル設定（localStorage）
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SettingsState = {
  /** チャットを開いたら自動既読（相手へ既読を送る） */
  autoMarkAsRead: boolean;
  /** 自分の送信に既読表示 */
  showReadReceipts: boolean;
  /** グループ既読者の mid / 名前を表示 */
  showReadByList: boolean;
  /** 一覧に未読数バッジを表示 */
  showUnreadBadge: boolean;
  /** 配信者モード: 友達・グループ名を伏せる */
  streamerMode: boolean;
  /** コンパクト表示（行間・余白を詰める） */
  compactDensity: boolean;
  /** 吹き出しのしっぽ */
  bubbleTail: boolean;
  /** Enter で送信 */
  enterToSend: boolean;
  /** フォント倍率 */
  fontScale: number;
  /** モバイルプッシュ通知の有効/無効 */
  notificationsEnabled: boolean;
  setAutoMarkAsRead: (v: boolean) => void;
  setShowReadReceipts: (v: boolean) => void;
  setShowReadByList: (v: boolean) => void;
  setShowUnreadBadge: (v: boolean) => void;
  setStreamerMode: (v: boolean) => void;
  setCompactDensity: (v: boolean) => void;
  setBubbleTail: (v: boolean) => void;
  setEnterToSend: (v: boolean) => void;
  setFontScale: (v: number) => void;
  setNotificationsEnabled: (v: boolean) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoMarkAsRead: true,
      showReadReceipts: true,
      showReadByList: false,
      showUnreadBadge: true,
      streamerMode: false,
      compactDensity: false,
      bubbleTail: true,
      enterToSend: true,
      fontScale: 1,
      notificationsEnabled: true,
      setAutoMarkAsRead: (v) => set({ autoMarkAsRead: v }),
      setShowReadReceipts: (v) => set({ showReadReceipts: v }),
      setShowReadByList: (v) => set({ showReadByList: v }),
      setShowUnreadBadge: (v) => set({ showUnreadBadge: v }),
      setStreamerMode: (v) => set({ streamerMode: v }),
      setCompactDensity: (v) => set({ compactDensity: v }),
      setBubbleTail: (v) => set({ bubbleTail: v }),
      setEnterToSend: (v) => set({ enterToSend: v }),
      setFontScale: (v) => set({ fontScale: Math.min(1.25, Math.max(0.85, v)) }),
      setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
    }),
    { name: "vyline:settings" },
  ),
);
