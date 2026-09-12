/**
 * stores/draftStore.ts — チャットごとの未送信下書き
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

type DraftState = {
  drafts: Record<string, string>;
  setDraft: (accountId: string | null, chatMid: string, text: string) => void;
  clearDraft: (accountId: string | null, chatMid: string) => void;
  getDraft: (accountId: string | null, chatMid: string) => string;
};

const keyOf = (accountId: string | null, chatMid: string) =>
  `${accountId ?? "anonymous"}:${chatMid}`;

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      setDraft: (accountId, chatMid, text) =>
        set((s) => {
          const next = { ...s.drafts };
          const key = keyOf(accountId, chatMid);
          if (!text.trim()) {
            delete next[key];
          } else {
            next[key] = text;
          }
          return { drafts: next };
        }),
      clearDraft: (accountId, chatMid) =>
        set((s) => {
          const next = { ...s.drafts };
          delete next[keyOf(accountId, chatMid)];
          return { drafts: next };
        }),
      getDraft: (accountId, chatMid) => get().drafts[keyOf(accountId, chatMid)] ?? "",
    }),
    { name: "vyline:drafts" },
  ),
);
