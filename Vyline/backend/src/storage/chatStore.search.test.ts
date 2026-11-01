import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let accountId: string;
let chatMid: string;
let dataDir: string;
let store: typeof import("./chatStore.js");
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-message-search-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  store = await import("./chatStore.js");
  ({ closeSqlite } = await import("./sqlite.js"));
  accountId = `search-${crypto.randomUUID()}`;
  chatMid = `u${"a".repeat(32)}`;
  await store.upsertMessages(accountId, chatMid, [
    {
      id: "101",
      chatMid,
      from: "u-peer",
      to: "u-self",
      text: "Hello, durable message search!",
      contentType: "NONE",
      createdTime: 101,
      isMyMessage: false,
      savedAt: new Date().toISOString(),
    },
    {
      id: "102",
      chatMid,
      from: "u-peer",
      to: "u-self",
      text: "another durable record",
      contentType: "NONE",
      createdTime: 102,
      isMyMessage: false,
      savedAt: new Date().toISOString(),
    },
  ]);
});

afterAll(async () => {
  await store?.releaseAccountChatCache(accountId);
  closeSqlite?.();
  await rm(dataDir, { recursive: true, force: true });
});

test("searches indexed chat text and bounded regular expressions", async () => {
  const textResult = await store.searchStoredMessages(accountId, chatMid, "durable message");
  expect(textResult.messages.map((message) => message.id)).toEqual(["101"]);
  expect(textResult.truncated).toBe(false);

  const regexResult = await store.searchStoredMessages(
    accountId,
    chatMid,
    "^hello.*search!$",
    true,
  );
  expect(regexResult.messages.map((message) => message.id)).toEqual(["101"]);
  expect(regexResult.truncated).toBe(false);
});

test("rejects unsafe or empty search expressions", async () => {
  await expect(store.searchStoredMessages(accountId, chatMid, "")).rejects.toThrow();
  await expect(
    store.searchStoredMessages(accountId, chatMid, "(?=unsafe)", true),
  ).rejects.toThrow();
});
