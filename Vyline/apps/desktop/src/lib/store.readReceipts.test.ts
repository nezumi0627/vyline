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

function captureReadRequests() {
  const bodies: Array<{ chatMid?: string; lastMessageId?: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/sendChatChecked")) {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as { lastMessageId?: string });
    }
    return Response.json({ ok: true });
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

test("reads through the latest received message when the list time is only slightly later", async () => {
  const bodies = captureReadRequests();
  setChatWithHistory("u-up-to-date", 1_000 + 5_000);

  await useStore.getState().markChatRead("u-up-to-date");

  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.lastMessageId).toBe("1000");
});
