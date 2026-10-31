import { afterEach, expect, test } from "bun:test";
import { useStore } from "./store.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  useStore.setState({ accountId: null, chats: [], messages: [], activeChatId: null, readDisabledMids: {} });
});

test("manual mark-all sends receipts even when automatic receipts are disabled", async () => {
  const requests: Array<{ url: string; body: { chatMid?: string } }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as { chatMid?: string },
    });
    return Response.json({ ok: true, lastMessageId: "server-latest" });
  }) as typeof fetch;

  useStore.setState((state) => ({
    accountId: "mark-all-read-test",
    settings: { ...state.settings, readReceipts: false },
    readDisabledMids: { "c-disabled-chat": true },
    chats: [
      { id: "u-unread-chat", name: "DM", type: "friend", avatar: "D", color: "#000", status: "", unread: 2, lastMessagePreview: "", lastMessageTime: 1 },
      { id: "c-disabled-chat", name: "Group", type: "group", avatar: "G", color: "#000", status: "", unread: 1, lastMessagePreview: "", lastMessageTime: 1 },
      { id: "u-read-chat", name: "Read", type: "friend", avatar: "R", color: "#000", status: "", unread: 0, lastMessagePreview: "", lastMessageTime: 1 },
    ],
  }));

  await useStore.getState().markAllChatsRead();

  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.body.chatMid).sort()).toEqual(["c-disabled-chat", "u-unread-chat"]);
  expect(useStore.getState().chats.every((chat) => chat.unread === 0)).toBe(true);
});
