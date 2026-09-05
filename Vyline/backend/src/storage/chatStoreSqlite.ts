/**
 * chatStoreSqlite.ts — SQLite-backed local chat/message cache.
 *
 * The previous implementation loaded chatdb.json in full and rewrote the whole
 * object after every burst of mutations. That becomes prohibitively expensive
 * on Raspberry Pi / SD-card deployments as history grows. This store keeps the
 * public chatStore API but uses indexed, transactional SQLite operations so
 * startup and history paging only touch the rows that are actually needed.
 *
 * Existing chatdb.json files are intentionally not migrated. A fresh
 * chatdb.sqlite is created per account; session credentials and other account
 * data remain untouched.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import type { Chat, Message, MessageSnapshot } from "@vyline/types";
import { childLogger } from "../logger.js";
import { accountFile, ensureAccount } from "./accountDirs.js";
import { BackupStorageLimitError } from "./backupLimits.js";
import {
  applyLocalReadWatermark,
  chatDbStorageBytes,
  compareMessageIdsAscending,
  compareMessagesNewestFirst,
  inferredChatKind,
  isUnresolvedLastMessagePreview,
  mergeStoredReadState,
  messageIsAtLeastAsNewAsChat,
  previewForMessage,
  rebuildChatDbRecords,
  shouldPreserveResolvedLastMessagePreview,
  storedChatToChat,
  storedMessageToMessage,
  type ChatDb,
  type ChatDbMergeResult,
  type ChatDbMeta,
  type ChatDbRecords,
  type StoredChat,
  type StoredMessage,
} from "./chatStoreCore.js";

const log = childLogger("chatStore");
const BOOTSTRAP_TOP_CHATS = Number(process.env.VYLINE_BOOTSTRAP_TOP_CHATS ?? 12);
const BOOTSTRAP_MSG_LIMIT = Number(process.env.VYLINE_BOOTSTRAP_MSG_LIMIT ?? 40);
const SCHEMA_VERSION = 1;
const SQLITE_CACHE_KIB = boundedInteger(process.env.VYLINE_SQLITE_CACHE_KIB, 4_096, 1_024, 65_536);
const SQLITE_BUSY_TIMEOUT_MS = boundedInteger(
  process.env.VYLINE_SQLITE_BUSY_TIMEOUT_MS,
  1_000,
  100,
  10_000,
);
const STAGING_QUOTA_CHECK_BATCHES = 10;

const databases = new Map<string, Database>();
const databaseOpenInflight = new Map<string, Promise<Database>>();
const databaseExclusiveTails = new Map<string, Promise<void>>();

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type SqlRow = Record<string, unknown>;

export interface ChatSnapshotProgress {
  phase: "chats" | "messages" | "merge";
  current: number;
  total: number;
}

export type ChatSnapshotProgressCallback = (progress: ChatSnapshotProgress) => void;

type ChatRow = {
  mid: string;
  name: string;
  kind: string;
  has_messages: number;
  last_message_time: number | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  thumbnail_url: string | null;
  unread_count: number | null;
  is_official: number | null;
  restored_history: number | null;
  updated_at: string;
};

type MessageRow = {
  id: string;
  chat_mid: string;
  from_mid: string;
  to_mid: string;
  text: string | null;
  content_type: string;
  created_time: number;
  is_my_message: number;
  content_metadata: string | null;
  read_count: number | null;
  read_by: string | null;
  seen: number | null;
  related_message_id: string | null;
  sticker_animated: number | null;
  sticker_sticky: number | null;
  reactions: string | null;
  saved_at: string;
  message_state: string | null;
  history: string | null;
  revoked_snapshot: string | null;
};

const CHAT_COLUMNS = `
  mid, name, kind, has_messages, last_message_time, last_message_id,
  last_message_preview, thumbnail_url, unread_count, is_official,
  restored_history, updated_at
`;

const MESSAGE_COLUMNS = `
  id, chat_mid, from_mid, to_mid, text, content_type, created_time,
  is_my_message, content_metadata, read_count, read_by, seen,
  related_message_id, sticker_animated, sticker_sticky, reactions,
  saved_at, message_state, history, revoked_snapshot
`;

function dbPath(accountId: string): string {
  return accountFile(accountId, "chatdb.sqlite");
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  if (value == null || value === "") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function boolOrNull(value: boolean | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

function fromChatRow(row: ChatRow): StoredChat {
  return {
    mid: row.mid,
    name: row.name,
    kind: row.kind as Chat["kind"],
    hasMessages: row.has_messages !== 0,
    ...(row.last_message_time != null ? { lastMessageTime: row.last_message_time } : {}),
    ...(row.last_message_id != null ? { lastMessageId: row.last_message_id } : {}),
    ...(row.last_message_preview != null ? { lastMessagePreview: row.last_message_preview } : {}),
    ...(row.thumbnail_url != null ? { thumbnailUrl: row.thumbnail_url } : {}),
    ...(row.unread_count != null ? { unreadCount: row.unread_count } : {}),
    ...(row.is_official != null ? { isOfficial: row.is_official !== 0 } : {}),
    ...(row.restored_history != null ? { restoredHistory: row.restored_history !== 0 } : {}),
    updatedAt: row.updated_at,
  };
}

function fromMessageRow(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    chatMid: row.chat_mid,
    from: row.from_mid,
    to: row.to_mid,
    text: row.text,
    contentType: row.content_type,
    createdTime: row.created_time,
    isMyMessage: row.is_my_message !== 0,
    ...(row.content_metadata != null
      ? { contentMetadata: parseJson(row.content_metadata) ?? null }
      : {}),
    ...(row.read_count != null ? { readCount: row.read_count } : {}),
    ...(row.read_by != null ? { readBy: parseJson<string[]>(row.read_by) ?? [] } : {}),
    ...(row.seen != null ? { seen: row.seen !== 0 } : {}),
    ...(row.related_message_id != null ? { relatedMessageId: row.related_message_id } : {}),
    ...(row.sticker_animated != null ? { stickerAnimated: row.sticker_animated !== 0 } : {}),
    ...(row.sticker_sticky != null ? { stickerSticky: row.sticker_sticky !== 0 } : {}),
    ...(row.reactions != null
      ? { reactions: parseJson<StoredMessage["reactions"]>(row.reactions) ?? [] }
      : {}),
    savedAt: row.saved_at,
    ...(row.message_state != null
      ? { messageState: row.message_state as Message["messageState"] }
      : {}),
    ...(row.history != null ? { history: parseJson<Message["history"]>(row.history) } : {}),
    ...(row.revoked_snapshot != null
      ? { revokedSnapshot: parseJson<MessageSnapshot>(row.revoked_snapshot) }
      : {}),
  };
}

function initializeBaseSchema(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA wal_autocheckpoint = 1000");
  db.exec("PRAGMA journal_size_limit = 33554432");
  db.exec(`PRAGMA cache_size = -${SQLITE_CACHE_KIB}`);
  db.exec("PRAGMA mmap_size = 0");
  db.exec("PRAGMA temp_store = FILE");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      mid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      has_messages INTEGER NOT NULL,
      last_message_time INTEGER,
      last_message_id TEXT,
      last_message_preview TEXT,
      thumbnail_url TEXT,
      unread_count INTEGER,
      is_official INTEGER,
      restored_history INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT NOT NULL,
      chat_mid TEXT NOT NULL,
      from_mid TEXT NOT NULL,
      to_mid TEXT NOT NULL,
      text TEXT,
      content_type TEXT NOT NULL,
      created_time INTEGER NOT NULL,
      is_my_message INTEGER NOT NULL,
      content_metadata TEXT,
      read_count INTEGER,
      read_by TEXT,
      seen INTEGER,
      related_message_id TEXT,
      sticker_animated INTEGER,
      sticker_sticky INTEGER,
      reactions TEXT,
      saved_at TEXT NOT NULL,
      message_state TEXT,
      history TEXT,
      revoked_snapshot TEXT,
      PRIMARY KEY (chat_mid, id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_messages_chat_time
      ON messages (chat_mid, created_time DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_order
      ON messages (
        chat_mid,
        created_time DESC,
        (CASE WHEN id NOT GLOB '*[^0-9]*' THEN length(id) ELSE 0 END) DESC,
        id DESC
      );
    CREATE INDEX IF NOT EXISTS idx_messages_unseen_inbound_numeric
      ON messages (chat_mid, length(id), id)
      WHERE is_my_message = 0
        AND seen IS NOT 1
        AND id NOT GLOB '*[^0-9]*';
    CREATE INDEX IF NOT EXISTS idx_messages_id ON messages (id);

    CREATE TABLE IF NOT EXISTS message_sync (
      chat_mid TEXT PRIMARY KEY,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_read (
      chat_mid TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      at TEXT NOT NULL
    );
  `);
}

function initializeDb(db: Database): void {
  const currentVersion = Number(
    (db.query("PRAGMA user_version").get() as { user_version?: number } | null)?.user_version ?? 0,
  );
  initializeBaseSchema(db);
  if (currentVersion < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

const STAGED_CHAT_COLUMNS = CHAT_COLUMNS;
const STAGED_MESSAGE_COLUMNS = MESSAGE_COLUMNS;

function resetAndInitializeStagingDb(db: Database): void {
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA temp_store = FILE");
  db.exec(`
    DROP TABLE IF EXISTS staged_local_read;
    DROP TABLE IF EXISTS staged_message_sync;
    DROP TABLE IF EXISTS staged_meta;
    DROP TABLE IF EXISTS staged_messages;
    DROP TABLE IF EXISTS staged_chats;

    CREATE TABLE staged_chats (
      mid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      has_messages INTEGER NOT NULL,
      last_message_time INTEGER,
      last_message_id TEXT,
      last_message_preview TEXT,
      thumbnail_url TEXT,
      unread_count INTEGER,
      is_official INTEGER,
      restored_history INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE staged_messages (
      id TEXT NOT NULL,
      chat_mid TEXT NOT NULL,
      from_mid TEXT NOT NULL,
      to_mid TEXT NOT NULL,
      text TEXT,
      content_type TEXT NOT NULL,
      created_time INTEGER NOT NULL,
      is_my_message INTEGER NOT NULL,
      content_metadata TEXT,
      read_count INTEGER,
      read_by TEXT,
      seen INTEGER,
      related_message_id TEXT,
      sticker_animated INTEGER,
      sticker_sticky INTEGER,
      reactions TEXT,
      saved_at TEXT NOT NULL,
      message_state TEXT,
      history TEXT,
      revoked_snapshot TEXT,
      PRIMARY KEY (chat_mid, id)
    ) WITHOUT ROWID;

    CREATE TABLE staged_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE staged_message_sync (
      chat_mid TEXT PRIMARY KEY,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE staged_local_read (
      chat_mid TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      at TEXT NOT NULL
    );
  `);
}

function normalizedSelectedMids(selectedMids?: Iterable<string>): string[] | undefined {
  if (!selectedMids) return undefined;
  const mids = [...new Set([...selectedMids].filter((mid) => typeof mid === "string" && mid))];
  return mids.length > 0 ? mids.sort() : undefined;
}

function installSelectedMids(db: Database, selectedMids?: Iterable<string>): boolean {
  db.exec("DROP TABLE IF EXISTS temp.vyline_selected_mids");
  const mids = normalizedSelectedMids(selectedMids);
  if (!mids) return false;
  db.exec("CREATE TEMP TABLE vyline_selected_mids (mid TEXT PRIMARY KEY) WITHOUT ROWID");
  const insert = db.query("INSERT INTO temp.vyline_selected_mids(mid) VALUES (?)");
  for (const mid of mids) insert.run(mid);
  return true;
}

function clearSelectedMids(db: Database): void {
  db.exec("DROP TABLE IF EXISTS temp.vyline_selected_mids");
}

function attachedTableExists(db: Database, table: string): boolean {
  return Boolean(
    db
      .query(
        "SELECT 1 AS present FROM vyline_stage.sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(table),
  );
}

function assertAttachedTableColumns(
  db: Database,
  table: string,
  required: readonly string[],
): void {
  if (!attachedTableExists(db, table)) throw new Error(`Invalid chat snapshot: missing ${table}`);
  const rows = db.query(`PRAGMA vyline_stage.table_info(${table})`).all() as Array<{
    name: string;
  }>;
  const actual = new Set(rows.map((row) => row.name));
  const missing = required.filter((column) => !actual.has(column));
  if (missing.length > 0)
    throw new Error(`Invalid chat snapshot: ${table} is missing ${missing.join(", ")}`);
}

async function getDbUnblocked(accountId: string): Promise<Database> {
  const existing = databases.get(accountId);
  if (existing) return existing;
  const opening = databaseOpenInflight.get(accountId);
  if (opening) return opening;

  const task = (async () => {
    ensureAccount(accountId);
    const path = dbPath(accountId);
    await mkdir(dirname(path), { recursive: true });
    const db = new Database(path, { create: true });
    try {
      await initializeDb(db);
      databases.set(accountId, db);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  })();
  databaseOpenInflight.set(accountId, task);
  try {
    return await task;
  } finally {
    if (databaseOpenInflight.get(accountId) === task) databaseOpenInflight.delete(accountId);
  }
}

async function getDb(accountId: string): Promise<Database> {
  const barrier = databaseExclusiveTails.get(accountId);
  if (barrier) await barrier;
  return getDbUnblocked(accountId);
}

async function withExclusiveAccountDb<T>(
  accountId: string,
  work: (db: Database) => Promise<T>,
): Promise<T> {
  const previous = databaseExclusiveTails.get(accountId) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => held);
  databaseExclusiveTails.set(accountId, tail);
  await previous.catch(() => undefined);
  try {
    return await work(await getDbUnblocked(accountId));
  } finally {
    release();
    if (databaseExclusiveTails.get(accountId) === tail) databaseExclusiveTails.delete(accountId);
  }
}

function withTransaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve original error */
    }
    throw error;
  }
}

function getMetaValue<T>(db: Database, key: string): T | undefined {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
  return row ? parseJson<T>(row.value) : undefined;
}

function setMetaValue(db: Database, key: string, value: unknown): void {
  db.query(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

function getChatRecord(db: Database, mid: string): StoredChat | undefined {
  const row = db
    .query(`SELECT ${CHAT_COLUMNS} FROM chats WHERE mid = ?`)
    .get(mid) as ChatRow | null;
  return row ? fromChatRow(row) : undefined;
}

function writeChatRecord(db: Database, chat: StoredChat): void {
  db.query(`
    INSERT INTO chats (
      mid, name, kind, has_messages, last_message_time, last_message_id,
      last_message_preview, thumbnail_url, unread_count, is_official,
      restored_history, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mid) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      has_messages = excluded.has_messages,
      last_message_time = excluded.last_message_time,
      last_message_id = excluded.last_message_id,
      last_message_preview = excluded.last_message_preview,
      thumbnail_url = excluded.thumbnail_url,
      unread_count = excluded.unread_count,
      is_official = excluded.is_official,
      restored_history = excluded.restored_history,
      updated_at = excluded.updated_at
  `).run(
    chat.mid,
    chat.name,
    chat.kind,
    chat.hasMessages ? 1 : 0,
    chat.lastMessageTime ?? null,
    chat.lastMessageId ?? null,
    chat.lastMessagePreview ?? null,
    chat.thumbnailUrl ?? null,
    chat.unreadCount ?? null,
    boolOrNull(chat.isOfficial),
    boolOrNull(chat.restoredHistory),
    chat.updatedAt,
  );
}

function getMessageRecord(
  db: Database,
  chatMid: string,
  messageId: string,
): StoredMessage | undefined {
  const row = db
    .query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_mid = ? AND id = ?`)
    .get(chatMid, messageId) as MessageRow | null;
  return row ? fromMessageRow(row) : undefined;
}

function writeMessageRecord(db: Database, message: StoredMessage): void {
  db.query(`
    INSERT INTO messages (
      id, chat_mid, from_mid, to_mid, text, content_type, created_time,
      is_my_message, content_metadata, read_count, read_by, seen,
      related_message_id, sticker_animated, sticker_sticky, reactions,
      saved_at, message_state, history, revoked_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_mid, id) DO UPDATE SET
      from_mid = excluded.from_mid,
      to_mid = excluded.to_mid,
      text = excluded.text,
      content_type = excluded.content_type,
      created_time = excluded.created_time,
      is_my_message = excluded.is_my_message,
      content_metadata = excluded.content_metadata,
      read_count = excluded.read_count,
      read_by = excluded.read_by,
      seen = excluded.seen,
      related_message_id = excluded.related_message_id,
      sticker_animated = excluded.sticker_animated,
      sticker_sticky = excluded.sticker_sticky,
      reactions = excluded.reactions,
      saved_at = excluded.saved_at,
      message_state = excluded.message_state,
      history = excluded.history,
      revoked_snapshot = excluded.revoked_snapshot
  `).run(
    message.id,
    message.chatMid,
    message.from,
    message.to,
    message.text,
    message.contentType,
    message.createdTime,
    message.isMyMessage ? 1 : 0,
    jsonOrNull(message.contentMetadata),
    message.readCount ?? null,
    jsonOrNull(message.readBy),
    boolOrNull(message.seen),
    message.relatedMessageId ?? null,
    boolOrNull(message.stickerAnimated),
    boolOrNull(message.stickerSticky),
    jsonOrNull(message.reactions),
    message.savedAt,
    message.messageState ?? null,
    jsonOrNull(message.history),
    jsonOrNull(message.revokedSnapshot),
  );
}

function latestStoredMessage(db: Database, chatMid: string): StoredMessage | undefined {
  const row = db
    .query(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages
      WHERE chat_mid = ?
      ORDER BY created_time DESC,
        CASE WHEN id NOT GLOB '*[^0-9]*' THEN length(id) ELSE 0 END DESC,
        id DESC
      LIMIT 1
    `)
    .get(chatMid) as MessageRow | null;
  return row ? fromMessageRow(row) : undefined;
}

function getLocalRead(
  db: Database,
  chatMid: string,
): { messageId: string; at: string } | undefined {
  const row = db.query("SELECT message_id, at FROM local_read WHERE chat_mid = ?").get(chatMid) as {
    message_id: string;
    at: string;
  } | null;
  return row ? { messageId: row.message_id, at: row.at } : undefined;
}

function applyLocalReadWatermarkSql(db: Database, chatMid: string, messageId: string): void {
  if (!/^\d+$/.test(messageId)) return;
  db.query(`
    UPDATE messages
    SET seen = 1
    WHERE chat_mid = ?
      AND is_my_message = 0
      AND seen IS NOT 1
      AND id NOT GLOB '*[^0-9]*'
      AND (
        length(id) < ? OR
        (length(id) = ? AND id <= ?)
      )
  `).run(chatMid, messageId.length, messageId.length, messageId);
}

function snapshotFromStoredMessage(stored: StoredMessage): MessageSnapshot {
  const {
    savedAt: _savedAt,
    history: _history,
    revokedSnapshot: _revokedSnapshot,
    messageState,
    ...snapshot
  } = stored;
  return { ...snapshot, ...(messageState != null ? { messageState } : {}) };
}

/** Open the SQLite file and schema only; no full-history hydration is performed. */
export async function warmAccountCache(accountId: string): Promise<void> {
  await getDb(accountId);
  log.debug({ accountId }, "sqlite chat cache ready");
}

export async function upsertChats(
  accountId: string,
  chats: StoredChat[],
  meta?: Partial<Pick<ChatDbMeta, "boxOrder" | "lastOpRevision">>,
): Promise<void> {
  const db = await getDb(accountId);
  withTransaction(db, () => {
    for (const chat of chats) {
      const existing = getChatRecord(db, chat.mid);
      if (!existing) {
        writeChatRecord(db, chat);
        continue;
      }

      const incomingTime = chat.lastMessageTime ?? 0;
      const existingTime = existing.lastMessageTime ?? 0;
      const keepExistingLast = existingTime > incomingTime;
      const keepResolvedPreview = shouldPreserveResolvedLastMessagePreview(existing, chat);
      const incomingNameIsFallback =
        !chat.name || chat.name === chat.mid || chat.name === "(No Name)";
      const incomingKindIsFallback = chat.kind === "unknown";

      writeChatRecord(db, {
        ...existing,
        ...chat,
        name: incomingNameIsFallback && existing.name ? existing.name : chat.name,
        kind: incomingKindIsFallback ? existing.kind : chat.kind,
        hasMessages: existing.hasMessages || chat.hasMessages,
        lastMessageTime: Math.max(existingTime, incomingTime),
        ...(keepExistingLast && existing.lastMessageId
          ? { lastMessageId: existing.lastMessageId }
          : chat.lastMessageId
            ? { lastMessageId: chat.lastMessageId }
            : existing.lastMessageId
              ? { lastMessageId: existing.lastMessageId }
              : {}),
        ...((keepExistingLast || keepResolvedPreview) && existing.lastMessagePreview
          ? { lastMessagePreview: existing.lastMessagePreview }
          : chat.lastMessagePreview
            ? { lastMessagePreview: chat.lastMessagePreview }
            : existing.lastMessagePreview
              ? { lastMessagePreview: existing.lastMessagePreview }
              : {}),
        ...(existing.restoredHistory || chat.restoredHistory ? { restoredHistory: true } : {}),
      });
    }
    if (meta?.boxOrder) setMetaValue(db, "boxOrder", meta.boxOrder);
    if (meta?.lastOpRevision != null) setMetaValue(db, "lastOpRevision", meta.lastOpRevision);
    setMetaValue(db, "chatsSyncedAt", new Date().toISOString());
  });
}

export async function upsertMessages(
  accountId: string,
  chatMid: string,
  messages: StoredMessage[],
): Promise<void> {
  const db = await getDb(accountId);
  withTransaction(db, () => {
    let latestIncoming: StoredMessage | undefined;
    for (const message of messages) {
      if (!latestIncoming || compareMessagesNewestFirst(message, latestIncoming) < 0)
        latestIncoming = message;
      const prev = getMessageRecord(db, chatMid, message.id);
      const prevRevoked =
        Boolean(prev?.revokedSnapshot) || Boolean(prev?.messageState?.startsWith("revoked"));
      const incomingRevoked =
        Boolean(message.revokedSnapshot) || Boolean(message.messageState?.startsWith("revoked"));
      const next: StoredMessage = {
        ...message,
        history: prev?.history?.length ? prev.history : message.history,
        ...mergeStoredReadState(prev, message),
      };
      const revokedSnapshot = prev?.revokedSnapshot ?? message.revokedSnapshot;
      if (revokedSnapshot) next.revokedSnapshot = revokedSnapshot;
      if (prevRevoked && !incomingRevoked) {
        next.messageState =
          prev?.messageState ?? (prev?.isMyMessage ? "revoked-by-self" : "revoked-by-other");
        next.contentType = prev ? prev.contentType : message.contentType;
        next.text = prev ? prev.text : message.text;
      }
      writeMessageRecord(db, next);
    }

    const localRead = getLocalRead(db, chatMid);
    if (localRead) applyLocalReadWatermarkSql(db, chatMid, localRead.messageId);

    const chat = getChatRecord(db, chatMid);
    const latestStored = latestIncoming
      ? getMessageRecord(db, chatMid, latestIncoming.id)
      : undefined;
    if (chat && latestStored && messageIsAtLeastAsNewAsChat(latestStored, chat)) {
      const incomingPreview = previewForMessage(latestStored);
      const incomingCursor: StoredChat = {
        ...chat,
        lastMessageId: latestStored.id,
        lastMessageTime: latestStored.createdTime,
        lastMessagePreview: incomingPreview,
      };
      const keepResolvedPreview = shouldPreserveResolvedLastMessagePreview(chat, incomingCursor);
      writeChatRecord(db, {
        ...chat,
        lastMessageId: latestStored.id,
        lastMessageTime: latestStored.createdTime,
        ...(!keepResolvedPreview ? { lastMessagePreview: incomingPreview } : {}),
        hasMessages: true,
        updatedAt: new Date().toISOString(),
      });
    }

    db.query(`
      INSERT INTO message_sync(chat_mid, synced_at) VALUES (?, ?)
      ON CONFLICT(chat_mid) DO UPDATE SET synced_at = excluded.synced_at
    `).run(chatMid, new Date().toISOString());
  });
}

export async function markStoredMessagesReadThrough(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<void> {
  const db = await getDb(accountId);
  withTransaction(db, () => {
    const current = getLocalRead(db, chatMid)?.messageId;
    try {
      if (current && BigInt(current) >= BigInt(messageId)) return;
    } catch {
      /* replace malformed cursor */
    }
    const now = new Date().toISOString();
    db.query(`
      INSERT INTO local_read(chat_mid, message_id, at) VALUES (?, ?, ?)
      ON CONFLICT(chat_mid) DO UPDATE SET message_id = excluded.message_id, at = excluded.at
    `).run(chatMid, messageId, now);
    applyLocalReadWatermarkSql(db, chatMid, messageId);
    const chat = getChatRecord(db, chatMid);
    if (chat && chat.unreadCount !== 0) writeChatRecord(db, { ...chat, unreadCount: 0 });
  });
}

export async function markMessageRevoked(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<void> {
  const db = await getDb(accountId);
  withTransaction(db, () => {
    const stored = getMessageRecord(db, chatMid, messageId);
    if (!stored) return;
    stored.revokedSnapshot = stored.revokedSnapshot ?? snapshotFromStoredMessage(stored);
    const prevState = stored.messageState ?? "normal";
    const entry = {
      state: prevState,
      text: stored.text,
      contentType: stored.contentType,
      updatedTime: Date.now(),
    };
    stored.messageState = stored.isMyMessage ? "revoked-by-self" : "revoked-by-other";
    stored.history = [...(stored.history ?? []), entry];
    stored.contentType = "UNSENT";
    stored.text = null;
    writeMessageRecord(db, stored);
    const chat = getChatRecord(db, chatMid);
    if (chat?.lastMessageId === messageId)
      writeChatRecord(db, { ...chat, lastMessagePreview: previewForMessage(stored) });
  });
}

export async function restoreRevokedMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<{ text: string | null; contentType: string } | null> {
  const db = await getDb(accountId);
  return withTransaction(db, () => {
    const stored = getMessageRecord(db, chatMid, messageId);
    if (!stored) return null;
    const snapshot = stored.revokedSnapshot;
    const lastNormal = stored.history?.length
      ? [...stored.history].reverse().find((h) => h.state === "normal" || h.state === "edited")
      : undefined;
    if (!snapshot && !lastNormal) return null;
    const restoredText = snapshot?.text ?? lastNormal?.text ?? null;
    const restoredContentType =
      snapshot?.contentType ?? lastNormal?.contentType ?? stored.contentType;
    const entry = {
      state: "normal" as const,
      text: stored.text,
      contentType: stored.contentType,
      updatedTime: Date.now(),
    };
    stored.messageState = (snapshot?.messageState ??
      lastNormal?.state ??
      "normal") as Message["messageState"];
    stored.history = [...(stored.history ?? []), entry];
    if (snapshot) stored.revokedSnapshot = snapshot;
    stored.text = restoredText;
    stored.contentType = restoredContentType;
    if (snapshot) {
      if (snapshot.contentMetadata !== undefined) stored.contentMetadata = snapshot.contentMetadata;
      if (snapshot.readCount !== undefined) stored.readCount = snapshot.readCount;
      if (snapshot.readBy !== undefined) stored.readBy = snapshot.readBy;
      if (snapshot.seen !== undefined) stored.seen = snapshot.seen;
      if (snapshot.relatedMessageId !== undefined)
        stored.relatedMessageId = snapshot.relatedMessageId;
      if (snapshot.stickerAnimated !== undefined) stored.stickerAnimated = snapshot.stickerAnimated;
      if (snapshot.stickerSticky !== undefined) stored.stickerSticky = snapshot.stickerSticky;
      if (snapshot.reactions !== undefined) stored.reactions = snapshot.reactions;
    }
    writeMessageRecord(db, stored);
    const chat = getChatRecord(db, chatMid);
    if (chat?.lastMessageId === messageId)
      writeChatRecord(db, { ...chat, lastMessagePreview: previewForMessage(stored) });
    return { text: restoredText, contentType: restoredContentType };
  });
}

export async function getMessageHistory(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<Message["history"]> {
  const db = await getDb(accountId);
  return getMessageRecord(db, chatMid, messageId)?.history ?? [];
}

export async function getMessages(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number },
): Promise<StoredMessage[]> {
  const db = await getDb(accountId);
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];

  let rows: MessageRow[];
  const beforeTime = opts?.beforeDeliveredTime;
  const beforeId = opts?.beforeMessageId;
  const order = `ORDER BY created_time DESC,
    CASE WHEN id NOT GLOB '*[^0-9]*' THEN length(id) ELSE 0 END DESC,
    id DESC`;

  if (beforeTime == null) {
    rows = db
      .query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_mid = ? ${order} LIMIT ?`)
      .all(chatMid, safeLimit) as MessageRow[];
  } else if (!beforeId) {
    rows = db
      .query(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_mid = ? AND created_time < ? ${order} LIMIT ?`,
      )
      .all(chatMid, beforeTime, safeLimit) as MessageRow[];
  } else if (/^\d+$/.test(beforeId)) {
    rows = db
      .query(`
        SELECT ${MESSAGE_COLUMNS}
        FROM messages
        WHERE chat_mid = ? AND (
          created_time < ? OR
          (created_time = ? AND (
            (id NOT GLOB '*[^0-9]*' AND (
              length(id) < ? OR (length(id) = ? AND id < ?)
            )) OR
            (id GLOB '*[^0-9]*' AND id < ?)
          ))
        )
        ${order}
        LIMIT ?
      `)
      .all(
        chatMid,
        beforeTime,
        beforeTime,
        beforeId.length,
        beforeId.length,
        beforeId,
        beforeId,
        safeLimit,
      ) as MessageRow[];
  } else {
    rows = db
      .query(`
        SELECT ${MESSAGE_COLUMNS}
        FROM messages
        WHERE chat_mid = ? AND (
          created_time < ? OR (created_time = ? AND id < ?)
        )
        ${order}
        LIMIT ?
      `)
      .all(chatMid, beforeTime, beforeTime, beforeId, safeLimit) as MessageRow[];
  }
  return rows.map(fromMessageRow).sort(compareMessagesNewestFirst).slice(0, safeLimit);
}

export async function findStoredMessageById(
  accountId: string,
  messageId: string,
): Promise<{ chatMid: string; message: StoredMessage } | null> {
  const db = await getDb(accountId);
  const row = db
    .query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ? LIMIT 1`)
    .get(messageId) as MessageRow | null;
  return row ? { chatMid: row.chat_mid, message: fromMessageRow(row) } : null;
}

export async function getStoredChats(accountId: string): Promise<Chat[]> {
  const db = await getDb(accountId);
  const rows = db.query(`SELECT ${CHAT_COLUMNS} FROM chats`).all() as ChatRow[];
  if (rows.length === 0) return [];
  const chats = rows.map(fromChatRow);
  const order = getMetaValue<string[]>(db, "boxOrder") ?? [];
  const byMid = new Map(chats.map((chat) => [chat.mid, chat]));
  const result: Chat[] = [];
  const seen = new Set<string>();
  for (const mid of order) {
    const chat = byMid.get(mid);
    if (!chat) continue;
    result.push(storedChatToChat(chat));
    seen.add(mid);
  }
  const tail = chats
    .filter((chat) => !seen.has(chat.mid))
    .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
  for (const chat of tail) result.push(storedChatToChat(chat));
  return result;
}

export async function getStoredMessages(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number },
): Promise<Message[]> {
  return (await getMessages(accountId, chatMid, limit, opts)).map(storedMessageToMessage);
}

export type BootstrapPayload = {
  chats: Chat[];
  messagesByChat: Record<string, Message[]>;
  syncedAt: string | null;
  chatsSyncedAt: string | null;
};

export async function getBootstrapPayload(accountId: string): Promise<BootstrapPayload> {
  const db = await getDb(accountId);
  const chats = await getStoredChats(accountId);
  const messagesByChat: Record<string, Message[]> = {};
  for (const mid of chats
    .filter((chat) => chat.hasMessages)
    .slice(0, BOOTSTRAP_TOP_CHATS)
    .map((chat) => chat.mid)) {
    messagesByChat[mid] = await getStoredMessages(accountId, mid, BOOTSTRAP_MSG_LIMIT);
  }
  const chatsSyncedAt = getMetaValue<string>(db, "chatsSyncedAt") ?? null;
  return { chats, messagesByChat, syncedAt: chatsSyncedAt, chatsSyncedAt };
}

export async function getCacheMeta(accountId: string): Promise<ChatDbMeta> {
  const db = await getDb(accountId);
  return readMeta(db);
}

function readMeta(db: Database): ChatDbMeta {
  const meta: ChatDbMeta = {};
  const lastOpRevision = getMetaValue<string>(db, "lastOpRevision");
  const boxOrder = getMetaValue<string[]>(db, "boxOrder");
  const chatsSyncedAt = getMetaValue<string>(db, "chatsSyncedAt");
  if (lastOpRevision != null) meta.lastOpRevision = lastOpRevision;
  if (boxOrder != null) meta.boxOrder = boxOrder;
  if (chatsSyncedAt != null) meta.chatsSyncedAt = chatsSyncedAt;

  const syncRows = db.query("SELECT chat_mid, synced_at FROM message_sync").all() as Array<{
    chat_mid: string;
    synced_at: string;
  }>;
  if (syncRows.length) {
    meta.messagesSyncedAt = Object.fromEntries(
      syncRows.map((row) => [row.chat_mid, row.synced_at]),
    );
  }
  const readRows = db.query("SELECT chat_mid, message_id, at FROM local_read").all() as Array<{
    chat_mid: string;
    message_id: string;
    at: string;
  }>;
  if (readRows.length) {
    meta.localReadUpTo = Object.fromEntries(
      readRows.map((row) => [row.chat_mid, { messageId: row.message_id, at: row.at }]),
    );
  }
  return meta;
}

export async function saveBoxOrder(accountId: string, boxOrder: string[]): Promise<void> {
  const db = await getDb(accountId);
  setMetaValue(db, "boxOrder", boxOrder);
}

export async function exportChatDb(accountId: string): Promise<ChatDb> {
  const db = await getDb(accountId);
  const chats: ChatDb["chats"] = {};
  for (const row of db.query(`SELECT ${CHAT_COLUMNS} FROM chats`).all() as ChatRow[]) {
    const chat = fromChatRow(row);
    chats[chat.mid] = chat;
  }
  const messages: ChatDb["messages"] = {};
  for (const row of db
    .query(`SELECT ${MESSAGE_COLUMNS} FROM messages ORDER BY chat_mid, created_time, id`)
    .all() as MessageRow[]) {
    const message = fromMessageRow(row);
    (messages[message.chatMid] ??= {})[message.id] = message;
  }
  return { meta: readMeta(db), chats, messages };
}

/** Bounded compatibility iterator for callers that still need StoredChat objects. */
export async function* iterateStoredChats(
  accountId: string,
  selectedMids?: Iterable<string>,
  batchSize = 500,
): AsyncGenerator<StoredChat> {
  const db = await getDb(accountId);
  const safeBatchSize = boundedInteger(String(batchSize), 500, 1, 2_000);
  const selected = normalizedSelectedMids(selectedMids);
  let yieldedSincePause = 0;

  if (selected) {
    const query = db.query(`SELECT ${CHAT_COLUMNS} FROM chats WHERE mid = ?`);
    for (const mid of selected) {
      const row = query.get(mid) as ChatRow | null;
      if (row) yield fromChatRow(row);
      if (row && ++yieldedSincePause >= safeBatchSize) {
        yieldedSincePause = 0;
        await yieldToEventLoop();
      }
    }
    return;
  }

  let afterMid = "";
  for (;;) {
    const rows = db
      .query(`SELECT ${CHAT_COLUMNS} FROM chats WHERE mid > ? ORDER BY mid LIMIT ?`)
      .all(afterMid, safeBatchSize) as ChatRow[];
    if (rows.length === 0) return;
    for (const row of rows) yield fromChatRow(row);
    afterMid = rows[rows.length - 1]!.mid;
    await yieldToEventLoop();
  }
}

/** Bounded compatibility iterator that never materializes the complete history. */
export async function* iterateStoredMessages(
  accountId: string,
  selectedMids?: Iterable<string>,
  batchSize = 500,
): AsyncGenerator<StoredMessage> {
  const db = await getDb(accountId);
  const safeBatchSize = boundedInteger(String(batchSize), 500, 1, 2_000);
  const selected = normalizedSelectedMids(selectedMids);

  if (selected) {
    for (const chatMid of selected) {
      let afterId = "";
      for (;;) {
        const rows = db
          .query(`
            SELECT ${MESSAGE_COLUMNS}
            FROM messages
            WHERE chat_mid = ? AND id > ?
            ORDER BY id
            LIMIT ?
          `)
          .all(chatMid, afterId, safeBatchSize) as MessageRow[];
        if (rows.length === 0) break;
        for (const row of rows) yield fromMessageRow(row);
        afterId = rows[rows.length - 1]!.id;
        await yieldToEventLoop();
      }
    }
    return;
  }

  let afterChatMid = "";
  let afterId = "";
  for (;;) {
    const rows = db
      .query(`
        SELECT ${MESSAGE_COLUMNS}
        FROM messages
        WHERE chat_mid > ? OR (chat_mid = ? AND id > ?)
        ORDER BY chat_mid, id
        LIMIT ?
      `)
      .all(afterChatMid, afterChatMid, afterId, safeBatchSize) as MessageRow[];
    if (rows.length === 0) return;
    for (const row of rows) yield fromMessageRow(row);
    const last = rows[rows.length - 1]!;
    afterChatMid = last.chat_mid;
    afterId = last.id;
    await yieldToEventLoop();
  }
}

function runStagingTransaction(db: Database, work: () => void): void {
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Create a normalized SQLite snapshot without constructing ChatDb JSON. Source
 * reads and destination writes are bounded, with an event-loop yield per batch.
 */
export async function createAccountChatSnapshot(
  accountId: string,
  targetPath: string,
  selectedMids?: Iterable<string>,
  onProgress?: ChatSnapshotProgressCallback,
): Promise<{ chats: number; messages: number }> {
  if (resolve(targetPath) === resolve(dbPath(accountId)))
    throw new Error("Chat snapshot target must differ from the live database");
  await mkdir(dirname(targetPath), { recursive: true });

  return withExclusiveAccountDb(accountId, async (source) => {
    const selected = normalizedSelectedMids(selectedMids);
    const hasSelection = installSelectedMids(source, selected);
    const selectionJoin = hasSelection
      ? "JOIN temp.vyline_selected_mids selected ON selected.mid = source_rows.mid"
      : "";
    const messageSelectionJoin = hasSelection
      ? "JOIN temp.vyline_selected_mids selected ON selected.mid = source_rows.chat_mid"
      : "";
    const target = new Database(targetPath, { create: true });
    try {
      resetAndInitializeStagingDb(target);
      const chatTotal = Number(
        (
          source
            .query(`SELECT count(*) AS count FROM chats source_rows ${selectionJoin}`)
            .get() as { count?: number } | null
        )?.count ?? 0,
      );
      const messageTotal = Number(
        (
          source
            .query(`SELECT count(*) AS count FROM messages source_rows ${messageSelectionJoin}`)
            .get() as { count?: number } | null
        )?.count ?? 0,
      );

      const insertChat = target.query(`
        INSERT INTO staged_chats (${STAGED_CHAT_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMessage = target.query(`
        INSERT INTO staged_messages (${STAGED_MESSAGE_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      if (!hasSelection) {
        const insertMeta = target.query("INSERT INTO staged_meta(key, value) VALUES (?, ?)");
        for (const row of source.query("SELECT key, value FROM meta").all() as Array<{
          key: string;
          value: string;
        }>)
          insertMeta.run(row.key, row.value);
      }
      target
        .query("INSERT OR REPLACE INTO staged_meta(key, value) VALUES ('snapshot_format', ?)")
        .run("vyline-normalized-v1");

      const syncJoin = hasSelection
        ? "JOIN temp.vyline_selected_mids selected ON selected.mid = source_rows.chat_mid"
        : "";
      const insertSync = target.query(
        "INSERT INTO staged_message_sync(chat_mid, synced_at) VALUES (?, ?)",
      );
      for (const row of source
        .query(
          `SELECT source_rows.chat_mid, source_rows.synced_at FROM message_sync source_rows ${syncJoin}`,
        )
        .all() as Array<{ chat_mid: string; synced_at: string }>)
        insertSync.run(row.chat_mid, row.synced_at);

      const insertRead = target.query(
        "INSERT INTO staged_local_read(chat_mid, message_id, at) VALUES (?, ?, ?)",
      );
      for (const row of source
        .query(
          `SELECT source_rows.chat_mid, source_rows.message_id, source_rows.at FROM local_read source_rows ${syncJoin}`,
        )
        .all() as Array<{ chat_mid: string; message_id: string; at: string }>)
        insertRead.run(row.chat_mid, row.message_id, row.at);

      let copiedChats = 0;
      let afterMid = "";
      onProgress?.({ phase: "chats", current: 0, total: chatTotal });
      for (;;) {
        const rows = source
          .query(`
            SELECT source_rows.*
            FROM chats source_rows
            ${selectionJoin}
            WHERE source_rows.mid > ?
            ORDER BY source_rows.mid
            LIMIT 500
          `)
          .all(afterMid) as ChatRow[];
        if (rows.length === 0) break;
        runStagingTransaction(target, () => {
          for (const row of rows)
            insertChat.run(
              row.mid,
              row.name,
              row.kind,
              row.has_messages,
              row.last_message_time,
              row.last_message_id,
              row.last_message_preview,
              row.thumbnail_url,
              row.unread_count,
              row.is_official,
              row.restored_history,
              row.updated_at,
            );
        });
        copiedChats += rows.length;
        afterMid = rows[rows.length - 1]!.mid;
        onProgress?.({ phase: "chats", current: copiedChats, total: chatTotal });
        await yieldToEventLoop();
      }

      let copiedMessages = 0;
      let afterChatMid = "";
      let afterMessageId = "";
      onProgress?.({ phase: "messages", current: 0, total: messageTotal });
      for (;;) {
        const rows = source
          .query(`
            SELECT source_rows.*
            FROM messages source_rows
            ${messageSelectionJoin}
            WHERE source_rows.chat_mid > ?
               OR (source_rows.chat_mid = ? AND source_rows.id > ?)
            ORDER BY source_rows.chat_mid, source_rows.id
            LIMIT 500
          `)
          .all(afterChatMid, afterChatMid, afterMessageId) as MessageRow[];
        if (rows.length === 0) break;
        runStagingTransaction(target, () => {
          for (const row of rows)
            insertMessage.run(
              row.id,
              row.chat_mid,
              row.from_mid,
              row.to_mid,
              row.text,
              row.content_type,
              row.created_time,
              row.is_my_message,
              row.content_metadata,
              row.read_count,
              row.read_by,
              row.seen,
              row.related_message_id,
              row.sticker_animated,
              row.sticker_sticky,
              row.reactions,
              row.saved_at,
              row.message_state,
              row.history,
              row.revoked_snapshot,
            );
        });
        copiedMessages += rows.length;
        const last = rows[rows.length - 1]!;
        afterChatMid = last.chat_mid;
        afterMessageId = last.id;
        onProgress?.({ phase: "messages", current: copiedMessages, total: messageTotal });
        await yieldToEventLoop();
      }

      target
        .query("INSERT OR REPLACE INTO staged_meta(key, value) VALUES ('snapshot_complete', '1')")
        .run();
      return { chats: copiedChats, messages: copiedMessages };
    } finally {
      clearSelectedMids(source);
      target.close();
    }
  });
}

/**
 * O(1) storage accounting based on allocated SQLite pages that currently hold
 * data. Freelist pages are excluded because SQLite can reuse them without
 * growing the database. Retained WAL capacity is managed separately.
 */
function sqliteUsedStorageBytes(db: Database): number {
  const pageCount = Number(
    (db.query("PRAGMA page_count").get() as { page_count?: number } | null)?.page_count ?? 0,
  );
  const freelistCount = Number(
    (db.query("PRAGMA freelist_count").get() as { freelist_count?: number } | null)
      ?.freelist_count ?? 0,
  );
  const pageSize = Number(
    (db.query("PRAGMA page_size").get() as { page_size?: number } | null)?.page_size ?? 0,
  );
  if (![pageCount, freelistCount, pageSize].every(Number.isFinite)) return 0;
  return Math.max(0, pageCount - freelistCount) * Math.max(0, pageSize);
}

function assertWithinStorageQuota(db: Database, maxStorageBytes: number): void {
  if (Number.isFinite(maxStorageBytes) && sqliteUsedStorageBytes(db) > maxStorageBytes) {
    throw new BackupStorageLimitError();
  }
}

export async function importChatDb(
  accountId: string,
  data: Pick<ChatDb, "meta" | "chats" | "messages">,
): Promise<{ chats: number; messages: number }> {
  const current = await exportChatDb(accountId);
  let chatCount = 0;
  let messageCount = 0;
  for (const [mid, chat] of Object.entries(data.chats ?? {})) {
    current.chats[mid] = chat;
    chatCount++;
  }
  for (const [chatMid, byChat] of Object.entries(data.messages ?? {})) {
    const target = current.messages[chatMid] ?? {};
    for (const [id, message] of Object.entries(byChat)) {
      target[id] = message;
      messageCount++;
    }
    current.messages[chatMid] = target;
  }
  for (const [chatMid, messages] of Object.entries(current.messages))
    applyLocalReadWatermark(messages, current.meta.localReadUpTo?.[chatMid]?.messageId);
  if (data.meta?.boxOrder) current.meta.boxOrder = data.meta.boxOrder;
  if (data.meta?.chatsSyncedAt) current.meta.chatsSyncedAt = data.meta.chatsSyncedAt;
  current.meta.messagesSyncedAt = current.meta.messagesSyncedAt ?? {};
  for (const [chatMid, iso] of Object.entries(data.meta?.messagesSyncedAt ?? {}))
    current.meta.messagesSyncedAt[chatMid] = iso;
  rebuildChatDbRecords(current);
  const db = await getDb(accountId);
  replaceDatabaseRecords(db, current);
  return { chats: chatCount, messages: messageCount };
}

function replaceDatabaseRecords(db: Database, data: ChatDb): void {
  withTransaction(db, () => {
    db.exec(
      "DELETE FROM messages; DELETE FROM chats; DELETE FROM message_sync; DELETE FROM local_read; DELETE FROM meta;",
    );
    for (const chat of Object.values(data.chats)) writeChatRecord(db, chat);
    for (const messages of Object.values(data.messages))
      for (const message of Object.values(messages)) writeMessageRecord(db, message);
    if (data.meta.lastOpRevision != null)
      setMetaValue(db, "lastOpRevision", data.meta.lastOpRevision);
    if (data.meta.boxOrder) setMetaValue(db, "boxOrder", data.meta.boxOrder);
    if (data.meta.chatsSyncedAt) setMetaValue(db, "chatsSyncedAt", data.meta.chatsSyncedAt);
    for (const [mid, iso] of Object.entries(data.meta.messagesSyncedAt ?? {}))
      db.query("INSERT INTO message_sync(chat_mid, synced_at) VALUES (?, ?)").run(mid, iso);
    for (const [mid, read] of Object.entries(data.meta.localReadUpTo ?? {}))
      db.query("INSERT INTO local_read(chat_mid, message_id, at) VALUES (?, ?, ?)").run(
        mid,
        read.messageId,
        read.at,
      );
  });
}

function mergeImportedRecordsSql(db: Database, incoming: ChatDbRecords): ChatDbMergeResult {
  let importedChats = 0;
  let skippedChats = 0;
  let importedMessages = 0;
  let skippedMessages = 0;
  const affected = new Set<string>();

  for (const [mid, incomingChat] of Object.entries(incoming.chats ?? {})) {
    affected.add(mid);
    const existing = getChatRecord(db, mid);
    if (!existing) {
      writeChatRecord(db, incomingChat);
      importedChats++;
      continue;
    }
    skippedChats++;
    const incomingIsNewer = (incomingChat.lastMessageTime ?? 0) > (existing.lastMessageTime ?? 0);
    const incomingKindShouldWin =
      incomingChat.kind !== "unknown" &&
      (existing.kind === "unknown" ||
        ((mid.startsWith("c") || mid.startsWith("r")) && incomingChat.kind === "group"));
    writeChatRecord(db, {
      ...existing,
      kind: incomingKindShouldWin ? incomingChat.kind : existing.kind,
      hasMessages: existing.hasMessages || incomingChat.hasMessages,
      ...(existing.restoredHistory || incomingChat.restoredHistory
        ? { restoredHistory: true }
        : {}),
      lastMessageTime: Math.max(existing.lastMessageTime ?? 0, incomingChat.lastMessageTime ?? 0),
      ...(incomingIsNewer && incomingChat.lastMessageId
        ? { lastMessageId: incomingChat.lastMessageId }
        : {}),
      ...(incomingIsNewer && incomingChat.lastMessagePreview
        ? { lastMessagePreview: incomingChat.lastMessagePreview }
        : {}),
      ...(existing.name === existing.mid && incomingChat.name ? { name: incomingChat.name } : {}),
    });
  }

  for (const [chatMid, incomingMessages] of Object.entries(incoming.messages ?? {})) {
    affected.add(chatMid);
    for (const [id, incomingMessage] of Object.entries(incomingMessages)) {
      const existing = getMessageRecord(db, chatMid, id);
      if (existing) {
        writeMessageRecord(db, {
          ...incomingMessage,
          ...existing,
          text: existing.text ?? incomingMessage.text,
          contentType:
            existing.contentType && existing.contentType !== "NONE"
              ? existing.contentType
              : incomingMessage.contentType,
          contentMetadata: {
            ...(incomingMessage.contentMetadata ?? {}),
            ...(existing.contentMetadata ?? {}),
          },
          createdTime:
            Number.isFinite(existing.createdTime) && existing.createdTime > 0
              ? existing.createdTime
              : incomingMessage.createdTime,
          savedAt: existing.savedAt || incomingMessage.savedAt,
        });
        skippedMessages++;
      } else {
        writeMessageRecord(db, incomingMessage);
        importedMessages++;
      }
    }
  }

  rebuildAffectedChats(db, affected);
  return { importedChats, skippedChats, importedMessages, skippedMessages };
}

function rebuildAffectedChats(db: Database, mids: Iterable<string>): void {
  for (const chatMid of mids) {
    if (chatMid.startsWith("c") || chatMid.startsWith("r"))
      db.query("UPDATE messages SET to_mid = ? WHERE chat_mid = ?").run(chatMid, chatMid);
    const latest = latestStoredMessage(db, chatMid);
    if (!latest) continue;
    const existing = getChatRecord(db, chatMid);
    writeChatRecord(db, {
      mid: chatMid,
      name: existing?.name || chatMid,
      kind: existing?.kind ?? "direct",
      hasMessages: true,
      lastMessageTime: latest.createdTime,
      lastMessageId: latest.id,
      lastMessagePreview: previewForMessage(latest),
      ...(existing?.thumbnailUrl ? { thumbnailUrl: existing.thumbnailUrl } : {}),
      ...(existing?.unreadCount != null ? { unreadCount: existing.unreadCount } : {}),
      ...(existing?.isOfficial != null ? { isOfficial: existing.isOfficial } : {}),
      ...(existing?.restoredHistory ? { restoredHistory: true } : {}),
      updatedAt: existing?.updatedAt ?? latest.savedAt,
    });
    const read = getLocalRead(db, chatMid);
    if (read) applyLocalReadWatermarkSql(db, chatMid, read.messageId);
  }
}

/** iOS / Android external-history restore with an atomic quota check. */
export async function mergeImportedChatDb(
  accountId: string,
  incoming: ChatDbRecords,
  maxStorageBytes = Number.POSITIVE_INFINITY,
): Promise<ChatDbMergeResult> {
  const db = await getDb(accountId);
  const result = withTransaction(db, () => {
    const result = mergeImportedRecordsSql(db, incoming);
    if (Number.isFinite(maxStorageBytes) && sqliteUsedStorageBytes(db) > maxStorageBytes)
      throw new BackupStorageLimitError();
    return result;
  });
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    log.warn({ accountId, error }, "legacy chat restore WAL truncation deferred");
  }
  return result;
}

const REQUIRED_STAGED_CHAT_COLUMNS = CHAT_COLUMNS.split(",").map((column) => column.trim());
const REQUIRED_STAGED_MESSAGE_COLUMNS = MESSAGE_COLUMNS.split(",").map((column) => column.trim());

async function mergeNormalizedStagingDb(
  accountId: string,
  stagingPath: string,
  selectedMids: Iterable<string> | undefined,
  maxStorageBytes: number,
  onProgress?: ChatSnapshotProgressCallback,
): Promise<ChatDbMergeResult> {
  if (!existsSync(stagingPath)) throw new Error(`Chat snapshot not found: ${stagingPath}`);
  if (resolve(stagingPath) === resolve(dbPath(accountId)))
    throw new Error("Cannot merge the live chat database as a snapshot");

  return withExclusiveAccountDb(accountId, async (db) => {
    let attached = false;
    let transactionOpen = false;
    try {
      db.query("ATTACH DATABASE ? AS vyline_stage").run(resolve(stagingPath));
      attached = true;
      assertAttachedTableColumns(db, "staged_chats", REQUIRED_STAGED_CHAT_COLUMNS);
      assertAttachedTableColumns(db, "staged_messages", REQUIRED_STAGED_MESSAGE_COLUMNS);

      const selected = normalizedSelectedMids(selectedMids);
      const hasSelection = installSelectedMids(db, selected);
      const chatSelectionJoin = hasSelection
        ? "JOIN temp.vyline_selected_mids selected ON selected.mid = staged.mid"
        : "";
      const messageSelectionJoin = hasSelection
        ? "JOIN temp.vyline_selected_mids selected ON selected.mid = staged.chat_mid"
        : "";

      const totalChats = Number(
        (
          db
            .query(
              `SELECT count(*) AS count FROM vyline_stage.staged_chats staged ${chatSelectionJoin}`,
            )
            .get() as { count?: number } | null
        )?.count ?? 0,
      );
      const totalMessages = Number(
        (
          db
            .query(
              `SELECT count(*) AS count FROM vyline_stage.staged_messages staged ${messageSelectionJoin}`,
            )
            .get() as { count?: number } | null
        )?.count ?? 0,
      );
      const skippedChats = Number(
        (
          db
            .query(`
              SELECT count(*) AS count
              FROM vyline_stage.staged_chats staged
              ${chatSelectionJoin}
              JOIN main.chats current ON current.mid = staged.mid
            `)
            .get() as { count?: number } | null
        )?.count ?? 0,
      );
      const skippedMessages = Number(
        (
          db
            .query(`
              SELECT count(*) AS count
              FROM vyline_stage.staged_messages staged
              ${messageSelectionJoin}
              JOIN main.messages current
                ON current.chat_mid = staged.chat_mid AND current.id = staged.id
            `)
            .get() as { count?: number } | null
        )?.count ?? 0,
      );

      onProgress?.({ phase: "chats", current: 0, total: totalChats });
      onProgress?.({ phase: "messages", current: 0, total: totalMessages });
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      assertWithinStorageQuota(db, maxStorageBytes);

      let copiedChats = 0;
      let chatBatches = 0;
      let afterChatMid = "";
      for (;;) {
        const keys = db
          .query(`
            SELECT staged.mid
            FROM vyline_stage.staged_chats staged
            ${chatSelectionJoin}
            WHERE staged.mid > ?
            ORDER BY staged.mid
            LIMIT 500
          `)
          .all(afterChatMid) as Array<{ mid: string }>;
        if (keys.length === 0) break;
        const lastMid = keys[keys.length - 1]!.mid;
        db.query(`
          INSERT INTO main.chats (${CHAT_COLUMNS})
          SELECT
            staged.mid, staged.name, staged.kind, staged.has_messages,
            staged.last_message_time, staged.last_message_id, staged.last_message_preview,
            staged.thumbnail_url, staged.unread_count, staged.is_official,
            staged.restored_history, staged.updated_at
          FROM vyline_stage.staged_chats staged
          ${chatSelectionJoin}
          WHERE staged.mid > ? AND staged.mid <= ?
          ON CONFLICT(mid) DO UPDATE SET
            name = CASE
              WHEN chats.name = chats.mid AND excluded.name <> '' THEN excluded.name
              ELSE chats.name
            END,
            kind = CASE
              WHEN excluded.kind <> 'unknown' AND (
                chats.kind = 'unknown' OR
                ((chats.mid LIKE 'c%' OR chats.mid LIKE 'r%') AND excluded.kind = 'group')
              ) THEN excluded.kind
              ELSE chats.kind
            END,
            has_messages = CASE
              WHEN chats.has_messages <> 0 OR excluded.has_messages <> 0 THEN 1 ELSE 0
            END,
            last_message_id = CASE
              WHEN coalesce(excluded.last_message_time, 0) > coalesce(chats.last_message_time, 0)
                AND excluded.last_message_id IS NOT NULL
              THEN excluded.last_message_id ELSE chats.last_message_id
            END,
            last_message_preview = CASE
              WHEN coalesce(excluded.last_message_time, 0) > coalesce(chats.last_message_time, 0)
                AND excluded.last_message_preview IS NOT NULL
              THEN excluded.last_message_preview ELSE chats.last_message_preview
            END,
            last_message_time = max(
              coalesce(chats.last_message_time, 0),
              coalesce(excluded.last_message_time, 0)
            ),
            restored_history = CASE
              WHEN chats.restored_history <> 0 OR excluded.restored_history <> 0 THEN 1
              ELSE chats.restored_history
            END
        `).run(afterChatMid, lastMid);
        copiedChats += keys.length;
        chatBatches++;
        afterChatMid = lastMid;
        onProgress?.({ phase: "chats", current: copiedChats, total: totalChats });
        if (chatBatches % STAGING_QUOTA_CHECK_BATCHES === 0) {
          assertWithinStorageQuota(db, maxStorageBytes);
        }
        await yieldToEventLoop();
      }

      if (!hasSelection && attachedTableExists(db, "staged_meta")) {
        db.exec(`
          INSERT INTO main.meta(key, value)
          SELECT key, value
          FROM vyline_stage.staged_meta
          WHERE key IN ('boxOrder', 'chatsSyncedAt')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
      }

      if (attachedTableExists(db, "staged_message_sync")) {
        const syncSelectionJoin = hasSelection
          ? "JOIN temp.vyline_selected_mids selected ON selected.mid = staged.chat_mid"
          : "";
        db.exec(`
          INSERT INTO main.message_sync(chat_mid, synced_at)
          SELECT staged.chat_mid, staged.synced_at
          FROM vyline_stage.staged_message_sync staged
          ${syncSelectionJoin}
          WHERE 1
          ON CONFLICT(chat_mid) DO UPDATE SET synced_at = CASE
            WHEN excluded.synced_at > message_sync.synced_at
            THEN excluded.synced_at ELSE message_sync.synced_at
          END
        `);
      }

      if (attachedTableExists(db, "staged_local_read")) {
        const readSelectionJoin = hasSelection
          ? "JOIN temp.vyline_selected_mids selected ON selected.mid = staged.chat_mid"
          : "";
        db.exec(`
          INSERT INTO main.local_read(chat_mid, message_id, at)
          SELECT staged.chat_mid, staged.message_id, staged.at
          FROM vyline_stage.staged_local_read staged
          ${readSelectionJoin}
          WHERE 1
          ON CONFLICT(chat_mid) DO UPDATE SET
            message_id = CASE
              WHEN excluded.message_id NOT GLOB '*[^0-9]*'
                AND local_read.message_id NOT GLOB '*[^0-9]*'
                AND (
                  length(excluded.message_id) > length(local_read.message_id) OR
                  (length(excluded.message_id) = length(local_read.message_id)
                    AND excluded.message_id > local_read.message_id)
                )
              THEN excluded.message_id
              WHEN excluded.message_id GLOB '*[^0-9]*' AND excluded.at > local_read.at
              THEN excluded.message_id
              ELSE local_read.message_id
            END,
            at = CASE
              WHEN excluded.message_id NOT GLOB '*[^0-9]*'
                AND local_read.message_id NOT GLOB '*[^0-9]*'
                AND (
                  length(excluded.message_id) > length(local_read.message_id) OR
                  (length(excluded.message_id) = length(local_read.message_id)
                    AND excluded.message_id > local_read.message_id)
                )
              THEN excluded.at
              WHEN excluded.message_id GLOB '*[^0-9]*' AND excluded.at > local_read.at
              THEN excluded.at
              ELSE local_read.at
            END
        `);
      }

      let copiedMessages = 0;
      let messageBatches = 0;
      let afterMessageChatMid = "";
      let afterMessageId = "";
      for (;;) {
        const keys = db
          .query(`
            SELECT staged.chat_mid, staged.id
            FROM vyline_stage.staged_messages staged
            ${messageSelectionJoin}
            WHERE staged.chat_mid > ?
               OR (staged.chat_mid = ? AND staged.id > ?)
            ORDER BY staged.chat_mid, staged.id
            LIMIT 500
          `)
          .all(afterMessageChatMid, afterMessageChatMid, afterMessageId) as Array<{
          chat_mid: string;
          id: string;
        }>;
        if (keys.length === 0) break;
        const last = keys[keys.length - 1]!;
        db.query(`
          INSERT INTO main.messages (${MESSAGE_COLUMNS})
          SELECT
            staged.id,
            staged.chat_mid,
            staged.from_mid,
            CASE
              WHEN staged.chat_mid LIKE 'c%' OR staged.chat_mid LIKE 'r%'
              THEN staged.chat_mid ELSE staged.to_mid
            END,
            staged.text,
            staged.content_type,
            staged.created_time,
            staged.is_my_message,
            staged.content_metadata,
            staged.read_count,
            staged.read_by,
            CASE
              WHEN staged.is_my_message = 0
                AND staged.id NOT GLOB '*[^0-9]*'
                AND EXISTS (
                  SELECT 1 FROM main.local_read local
                  WHERE local.chat_mid = staged.chat_mid
                    AND local.message_id NOT GLOB '*[^0-9]*'
                    AND (
                      length(staged.id) < length(local.message_id) OR
                      (length(staged.id) = length(local.message_id)
                        AND staged.id <= local.message_id)
                    )
                )
              THEN 1 ELSE staged.seen
            END,
            staged.related_message_id,
            staged.sticker_animated,
            staged.sticker_sticky,
            staged.reactions,
            staged.saved_at,
            staged.message_state,
            staged.history,
            staged.revoked_snapshot
          FROM vyline_stage.staged_messages staged
          ${messageSelectionJoin}
          WHERE (
              staged.chat_mid > ? OR
              (staged.chat_mid = ? AND staged.id > ?)
            ) AND (
              staged.chat_mid < ? OR
              (staged.chat_mid = ? AND staged.id <= ?)
            )
          ON CONFLICT(chat_mid, id) DO UPDATE SET
            to_mid = CASE
              WHEN messages.chat_mid LIKE 'c%' OR messages.chat_mid LIKE 'r%'
              THEN messages.chat_mid ELSE messages.to_mid
            END,
            text = coalesce(messages.text, excluded.text),
            content_type = CASE
              WHEN messages.content_type <> '' AND messages.content_type <> 'NONE'
              THEN messages.content_type ELSE excluded.content_type
            END,
            content_metadata = CASE
              WHEN messages.content_metadata IS NULL THEN excluded.content_metadata
              WHEN excluded.content_metadata IS NULL THEN messages.content_metadata
              WHEN json_valid(messages.content_metadata) AND json_valid(excluded.content_metadata)
              THEN json_patch(excluded.content_metadata, messages.content_metadata)
              ELSE messages.content_metadata
            END,
            created_time = CASE
              WHEN messages.created_time > 0 THEN messages.created_time ELSE excluded.created_time
            END,
            read_count = coalesce(messages.read_count, excluded.read_count),
            read_by = coalesce(messages.read_by, excluded.read_by),
            seen = CASE
              WHEN messages.is_my_message = 0
                AND messages.id NOT GLOB '*[^0-9]*'
                AND EXISTS (
                  SELECT 1 FROM main.local_read local
                  WHERE local.chat_mid = messages.chat_mid
                    AND local.message_id NOT GLOB '*[^0-9]*'
                    AND (
                      length(messages.id) < length(local.message_id) OR
                      (length(messages.id) = length(local.message_id)
                        AND messages.id <= local.message_id)
                    )
                )
              THEN 1 ELSE coalesce(messages.seen, excluded.seen)
            END,
            related_message_id = coalesce(messages.related_message_id, excluded.related_message_id),
            sticker_animated = coalesce(messages.sticker_animated, excluded.sticker_animated),
            sticker_sticky = coalesce(messages.sticker_sticky, excluded.sticker_sticky),
            reactions = coalesce(messages.reactions, excluded.reactions),
            saved_at = CASE
              WHEN messages.saved_at <> '' THEN messages.saved_at ELSE excluded.saved_at
            END,
            message_state = coalesce(messages.message_state, excluded.message_state),
            history = coalesce(messages.history, excluded.history),
            revoked_snapshot = coalesce(messages.revoked_snapshot, excluded.revoked_snapshot)
        `).run(
          afterMessageChatMid,
          afterMessageChatMid,
          afterMessageId,
          last.chat_mid,
          last.chat_mid,
          last.id,
        );
        copiedMessages += keys.length;
        messageBatches++;
        afterMessageChatMid = last.chat_mid;
        afterMessageId = last.id;
        onProgress?.({ phase: "messages", current: copiedMessages, total: totalMessages });
        if (messageBatches % STAGING_QUOTA_CHECK_BATCHES === 0) {
          assertWithinStorageQuota(db, maxStorageBytes);
        }
        await yieldToEventLoop();
      }

      onProgress?.({ phase: "merge", current: 0, total: 1 });
      assertWithinStorageQuota(db, maxStorageBytes);
      onProgress?.({ phase: "merge", current: 1, total: 1 });
      db.exec("COMMIT");
      transactionOpen = false;
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        // The data is already committed. A concurrent reader may defer WAL
        // truncation, so never misreport a successful atomic restore as failed.
        log.warn({ accountId, error }, "chat restore WAL truncation deferred");
      }
      return {
        importedChats: totalChats - skippedChats,
        skippedChats,
        importedMessages: totalMessages - skippedMessages,
        skippedMessages,
      };
    } catch (error) {
      if (transactionOpen) {
        db.exec("ROLLBACK");
        transactionOpen = false;
      }
      throw error;
    } finally {
      clearSelectedMids(db);
      if (attached) db.exec("DETACH DATABASE vyline_stage");
    }
  });
}

/** Set-based normalized staging merge used by Android/iOS restore pipelines. */
export async function mergeImportedChatDbFromStaging(
  accountId: string,
  stagingPath: string,
  maxStorageBytes = Number.POSITIVE_INFINITY,
  onProgress?: ChatSnapshotProgressCallback,
): Promise<ChatDbMergeResult> {
  return mergeNormalizedStagingDb(accountId, stagingPath, undefined, maxStorageBytes, onProgress);
}

/** Merge a normalized snapshot, optionally restricting it to selected chats. */
export async function mergeAccountChatSnapshot(
  accountId: string,
  snapshotPath: string,
  selectedMids?: Iterable<string>,
  maxStorageBytes = Number.POSITIVE_INFINITY,
  onProgress?: ChatSnapshotProgressCallback,
): Promise<ChatDbMergeResult> {
  return mergeNormalizedStagingDb(
    accountId,
    snapshotPath,
    selectedMids,
    maxStorageBytes,
    onProgress,
  );
}

export async function rebuildAccountChatDb(
  accountId: string,
): Promise<{ chats: number; messages: number; backupFile: string }> {
  const db = await getDb(accountId);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `chatdb.before-rebuild-${stamp}.sqlite`;
  await copyFile(dbPath(accountId), accountFile(accountId, backupFile));
  const mids = db
    .query("SELECT mid FROM chats UNION SELECT chat_mid AS mid FROM messages")
    .all() as Array<{
    mid: string;
  }>;
  withTransaction(db, () =>
    rebuildAffectedChats(
      db,
      mids.map((row) => row.mid),
    ),
  );
  const counts = db
    .query(
      "SELECT (SELECT count(*) FROM chats) AS chats, (SELECT count(*) FROM messages) AS messages",
    )
    .get() as { chats: number; messages: number };
  return { ...counts, backupFile };
}

/** SQLite commits are already durable; checkpoint opportunistically for compact WALs. */
export async function flushAccountChatDb(accountId: string): Promise<void> {
  const db = await getDb(accountId);
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
}

/** Release an account connection after shutdown/account removal and in isolated tests. */
export async function closeAccountChatDb(accountId: string): Promise<void> {
  if (!databases.has(accountId) && !databaseOpenInflight.has(accountId)) return;
  await withExclusiveAccountDb(accountId, async (db) => {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if (databases.get(accountId) === db) databases.delete(accountId);
    db.close();
  });
}

export async function listChatsWithCounts(
  accountId: string,
): Promise<Array<{ mid: string; name: string; messageCount: number }>> {
  const db = await getDb(accountId);
  const rows = db
    .query(`
    SELECT c.mid AS mid, c.name AS name, count(m.id) AS message_count
    FROM chats c
    LEFT JOIN messages m ON m.chat_mid = c.mid
    GROUP BY c.mid, c.name
  `)
    .all() as Array<{ mid: string; name: string; message_count: number }>;
  return rows.map((row) => ({ mid: row.mid, name: row.name, messageCount: row.message_count }));
}

/** Exposed for diagnostics/tests without requiring callers to know the file layout. */
export async function getChatDbLogicalStorageBytes(accountId: string): Promise<number> {
  const db = await getDb(accountId);
  const usedPages = sqliteUsedStorageBytes(db);
  const walBytes = await stat(`${dbPath(accountId)}-wal`)
    .then((entry) => entry.size)
    .catch(() => 0);
  return usedPages + walBytes;
}

/** Message-id-only view used by quota/media accounting without hydrating message bodies. */
export async function getStoredMessageRefs(
  accountId: string,
): Promise<Record<string, Record<string, { id: string }>>> {
  const db = await getDb(accountId);
  const result: Record<string, Record<string, { id: string }>> = {};
  const rows = db.query("SELECT chat_mid, id FROM messages").all() as Array<{
    chat_mid: string;
    id: string;
  }>;
  for (const row of rows) (result[row.chat_mid] ??= {})[row.id] = { id: row.id };
  return result;
}

// Re-export the pure size helper from this module as well for compatibility with
// callers importing directly from chatStoreSqlite during tests.
export { chatDbStorageBytes };
