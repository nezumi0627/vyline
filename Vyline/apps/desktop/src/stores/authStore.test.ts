import { describe, expect, test } from "bun:test";
import { api } from "../api/client.js";
import { normalizeAccountId, useAuthStore } from "./authStore.js";

describe("normalizeAccountId", () => {
  test("maps internal content sessions back to the owning account", () => {
    expect(normalizeAccountId("main:content")).toBe("main");
    expect(normalizeAccountId("work")).toBe("work");
    expect(normalizeAccountId(null)).toBeNull();
  });
});

describe("logout lifecycle", () => {
  test("logs out locally without deleting the saved credential", async () => {
    const originalLogout = api.auth.logout;
    const originalAccounts = api.auth.accounts;
    const calls: string[] = [];
    api.auth.logout = async (accountId) => {
      calls.push(accountId);
      return { ok: true, accountId };
    };
    api.auth.accounts = async () => ({
      ok: true,
      active: [],
      saved: ["account-a"],
      sessions: [],
    });
    useAuthStore.setState({ activeAccountId: "account-a", accounts: ["account-a"] });

    try {
      await useAuthStore.getState().logout("account-a");
      expect(calls).toEqual(["account-a"]);
      expect(useAuthStore.getState().activeAccountId).toBeNull();
      expect(useAuthStore.getState().saved).toEqual(["account-a"]);
    } finally {
      api.auth.logout = originalLogout;
      api.auth.accounts = originalAccounts;
      useAuthStore.setState({
        activeAccountId: null,
        accounts: [],
        saved: [],
        sessions: [],
        loading: false,
        initialized: false,
        error: null,
      });
    }
  });
});
