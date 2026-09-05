import { afterAll, describe, expect, test } from "bun:test";
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
  }, 120_000);
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
    mergeAccountChatSnapshot,
    createAccountChatSnapshot,
    getChatDbLogicalStorageBytes,
    flushAccountChatDb,
    closeAccountChatDb,
  } = await import("./chatStore.js");
  const { accountFile } = await import("./accountDirs.js");

  const accountId = "sqlite-test";
  const now = new Date().toISOString();

  afterAll(async () => {
    for (const id of [
      accountId,
      "snapshot-target",
      "snapshot-over-quota",
      "sqlite-large-source",
      "sqlite-large-target",
      "sqlite-large-over-quota",
    ]) {
      await flushAccountChatDb(id).catch(() => undefined);
      await closeAccountChatDb(id).catch(() => undefined);
    }
    await fs.rm(root, { recursive: true, force: true });
  });

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

    test("rolls back an imported restore when its SQLite page budget is exceeded", async () => {
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
      await expect(mergeImportedChatDb(accountId, incoming, 1)).rejects.toThrow("10GB");
      expect(await exportChatDb(accountId)).toEqual(before);
    });

    test("round-trips a normalized SQLite snapshot and keeps quota failure atomic", async () => {
      const snapshotPath = join(root, "chat-snapshot.sqlite");
      const progress: Array<{ phase: string; current: number; total: number }> = [];
      expect(
        await createAccountChatSnapshot(accountId, snapshotPath, undefined, (entry) =>
          progress.push(entry),
        ),
      ).toEqual({ chats: 1, messages: 3 });
      expect(progress.some((entry) => entry.phase === "messages" && entry.current === 3)).toBe(
        true,
      );
      const snapshotDb = new Database(snapshotPath, { readonly: true });
      const snapshotIndexes = snapshotDb
        .query("PRAGMA index_list(staged_messages)")
        .all() as Array<{
        name: string;
      }>;
      snapshotDb.close();
      expect(snapshotIndexes.some((index) => index.name === "idx_staged_messages_chat_time")).toBe(
        false,
      );

      expect(await mergeAccountChatSnapshot("snapshot-target", snapshotPath, ["u-peer"])).toEqual({
        importedChats: 1,
        skippedChats: 0,
        importedMessages: 3,
        skippedMessages: 0,
      });
      expect(
        (await getStoredMessages("snapshot-target", "u-peer", 10)).map((row) => row.id),
      ).toEqual(["3", "2", "1"]);
      expect(
        await fs
          .stat(`${accountFile("snapshot-target", "chatdb.sqlite")}-wal`)
          .then((entry) => entry.size)
          .catch(() => 0),
      ).toBe(0);
      expect(await mergeAccountChatSnapshot("snapshot-target", snapshotPath, ["u-peer"])).toEqual({
        importedChats: 0,
        skippedChats: 1,
        importedMessages: 0,
        skippedMessages: 3,
      });

      await expect(
        mergeAccountChatSnapshot("snapshot-over-quota", snapshotPath, undefined, 1),
      ).rejects.toThrow("10GB");
      expect(await getStoredChats("snapshot-over-quota")).toEqual([]);
    });

    test("keeps 100k-row storage accounting constant-time and yields between snapshot batches", async () => {
      const largeSource = "sqlite-large-source";
      await warmAccountCache(largeSource);
      await closeAccountChatDb(largeSource);
      const seed = new Database(accountFile(largeSource, "chatdb.sqlite"));
      seed.exec(`
          INSERT INTO chats (
            mid, name, kind, has_messages, last_message_time, last_message_id,
            last_message_preview, updated_at
          ) VALUES ('u-large', 'Large', 'direct', 1, 100000, '100000', 'last', '${now}');
          WITH RECURSIVE sequence(value) AS (
            VALUES(1)
            UNION ALL
            SELECT value + 1 FROM sequence WHERE value < 100000
          )
          INSERT INTO messages (
            id, chat_mid, from_mid, to_mid, text, content_type, created_time,
            is_my_message, saved_at
          )
          SELECT
            printf('%d', value), 'u-large', 'u-large', 'u-self', 'message',
            'NONE', value, 0, '${now}'
          FROM sequence;
        `);
      seed.close();

      const startedAt = performance.now();
      expect(await getChatDbLogicalStorageBytes(largeSource)).toBeGreaterThan(0);
      expect(performance.now() - startedAt).toBeLessThan(1_000);

      let timerTicks = 0;
      let maximumTimerGapMs = 0;
      let previousTimerAt = performance.now();
      const timer = setInterval(() => {
        const currentTimerAt = performance.now();
        maximumTimerGapMs = Math.max(maximumTimerGapMs, currentTimerAt - previousTimerAt);
        previousTimerAt = currentTimerAt;
        timerTicks++;
      }, 1);
      const snapshotPath = join(root, "large-chat-snapshot.sqlite");
      const progress: number[] = [];
      try {
        expect(
          await createAccountChatSnapshot(largeSource, snapshotPath, undefined, (entry) => {
            if (entry.phase === "messages") progress.push(entry.current);
          }),
        ).toEqual({ chats: 1, messages: 100000 });
        expect(await mergeAccountChatSnapshot("sqlite-large-target", snapshotPath)).toEqual({
          importedChats: 1,
          skippedChats: 0,
          importedMessages: 100000,
          skippedMessages: 0,
        });

        const quotaProgress: number[] = [];
        await expect(
          mergeAccountChatSnapshot(
            "sqlite-large-over-quota",
            snapshotPath,
            undefined,
            1024 * 1024,
            (entry) => {
              if (entry.phase === "messages") quotaProgress.push(entry.current);
            },
          ),
        ).rejects.toThrow("10GB");
        expect(Math.max(...quotaProgress)).toBeGreaterThan(0);
        expect(Math.max(...quotaProgress)).toBeLessThanOrEqual(10_000);
        expect(await getStoredChats("sqlite-large-over-quota")).toEqual([]);
      } finally {
        clearInterval(timer);
      }
      expect(progress.length).toBeGreaterThanOrEqual(200);
      expect(timerTicks).toBeGreaterThan(10);
      expect(maximumTimerGapMs).toBeLessThan(1_000);
    }, 60_000);
  });
}
