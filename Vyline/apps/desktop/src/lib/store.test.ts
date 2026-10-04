import { describe, expect, it } from "bun:test";
import { accountDraftKey, resolveChatToOpen, useStore } from "./store.js";

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

// --- 未読区切り（ここから未読）と既読無効の挙動 -------------------------

const makeChat = (id: string, unread: number) =>
  ({
    id,
    type: "friend",
    name: "peer",
    avatar: "P",
    color: "#000000",
    status: "",
    unread,
  }) as never;

const makeMessage = (id: string, chatId: string, createdAt: number, read: boolean) =>
  ({
    id,
    chatId,
    authorId: "peer",
    kind: "text",
    text: id,
    createdAt,
    status: read ? "read" : "sent",
    read,
    messageState: "normal",
  }) as never;

const withFetchStub = async <T>(run: () => Promise<T>): Promise<T> => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => "{}",
  })) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
};

describe("useStore unread divider", () => {
  it("does not clear read state or the divider when the chat has read receipts disabled", async () => {
    useStore.setState({
      accountId: "account-1",
      demoMode: false,
      readDisabledMids: { "chat-disabled": true },
      chats: [makeChat("chat-disabled", 3)],
      messages: [makeMessage("m-1", "chat-disabled", 10, false)],
      activeChatId: "chat-disabled",
      initialChatScrollMessageId: "m-1",
      initialChatScrollMode: "unread",
      unreadAnchors: { "chat-disabled": "m-1" },
    });

    await withFetchStub(() => useStore.getState().markChatRead("chat-disabled"));

    const state = useStore.getState();
    expect(state.messages[0]!.read).toBe(false);
    expect(state.chats[0]!.unread).toBe(3);
    expect(state.initialChatScrollMessageId).toBe("m-1");
    expect(state.unreadAnchors["chat-disabled"]).toBe("m-1");
  });

  it("does not clear read state when read receipts are off globally", async () => {
    useStore.setState({
      settings: { ...useStore.getState().settings, readReceipts: false },
      accountId: "account-1",
      demoMode: false,
      readDisabledMids: {},
      chats: [makeChat("chat-global-off", 2)],
      messages: [makeMessage("m-1", "chat-global-off", 10, false)],
      activeChatId: "chat-global-off",
      initialChatScrollMessageId: "m-1",
      initialChatScrollMode: "unread",
    });

    await withFetchStub(() => useStore.getState().markChatRead("chat-global-off"));

    const state = useStore.getState();
    expect(state.messages[0]!.read).toBe(false);
    expect(state.chats[0]!.unread).toBe(2);
    expect(state.initialChatScrollMessageId).toBe("m-1");
  });

  it("keeps the badge and anchors the unread boundary when read receipts are disabled", async () => {
    useStore.setState({
      accountId: "account-1",
      demoMode: false,
      readDisabledMids: { "chat-anchor": true },
      chats: [makeChat("chat-anchor", 4)],
      messages: [
        makeMessage("m-1", "chat-anchor", 10, true),
        makeMessage("m-2", "chat-anchor", 20, false),
        makeMessage("m-3", "chat-anchor", 30, false),
      ],
      activeChatId: null,
      initialChatScrollMessageId: null,
      initialChatScrollMode: null,
      unreadAnchors: {},
    });

    await withFetchStub(async () => {
      useStore.getState()._activateChat("chat-anchor");
    });

    const state = useStore.getState();
    expect(state.activeChatId).toBe("chat-anchor");
    expect(state.initialChatScrollMessageId).toBe("m-2");
    expect(state.initialChatScrollMode).toBe("unread");
    expect(state.unreadAnchors["chat-anchor"]).toBe("m-2");
    expect(state.chats[0]!.unread).toBe(4);
    expect(state.messages.every((message) => !message.read || message.id === "m-1")).toBe(true);
  });

  it("falls back to the last message position when there is no unread", async () => {
    useStore.setState({
      accountId: "account-1",
      demoMode: false,
      readDisabledMids: {},
      chats: [makeChat("chat-read-all", 0)],
      messages: [makeMessage("m-1", "chat-read-all", 10, true)],
      activeChatId: null,
      initialChatScrollMessageId: "stale-id",
      initialChatScrollMode: "unread",
      unreadAnchors: {},
    });

    await withFetchStub(async () => {
      useStore.getState()._activateChat("chat-read-all");
    });

    const state = useStore.getState();
    expect(state.initialChatScrollMessageId).toBeNull();
    expect(state.initialChatScrollMode).toBe("bottom");
  });

  it("clears the divider and the anchor once read receipts are sent", async () => {
    useStore.setState({
      settings: { ...useStore.getState().settings, readReceipts: true },
      accountId: "account-1",
      demoMode: false,
      readDisabledMids: {},
      chats: [makeChat("chat-enabled", 1)],
      messages: [makeMessage("900", "chat-enabled", 10, false)],
      activeChatId: "chat-enabled",
      initialChatScrollMessageId: "900",
      initialChatScrollMode: "unread",
      unreadAnchors: { "chat-enabled": "900" },
    });

    await withFetchStub(() => useStore.getState().markChatRead("chat-enabled"));

    const state = useStore.getState();
    expect(state.messages[0]!.read).toBe(true);
    expect(state.chats[0]!.unread).toBe(0);
    expect(state.initialChatScrollMessageId).toBeNull();
    expect(state.unreadAnchors["chat-enabled"]).toBeUndefined();
  });
});

describe("useStore unreadAnchors persistence", () => {
  it("keeps the anchors when account data is reset on reload", () => {
    useStore.setState({ unreadAnchors: { "chat-kept": "m-1" } });

    useStore.getState().resetAccountData();

    expect(useStore.getState().unreadAnchors).toEqual({ "chat-kept": "m-1" });
  });
});
