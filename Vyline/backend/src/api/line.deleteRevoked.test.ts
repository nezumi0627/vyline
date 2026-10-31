import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";

let dataDir: string;
let router: typeof import("./line.js").lineRouter;
let store: typeof import("../storage/chatStore.js");
let db: typeof import("../storage/sqlite.js");
const account = "offline-delete-revoked";
const chat = "delete-chat";
const message = (id: string, chatMid = chat) => ({
  id, chatMid, from: "peer", to: "me", text: `private ${id}`, contentType: "TEXT",
  createdTime: Number(id) || 1, isMyMessage: false, savedAt: "2026-01-01",
  contentMetadata: { CUSTOM: "private metadata" }, readBy: ["reader"],
  reactions: [{ fromMid: "reader", atMillis: 1, type: 2 }],
});
const remove = (id: string, accountId = account, chatMid = chat) => router.request(
  `/${accountId}/messages/${chatMid}/${id}`, { method: "DELETE" },
);

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-delete-revoked-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  process.env.VYLINE_STORAGE_DIR = join(dataDir, "storage");
  process.env.VYLINE_BACKUP_DIR = join(dataDir, "backups");
  process.env.VYLINE_CHATDB_SAVE_MS = "60000";
  store = await import("../storage/chatStore.js");
  db = await import("../storage/sqlite.js");
  ({ lineRouter: router } = await import("./line.js"));
});

afterAll(async () => {
  for (const id of [account, "other-account", "pending-account"]) await store.flushAccountChatDb(id);
  db.closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("DELETE validates revocation and scopes message lookup to account and chat", async () => {
  await store.upsertMessages(account, chat, [message("1")]);
  expect((await remove("1")).status).toBe(409);
  expect((await store.getMessages(account, chat, 10))[0]?.text).toBe("private 1");
  await store.markMessageRevoked(account, chat, "1");
  expect((await remove("1", "other-account")).status).toBe(404);
  expect((await remove("1", account, "other-chat")).status).toBe(404);
  expect((await store.getMessages(account, chat, 10))).toHaveLength(1);
});

test("DELETE purges all message relations and history, persists tombstone across reopen and blocks sync", async () => {
  await store.upsertChats(account, [{
    mid: chat, name: "Delete", kind: "direct", hasMessages: true,
    lastMessageId: "2", lastMessagePreview: "private 2", lastMessageTime: 2, updatedAt: "2026-01-01",
  }]);
  await store.upsertMessages(account, chat, [message("2")]);
  await store.markMessageRevoked(account, chat, "2");
  const tables = ["chat_messages_v2", "chat_message_snapshots_v2", "chat_message_metadata_v2",
    "chat_message_readers_v2", "chat_message_reactions_v2", "chat_message_history_v2"];
  for (const table of tables) {
    expect((db.sqlite.query(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id=? AND chat_mid=? AND message_id=?`)
      .get(account, chat, "2") as { count: number }).count).toBeGreaterThan(0);
  }
  await store.upsertMessages("other-account", chat, [message("2")]);
  await store.upsertMessages(account, "other-chat", [message("2", "other-chat")]);
  const response = await remove("2");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  for (const table of tables) {
    expect(db.sqlite.query(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id=? AND chat_mid=? AND message_id=?`)
      .get(account, chat, "2")).toEqual({ count: 0 });
  }
  expect(await store.getMessageHistory(account, chat, "2")).toEqual([]);
  expect(await store.restoreRevokedMessage(account, chat, "2")).toBeNull();
  expect((await store.getStoredChats(account))[0]?.lastMessageId).not.toBe("2");
  expect((await store.getMessages("other-account", chat, 10))).toHaveLength(1);
  expect((await store.getMessages(account, "other-chat", 10))).toHaveLength(1);
  db.closeSqlite();
  await store.upsertMessages(account, chat, [message("2"), { ...message("2"), messageState: "revoked-by-other" }]);
  expect((await store.getMessages(account, chat, 10)).some((row) => row.id === "2")).toBe(false);
  expect((await remove("2")).status).toBe(200);
  await store.upsertChats(account, [{
    mid: chat, name: "Delete", kind: "direct", hasMessages: true,
    lastMessageId: "2", lastMessagePreview: "private 2", lastMessageTime: 2, updatedAt: "2026-01-02",
  }]);
  expect((await store.getStoredChats(account))[0]?.lastMessageId).not.toBe("2");
  expect((await store.getStoredChats(account))[0]?.lastMessagePreview).not.toBe("private 2");
});

test("DELETE removes pending memory writes and resists sync while dirty and after flush", async () => {
  const pendingAccount = "pending-account";
  await store.mergeImportedChatDb(pendingAccount, {
    chats: { [chat]: { mid: chat, name: "Pending", kind: "direct", hasMessages: true, updatedAt: "2026-01-01" } },
    messages: { [chat]: { "9": message("9") } },
  });
  await store.markMessageRevoked(pendingAccount, chat, "9");
  expect((await remove("9", pendingAccount)).status).toBe(200);
  await store.upsertMessages(pendingAccount, chat, [message("9"), message("8")]);
  expect((await store.getMessages(pendingAccount, chat, 10)).map((row) => row.id)).toEqual(["8"]);
  expect(await store.getMessageHistory(pendingAccount, chat, "9")).toEqual([]);
  await store.flushAccountChatDb(pendingAccount);
  expect((await store.getMessages(pendingAccount, chat, 10)).map((row) => row.id)).toEqual(["8"]);
  await store.upsertMessages(pendingAccount, chat, [message("9")]);
  expect((await store.getMessages(pendingAccount, chat, 10)).map((row) => row.id)).toEqual(["8"]);
});

test("HTTP history, local pages, media and queued events do not expose deleted messages", async () => {
  const { pushTalkEvent, clearTalkEvents } = await import("../line/talkEventBuffer.js");
  await store.upsertMessages(account, chat, [message("10"), message("11")]);
  const original = (await store.getStoredMessages(account, chat, 1))[0]!;
  pushTalkEvent(account, { kind: "message", chatMid: chat, message: original });
  pushTalkEvent(account, { kind: "revoke", chatMid: chat, messageId: "11" });
  pushTalkEvent(account, { kind: "reaction", chatMid: chat, messageId: "11" });
  pushTalkEvent(account, { kind: "read", chatMid: chat });
  await store.markMessageRevoked(account, chat, "11");
  expect((await remove("11")).status).toBe(200);
  const history = await router.request(`/${account}/messages/${chat}/11/history`);
  expect(await history.json()).toEqual({ ok: true, history: [] });
  const page = await router.request(`/${account}/messages/${chat}?local=1`);
  expect((await page.json() as { messages: Array<{ id: string }> }).messages.some((m) => m.id === "11")).toBe(false);
  const manager = await import("../line/clientManager.js");
  // Polling checks for a session but only reads the local event buffer.
  const client = spyOn(manager, "getClient").mockReturnValue({} as NonNullable<ReturnType<typeof manager.getClient>>);
  let events: Response;
  try {
    events = await router.request(`/${account}/events/poll`);
  } finally {
    client.mockRestore();
  }
  const payload = await events.json() as { cursor: number; events: Array<{ kind: string }> };
  expect(payload.events.map((event) => event.kind)).toEqual(["read"]);
  expect(payload.cursor).toBe(4);
  expect((await router.request(`/${account}/media/${chat}/11`)).status).toBe(404);
  expect((await store.filterLocallyDeletedMessages(account, chat, [message("11"), message("10")])).map((m) => m.id))
    .toEqual(["10"]);
  clearTalkEvents(account);
});

test("failed relational deletion rolls back its tombstone and retains the stored message", async () => {
  await store.mergeImportedChatDb("pending-account", {
    chats: {}, messages: { [chat]: { "12": message("12") } },
  });
  await store.markMessageRevoked("pending-account", chat, "12");
  await store.flushAccountChatDb("pending-account");
  db.sqlite.exec(`CREATE TRIGGER reject_test_delete BEFORE DELETE ON chat_messages_v2
    WHEN OLD.account_id='pending-account' AND OLD.message_id='12'
    BEGIN SELECT RAISE(ABORT, 'test deletion failure'); END;`);
  await expect(store.deleteRevokedMessage("pending-account", chat, "12")).rejects.toThrow("test deletion failure");
  expect(db.sqlite.query(`SELECT 1 FROM chat_message_tombstones_v2 WHERE account_id=? AND chat_mid=? AND message_id=?`)
    .get("pending-account", chat, "12")).toBeNull();
  expect((await store.getMessages("pending-account", chat, 10)).some((row) => row.id === "12")).toBe(true);
  expect((await store.getMessageHistory("pending-account", chat, "12"))).toHaveLength(1);
  db.sqlite.exec("DROP TRIGGER reject_test_delete");
  expect((await remove("12", "pending-account")).status).toBe(200);
});

test("JSON, pending imports and SQLite backup restore honor existing local tombstones", async () => {
  const storedChat = {
    mid: chat, name: "Delete", kind: "direct" as const, hasMessages: true,
    lastMessageId: "13", lastMessagePreview: "private 13", lastMessageTime: 13, updatedAt: "2026-01-01",
  };
  await store.upsertChats(account, [storedChat]);
  await store.upsertMessages(account, chat, [message("13")]);
  await store.markMessageRevoked(account, chat, "13");
  const created = await router.request(`/${account}/backup/create`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatMids: [chat], includeMedia: false }),
  });
  expect(created.status).toBe(200);
  const backup = await created.json() as { summary: { id: string } };
  expect((await remove("13")).status).toBe(200);
  const incoming = { chats: { [chat]: storedChat }, messages: { [chat]: { "13": message("13") } } };
  await store.importChatDb(account, { ...incoming, meta: {} });
  expect((await store.getMessages(account, chat, 30)).some((row) => row.id === "13")).toBe(false);
  const merged = await store.mergeImportedChatDb(account, incoming);
  expect(merged.importedMessages).toBe(0);
  expect((await store.getMessages(account, chat, 30)).some((row) => row.id === "13")).toBe(false);
  await store.flushAccountChatDb(account);
  const restored = await router.request(`/${account}/backup/restore`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ backupId: backup.summary.id, includeMedia: false }),
  });
  expect(restored.status).toBe(200);
  expect((await store.getMessages(account, chat, 30)).some((row) => row.id === "13")).toBe(false);
  expect((await store.getStoredChats(account)).find((row) => row.mid === chat)?.lastMessageId).not.toBe("13");
  for (const table of ["chat_messages_v2", "chat_message_snapshots_v2", "chat_message_metadata_v2",
    "chat_message_readers_v2", "chat_message_reactions_v2", "chat_message_history_v2"]) {
    expect(db.sqlite.query(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id=? AND chat_mid=? AND message_id=?`)
      .get(account, chat, "13")).toEqual({ count: 0 });
  }
});

test("commit failure leaves dirty messages, chat summary and deferred writes unchanged", async () => {
  const pendingAccount = "pending-account";
  await store.upsertMessages(pendingAccount, chat, [message("15")]);
  await store.markMessageRevoked(pendingAccount, chat, "15");
  await store.mergeImportedChatDb(pendingAccount, {
    chats: {}, messages: { [chat]: { "14": message("14") } },
  });
  expect((await store.getStoredChats(pendingAccount)).find((row) => row.mid === chat)?.lastMessageId).toBe("15");
  db.sqlite.exec(`
    CREATE TABLE delete_commit_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE delete_commit_probe (
      parent_id INTEGER REFERENCES delete_commit_parent(id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TRIGGER fail_test_delete_commit AFTER DELETE ON chat_messages_v2
    WHEN OLD.account_id='pending-account' AND OLD.message_id='15'
    BEGIN INSERT INTO delete_commit_probe VALUES (1); END;
  `);
  try {
    await expect(store.deleteRevokedMessage(pendingAccount, chat, "15")).rejects.toThrow();
    expect(db.sqlite.query(`SELECT 1 FROM chat_message_tombstones_v2 WHERE account_id=? AND chat_mid=? AND message_id=?`)
      .get(pendingAccount, chat, "15")).toBeNull();
    expect((await store.getMessages(pendingAccount, chat, 30)).find((row) => row.id === "15")?.messageState)
      .toBe("revoked-by-other");
    expect((await store.getStoredChats(pendingAccount)).find((row) => row.mid === chat)?.lastMessageId).toBe("15");
    expect(await store.getMessageHistory(pendingAccount, chat, "15")).toHaveLength(1);
  } finally {
    db.sqlite.exec("DROP TRIGGER fail_test_delete_commit; DROP TABLE delete_commit_probe; DROP TABLE delete_commit_parent;");
  }
  await store.flushAccountChatDb(pendingAccount);
  expect((await store.getMessages(pendingAccount, chat, 30)).map((row) => row.id)).toEqual(["15", "14", "8"]);
  expect((await remove("15", pendingAccount)).status).toBe(200);
});
