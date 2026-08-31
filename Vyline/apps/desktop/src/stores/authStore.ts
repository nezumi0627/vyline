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
  activateSubdevice: (accountId: string) => void;
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

      activateSubdevice: (accountId) =>
        set({
          activeAccountId: accountId,
          accounts: [accountId],
          saved: [],
          sessions: [],
          initialized: true,
          loading: false,
          error: null,
          pendingLoginAccountId: null,
          loginMode: "auto",
        }),

      setPendingLogin: (id) => set({ pendingLoginAccountId: id }),

      openLogin: (mode, accountId = null) =>
        set({ loginMode: mode, pendingLoginAccountId: accountId }),

      refreshSessions: async () => {
        if (
          typeof localStorage !== "undefined" &&
          localStorage.getItem("vyline:subdevice-session")
        ) {
          await get().refreshAccounts();
          return;
        }
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
        const subdeviceToken =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("vyline:subdevice-session")
            : null;
        if (subdeviceToken) {
          // A paired browser may only use its assigned account. The owner's
          // /auth/accounts and /auth/restore APIs are deliberately inaccessible.
          const result = await api.subdevices.heartbeat(subdeviceToken);
          if (!result.ok || !result.device) {
            set({ activeAccountId: null, accounts: [], saved: [], sessions: [] });
            throw new Error(
              "サブデバイスの認証が無効です。PC側でQRコードを作成して再接続してください",
            );
          }
          get().activateSubdevice(result.device.accountId);
          return;
        }
        const res = await api.auth.accounts();
        if (!res.ok) return;

        // Backend startup owns the single sequential restore. Calling /restore
        // again here duplicated protocol/storage initialization for every tab.
        const active = res.active;
        const saved = res.saved;
        const sessions = res.sessions ?? [];

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
        // サブデバイスのログアウトは、この端末の選択状態だけを解除する。
        // PC側のLINEセッションと保存済みトークンは共有資産なので削除しない。
        const subdeviceSession =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("vyline:subdevice-session")
            : null;
        if (subdeviceSession) {
          set({ activeAccountId: null, error: null });
          return;
        }

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
