import { describe, expect, it } from "bun:test";
import { readTargetsFromMessageBoxes } from "./lineService.js";

describe("readTargetsFromMessageBoxes", () => {
  it("extracts unread chats with lastMessageId", () => {
    const targets = readTargetsFromMessageBoxes([
      { id: "c1", unreadCount: 2, lastDeliveredMessageId: { messageId: "123" } },
      { id: "c2", unreadCount: 0, lastDeliveredMessageId: { messageId: "456" } },
      { id: "u1", unreadCount: 1, lastDeliveredMessageId: { messageId: "" } },
      { id: "c3", unreadCount: 1, lastDeliveredMessageId: { messageId: "789" } },
    ]);
    expect(targets).toEqual([
      { chatMid: "c1", lastMessageId: "123" },
      { chatMid: "c3", lastMessageId: "789" },
    ]);
  });

  it("filters by allowed chatMids", () => {
    const targets = readTargetsFromMessageBoxes(
      [
        { id: "c1", unreadCount: 1, lastDeliveredMessageId: { messageId: "1" } },
        { id: "c2", unreadCount: 1, lastDeliveredMessageId: { messageId: "2" } },
      ],
      new Set(["c2"]),
    );
    expect(targets).toEqual([{ chatMid: "c2", lastMessageId: "2" }]);
  });

  it("handles bigint unreadCount", () => {
    const targets = readTargetsFromMessageBoxes([
      { id: "c1", unreadCount: 1n, lastDeliveredMessageId: { messageId: 999n } },
    ]);
    expect(targets).toEqual([{ chatMid: "c1", lastMessageId: "999" }]);
  });
});
