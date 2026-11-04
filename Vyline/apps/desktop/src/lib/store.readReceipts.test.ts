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

test("reports failed mark-read requests so the sync hook can retry", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) throw new Error("temporary failure");
    return Response.json({ ok: true });
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
  globalThis.fetch = (async () => {
    requests += 1;
    return Response.json(requests === 1 ? { ok: false } : { ok: true });
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
    return Response.json({ ok: true });
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

  releaseFirst(Response.json({ ok: true }));
  expect(await older).toBe(true);
  expect(await newer).toBe(true);
  expect(requestedIds).toEqual(["100", "200"]);
  expect(await useStore.getState().markChatRead("c-read-ordering", "100")).toBe(true);
  expect(requestedIds).toEqual(["100", "200"]);
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

  release(Response.json({ ok: true }));
  expect(await first).toBe(true);
  expect(await duplicate).toBe(true);
  expect(requests).toBe(1);
});
