/**
 * stores/privacyStore.ts — パスコード（ローカルのみ、解除まで通信しないゲート用）
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type PrivacyState = {
  pinEnabled: boolean;
  pinHash: string | null;
  unlocked: boolean;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => void;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
};

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set, get) => ({
      pinEnabled: false,
      pinHash: null,
      unlocked: true,
      setPin: async (pin) => {
        if (!pin || pin.length < 1) {
          throw new Error("パスコードを入力してください");
        }
        const pinHash = await sha256Hex(`vyline-pin:${pin}`);
        set({ pinEnabled: true, pinHash, unlocked: true });
      },
      clearPin: () => set({ pinEnabled: false, pinHash: null, unlocked: true }),
      unlock: async (pin) => {
        const { pinHash } = get();
        if (!pinHash) {
          set({ unlocked: true });
          return true;
        }
        const guess = await sha256Hex(`vyline-pin:${pin}`);
        const ok = guess === pinHash;
        if (ok) set({ unlocked: true });
        return ok;
      },
      lock: () => {
        if (get().pinEnabled) set({ unlocked: false });
      },
    }),
    {
      name: "vyline:privacy",
      partialize: (s) => ({
        pinEnabled: s.pinEnabled,
        pinHash: s.pinHash,
        // 起動時は必ずロック
        unlocked: false,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.pinEnabled) state.lock();
      },
    },
  ),
);
