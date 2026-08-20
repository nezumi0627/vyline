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
  pinMode: "pin" | "password";
  pinHash: string | null;
  unlocked: boolean;
  setPin: (pin: string, mode?: "pin" | "password") => Promise<void>;
  clearPin: () => void;
  unlock: (pin: string, mode?: "pin" | "password") => Promise<boolean>;
  lock: () => void;
};

export const usePrivacyStore = create<PrivacyState>()(
  persist(
  (set, get) => ({
    pinEnabled: false,
    pinMode: "pin",
    pinHash: null,
    unlocked: true,
    setPin: async (pin, mode = "pin") => {
      if (mode === "pin") {
        const digits = pin.replace(/\D/g, "");
        if (digits.length < 4 || digits.length > 8) {
          throw new Error("PIN は 4〜8 桁の数字にしてください");
        }
        const pinHash = await sha256Hex(`vyline-pin:${digits}`);
        set({ pinEnabled: true, pinMode: "pin", pinHash, unlocked: true });
      } else {
        if (pin.length < 1) {
          throw new Error("パスワードを入力してください");
        }
        const pinHash = await sha256Hex(`vyline-password:${pin}`);
        set({ pinEnabled: true, pinMode: "password", pinHash, unlocked: true });
      }
    },
    clearPin: () => set({ pinEnabled: false, pinMode: "pin", pinHash: null, unlocked: true }),
    unlock: async (pin, mode = "pin") => {
      const { pinHash } = get();
      if (!pinHash) {
        set({ unlocked: true });
        return true;
      }
      let guess: string;
      if (mode === "pin") {
        guess = await sha256Hex(`vyline-pin:${pin.replace(/\D/g, "")}`);
      } else {
        guess = await sha256Hex(`vyline-password:${pin}`);
      }
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
        pinMode: s.pinMode,
        pinHash: s.pinHash,
        unlocked: false,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.pinEnabled) state.lock();
      },
    },
  ),
);
