import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

// Storage modules cache paths/connections at module scope. Isolate this suite in
// a child process so VYLINE_DATA_DIR can never point at a developer's real data.
if (process.env.VYLINE_SQLITE_CHAT_TEST_CHILD !== "1") {
  test("SQLite chat store integration in an isolated process", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, VYLINE_SQLITE_CHAT_TEST_CHILD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  const root = await fs.mkdtemp(join(tmpdir(), "vyline-sqlite-chat-test-"));
  process.env.VYLINE_DATA_DIR = root;
  const {
    warmAccountCache,
    upsertChats,
    upsertMessages,
    getStoredChats,
    getStoredMessages,
    exportChatDb,
    mergeImportedChatDb,
    flushAccountChatDb,
    chatDbStorageBytes,
  } = await import("./chatStore.js");
  const { accountFile } = await import("./accountDirs.js");

  const accountId = "sqlite-test";
  const now = new Date().toISOString();

  describe("SQLite chat persistence", () => {
    test("ignores legacy chatdb.json and opens WAL SQLite without hydrating it", async () => {
      await fs.mkdir(join(root, "accounts", accountId), { recursive: true });
      await fs.writeFile(
        accountFile(accountId, "chatdb.json"),
        JSON.stringify({
          meta: {},
          chats: {
            "u-legacy": {
              mid: "u-legacy",
              name: "legacy",
              kind: "direct",
              hasMessages: true,
              updatedAt: now,
            },
          },
          messages: {},
        }),
      );

      await warmAccountCache(accountId);
      expect(await getStoredChats(accountId)).toEqual([]);

      const sqlitePath = accountFile(accountId, "chatdb.sqlite");
      expect((await fs.stat(sqlitePath)).size).toBeGreaterThan(0);
      const db = new Database(sqlitePath, { readonly: true });
      expect((db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe(
        "wal",
      );
      db.close();
    });

    test("persists messages and pages history from the indexed store", async () => {
      await upsertChats(accountId, [
        {
          mid: "u-peer",
          name: "Peer",
          kind: "direct",
          hasMessages: true,
          lastMessageTime: 3,
          lastMessageId: "3",
          lastMessagePreview: "three",
          updatedAt: now,
        },
      ]);
      await upsertMessages(accountId, "u-peer", [
        {
          id: "1",
          chatMid: "u-peer",
          from: "u-peer",
          to: "u-self",
          text: "one",
          contentType: "NONE",
          createdTime: 1,
          isMyMessage: false,
          savedAt: now,
        },
        {
          id: "2",
          chatMid: "u-peer",
          from: "u-peer",
          to: "u-self",
          text: "two",
          contentType: "NONE",
          createdTime: 2,
          isMyMessage: false,
          savedAt: now,
        },
        {
          id: "3",
          chatMid: "u-peer",
          from: "u-self",
          to: "u-peer",
          text: "three",
          contentType: "NONE",
          createdTime: 3,
          isMyMessage: true,
          savedAt: now,
        },
      ]);

      expect((await getStoredMessages(accountId, "u-peer", 2)).map((m) => m.id)).toEqual([
        "3",
        "2",
      ]);
      expect(
        (
          await getStoredMessages(accountId, "u-peer", 10, {
            beforeDeliveredTime: 2,
            beforeMessageId: "2",
          })
        ).map((m) => m.id),
      ).toEqual(["1"]);
      expect((await exportChatDb(accountId)).messages["u-peer"]?.["3"]?.text).toBe("three");
    });

    test("rolls back an imported restore when its logical history budget is exceeded", async () => {
      const before = await exportChatDb(accountId);
      const incoming = {
        chats: {},
        messages: {
          "u-peer": {
            "99": {
              id: "99",
              chatMid: "u-peer",
              from: "u-peer",
              to: "u-self",
              text: "must roll back",
              contentType: "NONE",
              createdTime: 99,
              isMyMessage: false,
              savedAt: now,
            },
          },
        },
      };
      const currentBytes = chatDbStorageBytes(before);
      await expect(mergeImportedChatDb(accountId, incoming, currentBytes)).rejects.toThrow("10GB");
      expect(await exportChatDb(accountId)).toEqual(before);
    });
  });

  await flushAccountChatDb(accountId);
  await fs.rm(root, { recursive: true, force: true });
}
