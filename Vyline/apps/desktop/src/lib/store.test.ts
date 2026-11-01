import { describe, expect, it } from "bun:test";
import { accountDraftKey, resolveChatToOpen, useStore } from "./store.js";

describe("useStore account initialization", () => {
  it("does not persist the last active chat for the next startup", () => {
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

    expect(storage.has("vyline:last-opened-chat:account-1")).toBe(false);
  });

  it("does not restore a previously opened chat when selecting an account", () => {
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

    expect(useStore.getState().activeChatId).toBeNull();
  });

  it("opens only an explicit active chat that still exists", () => {
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

    expect(
      resolveChatToOpen("account-1", null, ["chat-newest-message", "chat-last-opened"]),
    ).toBeNull();
    expect(
      resolveChatToOpen("account-1", "chat-last-opened", [
        "chat-newest-message",
        "chat-last-opened",
      ]),
    ).toBe("chat-last-opened");
  });

  it("does not restore the active chat while resetting account data", () => {
    useStore.setState({
      accountId: null,
      activeChatId: "chat-last-opened",
    });

    useStore.getState().setAccountId("account-1");
    useStore.getState().resetAccountData();

    expect(useStore.getState().activeChatId).toBeNull();
  });

  it("clears per-chat read-disabled settings when resetting account data", () => {
    useStore.setState({
      accountId: "account-1",
      readDisabledMids: { "chat-read-disabled": true },
    });

    useStore.getState().resetAccountData();

    expect(useStore.getState().readDisabledMids).toEqual({});
  });

  it("clears the last opened chat when switching accounts", () => {
    useStore.setState({
      accountId: "account-1",
      activeChatId: "chat-account-1",
    });

    useStore.getState().setAccountId("account-2");

    expect(useStore.getState().activeChatId).toBeNull();
  });

  it("keeps drafts isolated by account", () => {
    useStore.setState({ accountId: "account-1", drafts: {} });
    useStore.getState().setDraft("shared-chat", "account one draft");
    useStore.getState().setAccountId("account-2");
    useStore.getState().setDraft("shared-chat", "account two draft");

    expect(useStore.getState().drafts[accountDraftKey("account-1", "shared-chat")]).toBe(
      "account one draft",
    );
    expect(useStore.getState().drafts[accountDraftKey("account-2", "shared-chat")]).toBe(
      "account two draft",
    );
  });
});
