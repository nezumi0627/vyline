import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

const accountId = "offline-chat-migration";
let dataDir: string;
let chatStore: typeof import("./chatStore.js");
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-chat-sqlite-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  const previousDb = new Database(join(dataDir, "vyline.sqlite"));
  previousDb.exec(`
    CREATE TABLE chat_account_state (account_id TEXT PRIMARY KEY, meta_json TEXT NOT NULL);
    CREATE TABLE chat_records (account_id TEXT NOT NULL, mid TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id,mid));
    CREATE TABLE chat_messages (account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      created_time INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id,chat_mid,message_id));
  `);
  previousDb.query("INSERT INTO chat_account_state VALUES (?, ?)").run(
    "offline-previous-sqlite",
    JSON.stringify({
      boxOrder: ["c-old"],
      localReadUpTo: { "c-old": { messageId: "501", at: "2026-01-02T00:00:00.000Z" } },
    }),
  );
  previousDb.query("INSERT INTO chat_records VALUES (?, ?, ?)").run(
    "offline-previous-sqlite",
    "c-old",
    JSON.stringify({
      mid: "c-old",
      name: "Old SQLite",
      kind: "direct",
      hasMessages: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
  );
  previousDb.query("INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?)").run(
    "offline-previous-sqlite",
    "c-old",
    "501",
    5,
    JSON.stringify({
      id: "501",
      chatMid: "c-old",
      from: "peer",
      to: "me",
      text: "from old SQLite",
      contentType: "TEXT",
      createdTime: 5,
      isMyMessage: false,
      savedAt: "2026-01-02T00:00:00.000Z",
      reactions: [{ fromMid: "u2", atMillis: 4, type: 3 }],
    }),
  );
  previousDb.close();
  const legacy = {
    meta: {
      boxOrder: ["c1"],
      localReadUpTo: { c1: { messageId: "101", at: "2026-01-01T00:00:00.000Z" } },
    },
    chats: {
      c1: {
        mid: "c1",
        name: "Offline",
        kind: "direct",
        hasMessages: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    messages: {
      c1: {
        "100": {
          id: "100",
          chatMid: "c1",
          from: "peer",
          to: "me",
          text: "old",
          contentType: "TEXT",
          createdTime: 1,
          isMyMessage: false,
          savedAt: "2026-01-01T00:00:00.000Z",
          contentMetadata: { ALT_TEXT: "alt", CUSTOM: "value" },
          readBy: ["u1"],
          reactions: [{ fromMid: "u2", atMillis: 3, type: 2 }],
        },
        "101": {
          id: "101",
          chatMid: "c1",
          from: "peer",
          to: "me",
          text: "revoked",
          contentType: "UNSENT",
          createdTime: 2,
          isMyMessage: false,
          messageState: "revoked-by-other",
          history: [{ state: "normal", text: "kept", contentType: "TEXT", updatedTime: 1 }],
          revokedSnapshot: {
            id: "101",
            chatMid: "c1",
            from: "peer",
            to: "me",
            text: "kept",
            contentType: "TEXT",
            createdTime: 2,
            isMyMessage: false,
            savedAt: "2026-01-01T00:00:00.000Z",
          },
          savedAt: "2026-01-01T00:00:00.000Z",
        },
        "102": {
          id: "102",
          chatMid: "c1",
          from: "peer",
          to: "me",
          text: "same-time",
          contentType: "TEXT",
          createdTime: 2,
          isMyMessage: false,
          savedAt: "2026-01-01T00:00:00.000Z",
        },
        z: {
          id: "z",
          chatMid: "c1",
          from: "peer",
          to: "me",
          text: "non-numeric-z",
          contentType: "TEXT",
          createdTime: 2,
          isMyMessage: false,
          savedAt: "2026-01-01T00:00:00.000Z",
        },
        a: {
          id: "a",
          chatMid: "c1",
          from: "peer",
          to: "me",
          text: "non-numeric-a",
          contentType: "TEXT",
          createdTime: 2,
          isMyMessage: false,
          savedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    },
  };
  await writeFile(join(dataDir, `chatdb-${accountId}.json`), JSON.stringify(legacy));
  chatStore = await import("./chatStore.js");
  ({ closeSqlite } = await import("./sqlite.js"));
});

afterAll(async () => {
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("imports legacy history into indexed SQLite and preserves read/revoke state", async () => {
  const rows = await chatStore.getMessages(accountId, "c1", 20);
  expect(rows.map((row) => row.id)).toEqual(["z", "a", "102", "101", "100"]);
  expect(rows[3]?.seen).toBe(true);
  expect(rows[3]?.history?.[0]?.text).toBe("kept");
  expect(rows[4]?.contentMetadata).toEqual({ ALT_TEXT: "alt", CUSTOM: "value" });
  expect(rows[4]?.readBy).toEqual(["u1"]);
  expect(rows[4]?.reactions).toEqual([{ fromMid: "u2", atMillis: 3, type: 2 }]);
  expect(existsSync(join(dataDir, `chatdb-${accountId}.json`))).toBe(true);
  expect(existsSync(join(dataDir, "accounts", accountId, "chatdb.json"))).toBe(false);
  const { sqlite } = await import("./sqlite.js");
  expect(
    sqlite
      .query("SELECT COUNT(*) AS count FROM chat_messages_v2 WHERE account_id = ?")
      .get(accountId),
  ).toEqual({ count: 5 });
  const messageColumns = sqlite.query("PRAGMA table_info('chat_messages_v2')").all() as Array<{
    name: string;
  }>;
  expect(messageColumns.map((column) => column.name)).toContain("from_mid");
  expect(messageColumns.map((column) => column.name)).not.toContain("payload");
  expect(
    sqlite
      .query(
        "SELECT value FROM chat_message_metadata_v2 WHERE account_id = ? AND chat_mid = ? AND message_id = ? AND key = ?",
      )
      .get(accountId, "c1", "100", "CUSTOM"),
  ).toEqual({ value: "value" });
  expect(
    sqlite
      .query(
        "SELECT reader_mid FROM chat_message_readers_v2 WHERE account_id = ? AND chat_mid = ? AND message_id = ?",
      )
      .all(accountId, "c1", "100"),
  ).toEqual([{ reader_mid: "u1" }]);
  expect(
    sqlite
      .query(
        "SELECT from_mid, at_millis, reaction_type FROM chat_message_reactions_v2 WHERE account_id = ? AND chat_mid = ? AND message_id = ?",
      )
      .all(accountId, "c1", "100"),
  ).toEqual([{ from_mid: "u2", at_millis: 3, reaction_type: 2 }]);
});

test("defaults missing legacy isMyMessage to false during SQLite import", async () => {
  const legacyAccount = "offline-legacy-missing-owner-flag";
  await writeFile(
    join(dataDir, `chatdb-${legacyAccount}.json`),
    JSON.stringify({
      meta: {},
      chats: {
        "c-legacy-flag": {
          mid: "c-legacy-flag",
          name: "Legacy",
          kind: "direct",
          hasMessages: true,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      messages: {
        "c-legacy-flag": {
          "7": {
            id: "7",
            chatMid: "c-legacy-flag",
            from: "peer",
            to: "me",
            text: "legacy",
            contentType: "TEXT",
            createdTime: 7,
          },
        },
      },
    }),
  );

  const rows = await chatStore.getMessages(legacyAccount, "c-legacy-flag", 10);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.isMyMessage).toBe(false);
});

test("stale chat sync cannot restore unread count through the saved read position", async () => {
  const readAccount = "offline-read-position-reconciliation";
  await chatStore.upsertChats(readAccount, [
    {
      mid: "u-read-position",
      name: "Read position",
      kind: "direct",
      hasMessages: true,
      lastMessageId: "500",
      unreadCount: 4,
      updatedAt: "2026-01-03T00:00:00.000Z",
    },
  ]);
  await chatStore.markStoredMessagesReadThrough(readAccount, "u-read-position", "500");

  await chatStore.upsertChats(readAccount, [
    {
      mid: "u-read-position",
      name: "Read position",
      kind: "direct",
      hasMessages: true,
      lastMessageId: "500",
      unreadCount: 4,
      updatedAt: "2026-01-03T00:00:01.000Z",
    },
  ]);
  expect((await chatStore.getStoredChats(readAccount))[0]?.unreadCount).toBe(0);

  await chatStore.upsertChats(readAccount, [
    {
      mid: "u-read-position",
      name: "Read position",
      kind: "direct",
      hasMessages: true,
      lastMessageId: "501",
      unreadCount: 1,
      updatedAt: "2026-01-03T00:00:02.000Z",
    },
  ]);
  expect((await chatStore.getStoredChats(readAccount))[0]?.unreadCount).toBe(1);
});

test("migrates prior SQLite JSON payload rows and account metadata into relational tables", async () => {
  const oldAccount = "offline-previous-sqlite";
  const rows = await chatStore.getMessages(oldAccount, "c-old", 10);
  expect(rows[0]?.text).toBe("from old SQLite");
  expect(rows[0]?.seen).toBe(true);
  expect(rows[0]?.reactions).toEqual([{ fromMid: "u2", atMillis: 4, type: 3 }]);
  expect((await chatStore.getStoredChats(oldAccount))[0]?.name).toBe("Old SQLite");
  expect((await chatStore.getCacheMeta(oldAccount)).boxOrder).toEqual(["c-old"]);
  const { sqlite } = await import("./sqlite.js");
  const legacyTables = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_messages','chat_records','chat_account_state') ORDER BY name",
    )
    .all();
  expect(legacyTables).toEqual([
    { name: "chat_account_state" },
    { name: "chat_messages" },
    { name: "chat_records" },
  ]);
  expect(
    sqlite
      .query("SELECT payload FROM chat_messages WHERE account_id=? AND chat_mid=?")
      .get(oldAccount, "c-old"),
  ).toBeDefined();
});

test("keeps relational account metadata when no legacy JSON file exists", async () => {
  const account = "offline-existing-relational-meta";
  const { ensureRelationalChatSchema, writeChatMeta } = await import("./chatStoreRelational.js");
  const meta = {
    boxOrder: ["c-existing"],
    localReadUpTo: { "c-existing": { messageId: "500", at: "2026-02-01T00:00:00.000Z" } },
    messagesSyncedAt: { "c-existing": "2026-02-01T00:00:00.000Z" },
  };
  ensureRelationalChatSchema();
  writeChatMeta(account, meta);

  expect(await chatStore.getCacheMeta(account)).toEqual(meta);
});

test("message paging uses the account/chat index and an exclusive timestamp/id cursor", async () => {
  const rows = await chatStore.getMessages(accountId, "c1", 1, {
    beforeMessageId: "102",
    beforeDeliveredTime: 2,
  });
  expect(rows.map((row) => row.id)).toEqual(["101"]);
  const afterNonNumeric = await chatStore.getMessages(accountId, "c1", 1, {
    beforeMessageId: "a",
    beforeDeliveredTime: 2,
  });
  expect(afterNonNumeric.map((row) => row.id)).toEqual(["102"]);
  const { sqlite } = await import("./sqlite.js");
  const indexes = sqlite.query("PRAGMA index_list('chat_messages_v2')").all() as Array<{
    name: string;
  }>;
  expect(indexes.some((index) => index.name === "chat_messages_v2_order_idx")).toBe(true);
  const plan = sqlite
    .query(`EXPLAIN QUERY PLAN SELECT message_id FROM chat_messages_v2
    WHERE account_id = ? AND chat_mid = ?
      AND (created_time < ? OR (created_time = ? AND
        (message_id GLOB '*[^0-9]*' OR message_id = '' OR length(message_id) < length(?) OR
          (length(message_id) = length(?) AND message_id < ?))))
    ORDER BY created_time DESC, CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 1 ELSE 0 END DESC,
      CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 0 ELSE length(message_id) END DESC,
      message_id DESC LIMIT ?`)
    .all(accountId, "c1", 2, 2, "102", "102", "102", 1) as Array<{ detail: string }>;
  expect(plan.some((step) => step.detail.includes("chat_messages_v2_order_idx"))).toBe(true);
  expect(plan.some((step) => step.detail.includes("TEMP B-TREE"))).toBe(false);
});

test("message paging merges only pending writes while SQLite remains dirty", async () => {
  const pendingAccount = "offline-chat-pending-writes";
  await chatStore.upsertMessages(pendingAccount, "c1", [
    {
      id: "102",
      chatMid: "c1",
      from: "peer",
      to: "me",
      text: "stored timestamp",
      contentType: "TEXT",
      createdTime: 2,
      isMyMessage: false,
      savedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "z",
      chatMid: "c1",
      from: "peer",
      to: "me",
      text: "stored tie",
      contentType: "TEXT",
      createdTime: 2,
      isMyMessage: false,
      savedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  await chatStore.saveBoxOrder(pendingAccount, ["c1"]);
  await chatStore.upsertMessages(pendingAccount, "c1", [
    {
      id: "102",
      chatMid: "c1",
      from: "peer",
      to: "me",
      text: "updated timestamp",
      contentType: "TEXT",
      createdTime: 10,
      isMyMessage: false,
      savedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "103",
      chatMid: "c1",
      from: "peer",
      to: "me",
      text: "pending new",
      contentType: "TEXT",
      createdTime: 3,
      isMyMessage: false,
      savedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  expect((await chatStore.getMessages(pendingAccount, "c1", 2)).map((row) => row.id)).toEqual([
    "102",
    "103",
  ]);
  expect(
    (
      await chatStore.getMessages(pendingAccount, "c1", 2, {
        beforeMessageId: "102",
        beforeDeliveredTime: 10,
      })
    ).map((row) => row.id),
  ).toEqual(["103", "z"]);
  await chatStore.flushAccountChatDb(pendingAccount);
});

test("incremental message, read-through, revoke and restore updates persist in SQLite", async () => {
  await chatStore.upsertMessages(accountId, "c1", [
    {
      id: "103",
      chatMid: "c1",
      from: "peer",
      to: "me",
      text: "new",
      contentType: "TEXT",
      createdTime: 3,
      isMyMessage: false,
      savedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  expect((await chatStore.getMessages(accountId, "c1", 1))[0]?.id).toBe("103");
  await chatStore.markStoredMessagesReadThrough(accountId, "c1", "103");
  expect((await chatStore.getMessages(accountId, "c1", 1))[0]?.seen).toBe(true);
  await chatStore.markMessageRevoked(accountId, "c1", "103");
  await chatStore.markMessageRevoked(accountId, "c1", "103");
  expect((await chatStore.getMessages(accountId, "c1", 1))[0]?.contentType).toBe("UNSENT");
  expect((await chatStore.getMessages(accountId, "c1", 1))[0]?.history).toHaveLength(1);
  expect(await chatStore.restoreRevokedMessage(accountId, "c1", "103")).toEqual({
    text: "new",
    contentType: "TEXT",
  });
  expect((await chatStore.getMessages(accountId, "c1", 1))[0]?.text).toBe("new");
});

test("unchanged sync rows keep their first savedAt and skip relational rewrites", async () => {
  const message = {
    id: "stable",
    chatMid: "c-stable",
    from: "peer",
    to: "me",
    text: "same",
    contentType: "TEXT",
    createdTime: 1,
    isMyMessage: false,
    savedAt: "2026-01-01T00:00:00.000Z",
    contentMetadata: { ALT_TEXT: "alt" },
    readBy: ["u1"],
  };
  await chatStore.upsertMessages("offline-stable-row", "c-stable", [message]);
  const { sqlite } = await import("./sqlite.js");
  const before = sqlite
    .query(
      "SELECT saved_at FROM chat_messages_v2 WHERE account_id=? AND chat_mid=? AND message_id=?",
    )
    .get("offline-stable-row", "c-stable", "stable");
  const beforeMetadata = sqlite
    .query(
      "SELECT rowid FROM chat_message_metadata_v2 WHERE account_id=? AND chat_mid=? AND message_id=?",
    )
    .get("offline-stable-row", "c-stable", "stable");
  await chatStore.upsertMessages("offline-stable-row", "c-stable", [
    {
      ...message,
      savedAt: "2026-02-01T00:00:00.000Z",
    },
  ]);
  const after = sqlite
    .query(
      "SELECT saved_at FROM chat_messages_v2 WHERE account_id=? AND chat_mid=? AND message_id=?",
    )
    .get("offline-stable-row", "c-stable", "stable");
  const afterMetadata = sqlite
    .query(
      "SELECT rowid FROM chat_message_metadata_v2 WHERE account_id=? AND chat_mid=? AND message_id=?",
    )
    .get("offline-stable-row", "c-stable", "stable");
  expect(after).toEqual(before);
  expect(afterMetadata).toEqual(beforeMetadata);
});

test("rebuilding chat summaries does not rewrite message rows", async () => {
  const rebuildAccount = "offline-rebuild-no-message-write";
  await chatStore.upsertChats(rebuildAccount, [
    {
      mid: "c-rebuild",
      name: "Rebuild",
      kind: "direct",
      hasMessages: true,
      updatedAt: "2026-01-01",
    },
  ]);
  await chatStore.upsertMessages(rebuildAccount, "c-rebuild", [
    {
      id: "rebuild-message",
      chatMid: "c-rebuild",
      from: "peer",
      to: "me",
      text: "keep",
      contentType: "TEXT",
      createdTime: 1,
      isMyMessage: false,
      savedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "rebuild-latest",
      chatMid: "c-rebuild",
      from: "peer",
      to: "me",
      text: "latest",
      contentType: "TEXT",
      createdTime: 2,
      isMyMessage: false,
      savedAt: "2026-01-01T00:00:01.000Z",
    },
  ]);
  const { sqlite } = await import("./sqlite.js");
  sqlite.exec(`CREATE TABLE rebuild_write_probe (writes INTEGER NOT NULL DEFAULT 0);
    INSERT INTO rebuild_write_probe VALUES (0);
    CREATE TRIGGER count_rebuild_message_updates AFTER UPDATE ON chat_messages_v2
    WHEN OLD.account_id = 'offline-rebuild-no-message-write'
    BEGIN UPDATE rebuild_write_probe SET writes = writes + 1; END;`);
  const result = await chatStore.rebuildAccountChatDb(rebuildAccount);
  expect(result.messages).toBe(2);
  expect(existsSync(join(dataDir, "accounts", rebuildAccount, result.backupFile))).toBe(true);
  expect(result.backupFile.endsWith(".sqlite")).toBe(true);
  const backup = new Database(join(dataDir, "accounts", rebuildAccount, result.backupFile), {
    readonly: true,
  });
  expect(backup.query("SELECT name FROM chat_records_v2 WHERE mid='c-rebuild'").get()).toEqual({
    name: "Rebuild",
  });
  expect(
    (backup.query("SELECT COUNT(*) AS count FROM chat_records_v2").get() as { count: number })
      .count,
  ).toBe(1);
  backup.close();
  expect((await chatStore.getStoredChats(rebuildAccount))[0]?.lastMessageId).toBe("rebuild-latest");
  expect(sqlite.query("SELECT writes FROM rebuild_write_probe").get()).toEqual({ writes: 0 });
  expect(
    (await chatStore.getMessages(rebuildAccount, "c-rebuild", 5)).map((message) => message.text),
  ).toEqual(["latest", "keep"]);
});

test("deferred chat updates do not rewrite unchanged message history", async () => {
  const account = "offline-deferred-delta-write";
  await chatStore.upsertChats(account, [
    {
      mid: "c-delta",
      name: "Delta",
      kind: "direct",
      hasMessages: true,
      updatedAt: "2026-01-01",
    },
  ]);
  await chatStore.upsertMessages(account, "c-delta", [
    {
      id: "m1",
      chatMid: "c-delta",
      from: "peer",
      to: "me",
      text: "keep",
      contentType: "TEXT",
      createdTime: 1,
      isMyMessage: false,
      savedAt: "2026-01-01",
    },
    {
      id: "m2",
      chatMid: "c-delta",
      from: "peer",
      to: "me",
      text: "also keep",
      contentType: "TEXT",
      createdTime: 2,
      isMyMessage: false,
      savedAt: "2026-01-02",
    },
  ]);
  const { sqlite } = await import("./sqlite.js");
  sqlite.exec(`CREATE TABLE deferred_write_probe (writes INTEGER NOT NULL DEFAULT 0);
    INSERT INTO deferred_write_probe VALUES (0);
    CREATE TRIGGER count_deferred_message_updates AFTER UPDATE ON chat_messages_v2
    WHEN OLD.account_id = 'offline-deferred-delta-write'
    BEGIN UPDATE deferred_write_probe SET writes = writes + 1; END;`);

  await chatStore.mergeImportedChatDb(account, {
    chats: {
      "c-new": {
        mid: "c-new",
        name: "New",
        kind: "direct",
        hasMessages: false,
        updatedAt: "2026-01-03",
      },
    },
    messages: {},
  });
  await chatStore.prepareChatDbBackup(account);

  expect(sqlite.query("SELECT writes FROM deferred_write_probe").get()).toEqual({ writes: 0 });
  expect(
    (await chatStore.getMessages(account, "c-delta", 10)).map((message) => message.id),
  ).toEqual(["m2", "m1"]);
});

test("malformed legacy JSON remains recoverable and can be retried offline", async () => {
  const retryAccount = "offline-malformed-chat";
  const path = join(dataDir, `chatdb-${retryAccount}.json`);
  await writeFile(path, "{broken");
  await expect(chatStore.getMessages(retryAccount, "c2", 10)).rejects.toThrow();
  expect(await Bun.file(path).text()).toBe("{broken");

  await writeFile(
    path,
    JSON.stringify({
      chats: {},
      meta: {},
      messages: {
        c2: {
          m1: {
            id: "m1",
            chatMid: "c2",
            from: "peer",
            to: "me",
            text: "recovered",
            contentType: "TEXT",
            createdTime: 1,
            isMyMessage: false,
            savedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    }),
  );
  expect((await chatStore.getMessages(retryAccount, "c2", 10)).map((row) => row.text)).toEqual([
    "recovered",
  ]);
  expect(await Bun.file(path).text()).toContain("recovered");
});

test("persists the complete processed operation cursor in the isolated SQLite database", async () => {
  const account = "offline-operation-sync-cursor";
  await chatStore.upsertChats(account, [], { lastOpRevision: "90071992547409931" });
  expect(await chatStore.getOperationSyncCursor(account)).toEqual({
    revision: "90071992547409931",
    globalRevision: "0",
    individualRevision: "0",
  });

  await chatStore.saveOperationSyncCursor(account, {
    revision: "90071992547409937",
    globalRevision: "40000000000000001",
    individualRevision: "50000000000000002",
  });
  expect(await chatStore.getOperationSyncCursor(account)).toEqual({
    revision: "90071992547409937",
    globalRevision: "40000000000000001",
    individualRevision: "50000000000000002",
  });
});

test("changing only the message read flag does not rewrite unchanged child rows", async () => {
  const account = "offline-child-delta-write";
  const message = {
    id: "child-delta-1",
    chatMid: "c-child-delta",
    from: "peer",
    to: "me",
    text: "unchanged content",
    contentType: "TEXT",
    createdTime: 10,
    savedAt: "1970-01-01T00:00:00.010Z",
    isMyMessage: false,
    contentMetadata: { ALT_TEXT: "alt" },
    readBy: ["reader-1", "reader-2"],
    reactions: [{ fromMid: "reader-1", atMillis: 11, type: 1 }],
    history: [{ state: "normal" as const, text: "before", contentType: "TEXT", updatedTime: 9 }],
  };
  await chatStore.upsertMessages(account, message.chatMid, [message]);
  await chatStore.flushAccountChatDb(account);

  const { sqlite } = await import("./sqlite.js");
  sqlite.exec(`CREATE TABLE child_delta_probe (writes INTEGER NOT NULL DEFAULT 0);
    INSERT INTO child_delta_probe VALUES (0);
    CREATE TRIGGER count_child_metadata_delete AFTER DELETE ON chat_message_metadata_v2
      WHEN OLD.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;
    CREATE TRIGGER count_child_metadata_insert AFTER INSERT ON chat_message_metadata_v2
      WHEN NEW.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;
    CREATE TRIGGER count_child_reader_delete AFTER DELETE ON chat_message_readers_v2
      WHEN OLD.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;
    CREATE TRIGGER count_child_reader_insert AFTER INSERT ON chat_message_readers_v2
      WHEN NEW.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;
    CREATE TRIGGER count_child_reaction_delete AFTER DELETE ON chat_message_reactions_v2
      WHEN OLD.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;
    CREATE TRIGGER count_child_reaction_insert AFTER INSERT ON chat_message_reactions_v2
      WHEN NEW.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;
    CREATE TRIGGER count_child_history_delete AFTER DELETE ON chat_message_history_v2
      WHEN OLD.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;
    CREATE TRIGGER count_child_history_insert AFTER INSERT ON chat_message_history_v2
      WHEN NEW.account_id='offline-child-delta-write'
      BEGIN UPDATE child_delta_probe SET writes=writes+1; END;`);

  await chatStore.upsertMessages(account, message.chatMid, [{ ...message, seen: true }]);
  await chatStore.flushAccountChatDb(account);
  expect(sqlite.query("SELECT writes FROM child_delta_probe").get()).toEqual({ writes: 0 });
});

test("stages operation payloads durably and advances the cursor only when the inbox batch is acknowledged", async () => {
  const account = "offline-operation-inbox";
  const start = { revision: "100", globalRevision: "20", individualRevision: "30" };
  const target = { revision: "103", globalRevision: "21", individualRevision: "31" };
  const operation = {
    type: 26,
    revision: 103n,
    message: { id: "m-inbox", chunks: [new Uint8Array([1, 2, 3])] },
  };
  const firstId = await chatStore.stageOperationInboxBatch(account, start, target, [operation]);
  const retryId = await chatStore.stageOperationInboxBatch(account, start, target, [operation]);
  expect(retryId).toBe(firstId);
  expect(await chatStore.getOperationSyncCursor(account)).toBeUndefined();
  expect(await chatStore.getPendingOperationInboxBatches(account)).toEqual([
    {
      batchId: firstId,
      operations: [
        {
          type: 26,
          revision: 103n,
          message: { id: "m-inbox", chunks: [Buffer.from([1, 2, 3])] },
        },
      ],
      cursor: target,
    },
  ]);

  await chatStore.completeOperationInboxBatch(account, firstId, target);
  expect(await chatStore.getOperationSyncCursor(account)).toEqual(target);
  expect(await chatStore.getPendingOperationInboxBatches(account)).toEqual([]);
});

test("commits event outbox rows atomically with inbox acknowledgement and restores them", async () => {
  const account = "offline-operation-outbox";
  const start = { revision: "1", globalRevision: "0", individualRevision: "0" };
  const target = { revision: "2", globalRevision: "0", individualRevision: "0" };
  const id = await chatStore.stageOperationInboxBatch(account, start, target, [{ type: 26 }]);
  const events = [{ kind: "read", chatMid: "u-peer" } as const];
  const sequences = await chatStore.completeOperationInboxBatch(account, id, target, events, 0);
  expect(sequences).toEqual([1]);
  expect(await chatStore.getPendingOperationInboxBatches(account)).toEqual([]);
  expect(await chatStore.getTalkEventOutbox(account)).toEqual({
    events: [{ seq: 1, event: { kind: "read", chatMid: "u-peer" } }],
    seq: 1,
  });
});
