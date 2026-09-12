import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  applyLocalReadWatermark,
  mergeStoredReadState,
  softDeleteMessage,
  restoreDeletedMessage,
  upsertMessages,
  getStoredMessages,
  getChatCacheStats,
  releaseAccountChatCache,
  type StoredMessage,
} from "./chatStore.js";
import { accountDir } from "./accountDirs.js";

describe("mergeStoredReadState", () => {
  test("does not turn an unknown group message into read", () => {
    expect(mergeStoredReadState(undefined, {})).toEqual({});
  });

  test("keeps persisted readers when a later response omits them", () => {
    expect(
      mergeStoredReadState({ readBy: ["u-reader-1"], readCount: 1 }, { readBy: [], readCount: 0 }),
    ).toEqual({ readCount: 1, readBy: ["u-reader-1"] });
  });

  test("never rolls a persisted seen flag back to unread", () => {
    expect(mergeStoredReadState({ seen: true }, { seen: false })).toEqual({ seen: true });
  });
});

describe("applyLocalReadWatermark", () => {
  test("marks every received message through the confirmed read point without changing own receipts", () => {
    const messages: Record<string, StoredMessage> = {
      "100": {
        id: "100",
        chatMid: "u-chat",
        from: "u-peer",
        to: "u-me",
        text: "old",
        contentType: "NONE",
        createdTime: 1,
        isMyMessage: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
      "101": {
        id: "101",
        chatMid: "u-chat",
        from: "u-me",
        to: "u-peer",
        text: "mine",
        contentType: "NONE",
        createdTime: 2,
        isMyMessage: true,
        seen: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
      "102": {
        id: "102",
        chatMid: "u-chat",
        from: "u-peer",
        to: "u-me",
        text: "read",
        contentType: "NONE",
        createdTime: 3,
        isMyMessage: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
      "103": {
        id: "103",
        chatMid: "u-chat",
        from: "u-peer",
        to: "u-me",
        text: "unread",
        contentType: "NONE",
        createdTime: 4,
        isMyMessage: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
    };

    applyLocalReadWatermark(messages, "102");

    expect(messages["100"]?.seen).toBe(true);
    expect(messages["101"]?.seen).toBe(false);
    expect(messages["102"]?.seen).toBe(true);
    expect(messages["103"]?.seen).toBeUndefined();
  });
});

describe("soft deletion", () => {
  test("keeps a deleted message out of normal reads and does not let sync resurrect it", async () => {
    const accountId = `soft-delete-${crypto.randomUUID()}`;
    const chatMid = "u-soft-delete";
    const message: StoredMessage = {
      id: "200",
      chatMid,
      from: "u-peer",
      to: "u-me",
      text: "keep me for restore",
      contentType: "NONE",
      createdTime: 200,
      isMyMessage: false,
      savedAt: new Date().toISOString(),
    };

    await upsertMessages(accountId, chatMid, [message]);
    expect(await softDeleteMessage(accountId, chatMid, message.id)).toBe(true);
    await upsertMessages(accountId, chatMid, [{ ...message, text: "server replay" }]);

    expect(await getStoredMessages(accountId, chatMid, 10)).toEqual([]);
    expect(
      (await getStoredMessages(accountId, chatMid, 10, { includeDeleted: true }))[0]?.text,
    ).toBe("server replay");
    expect(await restoreDeletedMessage(accountId, chatMid, message.id)).toBe(true);
    expect((await getStoredMessages(accountId, chatMid, 10))[0]?.text).toBe("server replay");
    await rm(accountDir(accountId), { recursive: true, force: true });
  });
});

describe("bounded account cache", () => {
  test("flushes dirty history before evicting an older account", async () => {
    const firstAccount = `cache-first-${crypto.randomUUID()}`;
    const secondAccount = `cache-second-${crypto.randomUUID()}`;
    const chatMid = "u-cache";
    const message: StoredMessage = {
      id: "1",
      chatMid,
      from: "u-peer",
      to: "u-me",
      text: "must survive eviction",
      contentType: "NONE",
      createdTime: 1,
      isMyMessage: false,
      savedAt: new Date().toISOString(),
    };

    try {
      await upsertMessages(firstAccount, chatMid, [message]);
      await getStoredMessages(secondAccount, chatMid, 10);

      const stats = getChatCacheStats();
      expect(stats.cachedAccounts).toBeLessThanOrEqual(stats.maxCachedAccounts);
      expect(stats.cachedAccountIds).toContain(secondAccount);
      expect(stats.cachedAccountIds).not.toContain(firstAccount);

      // Reloading the evicted account proves that eviction did not discard its
      // dirty in-memory mutation before SQLite persistence completed.
      expect((await getStoredMessages(firstAccount, chatMid, 10))[0]?.text).toBe(
        "must survive eviction",
      );
    } finally {
      await releaseAccountChatCache(firstAccount).catch(() => undefined);
      await releaseAccountChatCache(secondAccount).catch(() => undefined);
      await rm(accountDir(firstAccount), { recursive: true, force: true });
      await rm(accountDir(secondAccount), { recursive: true, force: true });
    }
  });

  test("pages large histories without losing messages evicted from the hot cache", async () => {
    const accountId = `paging-${crypto.randomUUID()}`;
    const chatMid = "u-paging";
    const messages = Array.from(
      { length: 650 },
      (_, index): StoredMessage => ({
        id: String(10_000 + index),
        chatMid,
        from: "u-peer",
        to: "u-me",
        text: `message-${index}`,
        contentType: "NONE",
        createdTime: index + 1,
        isMyMessage: false,
        savedAt: new Date().toISOString(),
      }),
    );

    try {
      await upsertMessages(accountId, chatMid, messages);

      const newest = await getStoredMessages(accountId, chatMid, 20);
      expect(newest).toHaveLength(20);
      expect(newest[0]?.id).toBe("10649");

      const oldest = await getStoredMessages(accountId, chatMid, 20, {
        beforeDeliveredTime: 21,
        beforeMessageId: "10020",
      });
      expect(oldest[0]?.id).toBe("10019");
      expect(oldest).toHaveLength(20);

      // Updating an old record must merge with SQLite's copy even though it
      // is no longer in the bounded in-memory page.
      await upsertMessages(accountId, chatMid, [{ ...messages[0]!, text: "updated-old" }]);
      const updated = await getStoredMessages(accountId, chatMid, 5, {
        beforeDeliveredTime: 2,
        beforeMessageId: "10001",
      });
      expect(updated[0]?.text).toBe("updated-old");
      expect(
        (await getStoredMessages(accountId, chatMid, 5, { includeDeleted: true })).length,
      ).toBe(5);
    } finally {
      await releaseAccountChatCache(accountId).catch(() => undefined);
      await rm(accountDir(accountId), { recursive: true, force: true });
    }
  });
});
