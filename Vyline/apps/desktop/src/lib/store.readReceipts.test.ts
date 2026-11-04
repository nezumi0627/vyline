import { afterEach, expect, test } from "bun:test";
import { useStore } from "./store.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  useStore.setState({
    accountId: null,
    chats: [],
    messages: [],
    activeChatId: null,
    readDisabledMids: {},
  });
});

test("manual mark-all sends receipts even when automatic receipts are disabled", async () => {
  const requests: Array<{ url: string; body: { chatMids?: string[] } }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as { chatMids?: string[] },
    });
    return Response.json({ ok: true, lastMessageId: "server-latest" });
  }) as typeof fetch;

  useStore.setState((state) => ({
    accountId: "mark-all-read-test",
    settings: { ...state.settings, readReceipts: false },
    readDisabledMids: { "c-disabled-chat": true },
    chats: [
      {
        id: "u-unread-chat",
        name: "DM",
        type: "friend",
        avatar: "D",
        color: "#000",
        status: "",
        unread: 2,
        lastMessagePreview: "",
        lastMessageTime: 1,
      },
      {
        id: "c-disabled-chat",
        name: "Group",
        type: "group",
        avatar: "G",
        color: "#000",
        status: "",
        unread: 1,
        lastMessagePreview: "",
        lastMessageTime: 1,
      },
      {
        id: "u-read-chat",
        name: "Read",
        type: "friend",
        avatar: "R",
        color: "#000",
        status: "",
        unread: 0,
        lastMessagePreview: "",
        lastMessageTime: 1,
      },
    ],
  }));

  await useStore.getState().markAllChatsRead();

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("/read-all");
  expect(requests[0]?.body.chatMids?.sort()).toEqual(["c-disabled-chat", "u-unread-chat"]);
  expect(useStore.getState().chats.every((chat) => chat.unread === 0)).toBe(true);
});

test("uses the message ID when the chat summary advances within the same millisecond", async () => {
  const requestedIds: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { lastMessageId?: string };
    requestedIds.push(body.lastMessageId ?? "");
    return Response.json({ ok: true, lastMessageId: body.lastMessageId });
  }) as typeof fetch;
  useStore.setState((state) => ({
    accountId: "mark-read-same-millisecond",
    settings: { ...state.settings, readReceipts: true },
    chats: [
      {
        id: "c-same-millisecond",
        name: "DM",
        type: "friend",
        avatar: "D",
        color: "#000",
        status: "",
        unread: 1,
        lastMessageTime: 1,
        lastMessageId: "100",
      },
    ],
    messages: [
      {
        id: "90",
        chatId: "c-same-millisecond",
        authorId: "u-sender",
        text: "older",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
  }));

  await useStore.getState().markChatRead("c-same-millisecond");
  useStore.setState((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === "c-same-millisecond" ? { ...chat, lastMessageId: "101" } : chat,
    ),
  }));
  await useStore.getState().markChatRead("c-same-millisecond");

  expect(requestedIds).toEqual(["100", "101"]);
});

test("serializes newer read receipts behind an in-flight older receipt", async () => {
  const requestedIds: string[] = [];
  let releaseFirst!: (response: Response) => void;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { lastMessageId?: string };
    requestedIds.push(body.lastMessageId ?? "");
    if (requestedIds.length === 1) {
      return await new Promise<Response>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return Response.json({ ok: true, lastMessageId: body.lastMessageId });
  }) as typeof fetch;
  useStore.setState((state) => ({
    accountId: "mark-read-overlap",
    settings: { ...state.settings, readReceipts: true },
    chats: [
      {
        id: "c-overlap",
        name: "DM",
        type: "friend",
        avatar: "D",
        color: "#000",
        status: "",
        unread: 1,
        lastMessageTime: 2,
      },
    ],
    messages: ["100", "101"].map((id, index) => ({
      id,
      chatId: "c-overlap",
      authorId: "u-sender",
      text: "message",
      kind: "text" as const,
      createdAt: index + 1,
      read: false,
      status: "sent" as const,
      messageState: "normal" as const,
    })),
  }));

  const olderRequest = useStore.getState().markChatRead("c-overlap", "100");
  await Promise.resolve();
  const newerRequest = useStore.getState().markChatRead("c-overlap", "101");
  await Promise.resolve();
  expect(requestedIds).toEqual(["100"]);

  releaseFirst(Response.json({ ok: true, lastMessageId: "100" }));
  await Promise.all([olderRequest, newerRequest]);
  expect(requestedIds).toEqual(["100", "101"]);
});

function captureReadRequests() {
  const bodies: Array<{ chatMid?: string; lastMessageId?: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/sendChatChecked")) {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as { lastMessageId?: string });
    }
    return Response.json({ ok: true, lastMessageId: "1000" });
  }) as typeof fetch;
  return bodies;
}

function setChatWithHistory(chatId: string, lastMessageTime: number) {
  useStore.setState((state) => ({
    accountId: `box-ahead-${chatId}`,
    settings: { ...state.settings, readReceipts: true },
    chats: [
      {
        id: chatId,
        name: "Official",
        type: "friend",
        avatar: "O",
        color: "#000",
        status: "",
        // 開いた時点で一覧の未読は 0 にされている
        unread: 0,
        lastMessagePreview: "",
        lastMessageTime,
      },
    ],
    messages: [
      {
        id: "1000",
        chatId,
        authorId: chatId,
        kind: "text",
        text: "",
        createdAt: 1_000,
        messageState: "normal",
        read: true,
      } as never,
    ],
  }));
}

test("reads through the message box when the list is ahead of the history", async () => {
  const bodies = captureReadRequests();
  setChatWithHistory("u-box-ahead", 1_000 + 2 * 60_000);

  await useStore.getState().markChatRead("u-box-ahead");

  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.lastMessageId).toBeUndefined();

  // 同じ一覧の時刻へは送り直さない
  await useStore.getState().markChatRead("u-box-ahead");
  expect(bodies).toHaveLength(1);
});

test("retries read-through when the backend could not resolve a message id", async () => {
  let attempts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/sendChatChecked")) attempts++;
    return Response.json({ ok: true, lastMessageId: attempts === 1 ? undefined : "1000" });
  }) as typeof fetch;
  setChatWithHistory("u-box-id-unavailable", 1_000 + 2 * 60_000);

  await useStore.getState().markChatRead("u-box-id-unavailable");
  await useStore.getState().markChatRead("u-box-id-unavailable");

  expect(attempts).toBe(2);
});

test("reads through the latest received message when the list time is only slightly later", async () => {
  const bodies = captureReadRequests();
  setChatWithHistory("u-up-to-date", 1_000 + 5_000);

  await useStore.getState().markChatRead("u-up-to-date");

  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.lastMessageId).toBe("1000");
});

test("retries the initial receipt fetch after a failed or incomplete response", async () => {
  for (const [chatId, response] of [
    ["c-receipts-failed", { ok: false }],
    ["c-receipts-missing", { ok: true }],
  ] as const) {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json(
        requests === 1 ? response : { ok: true, receipts: { "old-own-message": { seen: true } } },
      );
    }) as unknown as typeof fetch;
    useStore.setState({
      accountId: `account-${chatId}`,
      messages: [
        {
          id: "old-own-message",
          chatId,
          authorId: "me",
          text: "sent",
          kind: "text",
          createdAt: 1,
          read: false,
          status: "sent",
          messageState: "normal",
        },
      ],
      readWatermarks: {},
    });

    await useStore.getState().refreshReadReceipts(chatId);
    await useStore.getState().refreshReadReceipts(chatId);

    expect(requests).toBe(2);
    expect(useStore.getState().messages[0]?.read).toBe(true);
  }
});

test("force refresh bypasses the successful initial-fetch marker", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return Response.json({ ok: true, receipts: {} });
  }) as unknown as typeof fetch;
  useStore.setState({
    accountId: "force-old-group-receipts",
    messages: [
      {
        id: "old-own-message",
        chatId: "c-old-group",
        authorId: "me",
        text: "sent",
        kind: "text",
        createdAt: 1,
        read: true,
        status: "read",
        messageState: "normal",
      },
    ],
    readWatermarks: {},
  });

  await useStore.getState().refreshReadReceipts("c-old-group");
  await useStore.getState().refreshReadReceipts("c-old-group", { force: true });

  expect(requests).toBe(2);
});

test.each(["account-switch", "account-reset"])(
  "clears initial receipt markers after %s",
  async (resetMode) => {
    let requests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("getMessageReadRange")) requests += 1;
      return Response.json({ ok: true, receipts: {} });
    }) as unknown as typeof fetch;
    const accountId = `clear-read-marker-${resetMode}`;
    const chatId = "c-old-group";
    const seed = () =>
      useStore.setState({
        accountId,
        messages: [
          {
            id: "old-own-message",
            chatId,
            authorId: "me",
            text: "sent",
            kind: "text",
            createdAt: 1,
            read: true,
            status: "read",
            messageState: "normal",
          },
        ],
        readWatermarks: {},
      });
    seed();
    await useStore.getState().refreshReadReceipts(chatId);

    if (resetMode === "account-switch") {
      useStore.getState().setAccountId("temporary-other-account");
      useStore.getState().setAccountId(accountId);
    } else {
      useStore.getState().resetAccountData();
    }
    seed();
    await useStore.getState().refreshReadReceipts(chatId);

    expect(requests).toBe(2);
  },
);

test("discards an in-flight receipt response after resetting the same account", async () => {
  let requests = 0;
  let releaseFirst!: (response: Response) => void;
  let announceFirst!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => {
    announceFirst = resolve;
  });
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) {
      announceFirst();
      return await new Promise<Response>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return Response.json({ ok: true, receipts: { "reset-race-message": { seen: true } } });
  }) as unknown as typeof fetch;
  const accountId = "receipt-reset-race";
  const chatId = "c-reset-race";
  const seed = () =>
    useStore.setState({
      accountId,
      messages: [
        {
          id: "reset-race-message",
          chatId,
          authorId: "me",
          text: "sent",
          kind: "text",
          createdAt: 1,
          read: false,
          status: "sent",
          messageState: "normal",
        },
      ],
      readWatermarks: {},
    });
  seed();
  const staleRequest = useStore.getState().refreshReadReceipts(chatId);
  await firstRequestStarted;

  useStore.getState().resetAccountData();
  seed();
  releaseFirst(Response.json({ ok: true, receipts: { "reset-race-message": { seen: true } } }));
  await staleRequest;

  expect(useStore.getState().messages[0]?.read).toBe(false);
  await useStore.getState().refreshReadReceipts(chatId);
  expect(requests).toBe(2);
  expect(useStore.getState().messages[0]?.read).toBe(true);
});

test("discards a stale reader-profile response after resetting the same account", async () => {
  let warmCalls = 0;
  let releaseWarmCache!: (response: Response) => void;
  let announceWarmCache!: () => void;
  const warmCacheStarted = new Promise<void>((resolve) => {
    announceWarmCache = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/vyline/warm")) {
      warmCalls += 1;
      if (warmCalls === 1) {
        announceWarmCache();
        return await new Promise<Response>((resolve) => {
          releaseWarmCache = resolve;
        });
      }
      return Response.json({
        ok: true,
        profiles: { "u-stale-reader": { displayName: "Fresh profile" } },
      });
    }
    return Response.json({
      ok: true,
      receipts: {},
      memberReadWatermarks: [{ mid: "u-stale-reader", upTo: "old-own-message" }],
    });
  }) as unknown as typeof fetch;
  const accountId = "reader-profile-reset-race";
  const chatId = "c-reader-profile-reset-race";
  useStore.setState({
    accountId,
    chats: [{ id: chatId, members: [] } as never],
    messages: [
      {
        id: "old-own-message",
        chatId,
        authorId: "me",
        text: "sent",
        kind: "text",
        createdAt: 1,
        read: true,
        status: "read",
        messageState: "normal",
      },
    ],
    readWatermarks: {},
  });

  await useStore.getState().refreshReadReceipts(chatId);
  await warmCacheStarted;
  useStore.getState().resetAccountData();
  useStore.setState({
    accountId,
    chats: [{ id: chatId, members: [] } as never],
    messages: [
      {
        id: "old-own-message",
        chatId,
        authorId: "me",
        text: "sent",
        kind: "text",
        createdAt: 1,
        read: true,
        status: "read",
        messageState: "normal",
      },
    ],
  });
  releaseWarmCache(
    Response.json({
      ok: true,
      profiles: { "u-stale-reader": { displayName: "Stale profile" } },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(useStore.getState().chats[0]?.members).toEqual([]);
  await useStore.getState().refreshReadReceipts(chatId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useStore.getState().chats[0]?.members?.[0]?.name).toBe("Fresh profile");
  expect(warmCalls).toBe(2);
});

test("reports failed mark-read requests so the sync hook can retry", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) throw new Error("temporary failure");
    return Response.json({ ok: true, lastMessageId: "1000" });
  }) as unknown as typeof fetch;
  useStore.setState((state) => ({
    accountId: "mark-read-retry-result",
    settings: { ...state.settings, readReceipts: true },
    messages: [
      {
        id: "received-message",
        chatId: "c-retry-read",
        authorId: "u-sender",
        text: "received",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
  }));

  expect(await useStore.getState().markChatRead("c-retry-read")).toBe(false);
  expect(await useStore.getState().markChatRead("c-retry-read")).toBe(true);
  expect(requests).toBe(2);
});

test("shares an in-flight mark-read result and retries after a failed request", async () => {
  let requests = 0;
  let releaseFirst!: (response: Response) => void;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) {
      return await new Promise<Response>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return Response.json({ ok: true, lastMessageId: "1000" });
  }) as unknown as typeof fetch;
  useStore.setState((state) => ({
    accountId: "mark-read-inflight",
    settings: { ...state.settings, readReceipts: true },
    messages: [
      {
        id: "received-message",
        chatId: "c-inflight-read",
        authorId: "u-sender",
        text: "received",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
  }));

  const first = useStore.getState().markChatRead("c-inflight-read");
  const duplicate = useStore.getState().markChatRead("c-inflight-read");
  await Promise.resolve();
  releaseFirst(Response.json({ ok: false }));
  expect(await first).toBe(false);
  expect(await duplicate).toBe(false);
  expect(requests).toBe(1);
  expect(await useStore.getState().markChatRead("c-inflight-read")).toBe(true);
  expect(requests).toBe(2);
});

test("serializes newer read positions and ignores stale older requests", async () => {
  const requestedIds: string[] = [];
  let releaseFirst!: (response: Response) => void;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { lastMessageId?: string };
    requestedIds.push(body.lastMessageId ?? "");
    if (requestedIds.length === 1) {
      return await new Promise<Response>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return Response.json({ ok: true, lastMessageId: body.lastMessageId });
  }) as typeof fetch;
  useStore.setState((state) => ({
    accountId: "mark-read-ordering",
    settings: { ...state.settings, readReceipts: true },
    messages: [
      {
        id: "100",
        chatId: "c-read-ordering",
        authorId: "u-sender",
        text: "older",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "normal",
      },
      {
        id: "200",
        chatId: "c-read-ordering",
        authorId: "u-sender",
        text: "newer",
        kind: "text",
        createdAt: 2,
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
  }));

  const older = useStore.getState().markChatRead("c-read-ordering", "100");
  await Promise.resolve();
  const newer = useStore.getState().markChatRead("c-read-ordering", "200");
  await Promise.resolve();
  expect(requestedIds).toEqual(["100"]);

  releaseFirst(Response.json({ ok: true, lastMessageId: "100" }));
  expect(await older).toBe(true);
  expect(await newer).toBe(true);
  expect(requestedIds).toEqual(["100", "200"]);
  expect(await useStore.getState().markChatRead("c-read-ordering", "100")).toBe(true);
  expect(requestedIds).toEqual(["100", "200"]);
});

test("queues a newer MessageBox time while an ID-less read-through is in flight", async () => {
  const requestedIds: Array<string | undefined> = [];
  let releaseFirst!: (response: Response) => void;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { lastMessageId?: string };
    requestedIds.push(body.lastMessageId);
    if (requestedIds.length === 1) {
      return await new Promise<Response>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return Response.json({ ok: true, lastMessageId: "300" });
  }) as typeof fetch;
  setChatWithHistory("u-box-time-race", 1_000 + 120_000);

  const older = useStore.getState().markChatRead("u-box-time-race");
  await Promise.resolve();
  useStore.setState((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === "u-box-time-race" ? { ...chat, lastMessageTime: 1_000 + 240_000 } : chat,
    ),
  }));
  const newer = useStore.getState().markChatRead("u-box-time-race");
  await Promise.resolve();
  expect(requestedIds).toEqual([undefined]);

  releaseFirst(Response.json({ ok: true, lastMessageId: "200" }));
  await Promise.all([older, newer]);
  expect(requestedIds).toEqual([undefined, undefined]);
});

test("uses the resolved MessageBox ID to suppress an older numeric read", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return Response.json({ ok: true, lastMessageId: "200" });
  }) as unknown as typeof fetch;
  setChatWithHistory("u-box-resolved-id", 1_000 + 120_000);
  useStore.setState({
    messages: [
      {
        id: "100",
        chatId: "u-box-resolved-id",
        authorId: "u-box-resolved-id",
        text: "older history",
        kind: "text",
        createdAt: 1_000,
        read: true,
        status: "read",
        messageState: "normal",
      },
    ],
  });

  await useStore.getState().markChatRead("u-box-resolved-id");
  await useStore.getState().markChatRead("u-box-resolved-id", "100");

  expect(requests).toBe(1);
});

test("shares mark-read requests when the chat has no loaded message ID", async () => {
  let requests = 0;
  let release!: (response: Response) => void;
  globalThis.fetch = (async () => {
    requests += 1;
    return await new Promise<Response>((resolve) => {
      release = resolve;
    });
  }) as unknown as typeof fetch;
  useStore.setState((state) => ({
    accountId: "mark-read-no-id",
    settings: { ...state.settings, readReceipts: true },
    messages: [],
  }));

  const first = useStore.getState().markChatRead("c-no-loaded-message");
  await Promise.resolve();
  const duplicate = useStore.getState().markChatRead("c-no-loaded-message");
  await Promise.resolve();
  expect(requests).toBe(1);

  release(Response.json({ ok: true, lastMessageId: "1000" }));
  expect(await first).toBe(true);
  expect(await duplicate).toBe(true);
  expect(await useStore.getState().markChatRead("c-no-loaded-message")).toBe(true);
  expect(requests).toBe(1);
});
