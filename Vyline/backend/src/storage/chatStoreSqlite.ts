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
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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

const databases = new Map<string, Database>();

type SqlRow = Record<string, unknown>;

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
    ...(row.last_message_preview != null
      ? { lastMessagePreview: row.last_message_preview }
      : {}),
    ...(row.thumbnail_url != null ? { thumbnailUrl: row.thumbnail_url } : {}),
    ...(row.unread_count != null ? { unreadCount: row.unread_count } : {}),
    ...(row.is_official != null ? { isOfficial: row.is_official !== 0 } : {}),
    ...(row.restored_history != null
      ? { restoredHistory: row.restored_history !== 0 }
      : {}),
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

function initializeDb(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA wal_autocheckpoint = 1000");
  db.exec("PRAGMA journal_size_limit = 33554432");
  db.exec("PRAGMA cache_size = -8192");
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
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

async function getDb(accountId: string): Promise<Database> {
  const existing = databases.get(accountId);
  if (existing) return existing;
  ensureAccount(accountId);
  const path = dbPath(accountId);
  await mkdir(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  initializeDb(db);
  databases.set(accountId, db);
  return db;
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
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | null;
  return row ? parseJson<T>(row.value) : undefined;
}

function setMetaValue(db: Database, key: string, value: unknown): void {
  db.query(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

function getChatRecord(db: Database, mid: string): StoredChat | undefined {
  const row = db.query(`SELECT ${CHAT_COLUMNS} FROM chats WHERE mid = ?`).get(mid) as
    | ChatRow
    | null;
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
  const row = db
    .query("SELECT message_id, at FROM local_read WHERE chat_mid = ?")
    .get(chatMid) as { message_id: string; at: string } | null;
  return row ? { messageId: row.message_id, at: row.at } : undefined;
}

function applyLocalReadWatermarkSql(db: Database, chatMid: string, messageId: string): void {
  if (!/^\d+$/.test(messageId)) return;
  db.query(`
    UPDATE messages
    SET seen = 1
    WHERE chat_mid = ?
      AND is_my_message = 0
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
  const db = await getDb(accountId);
  const counts = db
    .query("SELECT (SELECT count(*) FROM chats) AS chats, (SELECT count(*) FROM messages) AS messages")
    .get() as { chats: number; messages: number };
  log.debug({ accountId, ...counts }, "sqlite chat cache ready");
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
      const incomingNameIsFallback = !chat.name || chat.name === chat.mid || chat.name === "(No Name)";
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
      if (current && BigInt(current) > BigInt(messageId)) return;
    } catch {
      /* replace malformed cursor */
    }
    const now = new Date().toISOString();
    db.query(`
      INSERT INTO local_read(chat_mid, message_id, at) VALUES (?, ?, ?)
      ON CONFLICT(chat_mid) DO UPDATE SET message_id = excluded.message_id, at = excluded.at
    `).run(chatMid, messageId, now);
    applyLocalReadWatermarkSql(db, chatMid, messageId);
    db.query("UPDATE chats SET unread_count = 0 WHERE mid = ?").run(chatMid);
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
    const restoredContentType = snapshot?.contentType ?? lastNormal?.contentType ?? stored.contentType;
    const entry = {
      state: "normal" as const,
      text: stored.text,
      contentType: stored.contentType,
      updatedTime: Date.now(),
    };
    stored.messageState = (snapshot?.messageState ?? lastNormal?.state ?? "normal") as Message["messageState"];
    stored.history = [...(stored.history ?? []), entry];
    if (snapshot) stored.revokedSnapshot = snapshot;
    stored.text = restoredText;
    stored.contentType = restoredContentType;
    if (snapshot) {
      if (snapshot.contentMetadata !== undefined) stored.contentMetadata = snapshot.contentMetadata;
      if (snapshot.readCount !== undefined) stored.readCount = snapshot.readCount;
      if (snapshot.readBy !== undefined) stored.readBy = snapshot.readBy;
      if (snapshot.seen !== undefined) stored.seen = snapshot.seen;
      if (snapshot.relatedMessageId !== undefined) stored.relatedMessageId = snapshot.relatedMessageId;
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
    meta.messagesSyncedAt = Object.fromEntries(syncRows.map((row) => [row.chat_mid, row.synced_at]));
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

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function mapEntryBytes(key: string, valueBytes: number): number {
  return jsonBytes(key) + 1 + valueBytes;
}

/**
 * Exact logical chat history size used by the existing backup quota, calculated
 * from SQLite in bounded chunks rather than materializing the whole DB object.
 */
function sqliteLogicalStorageBytes(db: Database): number {
  const meta = readMeta(db);
  let total = jsonBytes({ meta, chats: {}, messages: {} }) - 4;

  const chatRows = db.query(`SELECT ${CHAT_COLUMNS} FROM chats`).all() as ChatRow[];
  let chatsBytes = 2;
  for (let index = 0; index < chatRows.length; index++) {
    const chat = fromChatRow(chatRows[index]!);
    chatsBytes += mapEntryBytes(chat.mid, jsonBytes(chat));
    if (index > 0) chatsBytes++;
  }
  total += chatsBytes;

  const mids = db.query("SELECT DISTINCT chat_mid FROM messages ORDER BY chat_mid").all() as Array<{
    chat_mid: string;
  }>;
  let messagesBytes = 2;
  for (let midIndex = 0; midIndex < mids.length; midIndex++) {
    const chatMid = mids[midIndex]!.chat_mid;
    let innerBytes = 2;
    let count = 0;
    let afterId = "";
    let afterTime = -1;
    for (;;) {
      const rows = db
        .query(`
          SELECT ${MESSAGE_COLUMNS}
          FROM messages
          WHERE chat_mid = ? AND (
            created_time > ? OR (created_time = ? AND id > ?)
          )
          ORDER BY created_time, id
          LIMIT 1000
        `)
        .all(chatMid, afterTime, afterTime, afterId) as MessageRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const message = fromMessageRow(row);
        innerBytes += mapEntryBytes(message.id, jsonBytes(message));
        if (count++ > 0) innerBytes++;
        afterTime = row.created_time;
        afterId = row.id;
      }
      if (rows.length < 1000) break;
    }
    messagesBytes += mapEntryBytes(chatMid, innerBytes);
    if (midIndex > 0) messagesBytes++;
  }
  total += messagesBytes;
  return total;
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
    db.exec("DELETE FROM messages; DELETE FROM chats; DELETE FROM message_sync; DELETE FROM local_read; DELETE FROM meta;");
    for (const chat of Object.values(data.chats)) writeChatRecord(db, chat);
    for (const messages of Object.values(data.messages))
      for (const message of Object.values(messages)) writeMessageRecord(db, message);
    if (data.meta.lastOpRevision != null) setMetaValue(db, "lastOpRevision", data.meta.lastOpRevision);
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
      ...(existing.restoredHistory || incomingChat.restoredHistory ? { restoredHistory: true } : {}),
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
  return withTransaction(db, () => {
    const result = mergeImportedRecordsSql(db, incoming);
    if (Number.isFinite(maxStorageBytes) && sqliteLogicalStorageBytes(db) > maxStorageBytes)
      throw new BackupStorageLimitError();
    return result;
  });
}

export async function rebuildAccountChatDb(
  accountId: string,
): Promise<{ chats: number; messages: number; backupFile: string }> {
  const db = await getDb(accountId);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `chatdb.before-rebuild-${stamp}.sqlite`;
  await copyFile(dbPath(accountId), accountFile(accountId, backupFile));
  const mids = db.query("SELECT mid FROM chats UNION SELECT chat_mid AS mid FROM messages").all() as Array<{
    mid: string;
  }>;
  withTransaction(db, () => rebuildAffectedChats(db, mids.map((row) => row.mid)));
  const counts = db
    .query("SELECT (SELECT count(*) FROM chats) AS chats, (SELECT count(*) FROM messages) AS messages")
    .get() as { chats: number; messages: number };
  return { ...counts, backupFile };
}

/** SQLite commits are already durable; checkpoint opportunistically for compact WALs. */
export async function flushAccountChatDb(accountId: string): Promise<void> {
  const db = await getDb(accountId);
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
}

export async function listChatsWithCounts(
  accountId: string,
): Promise<Array<{ mid: string; name: string; messageCount: number }>> {
  const db = await getDb(accountId);
  const rows = db.query(`
    SELECT c.mid AS mid, c.name AS name, count(m.id) AS message_count
    FROM chats c
    LEFT JOIN messages m ON m.chat_mid = c.mid
    GROUP BY c.mid, c.name
  `).all() as Array<{ mid: string; name: string; message_count: number }>;
  return rows.map((row) => ({ mid: row.mid, name: row.name, messageCount: row.message_count }));
}

/** Exposed for diagnostics/tests without requiring callers to know the file layout. */
export async function getChatDbLogicalStorageBytes(accountId: string): Promise<number> {
  const db = await getDb(accountId);
  const counts = db
    .query("SELECT (SELECT count(*) FROM chats) AS chats, (SELECT count(*) FROM messages) AS messages, (SELECT count(*) FROM meta) AS meta")
    .get() as { chats: number; messages: number; meta: number };
  const syncCount = (db.query("SELECT count(*) AS count FROM message_sync").get() as { count: number }).count;
  const readCount = (db.query("SELECT count(*) AS count FROM local_read").get() as { count: number }).count;
  if (counts.chats === 0 && counts.messages === 0 && counts.meta === 0 && syncCount === 0 && readCount === 0)
    return 0;
  return sqliteLogicalStorageBytes(db);
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
