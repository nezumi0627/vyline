import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { api } from "../api/client.js";
import { mapMessage } from "./mappers.js";
import { onAppEvent, type AppEventMap } from "./appEvents.js";
import { isResolvedMemberProfileName, resolveChatToOpen, useStore } from "./store.js";

describe("useStore account initialization", () => {
  it("does not restore the last opened chat when an account initializes", () => {
    const storage = new Map<string, string>();
    storage.set("vyline:last-opened-chat:account-1", "chat-last-opened");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    useStore.setState({
      accountId: null,
      activeChatId: "persisted-chat",
      chatPaneIds: ["persisted-chat"],
      chatPaneSizes: [100],
      focusedChatPane: 0,
    });

    useStore.getState().setAccountId("account-1");

    expect(useStore.getState().activeChatId).toBeNull();
    expect(useStore.getState().chatPaneIds).toEqual([]);
  });

  it("does not auto-select the newest chat but preserves an explicit valid selection", () => {
    const available = ["chat-newest-message", "chat-selected"];
    expect(resolveChatToOpen("account-1", null, available)).toBeNull();
    expect(resolveChatToOpen("account-1", "chat-selected", available)).toBe("chat-selected");
    expect(resolveChatToOpen("account-1", "missing", available)).toBeNull();
  });

  it("resets the account into the chat-selection state", () => {
    useStore.setState({
      accountId: "account-1",
      activeChatId: "chat-open",
      chatPaneIds: ["chat-open"],
      chatPaneSizes: [100],
      focusedChatPane: 0,
    });

    useStore.getState().resetAccountData();

    expect(useStore.getState().activeChatId).toBeNull();
    expect(useStore.getState().chatPaneIds).toEqual([]);
    expect(useStore.getState().chatPaneSizes).toEqual([]);
  });

  it("opens an explicitly selected chat at the latest-message position", () => {
    useStore.setState({
      accountId: "account-1",
      demoMode: true,
      activeChatId: null,
      chatPaneIds: [],
      chatPaneSizes: [],
      focusedChatPane: 0,
      chats: [
        {
          id: "chat-unread",
          type: "friend",
          name: "Unread",
          avatar: "U",
          color: "#000",
          status: "",
          unread: 4,
        },
      ],
      messages: [],
    });

    useStore.getState()._activateChat("chat-unread", { history: false });

    expect(useStore.getState().activeChatId).toBe("chat-unread");
    expect(useStore.getState().initialChatScrollMessageId).toBeNull();
    expect(useStore.getState().initialChatScrollMode).toBe("bottom");
    expect(useStore.getState().chats[0]?.unread).toBe(0);
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

describe("incoming call lifecycle", () => {
  it("receives a new call while the active chat delta is pending without duplicating the delta", async () => {
    const previousState = useStore.getState();
    const originalPollEvents = api.line.pollEvents;
    const originalMessagesDelta = api.line.messagesDelta;
    const accountId = "account-call-during-pending-delta";
    const callerMid = "u0123456789abcdef0123456789abcdef";
    const receivedAt = Date.now();
    let callAvailable = false;
    let deltaRequests = 0;
    let finishDelta!: (result: Awaited<ReturnType<typeof originalMessagesDelta>>) => void;
    const pendingDelta = new Promise<Awaited<ReturnType<typeof originalMessagesDelta>>>(
      (resolve) => {
        finishDelta = resolve;
      },
    );
    const polls: Promise<void>[] = [];
    api.line.messagesDelta = () => {
      deltaRequests += 1;
      return pendingDelta;
    };
    api.line.pollEvents = async () => ({
      ok: true,
      cursor: callAvailable ? 1 : 0,
      events: callAvailable
        ? [
            {
              kind: "call:incoming",
              seq: 1,
              callMid: "r-call-during-pending-delta",
              chatMid: callerMid,
              callerMid,
              callType: "audio",
              receivedAt,
            },
          ]
        : [],
    });

    try {
      useStore.setState({
        accountId,
        activeChatId: callerMid,
        incomingCall: null,
        callRequest: null,
        messages: [
          mapMessage(
            {
              id: "100",
              from: callerMid,
              to: "u-self",
              text: "Previous message",
              contentType: "NONE",
              createdTime: receivedAt - 1_000,
              isMyMessage: false,
            },
            callerMid,
            accountId,
          ),
        ],
      });
      polls.push(useStore.getState().pollIncoming());
      await Bun.sleep(0);
      expect(deltaRequests).toBe(1);

      callAvailable = true;
      polls.push(useStore.getState().pollIncoming());
      await Bun.sleep(0);

      expect(useStore.getState().incomingCall?.callMid).toBe("r-call-during-pending-delta");
      expect(deltaRequests).toBe(1);
    } finally {
      finishDelta({ ok: true, messages: [] });
      await Promise.all(polls);
      api.line.pollEvents = originalPollEvents;
      api.line.messagesDelta = originalMessagesDelta;
      useStore.setState(previousState);
    }
  });

  it("keeps the backend receive time for a fresh incoming call", async () => {
    const originalPollEvents = api.line.pollEvents;
    const receivedAt = Date.now() - 1_000;
    api.line.pollEvents = async () => ({
      ok: true,
      cursor: 1,
      events: [
        {
          kind: "call:incoming",
          seq: 1,
          callMid: "r-fresh-call",
          chatMid: "u0123456789abcdef0123456789abcdef",
          callerMid: "u0123456789abcdef0123456789abcdef",
          callType: "audio",
          receivedAt,
        },
      ],
    });

    try {
      useStore.setState({
        accountId: "account-fresh-call-replay",
        activeChatId: null,
        incomingCall: null,
      });

      await useStore.getState().pollIncoming();

      expect(useStore.getState().incomingCall?.receivedAt).toBe(receivedAt);
    } finally {
      api.line.pollEvents = originalPollEvents;
      useStore.setState({ incomingCall: null });
    }
  });

  it("does not revive a stale incoming call when an old poll event is replayed", async () => {
    const originalPollEvents = api.line.pollEvents;
    const receivedAt = Date.now() - 90_001;
    api.line.pollEvents = async () => ({
      ok: true,
      cursor: 1,
      events: [
        {
          kind: "call:incoming",
          seq: 1,
          callMid: "r-stale-call",
          chatMid: "u0123456789abcdef0123456789abcdef",
          callerMid: "u0123456789abcdef0123456789abcdef",
          callType: "audio",
          receivedAt,
        },
      ],
    });

    try {
      useStore.setState({
        accountId: "account-stale-call-replay",
        activeChatId: null,
        incomingCall: null,
      });

      await useStore.getState().pollIncoming();

      expect(useStore.getState().incomingCall).toBeNull();
    } finally {
      api.line.pollEvents = originalPollEvents;
    }
  });

  it("clears an incoming call when the end event matches the chat even if callMid differs", async () => {
    const originalPollEvents = api.line.pollEvents;
    api.line.pollEvents = async () => ({
      ok: true,
      cursor: 2,
      events: [
        {
          kind: "call:incoming",
          seq: 1,
          callMid: "r-call-token",
          chatMid: "u0123456789abcdef0123456789abcdef",
          callerMid: "u0123456789abcdef0123456789abcdef",
          callType: "audio",
          receivedAt: Date.now(),
        },
        {
          kind: "call:cancel",
          seq: 2,
          callMid: "u0123456789abcdef0123456789abcdef",
          chatMid: "u0123456789abcdef0123456789abcdef",
          callerMid: "u0123456789abcdef0123456789abcdef",
        },
      ],
    });

    try {
      useStore.setState({
        accountId: "account-call-lifecycle",
        activeChatId: null,
        incomingCall: null,
      });

      await useStore.getState().pollIncoming();

      expect(useStore.getState().incomingCall).toBeNull();
    } finally {
      api.line.pollEvents = originalPollEvents;
    }
  });

  it("clears an incoming call when its completed call-history message arrives", async () => {
    const originalPollEvents = api.line.pollEvents;
    const callerMid = "u0123456789abcdef0123456789abcdef";
    const receivedAt = Date.now() - 1_000;
    api.line.pollEvents = async () => ({
      ok: true,
      cursor: 2,
      events: [
        {
          kind: "message",
          seq: 1,
          chatMid: callerMid,
          message: {
            id: "call-history-message",
            from: callerMid,
            to: "uabcdef0123456789abcdef0123456789",
            text: "Call History : 0 millisecs, Result: 77",
            contentType: "CALL",
            contentMetadata: { DURATION: "0", RESULT: "CANCELED" },
            createdTime: receivedAt + 1_000,
            isMyMessage: false,
          },
        },
        {
          kind: "call:incoming",
          seq: 2,
          callMid: "r-call-history",
          chatMid: callerMid,
          callerMid,
          callType: "audio",
          receivedAt,
        },
      ],
    });

    try {
      useStore.setState({
        accountId: "account-call-history-end",
        activeChatId: null,
        incomingCall: null,
      });

      await useStore.getState().pollIncoming();

      expect(useStore.getState().incomingCall).toBeNull();
    } finally {
      api.line.pollEvents = originalPollEvents;
      useStore.setState({ incomingCall: null });
    }
  });

  it("does not revive an incoming call after its history was already merged", async () => {
    const originalPollEvents = api.line.pollEvents;
    const callerMid = "u0123456789abcdef0123456789abcdef";
    const receivedAt = Date.now() - 1_000;
    api.line.pollEvents = async () => ({
      ok: true,
      cursor: 1,
      events: [
        {
          kind: "call:incoming",
          seq: 1,
          callMid: "r-replayed-call",
          chatMid: callerMid,
          callerMid,
          callType: "audio",
          receivedAt,
        },
      ],
    });

    try {
      useStore.setState({
        accountId: "account-call-history-replay",
        activeChatId: null,
        messages: [],
        incomingCall: null,
      });
      useStore.getState().mergeIncomingMessages(
        callerMid,
        [
          {
            id: "completed-before-replay",
            from: callerMid,
            to: "uabcdef0123456789abcdef0123456789",
            text: "Call History : 0 millisecs, Result: 77",
            contentType: "CALL",
            contentMetadata: { DURATION: "0", RESULT: "CANCELED" },
            createdTime: receivedAt + 1_000,
            isMyMessage: false,
          },
        ],
        { silent: true },
      );

      await useStore.getState().pollIncoming();

      expect(useStore.getState().incomingCall).toBeNull();
    } finally {
      api.line.pollEvents = originalPollEvents;
      useStore.setState({ incomingCall: null, messages: [] });
    }
  });

  it("clears a pending banner when delta merge supplies the call history", () => {
    const callerMid = "u0123456789abcdef0123456789abcdef";
    const receivedAt = Date.now() - 1_000;
    useStore.setState({
      accountId: "account-call-history-delta",
      activeChatId: null,
      messages: [],
      incomingCall: {
        callMid: "r-delta-call",
        chatMid: callerMid,
        callerMid,
        callType: "audio",
        receivedAt,
      },
    });

    useStore.getState().mergeIncomingMessages(
      callerMid,
      [
        {
          id: "completed-by-delta",
          from: callerMid,
          to: "uabcdef0123456789abcdef0123456789",
          text: "Call History : 0 millisecs, Result: 77",
          contentType: "CALL",
          contentMetadata: { DURATION: "0", RESULT: "CANCELED" },
          createdTime: receivedAt + 1_000,
          isMyMessage: false,
        },
      ],
      { silent: true },
    );

    expect(useStore.getState().incomingCall).toBeNull();
    useStore.setState({ incomingCall: null, messages: [] });
  });

  it("keeps a redial and ignores unrelated or ordinary messages", () => {
    const chatMid = "u0123456789abcdef0123456789abcdef";
    const receivedAt = Date.now();
    const incomingCall = {
      callMid: chatMid,
      callerMid: chatMid,
      chatMid,
      callType: "audio" as const,
      receivedAt,
    };
    try {
      for (const [chatId, contentType, createdTime] of [
        [chatMid, "CALL", receivedAt - 1],
        ["u-other-peer", "CALL", receivedAt],
        [chatMid, "NONE", receivedAt],
      ] as const) {
        const message = mapMessage(
          {
            id: "unrelated-history",
            from: chatId,
            to: "u-self",
            text: null,
            contentType,
            createdTime,
            isMyMessage: false,
          },
          chatId,
          "account-call-history-negative",
        );
        useStore.setState({ messages: [message], incomingCall });
        expect(useStore.getState().incomingCall).toBe(incomingCall);
      }
    } finally {
      useStore.setState({ incomingCall: null, messages: [] });
    }
  });
});

describe("chat list freshness", () => {
  it("reports manual refresh failure and success without clearing the current draft or selection", async () => {
    const previous = useStore.getState();
    const originalChats = api.line.chats;
    useStore.setState({
      accountId: "account-manual-refresh",
      activeChatId: "u-open",
      drafts: { "u-open": "unsent draft" },
    });
    try {
      api.line.chats = async () => {
        throw new Error("offline");
      };
      expect(await useStore.getState().refreshChatsSilently()).toBe(false);
      api.line.chats = async () => ({ ok: true, chats: [] });
      expect(await useStore.getState().refreshChatsSilently()).toBe(true);
      expect(useStore.getState().activeChatId).toBe("u-open");
      expect(useStore.getState().drafts["u-open"]).toBe("unsent draft");
    } finally {
      api.line.chats = originalChats;
      useStore.setState(previous);
    }
  });

  it("keeps newer local chat metadata and ordering during stale hydration", () => {
    useStore.setState({
      accountId: "account-chat-list-hydrate",
      activeChatId: null,
      chats: [
        {
          id: "u-newest",
          type: "friend",
          name: "Newest",
          avatar: "N",
          color: "#111",
          status: "",
          unread: 0,
          lastMessageId: "200",
          lastMessageTime: 2_000,
          lastMessagePreview: "あなた: newest",
        },
        {
          id: "u-other",
          type: "friend",
          name: "Other",
          avatar: "O",
          color: "#222",
          status: "",
          unread: 0,
          lastMessageId: "150",
          lastMessageTime: 1_500,
          lastMessagePreview: "other",
        },
      ],
      messages: [],
    });

    useStore.getState().hydrateLineData({
      profile: null,
      chats: [
        {
          mid: "u-other",
          name: "Other",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "150",
          lastMessageTime: 1_500,
          lastMessagePreview: "other",
        },
        {
          mid: "u-newest",
          name: "Newest",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "100",
          lastMessageTime: 1_000,
          lastMessagePreview: "stale",
        },
      ],
      messages: [],
      hiddenMids: new Set(),
      contactCache: new Map(),
    });

    expect(useStore.getState().chats.map((chat) => chat.id)).toEqual(["u-newest", "u-other"]);
    expect(useStore.getState().chats[0]).toMatchObject({
      lastMessageId: "200",
      lastMessageTime: 2_000,
      lastMessagePreview: "あなた: newest",
    });
  });

  it("keeps a truly newer server chat ahead of a locally protected stale row", () => {
    useStore.setState({
      accountId: "account-chat-list-new-chat",
      activeChatId: null,
      chats: [
        {
          id: "u-local",
          type: "friend",
          name: "Local",
          avatar: "L",
          color: "#111",
          status: "",
          unread: 0,
          lastMessageId: "200",
          lastMessageTime: 2_000,
          lastMessagePreview: "あなた: local",
        },
        {
          id: "u-other",
          type: "friend",
          name: "Other",
          avatar: "O",
          color: "#222",
          status: "",
          unread: 0,
          lastMessageId: "50",
          lastMessageTime: 500,
          lastMessagePreview: "other",
        },
      ],
      messages: [],
    });

    useStore.getState().hydrateLineData({
      profile: null,
      chats: [
        {
          mid: "u-new",
          name: "New",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "300",
          lastMessageTime: 3_000,
          lastMessagePreview: "new",
        },
        {
          mid: "u-local",
          name: "Local",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "100",
          lastMessageTime: 1_000,
          lastMessagePreview: "stale",
        },
        {
          mid: "u-other",
          name: "Other",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "50",
          lastMessageTime: 500,
          lastMessagePreview: "other",
        },
      ],
      messages: [],
      hiddenMids: new Set(),
      contactCache: new Map(),
    });

    expect(useStore.getState().chats.map((chat) => chat.id)).toEqual([
      "u-new",
      "u-local",
      "u-other",
    ]);
    expect(useStore.getState().chats[1]).toMatchObject({
      lastMessageId: "200",
      lastMessageTime: 2_000,
      lastMessagePreview: "あなた: local",
    });
  });

  it("keeps a pending reply in its own chat across demo and real sends", async () => {
    const before = useStore.getState();
    const originalSend = api.line.send;
    const sent: { chatId: string; relatedMessageId?: string }[] = [];
    api.line.send = async (_accountId, chatId, _text, options) => {
      sent.push({ chatId, relatedMessageId: options?.relatedMessageId });
      return { ok: false, error: "test send without network" };
    };
    try {
      for (const demoMode of [true, false]) {
        useStore.setState({
          accountId: "reply-test-account",
          demoMode,
          chats: [],
          blockedMids: [],
          messages: [
            {
              id: "reply-in-a",
              chatId: "chat-a",
              authorId: "other",
              kind: "text",
              text: "Aの本文",
              createdAt: 1,
              status: "sent",
              read: false,
              messageState: "normal",
            },
          ],
          replyToId: "reply-in-a",
        });
        await useStore.getState().sendMessage("chat-b", "Bへの送信");
        expect(
          useStore.getState().messages.find((message) => message.chatId === "chat-b")?.replyToId,
        ).toBeUndefined();
        expect(useStore.getState().replyToId).toBe("reply-in-a");
        await useStore.getState().sendMessage("chat-a", "Aへの返信");
        expect(
          useStore
            .getState()
            .messages.find((message) => message.chatId === "chat-a" && message.authorId === "me")
            ?.replyToId,
        ).toBe("reply-in-a");
        expect(useStore.getState().replyToId).toBeNull();
      }
      expect(sent).toEqual([
        { chatId: "chat-b", relatedMessageId: undefined },
        { chatId: "chat-a", relatedMessageId: "reply-in-a" },
      ]);
    } finally {
      api.line.send = originalSend;
      useStore.setState(before, true);
    }
  });

  it("updates and raises the chat row as soon as an optimistic send is inserted", async () => {
    const originalSend = api.line.send;
    type SendResult = Awaited<ReturnType<typeof originalSend>>;
    let finishSend: ((result: SendResult) => void) | undefined;
    api.line.send = async () =>
      await new Promise<SendResult>((resolve) => {
        finishSend = resolve;
      });

    try {
      useStore.setState({
        accountId: "account-chat-list-send",
        demoMode: false,
        activeChatId: "u-target",
        chats: [
          {
            id: "u-other",
            type: "friend",
            name: "Other",
            avatar: "O",
            color: "#111",
            status: "",
            unread: 0,
            lastMessageId: "20",
            lastMessageTime: 2_000,
            lastMessagePreview: "other",
          },
          {
            id: "u-target",
            type: "friend",
            name: "Target",
            avatar: "T",
            color: "#222",
            status: "",
            unread: 0,
            lastMessageId: "10",
            lastMessageTime: 1_000,
            lastMessagePreview: "old",
          },
        ],
        messages: [],
        blockedMids: [],
        replyToId: null,
      });

      await useStore.getState().sendMessage("u-target", "hello");

      const target = useStore.getState().chats[0];
      expect(target?.id).toBe("u-target");
      expect(target?.lastMessagePreview).toBe("あなた: hello");
      expect(target?.lastMessageId?.startsWith("pending_")).toBe(true);
      finishSend?.({ ok: false, error: "test failure" });
      await Promise.resolve();
    } finally {
      api.line.send = originalSend;
    }
  });

  it("updates and raises the chat row when a received message is merged", () => {
    useStore.setState({
      accountId: "account-chat-list-receive",
      activeChatId: null,
      chats: [
        {
          id: "u-other",
          type: "friend",
          name: "Other",
          avatar: "O",
          color: "#111",
          status: "",
          unread: 0,
          lastMessageId: "20",
          lastMessageTime: 2_000,
          lastMessagePreview: "other",
        },
        {
          id: "u-sender",
          type: "friend",
          name: "Sender",
          avatar: "S",
          color: "#222",
          status: "",
          unread: 0,
          lastMessageId: "10",
          lastMessageTime: 1_000,
          lastMessagePreview: "old",
        },
      ],
      messages: [],
    });

    useStore.getState().mergeIncomingMessages(
      "u-sender",
      [
        {
          id: "30",
          from: "u-sender",
          to: "u-me",
          text: "received",
          contentType: "NONE",
          createdTime: 3_000,
          isMyMessage: false,
        },
      ],
      { silent: true },
    );

    expect(useStore.getState().chats[0]).toMatchObject({
      id: "u-sender",
      lastMessageId: "30",
      lastMessageTime: 3_000,
      lastMessagePreview: "received",
    });
  });
});

describe("accepted local sends request latest", () => {
  const chatId = "u-scroll-fixture";
  const accountId = "account-scroll-fixture";
  const image = () => new File(["synthetic image"], "fixture.png", { type: "image/png" });
  const audio = () => new Blob(["synthetic audio"], { type: "audio/webm" });
  const sends = [
    { name: "text", run: () => useStore.getState().sendMessage(chatId, "hello", { mute: true }) },
    { name: "sticker", run: () => useStore.getState().sendSticker(chatId, "pkg", "sticker") },
    {
      name: "combination",
      run: () =>
        useStore
          .getState()
          .sendCombinationSticker(chatId, [{ packageId: "pkg", stickerId: "sticker" }]),
    },
    { name: "emoji", run: () => useStore.getState().sendLineEmoji(chatId, "pkg", "emoji") },
    { name: "image", run: () => useStore.getState().sendImageFile(chatId, image()) },
  ];
  type State = ReturnType<typeof useStore.getState>;
  type SendResult = Awaited<ReturnType<typeof api.line.send>>;
  let previous: State;
  let windowDescriptor: PropertyDescriptor | undefined;
  let finish: (result: SendResult) => void;
  let reject: (error: Error) => void;
  let response: Promise<SendResult>;
  let off: () => void;
  let restoreSpies: Array<() => void>;
  let observed: Array<{ detail: AppEventMap["chat:scroll-latest"]; state: State }>;
  let apiCalls: number;
  // Oversized-media feedback uses the store notice (FloatNotice), not window.alert.
  const noticeText = () => useStore.getState().notice;

  beforeEach(() => {
    previous = useStore.getState();
    windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    useStore.setState({ notice: null });
    observed = [];
    apiCalls = 0;
    response = new Promise<SendResult>((resolve, rejectResponse) => {
      finish = resolve;
      reject = rejectResponse;
    });
    const stubSend = () => {
      apiCalls += 1;
      return response;
    };
    const spies = [
      spyOn(api.line, "send").mockImplementation(stubSend),
      spyOn(api.line, "sendSticker").mockImplementation(stubSend),
      spyOn(api.line, "sendCombinationSticker").mockImplementation(stubSend),
      spyOn(api.line, "sendEmoji").mockImplementation(stubSend),
      spyOn(api.line, "sendMedia").mockImplementation(stubSend),
      spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-scroll-fixture"),
      spyOn(URL, "revokeObjectURL").mockImplementation(() => {}),
    ];
    restoreSpies = spies.map((spy) => () => spy.mockRestore());
    useStore.setState({
      accountId,
      demoMode: false,
      activeChatId: null,
      chats: [
        {
          id: chatId,
          type: "friend",
          name: "Fixture",
          avatar: "F",
          color: "#000",
          status: "",
          unread: 0,
        },
      ],
      messages: [],
      drafts: { [chatId]: "hello" },
      replyToId: null,
      blockedMids: [],
      incomingCall: null,
      readWatermarks: {},
      settings: { ...previous.settings, highQualityImages: true },
      showNotice: (msg: string) => useStore.setState({ notice: msg }),
    });
    off = onAppEvent("chat:scroll-latest", (detail) => {
      observed.push({ detail, state: useStore.getState() });
    });
  });

  // These store methods intentionally detach their API continuations. Flush only
  // microtasks, then clear their 800ms refresh timers before restoring API spies.
  const flushSend = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  afterEach(async () => {
    finish({ ok: false, error: "synthetic cleanup" });
    await flushSend();
    off();
    useStore.getState().resetAccountData();
    useStore.setState(previous, true);
    for (const restore of restoreSpies) restore();
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  });

  for (const send of [
    ...sends,
    { name: "audio", run: () => useStore.getState().sendAudio(chatId, 2, audio()) },
  ]) {
    it(`emits synchronously after demo ${send.name} insertion, qualified as demo`, async () => {
      useStore.setState({ demoMode: true, accountId: null });
      const operation = send.run();
      expect(observed).toHaveLength(1);
      expect(observed[0]?.detail).toEqual({ chatId, accountId: null });
      expect(observed[0]?.state.messages).toHaveLength(1);
      expect(observed[0]?.state.messages[0]).toMatchObject({
        chatId,
        authorId: "me",
        status: "read",
      });
      expect(observed[0]?.state.chats[0]?.lastMessageId).toBe(observed[0]?.state.messages[0]?.id);
      await operation;
      expect(observed).toHaveLength(1);
      expect(apiCalls).toBe(0);
    });
  }

  for (const send of sends) {
    for (const outcome of ["success", "failure", "throw"] as const) {
      it(`emits once after accepted ${send.name}, not again on API ${outcome}`, async () => {
        const operation = send.run();
        expect(observed).toHaveLength(1);
        expect(observed[0]?.detail).toEqual({ chatId, accountId });
        expect(observed[0]?.state.messages).toHaveLength(1);
        expect(observed[0]?.state.messages[0]).toMatchObject({
          chatId,
          authorId: "me",
          status: "sending",
        });
        expect(observed[0]?.state.chats[0]?.lastMessageId).toBe(observed[0]?.state.messages[0]?.id);
        expect(apiCalls).toBe(1);
        if (outcome === "throw") reject(new Error("synthetic offline"));
        else
          finish(
            outcome === "success" ? { ok: true } : { ok: false, error: "synthetic rejection" },
          );
        await operation;
        await flushSend();
        const row = useStore.getState().messages[0];
        if (outcome === "success") expect(row?.status).toBe("sent");
        else if (send.name === "image") expect(row).toBeUndefined();
        else expect(row?.status).toBe("failed");
        expect(observed).toHaveLength(1);
      });
    }
  }

  it("does not repeat latest on server replacement, incoming me, or reconciliation", async () => {
    const operation = useStore.getState().sendMessage(chatId, "hello", { mute: true });
    expect(observed).toHaveLength(1);
    expect(observed[0]?.state.drafts[chatId]).toBe("");
    expect(api.line.send).toHaveBeenCalledWith(accountId, chatId, "hello", {
      relatedMessageId: undefined,
      contentMetadata: undefined,
      mute: true,
    });
    const message = {
      id: "101",
      from: "u-self",
      to: chatId,
      text: "hello",
      contentType: "NONE",
      createdTime: Date.now(),
      isMyMessage: true,
    };
    finish({ ok: true, message });
    await operation;
    await flushSend();
    expect(useStore.getState().messages.map((row) => row.id)).toEqual(["101"]);
    useStore.getState().mergeIncomingMessages(chatId, [message], { silent: true });
    useStore
      .getState()
      .mergeIncomingMessages(chatId, [{ ...message, id: "102", text: "another device" }], {
        silent: true,
      });
    expect(useStore.getState().messages).toHaveLength(2);
    expect(useStore.getState().messages.every((row) => row.authorId === "me")).toBe(true);
    expect(observed).toHaveLength(1);
  });

  it("does not treat a standalone incoming me message as a local send", () => {
    useStore.getState().mergeIncomingMessages(
      chatId,
      [
        {
          id: "103",
          from: "u-self",
          to: chatId,
          text: "other device",
          contentType: "NONE",
          createdTime: Date.now(),
          isMyMessage: true,
        },
      ],
      { silent: true },
    );
    expect(useStore.getState().messages[0]?.authorId).toBe("me");
    expect(observed).toHaveLength(0);
  });

  for (const guard of ["missing account", "blocked"] as const) {
    it(`does not emit or call an API for ${guard} sends`, async () => {
      useStore.setState(guard === "blocked" ? { blockedMids: [chatId] } : { accountId: null });
      for (const send of sends) await send.run();
      await useStore.getState().sendAudio(chatId, 2, audio());
      expect(useStore.getState().messages).toHaveLength(0);
      expect(observed).toHaveLength(0);
      expect(apiCalls).toBe(0);
    });
  }

  for (const demoMode of [true, false]) {
    it(`does not emit on existing empty input guards (demo=${demoMode})`, async () => {
      useStore.setState({ demoMode, accountId: demoMode ? null : accountId });
      await useStore.getState().sendMessage(chatId, " \n ");
      await useStore.getState().sendSticker(chatId, "", "sticker");
      await useStore.getState().sendSticker(chatId, "pkg", "");
      await useStore.getState().sendCombinationSticker(chatId, []);
      await useStore.getState().sendLineEmoji(chatId, "", "emoji");
      await useStore.getState().sendLineEmoji(chatId, "pkg", "");
      if (!demoMode) await useStore.getState().sendAudio(chatId, 0, new Blob([]));
      expect(useStore.getState().messages).toHaveLength(0);
      expect(observed).toHaveLength(0);
      expect(apiCalls).toBe(0);
    });
  }

  it("rejects oversized media before inserting any row or emitting latest", async () => {
    const messageArrays: State["messages"][] = [];
    const unsubscribe = useStore.subscribe((state, before) => {
      if (state.messages !== before.messages) messageArrays.push(state.messages);
    });
    try {
      await useStore
        .getState()
        .sendImageFile(
          chatId,
          new File([new Uint8Array(11_000_001)], "large.png", { type: "image/png" }),
        );
      expect(noticeText()).toBe("ファイルが大きすぎます（11MB まで）");
      expect(messageArrays.flat()).toHaveLength(0);
      expect(observed).toHaveLength(0);
      expect(apiCalls).toBe(0);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("accepts media exactly at the existing 11,000,000-byte limit", async () => {
    const operation = useStore
      .getState()
      .sendImageFile(
        chatId,
        new File([new Uint8Array(11_000_000)], "limit.png", { type: "image/png" }),
      );
    expect(observed).toHaveLength(1);
    expect(apiCalls).toBe(1);
    finish({ ok: false, error: "synthetic rejection" });
    await operation;
    expect(noticeText()).toBeNull();
    expect(observed).toHaveLength(1);
  });

  for (const outcome of ["accepted", "oversized", "account changed"] as const) {
    it(`waits for compression before media acceptance (${outcome})`, async () => {
      const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
      const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
      let completeCompression!: (blob: Blob) => void;
      let compressionStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        compressionStarted = resolve;
      });
      Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        value: async () => ({ width: 4096, height: 4096, close: () => {} }),
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          createElement: () => ({
            getContext: () => ({ drawImage: () => {} }),
            toBlob: (callback: (blob: Blob) => void) => {
              completeCompression = callback;
              compressionStarted();
            },
          }),
        },
      });
      let operation: Promise<void> | undefined;
      try {
        useStore.setState({
          settings: { ...useStore.getState().settings, highQualityImages: false },
        });
        // The original is oversized, but only the compressed payload determines acceptance.
        operation = useStore
          .getState()
          .sendImageFile(
            chatId,
            new File([new Uint8Array(11_000_001)], "large.png", { type: "image/png" }),
          );
        await started;
        expect(useStore.getState().messages).toHaveLength(0);
        expect(observed).toHaveLength(0);
        expect(apiCalls).toBe(0);
        if (outcome === "account changed")
          useStore.setState({ accountId: "account-other-fixture" });
        const compressed = new Blob(
          [outcome === "oversized" ? new Uint8Array(11_000_001) : "small compressed fixture"],
          { type: "image/jpeg" },
        );
        completeCompression(compressed);
        await flushSend();
        if (outcome === "accepted") {
          expect(observed).toHaveLength(1);
          expect(observed[0]?.detail).toEqual({ chatId, accountId });
          expect(observed[0]?.state.messages[0]?.status).toBe("sending");
          expect(api.line.sendMedia).toHaveBeenCalledWith(accountId, chatId, compressed, {
            mimeType: "image/jpeg",
            filename: "large.jpg",
            mediaType: "image",
          });
        } else {
          expect(observed).toHaveLength(0);
          expect(useStore.getState().messages).toHaveLength(0);
          expect(apiCalls).toBe(0);
          expect(URL.createObjectURL).not.toHaveBeenCalled();
        }
        expect(noticeText()).toBe(
          outcome === "oversized" ? "画像が大きすぎます（圧縮後も 11MB 超）" : null,
        );
      } finally {
        completeCompression?.(new Blob([]));
        finish({ ok: false, error: "synthetic cleanup" });
        await operation;
        if (bitmapDescriptor)
          Object.defineProperty(globalThis, "createImageBitmap", bitmapDescriptor);
        else Reflect.deleteProperty(globalThis, "createImageBitmap");
        if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
        else Reflect.deleteProperty(globalThis, "document");
      }
    });
  }

  it("captures accepted account scope even if a synchronous store subscriber switches accounts", async () => {
    const unsubscribe = useStore.subscribe((state, before) => {
      if (state.messages.length > before.messages.length)
        useStore.setState({ accountId: "account-other-fixture" });
    });
    try {
      await useStore.getState().sendMessage(chatId, "hello");
      expect(observed.map(({ detail }) => detail)).toEqual([{ chatId, accountId }]);
    } finally {
      unsubscribe();
    }
  });

  it("does not manufacture a row or latest intent for real audio preview or its reconciliation", async () => {
    await useStore.getState().sendAudio(chatId, 2, audio());
    expect(useStore.getState().chats[0]?.lastMessageId).toStartWith("pending_audio_");
    expect(useStore.getState().messages).toHaveLength(0);
    expect(observed).toHaveLength(0);
    expect(apiCalls).toBe(1);
    finish({ ok: true });
    await flushSend();
    useStore.getState().mergeIncomingMessages(
      chatId,
      [
        {
          id: "104",
          from: "u-self",
          to: chatId,
          text: null,
          contentType: "AUDIO",
          createdTime: Date.now(),
          isMyMessage: true,
        },
      ],
      { silent: true },
    );
    expect(useStore.getState().messages[0]?.kind).toBe("audio");
    expect(observed).toHaveLength(0);
  });
});

describe("reader profile resolution", () => {
  it("distinguishes real names from unresolved reader placeholders", () => {
    expect(isResolvedMemberProfileName("山田太郎")).toBe(true);
    expect(isResolvedMemberProfileName("メンバー")).toBe(false);
    expect(isResolvedMemberProfileName("member")).toBe(false);
    expect(isResolvedMemberProfileName("u0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isResolvedMemberProfileName("u0123456789a...")).toBe(false);
    expect(isResolvedMemberProfileName(undefined)).toBe(false);
  });
});

describe("group read receipt refresh", () => {
  it("keeps concurrent targeted reader refreshes independent", async () => {
    const originalReadReceipts = api.line.readReceipts;
    const calls: string[][] = [];
    const releases: Array<() => void> = [];
    api.line.readReceipts = async (_accountId, _chatMid, messageIds) => {
      calls.push([...messageIds]);
      await new Promise<void>((resolve) => releases.push(resolve));
      const target = messageIds.at(-1);
      const receipts: Record<string, { readCount: number; readBy: string[] }> = {};
      if (target === "1") receipts["1"] = { readCount: 2, readBy: ["u-a", "u-b"] };
      else receipts["2"] = { readCount: 1, readBy: ["u-a"] };
      return {
        ok: true,
        receipts,
      };
    };

    try {
      useStore.setState({
        accountId: "account-concurrent-readers",
        self: { name: "Self", avatar: "S", status: "", mid: "u-self" },
        chats: [
          {
            id: "c-concurrent-readers",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [
              { id: "u-a", name: "Reader A", avatar: "A", color: "#111" },
              { id: "u-b", name: "Reader B", avatar: "B", color: "#222" },
            ],
          },
        ],
        messages: Array.from({ length: 102 }, (_, index) => ({
          id: String(index + 1),
          chatId: "c-concurrent-readers",
          authorId: "me",
          kind: "text" as const,
          text: `message ${index + 1}`,
          createdAt: Date.now(),
          status: "sent" as const,
          read: false,
          messageState: "normal" as const,
        })),
        readWatermarks: {},
      });

      const first = useStore
        .getState()
        .refreshReadReceipts("c-concurrent-readers", { force: true, messageId: "1" });
      const second = useStore
        .getState()
        .refreshReadReceipts("c-concurrent-readers", { force: true, messageId: "2" });

      for (let i = 0; i < 10 && calls.length < 2; i++) await Promise.resolve();
      expect(calls).toHaveLength(2);
      expect(calls.map((ids) => ids.at(-1))).toEqual(["1", "2"]);

      for (const release of releases) release();
      await Promise.all([first, second]);

      const messages = new Map(
        useStore.getState().messages.map((message) => [message.id, message]),
      );
      expect(messages.get("1")?.readBy).toEqual(["u-a", "u-b"]);
      expect(messages.get("2")?.readBy).toEqual(["u-a"]);
      expect(messages.get("1")?.readCount).toBe(2);
      expect(messages.get("2")?.readCount).toBe(1);
    } finally {
      for (const release of releases) release();
      api.line.readReceipts = originalReadReceipts;
    }
  });

  it("force-refreshes an old targeted message and monotonically merges readers", async () => {
    const originalReadReceipts = api.line.readReceipts;
    const calls: Array<{ ids: string[]; force: boolean }> = [];
    api.line.readReceipts = async (_accountId, _chatMid, messageIds, opts) => {
      calls.push({ ids: messageIds, force: opts?.force === true });
      return {
        ok: true,
        receipts: {
          "100": { readCount: 1, readBy: ["u-new"] },
        },
        memberReadWatermarks: [{ mid: "u-new", upTo: "100" }],
        memberReadRanges: [{ mid: "u-new", startExclusive: "0", endInclusive: "100" }],
      };
    };

    try {
      useStore.setState({
        accountId: "account-read-test",
        chats: [
          {
            id: "c-group",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [
              { id: "u-old", name: "Old Reader", avatar: "O", color: "#111" },
              { id: "u-new", name: "New Reader", avatar: "N", color: "#222" },
            ],
          },
        ],
        messages: [
          {
            id: "100",
            chatId: "c-group",
            authorId: "me",
            kind: "text",
            text: "old message",
            createdAt: Date.now() - 60 * 60_000,
            status: "read",
            read: true,
            readBy: ["u-old"],
            readCount: 1,
            messageState: "normal",
          },
        ],
        readWatermarks: {
          "account-read-test:c-group": {
            memberWatermarks: [{ mid: "u-old", upTo: "100" }],
            memberReadRanges: [{ mid: "u-old", startExclusive: "0", endInclusive: "100" }],
            at: 0,
          },
        },
      });

      await useStore.getState().refreshReadReceipts("c-group", { force: true, messageId: "100" });

      expect(calls).toEqual([{ ids: ["100"], force: true }]);
      expect(useStore.getState().messages[0]?.readBy).toEqual(["u-old", "u-new"]);
      expect(
        useStore.getState().readWatermarks["account-read-test:c-group"]?.memberReadRanges,
      ).toEqual([
        { mid: "u-old", startExclusive: "0", endInclusive: "100" },
        { mid: "u-new", startExclusive: "0", endInclusive: "100" },
      ]);
    } finally {
      api.line.readReceipts = originalReadReceipts;
    }
  });

  it("keeps the first read time on received messages when the reader advances", async () => {
    const originalReadReceipts = api.line.readReceipts;
    let poll = 0;
    api.line.readReceipts = async () => {
      poll += 1;
      if (poll === 1) {
        return {
          ok: true,
          receipts: {
            "100": {
              readCount: 1,
              readBy: ["u-reader"],
              readByAt: { "u-reader": 10_000 },
            },
            "200": { readCount: 0, readBy: [] },
          },
          memberReadWatermarks: [{ mid: "u-reader", upTo: "100" }],
          memberReadRanges: [
            {
              mid: "u-reader",
              startExclusive: "0",
              endInclusive: "100",
              readAt: 10_000,
            },
          ],
        };
      }
      return {
        ok: true,
        receipts: {
          "100": {
            readCount: 1,
            readBy: ["u-reader"],
            readByAt: { "u-reader": 11_000 },
          },
          "200": {
            readCount: 1,
            readBy: ["u-reader"],
            readByAt: { "u-reader": 11_000 },
          },
        },
        memberReadWatermarks: [{ mid: "u-reader", upTo: "200" }],
        memberReadRanges: [
          {
            mid: "u-reader",
            startExclusive: "0",
            endInclusive: "200",
            readAt: 11_000,
          },
        ],
      };
    };

    try {
      useStore.setState({
        accountId: "account-received-read-time",
        chats: [
          {
            id: "c-received-read-time",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [
              { id: "u-sender", name: "Sender", avatar: "S", color: "#111" },
              { id: "u-reader", name: "Reader", avatar: "R", color: "#222" },
            ],
          },
        ],
        messages: [
          {
            id: "100",
            chatId: "c-received-read-time",
            authorId: "u-sender",
            kind: "text",
            text: "A",
            createdAt: 1_000,
            status: "sent",
            read: false,
            messageState: "normal",
          },
          {
            id: "200",
            chatId: "c-received-read-time",
            authorId: "u-sender",
            kind: "text",
            text: "B",
            createdAt: 2_000,
            status: "sent",
            read: false,
            messageState: "normal",
          },
        ],
        readWatermarks: {},
      });

      await useStore
        .getState()
        .refreshReadReceipts("c-received-read-time", { force: true, messageId: "100" });
      await useStore
        .getState()
        .refreshReadReceipts("c-received-read-time", { force: true, messageId: "200" });

      const messages = new Map(
        useStore.getState().messages.map((message) => [message.id, message]),
      );
      expect(messages.get("100")?.readByAt).toEqual({ "u-reader": 10_000 });
      expect(messages.get("200")?.readByAt).toEqual({ "u-reader": 11_000 });
      expect(
        useStore.getState().readWatermarks["account-received-read-time:c-received-read-time"]
          ?.memberReadRanges,
      ).toEqual([
        {
          mid: "u-reader",
          startExclusive: "0",
          endInclusive: "100",
          readAt: 10_000,
        },
        {
          mid: "u-reader",
          startExclusive: "100",
          endInclusive: "200",
          readAt: 11_000,
        },
      ]);
    } finally {
      api.line.readReceipts = originalReadReceipts;
    }
  });

  it("falls back to the full group member list for readers missing from warm cache", async () => {
    const originalReadReceipts = api.line.readReceipts;
    const originalVylineWarm = api.line.vylineWarm;
    const originalChatMembers = api.line.chatMembers;
    let warmCalls = 0;
    let memberCalls = 0;
    let releaseMembers!: () => void;
    const membersGate = new Promise<void>((resolve) => {
      releaseMembers = resolve;
    });
    api.line.readReceipts = async () => ({
      ok: true,
      receipts: {
        "200": { readCount: 1, readBy: ["u-reader-missing"] },
      },
      memberReadWatermarks: [{ mid: "u-reader-missing", upTo: "200" }],
      memberReadRanges: [{ mid: "u-reader-missing", startExclusive: "0", endInclusive: "200" }],
    });
    api.line.vylineWarm = async () => {
      warmCalls += 1;
      return { ok: true, profiles: {} };
    };
    api.line.chatMembers = async () => {
      memberCalls += 1;
      await membersGate;
      return {
        ok: true,
        members: [
          {
            mid: "u-reader-missing",
            displayName: "取得できた読者",
            thumbnailUrl: "https://example.com/reader.png",
          },
        ],
      };
    };

    try {
      useStore.setState({
        accountId: "account-reader-fallback",
        chats: [
          {
            id: "c-reader-fallback",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [
              {
                id: "u-reader-missing",
                name: "メンバー",
                avatar: "•",
                color: "#111",
              },
            ],
          },
        ],
        messages: [
          {
            id: "200",
            chatId: "c-reader-fallback",
            authorId: "me",
            kind: "text",
            text: "message",
            createdAt: Date.now(),
            status: "sent",
            read: false,
            messageState: "normal",
          },
        ],
        readWatermarks: {},
      });

      let refreshSettled = false;
      const refresh = useStore
        .getState()
        .refreshReadReceipts("c-reader-fallback", { force: true, messageId: "200" })
        .then(() => {
          refreshSettled = true;
        });

      for (let i = 0; i < 10 && memberCalls === 0; i++) await Promise.resolve();

      expect(warmCalls).toBe(1);
      expect(memberCalls).toBe(1);
      expect(refreshSettled).toBe(false);

      releaseMembers();
      await refresh;
      expect(refreshSettled).toBe(true);
      expect(useStore.getState().chats[0]?.members?.[0]).toMatchObject({
        id: "u-reader-missing",
        name: "取得できた読者",
        avatarUrl: "https://example.com/reader.png",
      });
    } finally {
      api.line.readReceipts = originalReadReceipts;
      api.line.vylineWarm = originalVylineWarm;
      api.line.chatMembers = originalChatMembers;
      releaseMembers();
    }
  });

  it("records the first read time per message from read notifications", () => {
    const chatId = "c-read-notify";
    const accountId = "account-read-notify";
    useStore.setState({
      accountId,
      self: { name: "Self", avatar: "S", status: "", mid: "u-self" },
      chats: [
        {
          id: chatId,
          type: "group",
          name: "Group",
          avatar: "G",
          color: "#000",
          status: "",
          unread: 0,
          members: [{ id: "u-reader", name: "Reader", avatar: "R", color: "#111" }],
        },
      ],
      messages: [
        {
          id: "100",
          chatId,
          authorId: "u-peer",
          kind: "text",
          text: "A",
          createdAt: 1_000,
          status: "sent",
          read: false,
          messageState: "normal",
        },
        {
          id: "200",
          chatId,
          authorId: "u-peer",
          kind: "text",
          text: "B",
          createdAt: 2_000,
          status: "sent",
          read: false,
          messageState: "normal",
        },
      ],
      // 既知の到達点（この地点までは別経路で既読が判明している）
      readWatermarks: {
        [`${accountId}:${chatId}`]: {
          memberReadRanges: [{ mid: "u-reader", startExclusive: "0", endInclusive: "50" }],
          memberWatermarks: [{ mid: "u-reader", upTo: "50" }],
          at: 0,
        },
      },
    });

    useStore.getState().applyMemberReadNotification(chatId, "u-reader", "100", 10_000);
    useStore.getState().applyMemberReadNotification(chatId, "u-reader", "200", 11_000);

    const messages = new Map(useStore.getState().messages.map((m) => [m.id, m]));
    expect(messages.get("100")?.readByAt).toEqual({ "u-reader": 10_000 });
    expect(messages.get("200")?.readByAt).toEqual({ "u-reader": 11_000 });

    // さらに新しい地点まで読まれても、既に記録した時刻は動かない。
    useStore.getState().applyMemberReadNotification(chatId, "u-reader", "300", 12_000);
    const after = new Map(useStore.getState().messages.map((m) => [m.id, m]));
    expect(after.get("100")?.readByAt).toEqual({ "u-reader": 10_000 });
    expect(after.get("200")?.readByAt).toEqual({ "u-reader": 11_000 });
  });

  it("ignores read notifications until a read watermark baseline exists", () => {
    const chatId = "c-read-notify-cold";
    const accountId = "account-read-notify-cold";
    useStore.setState({
      accountId,
      self: { name: "Self", avatar: "S", status: "", mid: "u-self" },
      chats: [
        {
          id: chatId,
          type: "group",
          name: "Group",
          avatar: "G",
          color: "#000",
          status: "",
          unread: 0,
          members: [],
        },
      ],
      messages: [
        {
          id: "100",
          chatId,
          authorId: "u-peer",
          kind: "text",
          text: "old",
          createdAt: 1_000,
          status: "sent",
          read: false,
          messageState: "normal",
        },
      ],
      readWatermarks: {},
    });

    useStore.getState().applyMemberReadNotification(chatId, "u-reader", "500", 12_000);

    // 到達点が未知のうちは履歴全体を通知時刻で塗らない。
    expect(useStore.getState().messages[0]?.readByAt).toBeUndefined();
    expect(useStore.getState().readWatermarks[`${accountId}:${chatId}`]).toBeUndefined();
  });

  it("keeps at most one reader panel open and toggles it closed", async () => {
    const originalReadReceipts = api.line.readReceipts;
    api.line.readReceipts = async () => ({ ok: true, receipts: {} });

    try {
      useStore.setState({
        accountId: "account-reader-panel",
        chats: [
          {
            id: "c-reader-panel",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [],
          },
        ],
        messages: ["1", "2"].map((id) => ({
          id,
          chatId: "c-reader-panel",
          authorId: "me" as const,
          kind: "text" as const,
          text: id,
          createdAt: Number(id),
          status: "sent" as const,
          read: false,
          messageState: "normal" as const,
        })),
        readWatermarks: {},
        readersPanel: null,
      });

      useStore.getState().toggleReadersPanel("c-reader-panel", "1");
      expect(useStore.getState().readersPanel).toMatchObject({ messageId: "1" });

      useStore.getState().toggleReadersPanel("c-reader-panel", "2");
      expect(useStore.getState().readersPanel).toMatchObject({ messageId: "2" });

      useStore.getState().toggleReadersPanel("c-reader-panel", "2");
      expect(useStore.getState().readersPanel).toBeNull();

      // 未完了の取得が後から解決しても、閉じたパネルを開き直さない。
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(useStore.getState().readersPanel).toBeNull();
    } finally {
      api.line.readReceipts = originalReadReceipts;
      useStore.setState({ readersPanel: null });
    }
  });

  it("marks messages read up to requestedMessageId with forceReceipt and keeps subsequent messages unread", async () => {
    const originalMarkAsRead = api.line.markAsRead;
    let markAsReadCalledWith: { accountId: string; chatId: string; lastMessageId?: string } | null =
      null;
    api.line.markAsRead = async (accountId, chatId, lastMessageId) => {
      markAsReadCalledWith = { accountId, chatId, lastMessageId };
      return { ok: true };
    };

    const chatId = "c-test-read-up-to";
    const accountId = "account-test-read-up-to";
    try {
      useStore.setState({
        accountId,
        chats: [
          {
            id: chatId,
            type: "group",
            name: "Test Chat",
            unread: 2,
            avatar: "",
            color: "blue",
            status: "offline",
            isOfficial: false,
          },
        ],
        messages: [
          {
            id: "100",
            chatId,
            authorId: "u-peer",
            kind: "text",
            text: "Message 100",
            createdAt: 1_000,
            status: "sent",
            read: false,
            messageState: "normal",
          },
          {
            id: "200",
            chatId,
            authorId: "u-peer",
            kind: "text",
            text: "Message 200",
            createdAt: 2_000,
            status: "sent",
            read: false,
            messageState: "normal",
          },
        ],
        settings: {
          ...useStore.getState().settings,
          readReceipts: false, // 既読OFF設定でも forceReceipt で送れること
        },
      });

      // 100 まで既読
      await useStore.getState().markChatRead(chatId, "100", { forceReceipt: true });

      expect(markAsReadCalledWith as unknown).toEqual({
        accountId,
        chatId,
        lastMessageId: "100",
      });

      const st = useStore.getState();
      const msg100 = st.messages.find((m) => m.id === "100");
      const msg200 = st.messages.find((m) => m.id === "200");
      const chat = st.chats.find((c) => c.id === chatId);

      expect(msg100?.read).toBe(true);
      expect(msg200?.read).toBe(false);
      expect(chat?.unread).toBe(1); // 200 が未読なので残りは 1 件
    } finally {
      api.line.markAsRead = originalMarkAsRead;
    }
  });
});
