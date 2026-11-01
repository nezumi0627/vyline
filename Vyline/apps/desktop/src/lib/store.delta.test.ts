import { afterAll, expect, test } from "bun:test";
import { useStore } from "./store.js";

const originalFetch = globalThis.fetch;

function holdFetchResponse() {
  let markStarted!: () => void;
  let resolveFetch!: (response: Response) => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  globalThis.fetch = (() => {
    markStarted();
    return response;
  }) as unknown as typeof fetch;
  return { started, resolveFetch };
}

function messageResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      messages: [
        {
          id: "2",
          from: "peer",
          to: "shared-chat-mid",
          text,
          contentType: "TEXT",
          createdTime: 2,
          isMyMessage: false,
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );
}

afterAll(() => {
  globalThis.fetch = originalFetch;
  useStore.setState({ accountId: null, activeChatId: null, chats: [], messages: [] });
});

test("keeps initial chat scrolling pending until the selected chat's latest page is ready", () => {
  useStore.setState({
    accountId: null,
    chats: [
      {
        id: "scroll-chat",
        name: "Chat",
        type: "friend",
        avatar: "C",
        color: "#000",
        status: "",
        unread: 0,
        lastMessagePreview: "cached",
        lastMessageTime: 1,
      },
    ],
    messages: [
      {
        id: "cached-1",
        chatId: "scroll-chat",
        authorId: "peer",
        text: "cached",
        kind: "text",
        createdAt: 1,
        read: true,
        status: "read",
        messageState: "normal",
      },
    ],
  });

  useStore.getState()._activateChat("scroll-chat");

  expect(useStore.getState().initialChatScrollPending).toBe(true);
});

test("does not merge a delta response after switching accounts while the request is in flight", async () => {
  const { started, resolveFetch } = holdFetchResponse();

  useStore.setState({
    accountId: "offline-account-before-switch",
    activeChatId: "shared-chat-mid",
    messages: [
      {
        id: "1",
        chatId: "shared-chat-mid",
        authorId: "peer",
        text: "old account",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
  });

  const poll = useStore.getState().pollMessagesDelta("shared-chat-mid");
  await started;
  useStore.setState({
    accountId: "offline-account-after-switch",
    activeChatId: "shared-chat-mid",
    messages: [],
  });
  resolveFetch(messageResponse("old account response"));

  await poll;
  expect(useStore.getState().accountId).toBe("offline-account-after-switch");
  expect(useStore.getState().messages).toEqual([]);
});

test("does not merge a backfill response after switching accounts in flight", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  useStore.setState({
    accountId: "offline-backfill-before-switch",
    activeChatId: "shared-chat-mid",
    messages: [
      {
        id: "1",
        chatId: "shared-chat-mid",
        authorId: "peer",
        text: "old account",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
  });

  const backfill = useStore.getState().backfillChat("shared-chat-mid");
  await started;
  useStore.setState({
    accountId: "offline-backfill-after-switch",
    activeChatId: "shared-chat-mid",
    messages: [],
  });
  resolveFetch(messageResponse("old backfill response"));
  await backfill;

  expect(useStore.getState().messages).toEqual([]);
});

test("ignores queued push events from an account that is no longer active", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  useStore.setState({
    accountId: "offline-push-before-switch",
    activeChatId: "shared-chat-mid",
    messages: [],
  });

  const poll = useStore.getState().pollIncoming();
  await started;
  useStore.setState({
    accountId: "offline-push-after-switch",
    activeChatId: "shared-chat-mid",
    messages: [],
  });
  resolveFetch(
    new Response(
      JSON.stringify({
        ok: true,
        cursor: 1,
        events: [
          {
            kind: "message",
            seq: 1,
            chatMid: "shared-chat-mid",
            message: {
              id: "2",
              from: "peer",
              to: "shared-chat-mid",
              text: "old push response",
              contentType: "TEXT",
              createdTime: 2,
              isMyMessage: false,
            },
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  await poll;

  expect(useStore.getState().messages).toEqual([]);
});

test("does not apply read receipts from a previous account to matching message IDs", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  useStore.setState({
    accountId: "offline-receipts-before-switch",
    activeChatId: "shared-chat-mid",
    messages: [
      {
        id: "shared-message-id",
        chatId: "shared-chat-mid",
        authorId: "me",
        text: "sent",
        kind: "text",
        createdAt: Date.now(),
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
    readWatermarks: {},
  });

  const refresh = useStore.getState().refreshReadReceipts("shared-chat-mid", { force: true });
  await started;
  useStore.setState({
    accountId: "offline-receipts-after-switch",
    activeChatId: "shared-chat-mid",
    messages: [
      {
        id: "shared-message-id",
        chatId: "shared-chat-mid",
        authorId: "me",
        text: "other account",
        kind: "text",
        createdAt: Date.now(),
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
    readWatermarks: {},
  });
  resolveFetch(
    new Response(
      JSON.stringify({
        ok: true,
        receipts: { "shared-message-id": { seen: true } },
        peerReadUpTo: "shared-message-id",
        memberReadWatermarks: [],
        memberMids: [],
      }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  await refresh;

  expect(useStore.getState().messages[0]?.read).toBe(false);
  expect(useStore.getState().readWatermarks).toEqual({});
});

test("does not replace a newly active account's messages with a previous account refresh", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  useStore.setState({
    accountId: "offline-refresh-before-switch",
    activeChatId: "shared-chat-mid",
    messages: [
      {
        id: "old-1",
        chatId: "shared-chat-mid",
        authorId: "peer",
        text: "old cache",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "normal",
      },
    ],
  });

  const refresh = useStore.getState().refreshMessages("shared-chat-mid", { force: true });
  await started;
  const newAccountMessage = {
    id: "new-1",
    chatId: "shared-chat-mid",
    authorId: "peer",
    text: "new account cache",
    kind: "text" as const,
    createdAt: 5,
    read: false,
    status: "sent" as const,
    messageState: "normal" as const,
  };
  useStore.setState({
    accountId: "offline-refresh-after-switch",
    activeChatId: "shared-chat-mid",
    messages: [newAccountMessage],
  });
  resolveFetch(messageResponse("old refresh response"));
  await refresh;

  expect(useStore.getState().messages).toEqual([newAccountMessage]);
});

test("does not replace the new account's chat list with an old account refresh", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  const newAccountChat = {
    id: "new-account-chat",
    name: "New account",
    type: "friend" as const,
    avatar: "N",
    color: "#000",
    status: "",
    unread: 0,
    online: false,
    isOfficial: false,
    isSelf: false,
    hidden: false,
    muted: false,
    pinned: false,
    lastMessageTime: 1,
  };
  useStore.setState({ accountId: "offline-chats-before-switch", chats: [] });

  const refresh = useStore.getState().refreshChatsSilently();
  await started;
  useStore.setState({ accountId: "offline-chats-after-switch", chats: [newAccountChat] });
  resolveFetch(
    new Response(JSON.stringify({ ok: true, chats: [] }), {
      headers: { "content-type": "application/json" },
    }),
  );
  await refresh;

  expect(useStore.getState().chats).toEqual([newAccountChat]);
});

test("does not overwrite blocked contacts after switching accounts in flight", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  useStore.setState({ accountId: "offline-blocked-before-switch", blockedMids: [] });

  const refresh = useStore.getState().syncBlockedMids();
  await started;
  useStore.setState({
    accountId: "offline-blocked-after-switch",
    blockedMids: ["new-account-block"],
  });
  resolveFetch(
    new Response(JSON.stringify({ ok: true, mids: ["old-account-block"] }), {
      headers: { "content-type": "application/json" },
    }),
  );
  await refresh;

  expect(useStore.getState().blockedMids).toEqual(["new-account-block"]);
});

test("does not request an unsend for a message whose send already failed", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  useStore.setState({
    accountId: "offline-unsend-failed",
    messages: [
      {
        id: "failed-message",
        chatId: "chat",
        authorId: "me",
        kind: "text",
        text: "not sent",
        createdAt: 1,
        status: "failed",
        read: false,
        messageState: "normal",
      },
    ],
  });

  await useStore.getState().revokeMessage("failed-message");

  expect(requests).toBe(0);
  expect(useStore.getState().messages[0]?.messageState).toBe("normal");
});

test("does not restore a revoked message when the backend has no restorable history", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: "no history to restore",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  useStore.setState({
    accountId: "offline-restore-failure",
    activeChatId: "restore-chat",
    messages: [
      {
        id: "restore-message",
        chatId: "restore-chat",
        authorId: "me",
        kind: "text",
        createdAt: 1,
        read: false,
        status: "sent",
        messageState: "revoked-by-self",
        history: [{ state: "normal", text: "original", contentType: "TEXT", updatedTime: 1 }],
      },
    ],
  });

  await useStore.getState().restoreRevokedMessage("restore-chat", "restore-message");

  const restored = useStore.getState().messages[0];
  expect(restored?.messageState).toBe("revoked-by-self");
  expect(restored?.text).toBeUndefined();
});

test("does not roll back an unsend into a new account after the old request fails", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  const sent = {
    id: "shared-unsend-id",
    chatId: "shared-chat-mid",
    authorId: "me",
    kind: "text" as const,
    text: "old account",
    createdAt: 1,
    status: "sent" as const,
    read: false,
    messageState: "normal" as const,
  };
  useStore.setState({ accountId: "offline-unsend-before-switch", messages: [sent] });

  const revoke = useStore.getState().revokeMessage(sent.id);
  await started;
  const newAccountMessage = {
    ...sent,
    text: "new account",
    messageState: "revoked-by-self" as const,
  };
  useStore.setState({ accountId: "offline-unsend-after-switch", messages: [newAccountMessage] });
  resolveFetch(
    new Response(JSON.stringify({ ok: false, error: "MESSAGE_NOT_DESTRUCTIBLE" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  );
  await revoke;

  expect(useStore.getState().messages).toEqual([newAccountMessage]);
});

test("does not mark a new account's optimistic message failed from an old send response", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  useStore.setState({ accountId: "offline-send-before-switch", messages: [] });

  const send = useStore.getState().sendMessage("shared-chat-mid", "old account text");
  await started;
  const optimistic = useStore.getState().messages[0]!;
  const newAccountMessage = { ...optimistic, text: "new account text" };
  useStore.setState({ accountId: "offline-send-after-switch", messages: [newAccountMessage] });
  resolveFetch(
    new Response(JSON.stringify({ ok: false, error: "offline failure fixture" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  );
  await send;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(useStore.getState().messages).toEqual([newAccountMessage]);
});

test("does not mark a new account's message failed from an old retry response", async () => {
  const { started, resolveFetch } = holdFetchResponse();
  const failed = {
    id: "shared-retry-id",
    chatId: "shared-chat-mid",
    authorId: "me",
    kind: "text" as const,
    text: "retry text",
    createdAt: 1,
    status: "failed" as const,
    read: false,
    messageState: "normal" as const,
    retry: { kind: "text" as const, text: "retry text" },
  };
  useStore.setState({ accountId: "offline-retry-before-switch", messages: [failed] });

  const retry = useStore.getState().retryMessage(failed.id);
  await started;
  const newAccountMessage = {
    ...failed,
    text: "new account message",
    retry: undefined,
    status: "sent" as const,
  };
  useStore.setState({ accountId: "offline-retry-after-switch", messages: [newAccountMessage] });
  resolveFetch(
    new Response(JSON.stringify({ ok: false, error: "offline retry failure" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  );
  await retry;

  expect(useStore.getState().messages).toEqual([newAccountMessage]);
});
