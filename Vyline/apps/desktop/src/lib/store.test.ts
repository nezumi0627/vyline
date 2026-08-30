import { describe, expect, it } from "bun:test";
import { resolveChatToOpen, useStore } from "./store.js";

describe("useStore account initialization", () => {
  it("records every activated chat for the next startup", () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    useStore.setState({ accountId: "account-1", demoMode: true, activeChatId: null });

    useStore.getState()._activateChat("chat-last-opened", { history: false });

    expect(storage.get("vyline:last-opened-chat:account-1")).toBe("chat-last-opened");
  });

  it("restores the account's explicitly last opened chat before chat loading", () => {
    const storage = new Map<string, string>([
      ["vyline:last-opened-chat:account-1", "chat-last-opened"],
    ]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    useStore.setState({ accountId: null, activeChatId: null });

    useStore.getState().setAccountId("account-1");

    expect(useStore.getState().activeChatId).toBe("chat-last-opened");
  });

  it("chooses the saved chat instead of the newest chat-list entry", () => {
    const storage = new Map<string, string>([
      ["vyline:last-opened-chat:account-1", "chat-last-opened"],
    ]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    expect(resolveChatToOpen("account-1", null, ["chat-newest-message", "chat-last-opened"])).toBe(
      "chat-last-opened",
    );
  });

  it("keeps the last opened chat when the persisted account is initialized", () => {
    useStore.setState({
      accountId: null,
      activeChatId: "chat-last-opened",
    });

    useStore.getState().setAccountId("account-1");
    useStore.getState().resetAccountData();

    expect(useStore.getState().activeChatId).toBe("chat-last-opened");
  });

  it("keeps per-chat read-disabled settings during reload hydration", () => {
    useStore.setState({
      accountId: "account-1",
      readDisabledMids: { "chat-read-disabled": true },
    });

    useStore.getState().resetAccountData();

    expect(useStore.getState().readDisabledMids).toEqual({ "chat-read-disabled": true });
  });

  it("clears the last opened chat when switching accounts", () => {
    useStore.setState({
      accountId: "account-1",
      activeChatId: "chat-account-1",
    });

    useStore.getState().setAccountId("account-2");

    expect(useStore.getState().activeChatId).toBeNull();
  });

  it("does not leak the previous account profile into the next account", () => {
    useStore.setState({
      accountId: "account-1",
      self: {
        name: "Account One",
        avatar: "A",
        avatarUrl: "https://example.com/a.png",
        status: "old",
        mid: "u-account-1",
      },
    });

    useStore.getState().setAccountId("account-2");

    expect(useStore.getState().self).toEqual({ name: "Vyline", avatar: "V", status: "" });
  });

  it("hydrates the active account MID along with its profile", () => {
    useStore.setState({ accountId: "account-2", chats: [], messages: [] });

    useStore.getState().hydrateLineData({
      profile: {
        mid: "u-account-2",
        displayName: "Account Two",
        statusMessage: "ready",
      },
      chats: [],
      messages: [],
      hiddenMids: new Set(),
      contactCache: new Map(),
    });

    expect(useStore.getState().self.mid).toBe("u-account-2");
    expect(useStore.getState().self.name).toBe("Account Two");
  });
});
