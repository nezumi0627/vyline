import { afterEach, expect, test } from "bun:test";
import { useStore } from "./store.js";

const originalFetch = globalThis.fetch;
const cachedChat = {
  id: "c-cached", name: "Cached group", type: "group" as const, avatar: "C",
  color: "#000", status: "", unread: 0, lastMessagePreview: "cached", lastMessageTime: 1,
};

function seed() {
  useStore.setState({ accountId: "offline-roster", chats: [cachedChat], activeChatId: cachedChat.id, messages: [] });
}

function respond(body: unknown) {
  globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  useStore.setState({ accountId: null, chats: [], messages: [], activeChatId: null });
});

test("an empty periodic refresh preserves the cached sidebar and selection", async () => {
  seed();
  respond({ ok: true, chats: [] });
  await useStore.getState().refreshChatsSilently();
  expect(useStore.getState().chats).toEqual([cachedChat]);
  expect(useStore.getState().activeChatId).toBe(cachedChat.id);
});

test("a failed refresh preserves the cached sidebar", async () => {
  seed();
  globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  await useStore.getState().refreshChatsSilently();
  expect(useStore.getState().chats).toEqual([cachedChat]);
});

test("a periodic refresh excludes exited groups even when they are still in history", async () => {
  seed();
  respond({ ok: true, chats: [{ mid: cachedChat.id, name: "Exited", kind: "group", hasMessages: true, left: true }] });
  await useStore.getState().refreshChatsSilently();
  expect(useStore.getState().chats).toEqual([]);
  expect(useStore.getState().activeChatId).toBeNull();
});

test("hydrating an exited selection keeps available chats but opens none", () => {
  seed();
  useStore.getState().hydrateLineData({
    profile: null, messages: [], readyChatId: null, hiddenMids: new Set(), contactCache: new Map(),
    chats: [
      { mid: cachedChat.id, name: "Exited", kind: "group", hasMessages: true, lastMessageTime: 1, left: true },
      { mid: "u-available", name: "Available", kind: "direct", hasMessages: true, lastMessageTime: 1 },
    ],
  });
  expect(useStore.getState().chats.map((c) => c.id)).toEqual(["u-available"]);
  expect(useStore.getState().activeChatId).toBeNull();
});

test("setting the same account preserves its cached chats, switching accounts clears them", () => {
  seed();
  useStore.getState().setAccountId("offline-roster");
  expect(useStore.getState().chats).toEqual([cachedChat]);
  useStore.getState().setAccountId("offline-other");
  expect(useStore.getState().chats).toEqual([]);
});

test("a fresh startup hydrates the chat list without opening the first chat", () => {
  useStore.setState({ accountId: "offline-roster", chats: [], activeChatId: null, messages: [] });
  useStore.getState().hydrateLineData({
    profile: null, messages: [], readyChatId: null, hiddenMids: new Set(), contactCache: new Map(),
    chats: [{ mid: cachedChat.id, name: cachedChat.name, kind: "group", hasMessages: true, lastMessageTime: 1 }],
  });
  expect(useStore.getState().chats.map((chat) => chat.id)).toEqual([cachedChat.id]);
  expect(useStore.getState().activeChatId).toBeNull();
});

test("the persisted store does not include the last opened chat", () => {
  const partialize = useStore.persist.getOptions().partialize;
  expect(partialize).toBeDefined();
  const persisted = partialize!(useStore.getState()) as Record<string, unknown>;
  expect(persisted).not.toHaveProperty("activeChatId");
});

test("rehydration discards a stale persisted chat selection", () => {
  useStore.setState({ accountId: "offline-roster", activeChatId: cachedChat.id, screen: "chat", messages: [] });
  const afterHydrate = useStore.persist.getOptions().onRehydrateStorage?.(useStore.getState());
  afterHydrate?.(useStore.getState(), undefined);
  expect(useStore.getState().activeChatId).toBeNull();
  expect(useStore.getState().screen).toBe("home");
});
