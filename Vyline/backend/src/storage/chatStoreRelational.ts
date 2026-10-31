import { isDeepStrictEqual } from "node:util";
import type { MessageContentMeta, MessageReaction, MessageSnapshot } from "@vyline/types";
import type { StoredChat, StoredMessage } from "./chatStore.js";
import { migrateOnce, sqlite } from "./sqlite.js";
import { ensureReadEngineV4Schema } from "./readEngineV4.js";

type Meta = {
  lastOpRevision?: string;
  boxOrder?: string[];
  chatsSyncedAt?: string;
  messagesSyncedAt?: Record<string, string>;
  localReadUpTo?: Record<string, { messageId: string; at: string }>;
};

type ChatRow = {
  account_id: string; mid: string; name: string; kind: StoredChat["kind"];
  has_messages: number; last_message_time: number | null; last_message_id: string | null;
  last_message_preview: string | null; thumbnail_url: string | null; unread_count: number | null;
  is_official: number | null; updated_at: string;
};

type MessageRow = {
  account_id: string; chat_mid: string; message_id: string; from_mid: string; to_mid: string;
  text: string | null; content_type: string; created_time: number; is_my_message: number;
  metadata_state: number; read_count: number | null; read_by_present: number; seen: number | null;
  related_message_id: string | null; related_message_present: number; sticker_animated: number | null;
  sticker_sticky: number | null; reactions_present: number; saved_at: string | null;
  message_state: StoredMessage["messageState"] | null; history_present: number;
};

type Owner = "main" | "snapshot";
let messageFtsReady = false;

export type OperationSyncCursor = {
  revision: string;
  globalRevision: string;
  individualRevision: string;
};

export type StoredOperationInboxBatch = {
  accountId: string;
  batchId: string;
  payload: string;
  cursor: OperationSyncCursor;
  createdAt: string;
};

export function ensureRelationalChatSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS chat_message_tombstones_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      PRIMARY KEY(account_id, chat_mid, message_id)
    );
    CREATE TABLE IF NOT EXISTS chat_records_v2 (
      account_id TEXT NOT NULL, mid TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
      has_messages INTEGER NOT NULL, last_message_time INTEGER, last_message_id TEXT,
      last_message_preview TEXT, thumbnail_url TEXT, unread_count INTEGER, is_official INTEGER,
      updated_at TEXT NOT NULL, PRIMARY KEY(account_id, mid)
    );
    CREATE TABLE IF NOT EXISTS chat_messages_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      from_mid TEXT NOT NULL, to_mid TEXT NOT NULL, text TEXT, content_type TEXT NOT NULL,
      created_time INTEGER NOT NULL, is_my_message INTEGER NOT NULL,
      metadata_state INTEGER NOT NULL DEFAULT 0, read_count INTEGER,
      read_by_present INTEGER NOT NULL DEFAULT 0, seen INTEGER, related_message_id TEXT,
      related_message_present INTEGER NOT NULL DEFAULT 0, sticker_animated INTEGER,
      sticker_sticky INTEGER, reactions_present INTEGER NOT NULL DEFAULT 0,
      saved_at TEXT, message_state TEXT, history_present INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(account_id, chat_mid, message_id)
    );
    CREATE INDEX IF NOT EXISTS chat_messages_v2_order_idx
      ON chat_messages_v2(account_id, chat_mid, created_time DESC,
        CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 1 ELSE 0 END DESC,
        CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 0 ELSE length(message_id) END DESC,
        message_id DESC);
    CREATE INDEX IF NOT EXISTS chat_messages_v2_id_idx
      ON chat_messages_v2(account_id, message_id);
    CREATE TABLE IF NOT EXISTS chat_message_snapshots_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      from_mid TEXT NOT NULL, to_mid TEXT NOT NULL, text TEXT, content_type TEXT NOT NULL,
      created_time INTEGER NOT NULL, is_my_message INTEGER NOT NULL,
      metadata_state INTEGER NOT NULL DEFAULT 0, read_count INTEGER,
      read_by_present INTEGER NOT NULL DEFAULT 0, seen INTEGER, related_message_id TEXT,
      related_message_present INTEGER NOT NULL DEFAULT 0, sticker_animated INTEGER,
      sticker_sticky INTEGER, reactions_present INTEGER NOT NULL DEFAULT 0,
      saved_at TEXT, message_state TEXT,
      PRIMARY KEY(account_id, chat_mid, message_id)
    );
    CREATE TABLE IF NOT EXISTS chat_message_metadata_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(account_id, chat_mid, message_id, owner, key)
    );
    CREATE TABLE IF NOT EXISTS chat_message_readers_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      owner TEXT NOT NULL, position INTEGER NOT NULL, reader_mid TEXT NOT NULL,
      PRIMARY KEY(account_id, chat_mid, message_id, owner, position)
    );
    CREATE TABLE IF NOT EXISTS chat_message_reactions_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      owner TEXT NOT NULL, position INTEGER NOT NULL, from_mid TEXT NOT NULL,
      at_millis INTEGER NOT NULL, reaction_type INTEGER NOT NULL,
      PRIMARY KEY(account_id, chat_mid, message_id, owner, position)
    );
    CREATE TABLE IF NOT EXISTS chat_message_history_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      position INTEGER NOT NULL, state TEXT NOT NULL, text TEXT, content_type TEXT NOT NULL,
      updated_time INTEGER NOT NULL,
      PRIMARY KEY(account_id, chat_mid, message_id, position)
    );
    CREATE TABLE IF NOT EXISTS chat_account_state_v2 (
      account_id TEXT PRIMARY KEY, last_op_revision TEXT, chats_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_operation_sync_cursor_v1 (
      account_id TEXT PRIMARY KEY,
      revision TEXT NOT NULL,
      global_revision TEXT NOT NULL,
      individual_revision TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_operation_inbox_v1 (
      account_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      revision TEXT NOT NULL,
      global_revision TEXT NOT NULL,
      individual_revision TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(account_id,batch_id)
    );
    CREATE INDEX IF NOT EXISTS chat_operation_inbox_v1_order_idx
      ON chat_operation_inbox_v1(account_id,created_at,batch_id);
    CREATE TABLE IF NOT EXISTS talk_event_outbox_v1 (
      account_id TEXT NOT NULL, seq INTEGER NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(account_id,seq)
    );
    CREATE TABLE IF NOT EXISTS talk_event_outbox_state_v1 (
      account_id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS talk_event_outbox_v1_created_idx
      ON talk_event_outbox_v1(account_id,seq);
    CREATE TABLE IF NOT EXISTS chat_box_order_v2 (
      account_id TEXT NOT NULL, position INTEGER NOT NULL, chat_mid TEXT NOT NULL,
      PRIMARY KEY(account_id, position)
    );
    CREATE TABLE IF NOT EXISTS chat_messages_synced_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, synced_at TEXT NOT NULL,
      PRIMARY KEY(account_id, chat_mid)
    );
    CREATE TABLE IF NOT EXISTS chat_local_read_v2 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, message_id TEXT NOT NULL,
      at TEXT NOT NULL, PRIMARY KEY(account_id, chat_mid)
    );
  `);
  // FTS5 trigram index makes substring search independent of loaded UI pages.
  // Keep it additive and tolerate SQLite builds that omit FTS5.
  try {
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts_v1 USING fts5(
        account_id UNINDEXED, chat_mid UNINDEXED, message_id UNINDEXED, text, tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS chat_messages_fts_v1_insert AFTER INSERT ON chat_messages_v2 BEGIN
        INSERT INTO chat_messages_fts_v1(account_id,chat_mid,message_id,text)
          VALUES (new.account_id,new.chat_mid,new.message_id,new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chat_messages_fts_v1_delete AFTER DELETE ON chat_messages_v2 BEGIN
        DELETE FROM chat_messages_fts_v1 WHERE account_id=old.account_id
          AND chat_mid=old.chat_mid AND message_id=old.message_id;
      END;
      CREATE TRIGGER IF NOT EXISTS chat_messages_fts_v1_update AFTER UPDATE OF text ON chat_messages_v2 BEGIN
        DELETE FROM chat_messages_fts_v1 WHERE account_id=old.account_id
          AND chat_mid=old.chat_mid AND message_id=old.message_id;
        INSERT INTO chat_messages_fts_v1(account_id,chat_mid,message_id,text)
          VALUES (new.account_id,new.chat_mid,new.message_id,new.text);
      END;
    `);
    migrateOnce("chat-message-fts-trigram-v1", () => {
      sqlite.exec(`INSERT INTO chat_messages_fts_v1(account_id,chat_mid,message_id,text)
        SELECT account_id,chat_mid,message_id,text FROM chat_messages_v2
        WHERE text IS NOT NULL AND text != ''`);
    });
    messageFtsReady = true;
  } catch {
    messageFtsReady = false;
    // LIKE fallback below preserves search on SQLite builds without FTS5/trigram.
  }
  migrateOldSqliteRows();
  ensureReadEngineV4Schema();
}

export type MessageSearchRow = { message_id: string; text: string | null };

export function searchStoredMessageRows(
  accountId: string,
  chatMid: string,
  query: string,
  limit: number,
): MessageSearchRow[] {
  const q = query.trim();
  if (!q) return [];
  if (q.length >= 3 && messageFtsReady) {
    try {
      const phrase = `"${q.replaceAll('"', '""')}"`;
      return sqlite.query(`SELECT m.message_id,m.text FROM chat_messages_fts_v1
        JOIN chat_messages_v2 m ON m.account_id=chat_messages_fts_v1.account_id
          AND m.chat_mid=chat_messages_fts_v1.chat_mid AND m.message_id=chat_messages_fts_v1.message_id
        WHERE chat_messages_fts_v1 MATCH ? AND chat_messages_fts_v1.account_id=? AND chat_messages_fts_v1.chat_mid=?
        ORDER BY m.created_time DESC,m.message_id DESC LIMIT ?`)
        .all(phrase, accountId, chatMid, limit) as MessageSearchRow[];
    } catch {
      // FTS query syntax may be unavailable in an older SQLite runtime.
    }
  }
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return sqlite.query(`SELECT message_id,text FROM (
      SELECT message_id,text,created_time FROM chat_messages_v2
      WHERE account_id=? AND chat_mid=? AND text IS NOT NULL
      ORDER BY created_time DESC,message_id DESC LIMIT 10000
    ) WHERE text LIKE ? ESCAPE '\\' ORDER BY created_time DESC,message_id DESC LIMIT ?`)
    .all(accountId, chatMid, pattern, limit) as MessageSearchRow[];
}

export function scanStoredMessageRows(accountId: string, chatMid: string, limit: number): MessageSearchRow[] {
  return sqlite.query(`SELECT message_id,text FROM chat_messages_v2
    WHERE account_id=? AND chat_mid=? AND text IS NOT NULL
    ORDER BY created_time DESC,message_id DESC LIMIT ?`)
    .all(accountId, chatMid, limit) as MessageSearchRow[];
}

function tableExists(name: string): boolean {
  return Boolean(sqlite.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function migrateOldSqliteRows(): void {
  migrateOnce("chat-sqlite-json-to-relational-v2", () => {
    const metaByAccount = new Map<string, Meta>();
    const migratedAccounts = new Set<string>();
    if (tableExists("chat_account_state")) {
      const columns = sqlite.query("PRAGMA table_info(chat_account_state)").all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === "meta_json")) {
        const rows = sqlite.query("SELECT account_id, meta_json FROM chat_account_state").all() as Array<{ account_id: string; meta_json: string }>;
        for (const row of rows) {
          migratedAccounts.add(row.account_id);
          const meta = JSON.parse(row.meta_json) as Meta;
          metaByAccount.set(row.account_id, meta);
          writeChatMeta(row.account_id, meta);
        }
      }
    }
    if (tableExists("chat_records")) {
      const columns = sqlite.query("PRAGMA table_info(chat_records)").all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === "payload")) {
        const rows = sqlite.query("SELECT account_id, payload FROM chat_records").all() as Array<{ account_id: string; payload: string }>;
        for (const row of rows) {
          migratedAccounts.add(row.account_id);
          writeStoredChat(row.account_id, JSON.parse(row.payload) as StoredChat);
        }
      }
    }
    if (tableExists("chat_messages")) {
      const columns = sqlite.query("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === "payload")) {
        const rows = sqlite.query("SELECT account_id, chat_mid, payload FROM chat_messages").all() as Array<{ account_id: string; chat_mid: string; payload: string }>;
        for (const row of rows) {
          migratedAccounts.add(row.account_id);
          const message = JSON.parse(row.payload) as StoredMessage;
          const cursor = metaByAccount.get(row.account_id)?.localReadUpTo?.[row.chat_mid]?.messageId;
          if (cursor && !message.isMyMessage && /^\d+$/.test(message.id) && /^\d+$/.test(cursor)) {
            try { if (BigInt(message.id) <= BigInt(cursor)) message.seen = true; } catch { /* ignore malformed IDs */ }
          }
          writeStoredMessage(row.account_id, row.chat_mid, message);
        }
      }
    }
    const recordImport = sqlite.query("INSERT OR IGNORE INTO app_migrations (name, applied_at) VALUES (?, ?)");
    for (const accountId of migratedAccounts) {
      recordImport.run(`chatdb-json-v1:${accountId}`, new Date().toISOString());
    }
    sqlite.exec("DROP TABLE IF EXISTS chat_messages; DROP TABLE IF EXISTS chat_records; DROP TABLE IF EXISTS chat_account_state;");
  });
}

export function writeStoredChat(accountId: string, chat: StoredChat): void {
  sqlite.query(`INSERT INTO chat_records_v2
    (account_id, mid, name, kind, has_messages, last_message_time, last_message_id,
      last_message_preview, thumbnail_url, unread_count, is_official, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, mid) DO UPDATE SET name=excluded.name, kind=excluded.kind,
      has_messages=excluded.has_messages, last_message_time=excluded.last_message_time,
      last_message_id=excluded.last_message_id, last_message_preview=excluded.last_message_preview,
      thumbnail_url=excluded.thumbnail_url, unread_count=excluded.unread_count,
      is_official=excluded.is_official, updated_at=excluded.updated_at`)
    .run(accountId, chat.mid, chat.name, chat.kind, chat.hasMessages ? 1 : 0,
      chat.lastMessageTime ?? null, chat.lastMessageId ?? null, chat.lastMessagePreview ?? null,
      chat.thumbnailUrl ?? null, chat.unreadCount ?? null,
      chat.isOfficial == null ? null : Number(chat.isOfficial), chat.updatedAt);
}

export function readStoredChat(row: ChatRow): StoredChat {
  return {
    mid: row.mid, name: row.name, kind: row.kind, hasMessages: row.has_messages === 1,
    ...(row.last_message_time != null ? { lastMessageTime: row.last_message_time } : {}),
    ...(row.last_message_id != null ? { lastMessageId: row.last_message_id } : {}),
    ...(row.last_message_preview != null ? { lastMessagePreview: row.last_message_preview } : {}),
    ...(row.thumbnail_url != null ? { thumbnailUrl: row.thumbnail_url } : {}),
    ...(row.unread_count != null ? { unreadCount: row.unread_count } : {}),
    ...(row.is_official != null ? { isOfficial: row.is_official === 1 } : {}),
    updatedAt: row.updated_at,
  };
}

function writeVariant(accountId: string, chatMid: string, message: StoredMessage | MessageSnapshot, owner: Owner): void {
  const snapshot = owner === "snapshot";
  const table = snapshot ? "chat_message_snapshots_v2" : "chat_messages_v2";
  const fields = `account_id, chat_mid, message_id, from_mid, to_mid, text, content_type,
    created_time, is_my_message, metadata_state, read_count, read_by_present, seen,
    related_message_id, related_message_present, sticker_animated, sticker_sticky,
    reactions_present${snapshot ? ", saved_at, message_state" : ", saved_at, message_state, history_present"}`;
  const values = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${snapshot ? "" : ", ?"}`;
  sqlite.query(`INSERT INTO ${table} (${fields}) VALUES (${values})
    ON CONFLICT(account_id, chat_mid, message_id) DO UPDATE SET
      from_mid=excluded.from_mid, to_mid=excluded.to_mid, text=excluded.text,
      content_type=excluded.content_type, created_time=excluded.created_time,
      is_my_message=excluded.is_my_message, metadata_state=excluded.metadata_state,
      read_count=excluded.read_count, read_by_present=excluded.read_by_present,
      seen=excluded.seen, related_message_id=excluded.related_message_id,
      related_message_present=excluded.related_message_present,
      sticker_animated=excluded.sticker_animated, sticker_sticky=excluded.sticker_sticky,
      reactions_present=excluded.reactions_present, saved_at=excluded.saved_at,
      message_state=excluded.message_state${snapshot ? "" : ", history_present=excluded.history_present"}`)
    .run(accountId, chatMid, message.id, message.from, message.to, message.text,
      message.contentType, message.createdTime, Number(Boolean(message.isMyMessage)),
      message.contentMetadata === undefined ? 0 : message.contentMetadata === null ? 1 : 2,
      message.readCount ?? null, Number(Object.hasOwn(message, "readBy")),
      message.seen == null ? null : Number(message.seen), message.relatedMessageId ?? null,
      Number(Object.hasOwn(message, "relatedMessageId")),
      message.stickerAnimated == null ? null : Number(message.stickerAnimated),
      message.stickerSticky == null ? null : Number(message.stickerSticky),
      Number(Object.hasOwn(message, "reactions")),
      "savedAt" in message ? message.savedAt : null, message.messageState ?? null,
      ...(!snapshot ? [Number(Object.hasOwn(message, "history"))] : []));

  const relationKey = [accountId, chatMid, message.id, owner] as const;
  const nextMetadata = Object.entries(message.contentMetadata ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const currentMetadata = sqlite.query(`SELECT key,value FROM chat_message_metadata_v2
    WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=? ORDER BY key`)
    .all(...relationKey) as Array<{ key: string; value: string }>;
  if (!isDeepStrictEqual(currentMetadata, nextMetadata.map(([key, value]) => ({ key, value })))) {
    sqlite.query(`DELETE FROM chat_message_metadata_v2
      WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=?`).run(...relationKey);
    const insert = sqlite.query(`INSERT INTO chat_message_metadata_v2
      (account_id, chat_mid, message_id, owner, key, value) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const [key, value] of nextMetadata) insert.run(accountId, chatMid, message.id, owner, key, value);
  }

  const nextReaders = message.readBy ?? [];
  const currentReaders = sqlite.query(`SELECT reader_mid FROM chat_message_readers_v2
    WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=? ORDER BY position`)
    .all(...relationKey).map((row) => (row as { reader_mid: string }).reader_mid);
  if (!isDeepStrictEqual(currentReaders, nextReaders)) {
    sqlite.query(`DELETE FROM chat_message_readers_v2
      WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=?`).run(...relationKey);
    const insert = sqlite.query(`INSERT INTO chat_message_readers_v2
      (account_id, chat_mid, message_id, owner, position, reader_mid) VALUES (?, ?, ?, ?, ?, ?)`);
    nextReaders.forEach((mid, index) => insert.run(accountId, chatMid, message.id, owner, index, mid));
  }

  const nextReactions = message.reactions ?? [];
  const currentReactions = sqlite.query(`SELECT from_mid AS fromMid,at_millis AS atMillis,
      reaction_type AS type FROM chat_message_reactions_v2
    WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=? ORDER BY position`)
    .all(...relationKey) as MessageReaction[];
  if (!isDeepStrictEqual(currentReactions, nextReactions)) {
    sqlite.query(`DELETE FROM chat_message_reactions_v2
      WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=?`).run(...relationKey);
    const insert = sqlite.query(`INSERT INTO chat_message_reactions_v2
      (account_id, chat_mid, message_id, owner, position, from_mid, at_millis, reaction_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    nextReactions.forEach((reaction, index) => insert.run(
      accountId, chatMid, message.id, owner, index, reaction.fromMid, reaction.atMillis, reaction.type,
    ));
  }

  if (!snapshot) {
    const nextHistory = (message as StoredMessage).history ?? [];
    const currentHistory = sqlite.query(`SELECT state,text,content_type AS contentType,
        updated_time AS updatedTime FROM chat_message_history_v2
      WHERE account_id=? AND chat_mid=? AND message_id=? ORDER BY position`)
      .all(accountId, chatMid, message.id);
    if (!isDeepStrictEqual(currentHistory, nextHistory)) {
      sqlite.query(`DELETE FROM chat_message_history_v2
        WHERE account_id=? AND chat_mid=? AND message_id=?`).run(accountId, chatMid, message.id);
      const insert = sqlite.query(`INSERT INTO chat_message_history_v2
        (account_id, chat_mid, message_id, position, state, text, content_type, updated_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      nextHistory.forEach((item, index) => insert.run(
        accountId, chatMid, message.id, index, item.state, item.text, item.contentType, item.updatedTime,
      ));
    }
  }
}

export function writeStoredMessage(accountId: string, chatMid: string, message: StoredMessage): void {
  if (isStoredMessageDeleted(accountId, chatMid, message.id)) return;
  writeVariant(accountId, chatMid, message, "main");
  if (message.revokedSnapshot) writeVariant(accountId, chatMid, message.revokedSnapshot, "snapshot");
  else {
    const snapshot = sqlite.query(`SELECT 1 FROM chat_message_snapshots_v2
      WHERE account_id=? AND chat_mid=? AND message_id=?`).get(accountId, chatMid, message.id);
    if (snapshot) {
      sqlite.query("DELETE FROM chat_message_snapshots_v2 WHERE account_id=? AND chat_mid=? AND message_id=?")
        .run(accountId, chatMid, message.id);
      for (const relation of ["chat_message_metadata_v2", "chat_message_readers_v2", "chat_message_reactions_v2"] as const) {
        sqlite.query(`DELETE FROM ${relation} WHERE account_id=? AND chat_mid=? AND message_id=? AND owner='snapshot'`)
          .run(accountId, chatMid, message.id);
      }
    }
  }
}

export function isStoredMessageDeleted(accountId: string, chatMid: string, messageId: string): boolean {
  return Boolean(sqlite.query(`SELECT 1 FROM chat_message_tombstones_v2
    WHERE account_id=? AND chat_mid=? AND message_id=?`).get(accountId, chatMid, messageId));
}

export function getDeletedMessageIds(accountId: string, chatMid: string, messageIds: string[]): Set<string> {
  if (messageIds.length === 0) return new Set();
  const uniqueIds = [...new Set(messageIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = sqlite.query(`SELECT message_id FROM chat_message_tombstones_v2
    WHERE account_id=? AND chat_mid=? AND message_id IN (${placeholders})`)
    .all(accountId, chatMid, ...uniqueIds) as Array<{ message_id: string }>;
  return new Set(rows.map((row) => row.message_id));
}

/** Caller holds the transaction covering validation, tombstone and message removal. */
export function deleteStoredMessage(accountId: string, chatMid: string, messageId: string): void {
  sqlite.query("INSERT OR IGNORE INTO chat_message_tombstones_v2 VALUES (?,?,?)")
    .run(accountId, chatMid, messageId);
  for (const table of ["chat_message_metadata_v2", "chat_message_readers_v2", "chat_message_reactions_v2",
    "chat_message_history_v2", "chat_message_snapshots_v2", "chat_messages_v2"]) {
    sqlite.query(`DELETE FROM ${table} WHERE account_id=? AND chat_mid=? AND message_id=?`)
      .run(accountId, chatMid, messageId);
  }
}

type MessageBatch = {
  metadata: Map<string, Array<[string, string]>>;
  readers: Map<string, string[]>;
  reactions: Map<string, MessageReaction[]>;
  history: Map<string, StoredMessage["history"]>;
  snapshots: Map<string, MessageRow>;
};

function batchKey(messageId: string, owner: Owner): string { return `${owner}:${messageId}`; }

function loadMessageBatch(accountId: string, chatMid: string, messageIds: string[]): MessageBatch {
  const batch: MessageBatch = {
    metadata: new Map(), readers: new Map(), reactions: new Map(), history: new Map(), snapshots: new Map(),
  };
  if (!messageIds.length) return batch;
  const placeholders = messageIds.map(() => "?").join(",");
  const params = [accountId, chatMid, ...messageIds];
  const metadata = sqlite.query(`SELECT message_id,owner,key,value FROM chat_message_metadata_v2
    WHERE account_id=? AND chat_mid=? AND message_id IN (${placeholders}) ORDER BY key`).all(...params) as
    Array<{ message_id: string; owner: Owner; key: string; value: string }>;
  for (const row of metadata) {
    const key = batchKey(row.message_id, row.owner);
    const entries = batch.metadata.get(key) ?? [];
    entries.push([row.key, row.value]);
    batch.metadata.set(key, entries);
  }
  const readers = sqlite.query(`SELECT message_id,owner,position,reader_mid FROM chat_message_readers_v2
    WHERE account_id=? AND chat_mid=? AND message_id IN (${placeholders}) ORDER BY position`).all(...params) as
    Array<{ message_id: string; owner: Owner; reader_mid: string }>;
  for (const row of readers) {
    const key = batchKey(row.message_id, row.owner);
    const values = batch.readers.get(key) ?? [];
    values.push(row.reader_mid);
    batch.readers.set(key, values);
  }
  const reactions = sqlite.query(`SELECT message_id,owner,from_mid AS fromMid,at_millis AS atMillis,
    reaction_type AS type FROM chat_message_reactions_v2
    WHERE account_id=? AND chat_mid=? AND message_id IN (${placeholders}) ORDER BY position`).all(...params) as
    Array<{ message_id: string; owner: Owner; fromMid: string; atMillis: number; type: number }>;
  for (const row of reactions) {
    const key = batchKey(row.message_id, row.owner);
    const values = batch.reactions.get(key) ?? [];
    values.push({ fromMid: row.fromMid, atMillis: row.atMillis, type: row.type });
    batch.reactions.set(key, values);
  }
  const history = sqlite.query(`SELECT message_id,state,text,content_type AS contentType,updated_time AS updatedTime
    FROM chat_message_history_v2 WHERE account_id=? AND chat_mid=? AND message_id IN (${placeholders}) ORDER BY position`)
    .all(...params) as Array<{ message_id: string; state: NonNullable<StoredMessage["history"]>[number]["state"]; text: string | null; contentType: string; updatedTime: number }>;
  for (const row of history) {
    const values = batch.history.get(row.message_id) ?? [];
    values.push({ state: row.state, text: row.text, contentType: row.contentType, updatedTime: row.updatedTime });
    batch.history.set(row.message_id, values);
  }
  const snapshots = sqlite.query(`SELECT * FROM chat_message_snapshots_v2
    WHERE account_id=? AND chat_mid=? AND message_id IN (${placeholders})`).all(...params) as MessageRow[];
  for (const row of snapshots) batch.snapshots.set(row.message_id, row);
  return batch;
}

function readVariant(row: MessageRow, owner: Owner, batch?: MessageBatch): StoredMessage | MessageSnapshot {
  const { account_id, chat_mid, message_id, from_mid, to_mid, text, content_type, created_time,
    is_my_message, metadata_state, read_count, read_by_present, seen, related_message_id,
    related_message_present, sticker_animated, sticker_sticky, reactions_present, saved_at,
    message_state } = row;
  const out: Record<string, unknown> = {
    id: message_id, from: from_mid, to: to_mid, text, contentType: content_type,
    createdTime: created_time, isMyMessage: is_my_message === 1,
  };
  if (metadata_state === 1) out.contentMetadata = null;
  if (read_count != null) out.readCount = read_count;
  if (read_by_present) out.readBy = [];
  if (seen != null) out.seen = seen === 1;
  if (related_message_present) out.relatedMessageId = related_message_id;
  if (sticker_animated != null) out.stickerAnimated = sticker_animated === 1;
  if (sticker_sticky != null) out.stickerSticky = sticker_sticky === 1;
  if (reactions_present) out.reactions = [];
  if (saved_at != null) out.savedAt = saved_at;
  if (message_state != null) out.messageState = message_state;
  if (metadata_state === 2) out.contentMetadata = {};
  if (batch) {
    const key = batchKey(message_id, owner);
    if (metadata_state === 2) out.contentMetadata = Object.fromEntries(batch.metadata.get(key) ?? []);
    if (read_by_present) out.readBy = batch.readers.get(key) ?? [];
    if (reactions_present) out.reactions = batch.reactions.get(key) ?? [];
  } else if (metadata_state === 2 || read_by_present || reactions_present) {
    const metadata = sqlite.query(`SELECT key, value FROM chat_message_metadata_v2
      WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=? ORDER BY key`)
      .all(account_id, chat_mid, message_id, owner) as Array<{ key: string; value: string }>;
    if (metadata_state === 2) out.contentMetadata = Object.fromEntries(metadata.map((item) => [item.key, item.value]));
    if (read_by_present) out.readBy = (sqlite.query(`SELECT reader_mid FROM chat_message_readers_v2
      WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=? ORDER BY position`)
      .all(account_id, chat_mid, message_id, owner) as Array<{ reader_mid: string }>).map((item) => item.reader_mid);
    if (reactions_present) out.reactions = sqlite.query(`SELECT from_mid AS fromMid, at_millis AS atMillis,
      reaction_type AS type FROM chat_message_reactions_v2
      WHERE account_id=? AND chat_mid=? AND message_id=? AND owner=? ORDER BY position`)
      .all(account_id, chat_mid, message_id, owner) as MessageReaction[];
  }
  if (owner === "main") {
    const messageRow = row as MessageRow & { history_present: number };
    if (messageRow.history_present && batch) out.history = batch.history.get(message_id) ?? [];
    else if (messageRow.history_present) {
      out.history = sqlite.query(`SELECT state, text, content_type AS contentType, updated_time AS updatedTime
        FROM chat_message_history_v2 WHERE account_id=? AND chat_mid=? AND message_id=? ORDER BY position`)
        .all(account_id, chat_mid, message_id) as StoredMessage["history"];
    }
    const snapshot = batch?.snapshots.get(message_id) ?? (!batch ? sqlite.query(`SELECT * FROM chat_message_snapshots_v2
      WHERE account_id=? AND chat_mid=? AND message_id=?`).get(account_id, chat_mid, message_id) as MessageRow | null : null);
    if (snapshot) out.revokedSnapshot = readVariant(snapshot, "snapshot", batch);
  }
  return out as unknown as StoredMessage | MessageSnapshot;
}

export function readStoredMessage(accountId: string, chatMid: string, messageId: string): StoredMessage | undefined {
  const row = sqlite.query("SELECT * FROM chat_messages_v2 WHERE account_id=? AND chat_mid=? AND message_id=?")
    .get(accountId, chatMid, messageId) as MessageRow | null;
  return row ? readVariant(row, "main") as StoredMessage : undefined;
}

export function readLatestStoredMessage(accountId: string, chatMid: string): StoredMessage | undefined {
  const row = sqlite.query(`SELECT * FROM chat_messages_v2 WHERE account_id=? AND chat_mid=?
    ORDER BY created_time DESC,
      CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 1 ELSE 0 END DESC,
      CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 0 ELSE length(message_id) END DESC,
      message_id DESC LIMIT 1`).get(accountId, chatMid) as MessageRow | null;
  return row ? readVariant(row, "main") as StoredMessage : undefined;
}

export function readStoredMessages(accountId: string, chatMid: string): StoredMessage[] {
  const rows = sqlite.query("SELECT * FROM chat_messages_v2 WHERE account_id=? AND chat_mid=?")
    .all(accountId, chatMid) as MessageRow[];
  const batch = loadMessageBatch(accountId, chatMid, rows.map((row) => row.message_id));
  return rows.map((row) => readVariant(row, "main", batch) as StoredMessage);
}

export function readStoredMessagesByIds(accountId: string, chatMid: string, messageIds: string[]): StoredMessage[] {
  if (!messageIds.length) return [];
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = sqlite.query(`SELECT * FROM chat_messages_v2 WHERE account_id=? AND chat_mid=? AND message_id IN (${placeholders})`)
    .all(accountId, chatMid, ...messageIds) as MessageRow[];
  const byId = new Map(rows.map((row) => [row.message_id, row]));
  const batch = loadMessageBatch(accountId, chatMid, messageIds);
  return messageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [readVariant(row, "main", batch) as StoredMessage] : [];
  });
}

export function readStoredChatById(accountId: string, chatMid: string): StoredChat | undefined {
  const row = sqlite.query("SELECT * FROM chat_records_v2 WHERE account_id=? AND mid=?")
    .get(accountId, chatMid) as ChatRow | null;
  return row ? readStoredChat(row) : undefined;
}

export function readStoredChats(accountId: string): StoredChat[] {
  return (sqlite.query("SELECT * FROM chat_records_v2 WHERE account_id=? ORDER BY rowid")
    .all(accountId) as ChatRow[]).map(readStoredChat);
}

export function writeChatMeta(accountId: string, meta: Meta): void {
  sqlite.query(`INSERT INTO chat_account_state_v2 (account_id,last_op_revision,chats_synced_at)
    VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET
      last_op_revision=excluded.last_op_revision,chats_synced_at=excluded.chats_synced_at`)
    .run(accountId, meta.lastOpRevision ?? null, meta.chatsSyncedAt ?? null);
  writeChatBoxOrder(accountId, meta.boxOrder ?? []);
  sqlite.query("DELETE FROM chat_messages_synced_v2 WHERE account_id=?").run(accountId);
  sqlite.query("DELETE FROM chat_local_read_v2 WHERE account_id=?").run(accountId);
  const synced = sqlite.query("INSERT INTO chat_messages_synced_v2 (account_id,chat_mid,synced_at) VALUES (?,?,?)");
  for (const [mid, at] of Object.entries(meta.messagesSyncedAt ?? {})) synced.run(accountId, mid, at);
  const read = sqlite.query("INSERT INTO chat_local_read_v2 (account_id,chat_mid,message_id,at) VALUES (?,?,?,?)");
  for (const [mid, value] of Object.entries(meta.localReadUpTo ?? {})) read.run(accountId, mid, value.messageId, value.at);
}

export function writeChatSyncState(
  accountId: string,
  lastOpRevision: string | undefined,
  chatsSyncedAt: string,
): void {
  sqlite.query(`INSERT INTO chat_account_state_v2 (account_id,last_op_revision,chats_synced_at)
    VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET
      last_op_revision=COALESCE(excluded.last_op_revision,chat_account_state_v2.last_op_revision),
      chats_synced_at=excluded.chats_synced_at`)
    .run(accountId, lastOpRevision ?? null, chatsSyncedAt);
}

export function readOperationSyncCursor(accountId: string): OperationSyncCursor | undefined {
  const row = sqlite.query(`SELECT revision,global_revision,individual_revision
    FROM chat_operation_sync_cursor_v1 WHERE account_id=?`).get(accountId) as
    | { revision: string; global_revision: string; individual_revision: string }
    | null;
  if (row) {
    return {
        revision: row.revision,
        globalRevision: row.global_revision,
        individualRevision: row.individual_revision,
    };
  }
  const legacy = sqlite.query("SELECT last_op_revision FROM chat_account_state_v2 WHERE account_id=?")
    .get(accountId) as { last_op_revision: string | null } | null;
  return legacy?.last_op_revision != null
    ? { revision: legacy.last_op_revision, globalRevision: "0", individualRevision: "0" }
    : undefined;
}

export function writeOperationSyncCursor(accountId: string, cursor: OperationSyncCursor): void {
  sqlite.query(`INSERT INTO chat_operation_sync_cursor_v1
    (account_id,revision,global_revision,individual_revision,updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(account_id) DO UPDATE SET
      revision=excluded.revision,
      global_revision=excluded.global_revision,
      individual_revision=excluded.individual_revision,
      updated_at=excluded.updated_at`)
    .run(accountId, cursor.revision, cursor.globalRevision, cursor.individualRevision, new Date().toISOString());
}

export function insertOperationInboxBatch(
  accountId: string,
  batchId: string,
  payload: string,
  cursor: OperationSyncCursor,
): void {
  sqlite.query(`INSERT OR IGNORE INTO chat_operation_inbox_v1
    (account_id,batch_id,payload_json,revision,global_revision,individual_revision,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    accountId, batchId, payload, cursor.revision, cursor.globalRevision,
    cursor.individualRevision, new Date().toISOString(),
  );
}

export function readOperationInboxBatches(accountId: string): StoredOperationInboxBatch[] {
  return (sqlite.query(`SELECT batch_id,payload_json,revision,global_revision,individual_revision,created_at
    FROM chat_operation_inbox_v1 WHERE account_id=? ORDER BY rowid`).all(accountId) as Array<{
      batch_id: string;
      payload_json: string;
      revision: string;
      global_revision: string;
      individual_revision: string;
      created_at: string;
    }>).map((row) => ({
      accountId,
      batchId: row.batch_id,
      payload: row.payload_json,
      cursor: {
        revision: row.revision,
        globalRevision: row.global_revision,
        individualRevision: row.individual_revision,
      },
      createdAt: row.created_at,
    }));
}

export function deleteOperationInboxBatch(accountId: string, batchId: string): void {
  sqlite.query("DELETE FROM chat_operation_inbox_v1 WHERE account_id=? AND batch_id=?").run(accountId, batchId);
}

export function writeChatBoxOrder(accountId: string, boxOrder: string[]): void {
  sqlite.query("DELETE FROM chat_box_order_v2 WHERE account_id=?").run(accountId);
  const insert = sqlite.query("INSERT INTO chat_box_order_v2 (account_id,position,chat_mid) VALUES (?,?,?)");
  boxOrder.forEach((mid, index) => insert.run(accountId, index, mid));
}

export function readLocalReadPosition(accountId: string, chatMid: string): { messageId: string; at: string } | undefined {
  const row = sqlite.query("SELECT message_id,at FROM chat_local_read_v2 WHERE account_id=? AND chat_mid=?")
    .get(accountId, chatMid) as { message_id: string; at: string } | null;
  return row ? { messageId: row.message_id, at: row.at } : undefined;
}

export function writeLocalReadPosition(accountId: string, chatMid: string, messageId: string, at: string): void {
  sqlite.query(`INSERT INTO chat_local_read_v2 (account_id,chat_mid,message_id,at) VALUES (?,?,?,?)
    ON CONFLICT(account_id,chat_mid) DO UPDATE SET message_id=excluded.message_id,at=excluded.at`)
    .run(accountId, chatMid, messageId, at);
}

export function writeMessagesSyncedAt(accountId: string, chatMid: string, syncedAt: string): void {
  sqlite.query(`INSERT INTO chat_messages_synced_v2 (account_id,chat_mid,synced_at) VALUES (?,?,?)
    ON CONFLICT(account_id,chat_mid) DO UPDATE SET synced_at=excluded.synced_at`)
    .run(accountId, chatMid, syncedAt);
}

export function readChatMeta(accountId: string): Meta {
  const state = sqlite.query("SELECT last_op_revision,chats_synced_at FROM chat_account_state_v2 WHERE account_id=?")
    .get(accountId) as { last_op_revision: string | null; chats_synced_at: string | null } | null;
  const boxOrder = (sqlite.query("SELECT chat_mid FROM chat_box_order_v2 WHERE account_id=? ORDER BY position")
    .all(accountId) as Array<{ chat_mid: string }>).map((row) => row.chat_mid);
  const syncedRows = sqlite.query("SELECT chat_mid,synced_at FROM chat_messages_synced_v2 WHERE account_id=?")
    .all(accountId) as Array<{ chat_mid: string; synced_at: string }>;
  const readRows = sqlite.query("SELECT chat_mid,message_id,at FROM chat_local_read_v2 WHERE account_id=?")
    .all(accountId) as Array<{ chat_mid: string; message_id: string; at: string }>;
  return {
    ...(state?.last_op_revision != null ? { lastOpRevision: state.last_op_revision } : {}),
    ...(state?.chats_synced_at != null ? { chatsSyncedAt: state.chats_synced_at } : {}),
    ...(boxOrder.length ? { boxOrder } : {}),
    ...(syncedRows.length ? { messagesSyncedAt: Object.fromEntries(syncedRows.map((r) => [r.chat_mid, r.synced_at])) } : {}),
    ...(readRows.length ? { localReadUpTo: Object.fromEntries(readRows.map((r) => [r.chat_mid, { messageId: r.message_id, at: r.at }])) } : {}),
  };
}

export function markMessagesReadThrough(accountId: string, chatMid: string, messageId: string): void {
  if (!/^\d+$/.test(messageId)) return;
  const cursor = messageId.replace(/^0+/, "") || "0";
  sqlite.query(`UPDATE chat_messages_v2 SET seen=1
    WHERE account_id=? AND chat_mid=? AND is_my_message=0 AND COALESCE(seen,0)=0
      AND message_id!='' AND message_id NOT GLOB '*[^0-9]*'
      AND (length(CASE WHEN ltrim(message_id,'0')='' THEN '0' ELSE ltrim(message_id,'0') END) < length(?)
        OR (length(CASE WHEN ltrim(message_id,'0')='' THEN '0' ELSE ltrim(message_id,'0') END)=length(?)
          AND CASE WHEN ltrim(message_id,'0')='' THEN '0' ELSE ltrim(message_id,'0') END <= ?))`)
    .run(accountId, chatMid, cursor, cursor, cursor);
}
