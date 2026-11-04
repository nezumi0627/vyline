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

test("retries the initial receipt fetch after a failed or incomplete response", async () => {
  for (const [chatId, response] of [
    ["c-receipts-failed", { ok: false }],
    ["c-receipts-missing", { ok: true }],
  ] as const) {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json(
        requests === 1
          ? response
          : { ok: true, receipts: { "old-own-message": { seen: true } } },
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
