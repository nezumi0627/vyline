import { describe, expect, it } from "bun:test";
import type { Chat, Message } from "@vyline/types";
import {
  attachGroupReadReceipts,
  memberReadWatermarks,
  normalizeMessageReadRanges,
  reconcileChatUnreadWithLocalRead,
  rethrowReadReceiptFailure,
  setBoundedCacheEntry,
} from "./lineService";

describe("attachGroupReadReceipts", () => {
  it("preserves readers from earlier polls while adding new readers", () => {
    const message = {
      id: "100",
      isMyMessage: true,
      readBy: ["u-old"],
      readCount: 1,
    } as unknown as Message;

    attachGroupReadReceipts(
      [message],
      [
        { mid: "u-new", upTo: 100n },
        { mid: "u-old", upTo: 100n },
      ],
    );

    expect(message.readBy).toEqual(["u-old", "u-new"]);
    expect(message.readCount).toBe(2);
  });

  it("reads the actual TMessageReadRange map shape with one entry per member", () => {
    const marks = memberReadWatermarks(
      [
        {
          chatId: "c-group",
          ranges: {
            "u-reader": { startMessageId: "1", endMessageId: "123" },
          },
        },
      ],
      "c-group",
      "u-self",
    );

    expect(marks).toEqual([{ mid: "u-reader", upTo: 123n }]);
  });

  it("unwraps the thrift success wrapper returned by the raw request client", () => {
    expect(
      normalizeMessageReadRanges({
        success: [{ chatId: "c-group", ranges: {} }],
      }),
    ).toEqual([{ chatId: "c-group", ranges: {} }]);
  });
});

describe("rethrowReadReceiptFailure", () => {
  it("keeps a network failure visible to callers so they can retry", () => {
    const failure = new Error("connection reset");
    expect(() => rethrowReadReceiptFailure(failure, "account", "chat")).toThrow(failure);
  });
});

describe("reconcileChatUnreadWithLocalRead", () => {
  const chat = { mid: "u-chat", lastMessageId: "200", unreadCount: 3 } as Chat;

  it("clears a stale unread count when the local read position includes the latest message", () => {
    expect(reconcileChatUnreadWithLocalRead(chat, "200").unreadCount).toBe(0);
    expect(reconcileChatUnreadWithLocalRead(chat, "201").unreadCount).toBe(0);
  });

  it("preserves unread messages newer than the local read position", () => {
    expect(reconcileChatUnreadWithLocalRead(chat, "199")).toBe(chat);
  });

  it("keeps the server count when message ID ordering is unknown", () => {
    expect(
      reconcileChatUnreadWithLocalRead({ ...chat, lastMessageId: "opaque" }, "opaque").unreadCount,
    ).toBe(3);
  });
});

describe("setBoundedCacheEntry", () => {
  it("evicts the least recently inserted key when the cache reaches its cap", () => {
    const cache = new Map([
      ["old", 1],
      ["newer", 2],
    ]);
    setBoundedCacheEntry(cache, "latest", 3, 2);
    expect([...cache]).toEqual([
      ["newer", 2],
      ["latest", 3],
    ]);
  });
});
