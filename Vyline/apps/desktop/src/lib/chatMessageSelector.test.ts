import { expect, test } from "bun:test";
import { createChatMessageSelector, retainMessagesForChat } from "./chatMessageSelector.js";

type TestMessage = { id: string; chatId: string; createdAt: number };
const compare = (a: TestMessage, b: TestMessage) => a.createdAt - b.createdAt;

test("reuses a chat's sorted messages until that chat or source array changes", () => {
  const select = createChatMessageSelector(compare);
  const messages = [
    { id: "2", chatId: "c1", createdAt: 2 },
    { id: "1", chatId: "c1", createdAt: 1 },
    { id: "3", chatId: "c2", createdAt: 3 },
  ];

  const first = select(messages, "c1");
  expect(first.map((message) => message.id)).toEqual(["1", "2"]);
  expect(select(messages, "c1")).toBe(first);
  expect(select(messages, "c2")).not.toBe(first);
  expect(select([...messages], "c1")).not.toBe(first);
});

test("retains only the active chat's messages in the in-memory store", () => {
  const messages = [
    { id: "1", chatId: "c1", createdAt: 1 },
    { id: "2", chatId: "c2", createdAt: 2 },
    { id: "3", chatId: "c1", createdAt: 3 },
  ];
  expect(retainMessagesForChat(messages, "c1").map((message) => message.id)).toEqual(["1", "3"]);
  expect(retainMessagesForChat(messages, null)).toEqual([]);
});
