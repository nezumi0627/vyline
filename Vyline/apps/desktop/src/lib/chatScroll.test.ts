import { describe, expect, it } from "bun:test";
import { findFirstUnreadMessage } from "./chatScroll";

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

// 区切り契約: 戻り値 id はそのまま「ここから未読」のアンカー、undefined は末尾表示。
describe("unread divider contract", () => {
  it("uses the returned id as the divider anchor shown right before that message", () => {
    const messages = [message("10", 10, true), message("20", 20, false), message("30", 30, false)];
    const anchor = findFirstUnreadMessage(messages);

    expect(anchor?.id).toBe("20");
    expect(messages.findIndex((m) => m.id === anchor?.id)).toBe(1);
  });

  it("yields no divider when everything is read", () => {
    expect(findFirstUnreadMessage([message("10", 10, true)])).toBeUndefined();
  });
});
