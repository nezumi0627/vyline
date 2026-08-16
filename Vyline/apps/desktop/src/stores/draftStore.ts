/**
 * stores/draftStore.ts — チャットごとの未送信下書き
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

type DraftState = {
  drafts: Record<string, string>;
  setDraft: (chatMid: string, text: string) => void;
  clearDraft: (chatMid: string) => void;
  getDraft: (chatMid: string) => string;
};

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      setDraft: (chatMid, text) =>
        set((s) => {
          const next = { ...s.drafts };
          if (!text.trim()) {
            delete next[chatMid];
          } else {
            next[chatMid] = text;
          }
          return { drafts: next };
        }),
      clearDraft: (chatMid) =>
        set((s) => {
          const next = { ...s.drafts };
          delete next[chatMid];
          return { drafts: next };
        }),
      getDraft: (chatMid) => get().drafts[chatMid] ?? "",
    }),
    { name: "vyline:drafts" },
  ),
);
