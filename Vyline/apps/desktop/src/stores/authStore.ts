/**
 * stores/authStore.ts
 *
 * 認証状態の管理。
 * - backend の tokens.json に authToken を保存
 * - 起動時に saved → restore → active を復元
 * - activeAccountId は localStorage に永続化
 * - ログイン画面用に sessions メタを保持
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "../api/client.js";
import type { SavedSession } from "@vyline/types";

interface AuthState {
  activeAccountId: string | null;
  accounts: string[];
  saved: string[];
  sessions: SavedSession[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  /** ログイン画面で事前選択するアカウント（アカウント追加・切替時） */
  pendingLoginAccountId: string | null;
  /** login 画面を開いた理由。auto=起動時のみ / manual=サイドバーからの追加・切替 */
  loginMode: "auto" | "manual";

  setActiveAccount: (id: string) => void;
  setPendingLogin: (id: string | null) => void;
  /** ログイン画面を開く。manual の場合は戻るボタンを表示する */
  openLogin: (mode: "auto" | "manual", accountId?: string | null) => void;
  /** 保存済みトークンを restore し、active 一覧を更新 */
  refreshAccounts: () => Promise<void>;
  /** 自動 restore せず一覧だけ更新（ログイン画面用） */
  refreshSessions: () => Promise<void>;
  bootstrap: () => Promise<void>;
  loginEmail: (
    accountId: string,
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  loginQrStart: (accountId: string) => Promise<{ ok: boolean; error?: string }>;
  loginToken: (accountId: string, authToken: string) => Promise<{ ok: boolean; error?: string }>;
  restore: (accountId: string) => Promise<{ ok: boolean; error?: string }>;
  switchAccount: (accountId: string) => Promise<{ ok: boolean; error?: string }>;
  deleteSession: (accountId: string) => Promise<void>;
  logout: (accountId: string) => Promise<void>;
  onLoginSuccess: (accountId: string) => Promise<void>;
}

const BACKEND_STARTUP_BACKOFF_MS = 500;
const BACKEND_STARTUP_BACKOFF_MAX_MS = 5_000;

function isBackendStartupError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("backend に接続できません") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      activeAccountId: null,
      accounts: [],
      saved: [],
      sessions: [],
      loading: false,
      initialized: false,
      error: null,
      pendingLoginAccountId: null,
      loginMode: "auto",

      setActiveAccount: (id) => set({ activeAccountId: id }),

      setPendingLogin: (id) => set({ pendingLoginAccountId: id }),

      openLogin: (mode, accountId = null) =>
        set({ loginMode: mode, pendingLoginAccountId: accountId }),

      refreshSessions: async () => {
        const res = await api.auth.sessions();
        if (!res.ok) return;
        const accountsRes = await api.auth.accounts();
        set({
          sessions: res.sessions ?? [],
          accounts: accountsRes.ok ? accountsRes.active : get().accounts,
          saved: accountsRes.ok ? accountsRes.saved : get().saved,
        });
      },

      refreshAccounts: async () => {
        const res = await api.auth.accounts();
        if (!res.ok) return;

        let active = res.active;
        let saved = res.saved;
        let sessions = res.sessions ?? [];

        // メモリに無いが tokens.json にある → restore
        const missing = saved.filter((id) => !active.includes(id));
        if (missing.length > 0) {
          await Promise.allSettled(missing.map((id) => api.auth.restore(id)));
          const again = await api.auth.accounts();
          if (again.ok) {
            active = again.active;
            saved = again.saved;
            sessions = again.sessions ?? sessions;
          }
        }

        set({ accounts: active, saved, sessions });

        const current = get().activeAccountId;
        if (active.length === 0) {
          set({ activeAccountId: null });
        } else if (!current || !active.includes(current)) {
          set({ activeAccountId: active[0] ?? null });
        }
      },

      bootstrap: async () => {
        if (get().initialized) return;
        set({ loading: true, error: null });
        try {
          let backoff = BACKEND_STARTUP_BACKOFF_MS;
          // backend 起動待ちの間はエラー化せず、接続できるまで静かに待つ
          for (;;) {
            try {
              await get().refreshAccounts();
              break;
            } catch (err) {
              if (!isBackendStartupError(err)) {
                throw err;
              }
              await sleep(backoff);
              backoff = Math.min(backoff * 1.5, BACKEND_STARTUP_BACKOFF_MAX_MS);
            }
          }
        } catch (err) {
          set({ error: String(err) });
        } finally {
          set({ loading: false, initialized: true });
        }
      },

      onLoginSuccess: async (accountId) => {
        set({
          activeAccountId: accountId,
          error: null,
          loginMode: "auto",
          pendingLoginAccountId: null,
        });
        // 少し待ってトークン保存・プロフィール追記を待つ
        await new Promise((r) => setTimeout(r, 400));
        await get().refreshAccounts();
        set({ activeAccountId: accountId });
      },

      loginEmail: async (accountId, email, password) => {
        set({ loading: true, error: null });
        try {
          const res = await api.auth.loginEmail({ accountId, email, password });
          if (!res.ok) {
            const message = res.error ?? "login failed";
            set({ error: message });
            return { ok: false, error: message };
          }
          return { ok: true };
        } catch (err) {
          const message = String(err);
          set({ error: message });
          return { ok: false, error: message };
        } finally {
          set({ loading: false });
        }
      },

      loginQrStart: async (accountId) => {
        set({ loading: true, error: null });
        try {
          const res = await api.auth.loginQrStart(accountId);
          if (!res.ok) {
            const message = res.error ?? "QR login start failed";
            set({ error: message });
            return { ok: false, error: message };
          }
          return { ok: true };
        } catch (err) {
          const message = String(err);
          set({ error: message });
          return { ok: false, error: message };
        } finally {
          set({ loading: false });
        }
      },

      loginToken: async (accountId, authToken) => {
        set({ loading: true, error: null });
        try {
          const res = await api.auth.loginToken({ accountId, authToken });
          if (!res.ok) {
            const message = res.error ?? "token login failed";
            set({ error: message });
            return { ok: false, error: message };
          }
          await get().refreshAccounts();
          set({ activeAccountId: accountId });
          return { ok: true };
        } catch (err) {
          const message = String(err);
          set({ error: message });
          return { ok: false, error: message };
        } finally {
          set({ loading: false });
        }
      },

      restore: async (accountId) => {
        set({ loading: true, error: null });
        try {
          const res = await api.auth.restore(accountId);
          if (!res.ok) {
            const message = res.error ?? "restore failed";
            set({ error: message });
            return { ok: false, error: message };
          }
          await get().refreshAccounts();
          set({ activeAccountId: accountId });
          return { ok: true };
        } catch (err) {
          const message = String(err);
          set({ error: message });
          return { ok: false, error: message };
        } finally {
          set({ loading: false });
        }
      },

      switchAccount: async (accountId) => {
        set({ loading: true, error: null });
        try {
          const res = await api.auth.switch_(accountId);
          if (!res.ok) {
            const message = res.error ?? "switch failed";
            set({ error: message });
            return { ok: false, error: message };
          }
          await get().refreshAccounts();
          set({ activeAccountId: accountId });
          return { ok: true };
        } catch (err) {
          const message = String(err);
          set({ error: message });
          return { ok: false, error: message };
        } finally {
          set({ loading: false });
        }
      },

      deleteSession: async (accountId) => {
        await api.auth.deleteSession(accountId, { logout: true });
        await get().refreshSessions();
        if (get().activeAccountId === accountId) {
          set({ activeAccountId: get().accounts[0] ?? null });
        }
      },

      logout: async (accountId) => {
        await api.auth.deleteAccount(accountId);
        await get().refreshAccounts();
        if (get().activeAccountId === accountId) {
          set({ activeAccountId: get().accounts[0] ?? null });
        }
      },
    }),
    {
      name: "vyline:auth",
      partialize: (s) => ({ activeAccountId: s.activeAccountId }),
    },
  ),
);
