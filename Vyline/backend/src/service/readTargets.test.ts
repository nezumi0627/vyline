import { expect, test } from "bun:test";
import { readTargetsFromMessageBoxes } from "./lineService.js";

test("readTargetsFromMessageBoxes selects unread chats and their watermark", () => {
  expect(
    readTargetsFromMessageBoxes([
      { id: "c1", unreadCount: 2, lastDeliveredMessageId: { messageId: "101" } },
      { id: "c2", unreadCount: 0, lastDeliveredMessageId: { messageId: "202" } },
      { id: "c3", unreadCount: 1, lastDeliveredMessageId: { messageId: "" } },
    ]),
  ).toEqual([{ chatMid: "c1", lastMessageId: "101" }]);
});

test("readTargetsFromMessageBoxes respects the enabled chat allowlist", () => {
  expect(
    readTargetsFromMessageBoxes(
      [{ id: "c1", unreadCount: 1, lastDeliveredMessageId: { messageId: 101n } }],
      new Set(["c2"]),
    ),
  ).toEqual([]);
});
