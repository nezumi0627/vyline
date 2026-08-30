import { describe, expect, it } from "bun:test";
import { findFirstUnreadMessage, isNearScrollBottom } from "./chatScroll";

const message = (id: string, createdAt: number, read: boolean, authorId = "peer") => ({
  id,
  createdAt,
  read,
  authorId,
});

describe("findFirstUnreadMessage", () => {
  it("returns the oldest unread message from the other person", () => {
    const result = findFirstUnreadMessage([
      message("30", 30, false),
      message("10", 10, true),
      message("20", 20, false),
    ]);

    expect(result?.id).toBe("20");
  });

  it("ignores unread messages sent by me", () => {
    const result = findFirstUnreadMessage([message("10", 10, false, "me")]);

    expect(result).toBeUndefined();
  });

  it("returns undefined when all messages are read", () => {
    const result = findFirstUnreadMessage([message("10", 10, true), message("20", 20, true)]);
    expect(result).toBeUndefined();
  });

  it("uses BigInt id as tie-breaker when createdAt is equal", () => {
    const result = findFirstUnreadMessage([message("20", 100, false), message("10", 100, false)]);
    expect(result?.id).toBe("10");
  });
});

describe("isNearScrollBottom", () => {
  it("treats exact and fractional bottom positions as bottom", () => {
    expect(isNearScrollBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isNearScrollBottom({ scrollTop: 599.4, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  it("returns false when the user is meaningfully above the bottom", () => {
    expect(isNearScrollBottom({ scrollTop: 560, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it("supports a custom threshold and clamps negative thresholds", () => {
    const metrics = { scrollTop: 590, scrollHeight: 1000, clientHeight: 400 };
    expect(isNearScrollBottom(metrics, 12)).toBe(true);
    expect(isNearScrollBottom(metrics, -1)).toBe(false);
  });
});
