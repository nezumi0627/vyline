import { expect, test } from "bun:test";
import {
  countReceivedMessages,
  findFirstUnreadReceivedMessage,
  findLatestReceivedMessage,
  isAtOrBeforeReadPosition,
  markReceivedMessagesReadThrough,
  resolveInitialUnreadScrollTarget,
  rollbackReceiptAttempt,
} from "./readReceiptSelection.js";

const message = (id: string, createdAt: number, authorId = "peer", chatId = "c") => ({
  id,
  createdAt,
  authorId,
  chatId,
});

test("selects the latest received message by timestamp and numeric ID without sorting", () => {
  const messages = [
    message("100", 10),
    message("9", 10),
    message("2", 11),
    message("1000", 99, "me"),
    message("pending_1", 99),
    message("999", 99, "peer", "other"),
  ];
  expect(findLatestReceivedMessage(messages, "c")?.id).toBe("2");
});

test("uses descending lexical ID order when equal-time IDs are nonnumeric", () => {
  expect(findLatestReceivedMessage([message("a", 1), message("z", 1)], "c")?.id).toBe("z");
});

test("read-through uses the same timestamp then ID ordering as latest selection", () => {
  const latest = message("z", 10);
  expect(isAtOrBeforeReadPosition(message("a", 10), latest)).toBe(true);
  expect(isAtOrBeforeReadPosition(message("zz", 10), latest)).toBe(false);
  expect(isAtOrBeforeReadPosition(message("999", 9), latest)).toBe(true);
  expect(isAtOrBeforeReadPosition(message("1", 11), latest)).toBe(false);
});

test("finds the earliest unread received message using the shared position ordering", () => {
  expect(
    findFirstUnreadReceivedMessage(
      [
        { ...message("z", 10), read: false },
        { ...message("a", 10), read: false },
        { ...message("0", 9), read: true },
        { ...message("pending_1", 1), read: false },
      ],
      "c",
    )?.id,
  ).toBe("a");
});

test("preserves the captured unread target when hydration sees messages already marked read", () => {
  const hydrated = [{ ...message("42", 42), read: true }];
  expect(resolveInitialUnreadScrollTarget(hydrated, "c", "42")).toBe("42");
});

test("prefers a fresh unread target discovered during hydration", () => {
  const hydrated = [
    { ...message("43", 43), read: false },
    { ...message("42", 42), read: true },
  ];
  expect(resolveInitialUnreadScrollTarget(hydrated, "c", "42")).toBe("43");
});

test("uses the chat unread count when group message readCount marks messages read by other members", () => {
  const hydrated = [
    { ...message("101", 1), read: true },
    { ...message("102", 2), read: true },
    { ...message("103", 3), read: true },
  ];
  expect(resolveInitialUnreadScrollTarget(hydrated, "c", null, 2)).toBe("102");
});

test("counts only received persisted messages when resolving an unread window", () => {
  expect(
    countReceivedMessages(
      [
        message("1", 1),
        message("2", 2, "me"),
        message("pending_3", 3),
        message("4", 4, "peer", "other"),
      ],
      "c",
    ),
  ).toBe(1);
});

test("read-through preserves the source array when nothing changes", () => {
  const messages = [
    { ...message("1", 1), read: true, status: "read" },
    { ...message("2", 2, "me"), read: false, status: "sent" },
  ];
  expect(markReceivedMessagesReadThrough(messages, "c", message("1", 1))).toBe(messages);
});

test("read-through only copies when a received message actually needs updating", () => {
  const messages = [
    { ...message("1", 1), read: false, status: "sent" },
    { ...message("2", 2, "me"), read: false, status: "sent" },
    { ...message("3", 3, "peer", "other"), read: false, status: "sent" },
  ];
  const updated = markReceivedMessagesReadThrough(messages, "c", message("1", 1));
  expect(updated).not.toBe(messages);
  expect(updated[0]).toEqual({ ...messages[0], read: true, status: "read" });
  expect(updated[1]).toBe(messages[1]);
  expect(updated[2]).toBe(messages[2]);
});

test("a failed older read request does not clear a newer in-flight receipt", () => {
  const sent = new Map([["account:c", "101"]]);
  rollbackReceiptAttempt(sent, "account:c", "100");
  expect(sent.get("account:c")).toBe("101");
  rollbackReceiptAttempt(sent, "account:c", "101");
  expect(sent.has("account:c")).toBe(false);
});
