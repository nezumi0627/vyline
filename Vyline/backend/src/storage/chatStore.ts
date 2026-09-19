/**
 * chatStore.ts — Desktop 相当のローカルメッセージキャッシュ
 *
 * LINE Desktop の .edb local-first に相当する JSON 永続化。
 * 起動時はディスク → メモリで即返却、RPC はバックグラウンド同期。
 */

import { existsSync, mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import type {
  Chat,
  Message,
  MessageContentMeta,
  MessageReaction,
  MessageSnapshot,
} from "@vyline/types";
import { childLogger } from "../logger.js";
import { accountFile, readAccountJson } from "./accountDirs.js";

const log = childLogger("chatStore");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");

const SAVE_DEBOUNCE_MS = Number(process.env.VYLINE_CHATDB_SAVE_MS ?? 400);
const BOOTSTRAP_TOP_CHATS = Number(process.env.VYLINE_BOOTSTRAP_TOP_CHATS ?? 12);
const BOOTSTRAP_MSG_LIMIT = Number(process.env.VYLINE_BOOTSTRAP_MSG_LIMIT ?? 40);
/**
 * The in-memory representation is deliberately account-scoped.  Keep the
 * default small: a second account is useful for a quick switch, but keeping
 * every account's complete history resident defeats SQLite's purpose.
 */
const MAX_CACHED_ACCOUNTS = Math.max(
  1,
  Number.parseInt(process.env.VYLINE_CHAT_CACHE_ACCOUNTS ?? "1", 10) || 1,
);

export interface StoredChat {
  mid: string;
  name: string;
  kind: Chat["kind"];
  hasMessages: boolean;
  lastMessageTime?: number;
  lastMessageId?: string;
  lastMessagePreview?: string;
  thumbnailUrl?: string;
  unreadCount?: number;
  isOfficial?: boolean;
  /** 外部バックアップから復元された履歴を持つ。退出済みグループも履歴として表示するために使う。 */
  restoredHistory?: boolean;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  chatMid: string;
  from: string;
  to: string;
  text: string | null;
  contentType: string;
  createdTime: number;
  isMyMessage: boolean;
  contentMetadata?: MessageContentMeta | null;
  readCount?: number;
  readBy?: string[];
  seen?: boolean;
  relatedMessageId?: string | null;
  stickerAnimated?: boolean;
  stickerSticky?: boolean;
  reactions?: MessageReaction[];
  savedAt: string;
  messageState?: Message["messageState"];
  history?: Message["history"];
  revokedSnapshot?: MessageSnapshot;
  /** UIからは通常隠すが、復元のためレコード自体はSQLiteに残す。 */
  isDeleted?: boolean;
  deletedAt?: string | null;
  /** reader MID → 既読になった時刻。readBy/readCountとの互換用。 */
  readAtBy?: Record<string, string>;
}

interface ChatDbMeta {
  /** getMessageBoxes の lastOpRevision（差分同期用・将来） */
  lastOpRevision?: string;
  /** Desktop 準拠: messageBoxes 返却順 */
  boxOrder?: string[];
  chatsSyncedAt?: string;
  /** chatMid → ISO */
  messagesSyncedAt?: Record<string, string>;
  /** 自分が受信メッセージを既読にした最終位置（復元DBにも適用する）。 */
  localReadUpTo?: Record<string, { messageId: string; at: string }>;
  /** reader MIDごとの既読カーソル。selfは従来のlocalReadUpToと同期する。 */
  readCursors?: Record<string, Record<string, { messageId: string; at: string }>>;
}

interface ChatDb {
  meta: ChatDbMeta;
  chats: Record<string, StoredChat>;
  messages: Record<string, Record<string, StoredMessage>>;
}

export interface ChatDbRecords {
  meta?: ChatDbMeta;
  chats: Record<string, StoredChat>;
  messages: Record<string, Record<string, StoredMessage>>;
}

export interface ChatDbMergeResult {
  importedChats: number;
  skippedChats: number;
  importedMessages: number;
  skippedMessages: number;
}

type MessageCursor = Pick<StoredMessage, "id" | "createdTime">;

function compareMessageIdsAscending(left: string, right: string): number {
  if (left === right) return 0;
  try {
    return BigInt(left) < BigInt(right) ? -1 : 1;
  } catch {
    return left.localeCompare(right);
  }
}

/** 全経路で共通に使う複合順序: 新しい時刻、同時刻なら大きいメッセージIDが先。 */
export function compareMessagesNewestFirst(left: MessageCursor, right: MessageCursor): number {
  const byTime = right.createdTime - left.createdTime;
  return byTime || -compareMessageIdsAscending(left.id, right.id);
}

export function compareMessagesOldestFirst(left: MessageCursor, right: MessageCursor): number {
  const byTime = left.createdTime - right.createdTime;
  return byTime || compareMessageIdsAscending(left.id, right.id);
}

function previewForMessage(message: StoredMessage): string {
  const text = message.text?.trim();
  if (text) return text.slice(0, 120);
  switch (message.contentType.toUpperCase()) {
    case "IMAGE":
      return "画像";
    case "VIDEO":
      return "動画";
    case "AUDIO":
      return "音声";
    case "FILE":
      return "ファイル";
    case "STICKER":
      return "スタンプ";
    default:
      return message.contentType || "メッセージ";
  }
}

export const ENCRYPTED_LAST_MESSAGE_PREVIEW = "暗号化メッセージ";

export function isUnresolvedLastMessagePreview(value: string | null | undefined): boolean {
  const normalized = value?.trim().toUpperCase();
  return (
    !normalized ||
    normalized === ENCRYPTED_LAST_MESSAGE_PREVIEW.toUpperCase() ||
    normalized === "E2EE_UNAVAILABLE" ||
    normalized === "UNSENT" ||
    normalized === "UNSEND" ||
    normalized === "CHATEVENT" ||
    normalized === "NONE" ||
    normalized === "0"
  );
}

export function shouldPreserveResolvedLastMessagePreview(
  existing: Pick<StoredChat, "lastMessageId" | "lastMessageTime" | "lastMessagePreview">,
  incoming: Pick<StoredChat, "lastMessageId" | "lastMessageTime" | "lastMessagePreview">,
): boolean {
  const sameMessage =
    existing.lastMessageId && incoming.lastMessageId
      ? existing.lastMessageId === incoming.lastMessageId
      : (existing.lastMessageTime ?? 0) > 0 &&
        existing.lastMessageTime === incoming.lastMessageTime;
  return Boolean(
    sameMessage &&
      existing.lastMessagePreview &&
      !isUnresolvedLastMessagePreview(existing.lastMessagePreview) &&
      isUnresolvedLastMessagePreview(incoming.lastMessagePreview),
  );
}

const memory = new Map<string, ChatDb>();
const dirty = new Set<string>();
const dirtyVersion = new Map<string, number>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const flushInFlight = new Map<string, Promise<void>>();
const loadInFlight = new Map<string, Promise<ChatDb>>();
const cacheAccess = new Map<string, number>();
let cacheAccessSequence = 0;

function dbPath(accountId: string): string {
  return accountFile(accountId, "chatdb.sqlite");
}
const legacyDbPath = (accountId: string) => join(DATA_DIR, `chatdb-${accountId}.json`);

const SQLITE_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS chat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chats (
    mid TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    has_messages INTEGER NOT NULL,
    last_message_time INTEGER,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    chat_mid TEXT NOT NULL,
    id TEXT NOT NULL,
    created_time INTEGER NOT NULL,
    is_my_message INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    message_state TEXT,
    payload TEXT NOT NULL,
    PRIMARY KEY (chat_mid, id)
  );
  CREATE TABLE IF NOT EXISTS read_cursors (
    chat_mid TEXT NOT NULL,
    reader_mid TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (chat_mid, reader_mid)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat_order
    ON messages(chat_mid, created_time DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_chat_deleted
    ON messages(chat_mid, is_deleted, created_time DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_state
    ON messages(chat_mid, message_state);
`;

function openSqlite(accountId: string): Database {
  mkdirSync(dirname(dbPath(accountId)), { recursive: true });
  const sqlite = new Database(dbPath(accountId));
  sqlite.exec(SQLITE_SCHEMA);
  return sqlite;
}

const MAX_CACHED_MESSAGES_PER_CHAT = Math.max(
  50,
  Number.parseInt(process.env.VYLINE_CHAT_CACHE_MESSAGES ?? "500", 10) || 500,
);

function cacheMessages(db: ChatDb, chatMid: string, messages: StoredMessage[]): void {
  if (messages.length === 0) return;
  const byChat = (db.messages[chatMid] ??= {});
  for (const message of messages) byChat[message.id] = message;
  const ids = Object.values(byChat)
    .sort(compareMessagesNewestFirst)
    .slice(MAX_CACHED_MESSAGES_PER_CHAT)
    .map((message) => message.id);
  for (const id of ids) delete byChat[id];
}

function readMessagesSqlite(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number; includeDeleted?: boolean },
): StoredMessage[] {
  const sqlite = openSqlite(accountId);
  try {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 0, 0), 2_000);
    if (safeLimit === 0) return [];
    const beforeTime = opts?.beforeDeliveredTime;
    const beforeId = opts?.beforeMessageId;
    const deleted = opts?.includeDeleted ? "" : " AND is_deleted = 0";
    let sql = `SELECT payload FROM messages WHERE chat_mid = ?${deleted}`;
    const args: Array<string | number> = [chatMid];
    if (beforeTime != null && beforeId != null) {
      sql += " AND (created_time < ? OR (created_time = ? AND id < ?))";
      args.push(beforeTime, beforeTime, beforeId);
    } else if (beforeTime != null) {
      sql += " AND created_time < ?";
      args.push(beforeTime);
    } else if (beforeId != null) {
      try {
        BigInt(beforeId);
        sql += " AND CAST(id AS INTEGER) < CAST(? AS INTEGER)";
        args.push(beforeId);
      } catch {
        return [];
      }
    }
    sql += " ORDER BY created_time DESC, CAST(id AS INTEGER) DESC, id DESC LIMIT ?";
    args.push(safeLimit);
    return (sqlite.query(sql).all(...args) as Array<{ payload: string }>).flatMap((row) => {
      try {
        return [JSON.parse(row.payload) as StoredMessage];
      } catch {
        return [];
      }
    });
  } finally {
    sqlite.close();
  }
}

function readMessageSqlite(
  accountId: string,
  chatMid: string,
  messageId: string,
): StoredMessage | null {
  const sqlite = openSqlite(accountId);
  try {
    const row = sqlite
      .query("SELECT payload FROM messages WHERE chat_mid = ? AND id = ?")
      .get(chatMid, messageId) as { payload: string } | null;
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as StoredMessage;
    } catch {
      return null;
    }
  } finally {
    sqlite.close();
  }
}

/** Persist only the received mutation batch; never rewrite the conversation. */
function upsertMessagesSqlite(accountId: string, messages: StoredMessage[]): void {
  if (messages.length === 0) return;
  const sqlite = openSqlite(accountId);
  try {
    const statement = sqlite.prepare(
      "INSERT INTO messages (chat_mid, id, created_time, is_my_message, is_deleted, deleted_at, message_state, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chat_mid, id) DO UPDATE SET created_time=excluded.created_time, is_my_message=excluded.is_my_message, is_deleted=excluded.is_deleted, deleted_at=excluded.deleted_at, message_state=excluded.message_state, payload=excluded.payload",
    );
    sqlite.transaction(() => {
      for (const message of messages) {
        statement.run(
          message.chatMid,
          message.id,
          message.createdTime,
          message.isMyMessage ? 1 : 0,
          message.isDeleted ? 1 : 0,
          message.deletedAt ?? null,
          message.messageState ?? null,
          JSON.stringify(message),
        );
      }
    })();
  } finally {
    sqlite.close();
  }
}

function readSqliteDb(accountId: string): ChatDb {
  const sqlite = openSqlite(accountId);
  try {
    const meta: ChatDbMeta = {};
    for (const row of sqlite.query("SELECT key, value FROM chat_meta").all() as Array<{
      key: string;
      value: string;
    }>) {
      try {
        (meta as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        /* ignore corrupt metadata */
      }
    }
    const chats: Record<string, StoredChat> = {};
    for (const row of sqlite.query("SELECT payload FROM chats").all() as Array<{
      payload: string;
    }>) {
      const chat = JSON.parse(row.payload) as StoredChat;
      chats[chat.mid] = chat;
    }
    // Messages are deliberately not hydrated at startup.  SQLite is the
    // source of truth; only the requested page (or a small mutation batch)
    // is brought into memory.
    return { meta, chats, messages: {} };
  } finally {
    sqlite.close();
  }
}

function writeSqliteDb(accountId: string, db: ChatDb): void {
  const sqlite = openSqlite(accountId);
  try {
    const transaction = sqlite.transaction(() => {
      const metaInsert = sqlite.prepare(
        "INSERT INTO chat_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      );
      for (const [key, value] of Object.entries(db.meta)) {
        if (value !== undefined) metaInsert.run(key, JSON.stringify(value));
      }
      const chatInsert = sqlite.prepare(
        "INSERT INTO chats (mid, kind, name, has_messages, last_message_time, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mid) DO UPDATE SET kind=excluded.kind, name=excluded.name, has_messages=excluded.has_messages, last_message_time=excluded.last_message_time, updated_at=excluded.updated_at, payload=excluded.payload",
      );
      for (const chat of Object.values(db.chats)) {
        chatInsert.run(
          chat.mid,
          chat.kind,
          chat.name,
          chat.hasMessages ? 1 : 0,
          chat.lastMessageTime ?? null,
          chat.updatedAt,
          JSON.stringify(chat),
        );
      }
      const messageInsert = sqlite.prepare(
        "INSERT INTO messages (chat_mid, id, created_time, is_my_message, is_deleted, deleted_at, message_state, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chat_mid, id) DO UPDATE SET created_time=excluded.created_time, is_my_message=excluded.is_my_message, is_deleted=excluded.is_deleted, deleted_at=excluded.deleted_at, message_state=excluded.message_state, payload=excluded.payload",
      );
      for (const [chatMid, byChat] of Object.entries(db.messages)) {
        for (const message of Object.values(byChat)) {
          messageInsert.run(
            chatMid,
            message.id,
            message.createdTime,
            message.isMyMessage ? 1 : 0,
            message.isDeleted ? 1 : 0,
            message.deletedAt ?? null,
            message.messageState ?? null,
            JSON.stringify(message),
          );
        }
      }
      const cursorInsert = sqlite.prepare(
        "INSERT INTO read_cursors (chat_mid, reader_mid, message_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_mid, reader_mid) DO UPDATE SET message_id=excluded.message_id, updated_at=excluded.updated_at",
      );
      for (const [chatMid, readers] of Object.entries(db.meta.readCursors ?? {})) {
        for (const [readerMid, cursor] of Object.entries(readers))
          cursorInsert.run(chatMid, readerMid, cursor.messageId, cursor.at);
      }
    });
    transaction();
  } finally {
    sqlite.close();
  }
}

function emptyDb(): ChatDb {
  return { meta: {}, chats: {}, messages: {} };
}

function hydrateMessage(
  accountId: string,
  db: ChatDb,
  chatMid: string,
  messageId: string,
): StoredMessage | undefined {
  const cached = db.messages[chatMid]?.[messageId];
  if (cached) return cached;
  const loaded = readMessageSqlite(accountId, chatMid, messageId) ?? undefined;
  if (loaded) (db.messages[chatMid] ??= {})[messageId] = loaded;
  return loaded;
}

function readAllMessages(accountId: string): Record<string, Record<string, StoredMessage>> {
  const sqlite = openSqlite(accountId);
  try {
    const result: Record<string, Record<string, StoredMessage>> = {};
    for (const row of sqlite
      .prepare("SELECT chat_mid, id, payload FROM messages ORDER BY chat_mid, created_time, id")
      .all() as Array<{ chat_mid: string; id: string; payload: string }>) {
      try {
        (result[row.chat_mid] ??= {})[row.id] = JSON.parse(row.payload) as StoredMessage;
      } catch {
        /* skip only the corrupt row */
      }
    }
    return result;
  } finally {
    sqlite.close();
  }
}

function mergeReadCursors(
  previous: ChatDbMeta["readCursors"],
  incoming: ChatDbMeta["readCursors"],
): ChatDbMeta["readCursors"] {
  const result: NonNullable<ChatDbMeta["readCursors"]> = {};
  for (const [chatMid, readers] of Object.entries(previous ?? {})) result[chatMid] = { ...readers };
  for (const [chatMid, readers] of Object.entries(incoming ?? {})) {
    const target = (result[chatMid] ??= {});
    for (const [readerMid, cursor] of Object.entries(readers)) {
      const current = target[readerMid];
      if (!current) {
        target[readerMid] = cursor;
        continue;
      }
      try {
        if (BigInt(cursor.messageId) > BigInt(current.messageId)) target[readerMid] = cursor;
      } catch {
        target[readerMid] = cursor;
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeLocalReadUpTo(
  previous: ChatDbMeta["localReadUpTo"],
  incoming: ChatDbMeta["localReadUpTo"],
): ChatDbMeta["localReadUpTo"] {
  const result = { ...(previous ?? {}) };
  for (const [chatMid, cursor] of Object.entries(incoming ?? {})) {
    const current = result[chatMid];
    if (!current) {
      result[chatMid] = cursor;
      continue;
    }
    try {
      if (BigInt(cursor.messageId) > BigInt(current.messageId)) result[chatMid] = cursor;
    } catch {
      result[chatMid] = cursor;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function loadDbFromDisk(accountId: string): Promise<ChatDb> {
  await ensureDataDir();
  const path = dbPath(accountId);
  if (existsSync(path)) {
    try {
      return readSqliteDb(accountId);
    } catch (err) {
      log.warn({ accountId, err }, "failed to load sqlite chat db; trying legacy JSON");
    }
  }
  const legacy = await readAccountJson<Partial<ChatDb>>(
    accountId,
    "chatdb.json",
    legacyDbPath(accountId),
  );
  if (legacy) {
    const db: ChatDb = {
      meta: legacy.meta ?? {},
      chats: legacy.chats ?? {},
      messages: legacy.messages ?? {},
    };
    try {
      writeSqliteDb(accountId, db);
    } catch (err) {
      log.warn({ accountId, err }, "failed to migrate legacy chat db");
    }
    // Do not retain the complete legacy object after migration.
    return readSqliteDb(accountId);
  }
  return emptyDb();
}

async function getDb(accountId: string): Promise<ChatDb> {
  const mem = memory.get(accountId);
  if (mem) {
    touchCache(accountId);
    return mem;
  }

  const existingLoad = loadInFlight.get(accountId);
  if (existingLoad) return existingLoad;

  const load = (async () => {
    // Eviction is performed before loading so a newly selected account never
    // temporarily doubles the resident complete-history databases.
    await evictOverflow(accountId);
    const db = await loadDbFromDisk(accountId);
    memory.set(accountId, db);
    touchCache(accountId);
    // Another account may have been loaded while this I/O was in progress.
    // Keep the just-requested account and evict only safe (clean) entries.
    await evictOverflow(accountId);
    return db;
  })();
  loadInFlight.set(accountId, load);
  try {
    return await load;
  } finally {
    if (loadInFlight.get(accountId) === load) loadInFlight.delete(accountId);
  }
}

function touchCache(accountId: string): void {
  cacheAccess.set(accountId, ++cacheAccessSequence);
}

/**
 * Drop only a fully persisted account cache.  Dirty accounts are flushed
 * first; a failed flush is a hard stop and leaves the object resident so no
 * in-memory-only mutation can be lost.
 */
async function evictOverflow(keepAccountId?: string): Promise<void> {
  while (memory.size > MAX_CACHED_ACCOUNTS) {
    const candidates = [...memory.keys()]
      .filter((accountId) => accountId !== keepAccountId)
      .sort((left, right) => (cacheAccess.get(left) ?? 0) - (cacheAccess.get(right) ?? 0));
    const accountId = candidates[0];
    if (!accountId) return;

    if (dirty.has(accountId)) await flushDb(accountId);
    if (dirty.has(accountId)) return;
    memory.delete(accountId);
    cacheAccess.delete(accountId);
    log.debug({ accountId }, "evicted clean chat cache");
  }
}

/**
 * Explicit lifecycle hook for logout/account removal integrations.  It is
 * safe to call while a debounce timer exists and never deletes SQLite data.
 */
export async function releaseAccountChatCache(accountId: string): Promise<void> {
  const timer = saveTimers.get(accountId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(accountId);
  }
  if (memory.has(accountId) && dirty.has(accountId)) await flushDb(accountId);
  if (dirty.has(accountId)) {
    throw new Error(`chat cache for ${accountId} is still dirty`);
  }
  memory.delete(accountId);
  cacheAccess.delete(accountId);
}

/** Diagnostic information used by tests and local diagnostics, not message data. */
export function getChatCacheStats(): {
  cachedAccounts: number;
  dirtyAccounts: number;
  maxCachedAccounts: number;
  cachedAccountIds: string[];
} {
  return {
    cachedAccounts: memory.size,
    dirtyAccounts: dirty.size,
    maxCachedAccounts: MAX_CACHED_ACCOUNTS,
    cachedAccountIds: [...memory.keys()],
  };
}

function snapshotFromStoredMessage(stored: StoredMessage): MessageSnapshot {
  const {
    savedAt: _savedAt,
    history: _history,
    revokedSnapshot: _revokedSnapshot,
    messageState,
    ...snapshot
  } = stored;
  return {
    ...snapshot,
    ...(messageState != null ? { messageState } : {}),
  };
}

function scheduleSave(accountId: string): void {
  dirty.add(accountId);
  dirtyVersion.set(accountId, (dirtyVersion.get(accountId) ?? 0) + 1);
  const prev = saveTimers.get(accountId);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    accountId,
    setTimeout(() => {
      saveTimers.delete(accountId);
      // Background saves are best-effort, but failures remain dirty so an
      // explicit restore/rebuild flush can retry and surface the error.
      void flushDb(accountId).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** 既読情報はサーバ応答の欠落で巻き戻さない。未読を既読へ昇格させるのは明示値だけにする。 */
export function mergeStoredReadState(
  previous: Pick<StoredMessage, "seen" | "readCount" | "readBy" | "readAtBy"> | undefined,
  incoming: Pick<StoredMessage, "seen" | "readCount" | "readBy" | "readAtBy">,
): Pick<StoredMessage, "seen" | "readCount" | "readBy" | "readAtBy"> {
  const readBy = [...new Set([...(previous?.readBy ?? []), ...(incoming.readBy ?? [])])];
  const readCount = Math.max(previous?.readCount ?? 0, incoming.readCount ?? 0, readBy.length);
  const readAtBy = { ...(previous?.readAtBy ?? {}) };
  for (const [readerMid, incomingAt] of Object.entries(incoming.readAtBy ?? {})) {
    const previousAt = readAtBy[readerMid];
    if (!previousAt) {
      readAtBy[readerMid] = incomingAt;
      continue;
    }
    const previousMs = Date.parse(previousAt);
    const incomingMs = Date.parse(incomingAt);
    // Preserve the first-read timestamp; later syncs can only confirm the same read.
    if (Number.isFinite(incomingMs) && Number.isFinite(previousMs) && incomingMs < previousMs) {
      readAtBy[readerMid] = incomingAt;
    }
  }
  return {
    ...(previous?.seen === true || incoming.seen === true ? { seen: true } : {}),
    ...(readCount > 0 ? { readCount } : {}),
    ...(readBy.length > 0 ? { readBy } : {}),
    ...(Object.keys(readAtBy).length > 0 ? { readAtBy } : {}),
  };
}

async function flushDb(accountId: string): Promise<void> {
  const existingFlush = flushInFlight.get(accountId);
  if (existingFlush) return existingFlush;
  if (!dirty.has(accountId)) return;

  const run = (async () => {
    while (dirty.has(accountId)) {
      const db = memory.get(accountId);
      if (!db) {
        dirty.delete(accountId);
        return;
      }

      await ensureDataDir();
      const version = dirtyVersion.get(accountId) ?? 0;
      try {
        writeSqliteDb(accountId, db);
      } catch (err) {
        // Never convert a failed restore into a successful in-memory-only one.
        // Keep the DB dirty and let explicit flush callers observe the error.
        dirty.add(accountId);
        log.warn({ accountId, err }, "failed to save chat db");
        throw err;
      }

      if ((dirtyVersion.get(accountId) ?? 0) === version) {
        dirty.delete(accountId);
      }
      // If another mutation happened while writing, dirty remains set and the
      // loop atomically writes the newer snapshot before resolving.
    }
  })();

  flushInFlight.set(accountId, run);
  try {
    await run;
  } finally {
    if (flushInFlight.get(accountId) === run) flushInFlight.delete(accountId);
  }
}

/** セッション復元直後にディスクをメモリへ載せる */
export async function warmAccountCache(accountId: string): Promise<void> {
  await getDb(accountId);
  log.debug({ accountId }, "chat cache warmed");
}

export async function upsertChats(
  accountId: string,
  chats: StoredChat[],
  meta?: Partial<Pick<ChatDbMeta, "boxOrder" | "lastOpRevision">>,
): Promise<void> {
  const db = await getDb(accountId);
  for (const chat of chats) {
    const existing = db.chats[chat.mid];
    if (!existing) {
      db.chats[chat.mid] = chat;
      continue;
    }

    const incomingTime = chat.lastMessageTime ?? 0;
    const existingTime = existing.lastMessageTime ?? 0;
    const keepExistingLast = existingTime > incomingTime;
    const incomingNameIsFallback =
      !chat.name || chat.name === chat.mid || chat.name === "(No Name)";
    const incomingKindIsFallback = chat.kind === "unknown";

    db.chats[chat.mid] = {
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
      ...(keepExistingLast && existing.lastMessagePreview
        ? { lastMessagePreview: existing.lastMessagePreview }
        : chat.lastMessagePreview
          ? { lastMessagePreview: chat.lastMessagePreview }
          : existing.lastMessagePreview
            ? { lastMessagePreview: existing.lastMessagePreview }
            : {}),
      ...(existing.restoredHistory || chat.restoredHistory ? { restoredHistory: true } : {}),
    };
  }
  if (meta?.boxOrder) db.meta.boxOrder = meta.boxOrder;
  if (meta?.lastOpRevision != null) db.meta.lastOpRevision = meta.lastOpRevision;
  db.meta.chatsSyncedAt = new Date().toISOString();
  scheduleSave(accountId);
}

export async function upsertMessages(
  accountId: string,
  chatMid: string,
  messages: StoredMessage[],
): Promise<void> {
  const db = await getDb(accountId);
  const byChat = db.messages[chatMid] ?? {};
  const nextMessages: StoredMessage[] = [];
  for (const message of messages) {
    const prev =
      byChat[message.id] ?? readMessageSqlite(accountId, chatMid, message.id) ?? undefined;
    const prevRevoked =
      Boolean(prev?.revokedSnapshot) || Boolean(prev?.messageState?.startsWith("revoked"));
    const incomingRevoked =
      Boolean(message.revokedSnapshot) || Boolean(message.messageState?.startsWith("revoked"));
    const next: StoredMessage = {
      ...message,
      history: prev?.history?.length ? prev.history : message.history,
      ...mergeStoredReadState(prev, message),
      // Local deletion is user-owned state. A later server sync must not
      // resurrect the row; only restoreDeletedMessage may clear this flag.
      ...(prev?.isDeleted
        ? { isDeleted: true, deletedAt: prev.deletedAt ?? null }
        : message.isDeleted
          ? { isDeleted: true, deletedAt: message.deletedAt ?? null }
          : {}),
    };
    const revokedSnapshot = prev?.revokedSnapshot ?? message.revokedSnapshot;
    if (revokedSnapshot) next.revokedSnapshot = revokedSnapshot;
    if (prevRevoked && !incomingRevoked) {
      next.messageState =
        prev?.messageState ?? (prev?.isMyMessage ? "revoked-by-self" : "revoked-by-other");
      next.contentType = prev ? prev.contentType : message.contentType;
      next.text = prev ? prev.text : message.text;
    }
    byChat[message.id] = next;
    nextMessages.push(next);
  }
  applyLocalReadWatermark(byChat, db.meta.localReadUpTo?.[chatMid]?.messageId);
  // Write before trimming the in-memory page. This makes large sync batches
  // bounded in RAM while keeping every message durable immediately.
  upsertMessagesSqlite(accountId, nextMessages);
  // Only retain the hot tail in memory. The complete batch is persisted by
  // the debounced transactional UPSERT; evicting it from this map is safe.
  cacheMessages(db, chatMid, Object.values(byChat));
  db.meta.messagesSyncedAt = db.meta.messagesSyncedAt ?? {};
  db.meta.messagesSyncedAt[chatMid] = new Date().toISOString();
  scheduleSave(accountId);
}

/**
 * 自分が送った既読位置を、受信メッセージだけへ単調に反映する。
 * 相手が読んだ自分のメッセージの既読状態とは別の情報である。
 */
export function applyLocalReadWatermark(
  messages: Record<string, StoredMessage>,
  upToMessageId: string | undefined,
): void {
  if (!upToMessageId) return;
  let upTo: bigint;
  try {
    upTo = BigInt(upToMessageId);
  } catch {
    return;
  }
  for (const message of Object.values(messages)) {
    if (message.isMyMessage) continue;
    try {
      if (BigInt(message.id) <= upTo) message.seen = true;
    } catch {
      /* non-numeric local IDs cannot be part of a server read range */
    }
  }
}

/** 既読リクエスト成功後、同じ地点以前の受信メッセージをDBへ単調に保存する。 */
export async function markStoredMessagesReadThrough(
  accountId: string,
  chatMid: string,
  messageId: string,
  readerMid = "self",
): Promise<void> {
  const db = await getDb(accountId);
  const current =
    readerMid === "self"
      ? db.meta.localReadUpTo?.[chatMid]?.messageId
      : db.meta.readCursors?.[chatMid]?.[readerMid]?.messageId;
  try {
    if (current && BigInt(current) > BigInt(messageId)) return;
  } catch {
    /* replace malformed legacy cursor */
  }
  const at = new Date().toISOString();
  db.meta.readCursors = {
    ...db.meta.readCursors,
    [chatMid]: { ...(db.meta.readCursors?.[chatMid] ?? {}), [readerMid]: { messageId, at } },
  };
  if (readerMid === "self") {
    db.meta.localReadUpTo = { ...db.meta.localReadUpTo, [chatMid]: { messageId, at } };
    applyLocalReadWatermark(db.messages[chatMid] ?? {}, messageId);
    const chat = db.chats[chatMid];
    if (chat) chat.unreadCount = 0;
  } else {
    for (const message of Object.values(db.messages[chatMid] ?? {})) {
      if (!message.isMyMessage) continue;
      try {
        if (BigInt(message.id) <= BigInt(messageId)) {
          message.readBy = [...new Set([...(message.readBy ?? []), readerMid])];
          message.readAtBy = { ...(message.readAtBy ?? {}), [readerMid]: at };
          message.readCount = Math.max(message.readCount ?? 0, message.readBy.length);
        }
      } catch {
        /* local/non-numeric IDs cannot be ranged */
      }
    }
  }
  // The cursor is authoritative even when the affected messages are not in
  // the hot page. Persist the message-side receipt changes without loading
  // the whole conversation.
  if (readerMid === "self") {
    const sqlite = openSqlite(accountId);
    try {
      sqlite.run(
        "UPDATE messages SET payload = json_set(payload, '$.seen', 1) WHERE chat_mid = ? AND is_deleted = 0 AND is_my_message = 0 AND CAST(id AS INTEGER) <= CAST(? AS INTEGER)",
        [chatMid, messageId],
      );
    } finally {
      sqlite.close();
    }
  }
  scheduleSave(accountId);
}

/** レコードは保持したまま、通常の取得結果からだけ隠す削除。復元可能。 */
export async function softDeleteMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<boolean> {
  const db = await getDb(accountId);
  const message = hydrateMessage(accountId, db, chatMid, messageId);
  if (!message) return false;
  if (!message.isDeleted) {
    message.isDeleted = true;
    message.deletedAt = new Date().toISOString();
    upsertMessagesSqlite(accountId, [message]);
    scheduleSave(accountId);
  }
  return true;
}

export async function restoreDeletedMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<boolean> {
  const db = await getDb(accountId);
  const message = hydrateMessage(accountId, db, chatMid, messageId);
  if (!message || !message.isDeleted) return false;
  message.isDeleted = false;
  message.deletedAt = null;
  upsertMessagesSqlite(accountId, [message]);
  scheduleSave(accountId);
  return true;
}

/** push の DESTROY op で受け取った取消しを chatdb の該当メッセージへ反映 */
export async function markMessageRevoked(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<void> {
  const db = await getDb(accountId);
  const stored = hydrateMessage(accountId, db, chatMid, messageId);
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
  upsertMessagesSqlite(accountId, [stored]);
  scheduleSave(accountId);
}

/** 取消し済みメッセージを元に戻す（ローカル永続化）。LINE サーバー側は元に戻せないため chatStore のみ更新 */
export async function restoreRevokedMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<{ text: string | null; contentType: string } | null> {
  const db = await getDb(accountId);
  const stored = hydrateMessage(accountId, db, chatMid, messageId);
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
    if (snapshot.relatedMessageId !== undefined) {
      stored.relatedMessageId = snapshot.relatedMessageId;
    }
    if (snapshot.stickerAnimated !== undefined) stored.stickerAnimated = snapshot.stickerAnimated;
    if (snapshot.stickerSticky !== undefined) stored.stickerSticky = snapshot.stickerSticky;
    if (snapshot.reactions !== undefined) stored.reactions = snapshot.reactions;
  }
  upsertMessagesSqlite(accountId, [stored]);
  scheduleSave(accountId);
  return { text: restoredText, contentType: restoredContentType };
}

export async function getMessageHistory(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<Message["history"]> {
  const db = await getDb(accountId);
  const stored = hydrateMessage(accountId, db, chatMid, messageId);
  return stored?.history ?? [];
}

export async function getMessages(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number; includeDeleted?: boolean },
): Promise<StoredMessage[]> {
  const db = await getDb(accountId);
  const pageById = new Map(
    readMessagesSqlite(accountId, chatMid, limit, opts).map((message) => [message.id, message]),
  );
  // Include mutations still inside the debounce window. The cache is bounded,
  // so this merge cannot turn a read into an unbounded memory allocation.
  for (const message of Object.values(db.messages[chatMid] ?? {})) {
    if (!opts?.includeDeleted && message.isDeleted) continue;
    if (opts?.beforeDeliveredTime != null) {
      if (message.createdTime > opts.beforeDeliveredTime) continue;
      if (message.createdTime === opts.beforeDeliveredTime) {
        if (opts.beforeMessageId == null) continue;
        if (compareMessageIdsAscending(message.id, opts.beforeMessageId) >= 0) continue;
      }
    }
    pageById.set(message.id, message);
  }
  const page = [...pageById.values()]
    .sort(compareMessagesNewestFirst)
    .slice(0, Math.max(0, Math.min(limit, 2_000)));
  // Keep only the page most recently used by callers. This also makes
  // subsequent read-state mutations cheap without turning the page into a
  // second database.
  cacheMessages(db, chatMid, page);
  return page;
}

export async function findStoredMessageById(
  accountId: string,
  messageId: string,
): Promise<{ chatMid: string; message: StoredMessage } | null> {
  const db = await getDb(accountId);
  for (const [chatMid, messages] of Object.entries(db.messages)) {
    const message = messages[messageId];
    if (message) return { chatMid, message };
  }
  const sqlite = openSqlite(accountId);
  try {
    const row = sqlite
      .prepare("SELECT chat_mid, payload FROM messages WHERE id = ? LIMIT 1")
      .get(messageId) as { chat_mid: string; payload: string } | null;
    if (row) return { chatMid: row.chat_mid, message: JSON.parse(row.payload) as StoredMessage };
  } finally {
    sqlite.close();
  }
  return null;
}

function storedChatToChat(stored: StoredChat): Chat {
  const chat: Chat = {
    mid: stored.mid,
    name: stored.name,
    hasMessages: stored.hasMessages,
    kind: stored.kind,
    lastMessageTime: stored.lastMessageTime ?? 0,
  };
  if (stored.lastMessageId) chat.lastMessageId = stored.lastMessageId;
  if (stored.thumbnailUrl) chat.thumbnailUrl = stored.thumbnailUrl;
  if (stored.lastMessagePreview) chat.lastMessagePreview = stored.lastMessagePreview;
  if (stored.unreadCount != null) chat.unreadCount = stored.unreadCount;
  if (stored.isOfficial) chat.isOfficial = true;
  if (stored.restoredHistory) chat.restoredHistory = true;
  return chat;
}

function storedMessageToMessage(stored: StoredMessage): Message {
  // Older Android/iOS restores stored received group messages with to=self MID.
  // Normalize on read so already-imported histories become visible immediately
  // after upgrading, without requiring users to delete or re-import chatdb.
  const to =
    stored.chatMid.startsWith("c") || stored.chatMid.startsWith("r") ? stored.chatMid : stored.to;
  const msg: Message = {
    id: stored.id,
    from: stored.from,
    to,
    text: stored.text,
    contentType: stored.contentType,
    createdTime: stored.createdTime,
    isMyMessage: stored.isMyMessage,
    contentMetadata: stored.contentMetadata ?? null,
    messageState: stored.messageState ?? "normal",
  };
  if (stored.history) msg.history = stored.history;
  if (stored.revokedSnapshot) msg.revokedSnapshot = stored.revokedSnapshot;
  if (stored.readCount != null) msg.readCount = stored.readCount;
  if (stored.readBy) msg.readBy = stored.readBy;
  if (stored.seen != null) msg.seen = stored.seen;
  if (stored.relatedMessageId) msg.relatedMessageId = stored.relatedMessageId;
  if (stored.stickerAnimated) msg.stickerAnimated = true;
  if (stored.stickerSticky) msg.stickerSticky = true;
  if (stored.reactions?.length) msg.reactions = stored.reactions;
  return msg;
}

/** Desktop 準拠: boxOrder 順、無ければ lastMessageTime 降順 */
export async function getStoredChats(accountId: string): Promise<Chat[]> {
  const db = await getDb(accountId);
  const chats = Object.values(db.chats);
  if (chats.length === 0) return [];

  const order = db.meta.boxOrder ?? [];
  const byMid = new Map(chats.map((c) => [c.mid, c]));
  const result: Chat[] = [];
  const seen = new Set<string>();

  for (const mid of order) {
    const c = byMid.get(mid);
    if (!c) continue;
    result.push(storedChatToChat(c));
    seen.add(mid);
  }

  const tail = chats
    .filter((c) => !seen.has(c.mid))
    .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));

  for (const c of tail) {
    result.push(storedChatToChat(c));
  }
  return result;
}

export async function getStoredMessages(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number; includeDeleted?: boolean },
): Promise<Message[]> {
  const stored = await getMessages(accountId, chatMid, limit, opts);
  return stored.map(storedMessageToMessage);
}

export type BootstrapPayload = {
  chats: Chat[];
  messagesByChat: Record<string, Message[]>;
  syncedAt: string | null;
  chatsSyncedAt: string | null;
};

/** 起動時一括 hydrate（Desktop ローカル DB 相当） */
export async function getBootstrapPayload(accountId: string): Promise<BootstrapPayload> {
  const db = await getDb(accountId);
  const chats = await getStoredChats(accountId);
  const messagesByChat: Record<string, Message[]> = {};

  const topMids = chats
    .filter((c) => c.hasMessages)
    .slice(0, BOOTSTRAP_TOP_CHATS)
    .map((c) => c.mid);

  for (const mid of topMids) {
    messagesByChat[mid] = await getStoredMessages(accountId, mid, BOOTSTRAP_MSG_LIMIT);
  }

  return {
    chats,
    messagesByChat,
    syncedAt: db.meta.chatsSyncedAt ?? null,
    chatsSyncedAt: db.meta.chatsSyncedAt ?? null,
  };
}

export async function getCacheMeta(accountId: string): Promise<ChatDbMeta> {
  const db = await getDb(accountId);
  return { ...db.meta };
}

export function messageSyncAgeMs(meta: ChatDbMeta, chatMid: string): number | null {
  const iso = meta.messagesSyncedAt?.[chatMid];
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Date.now() - t : null;
}

export async function saveBoxOrder(accountId: string, boxOrder: string[]): Promise<void> {
  const db = await getDb(accountId);
  db.meta.boxOrder = boxOrder;
  scheduleSave(accountId);
}

/** VylineBackup: コンテナだけコピーした参照スナップショットを返す。
 * 個々のメッセージオブジェクトは不変扱いのため clone しない
 * （全件 deep copy は DB サイズ分のメモリを一時的に 2〜3 重で消費していた） */
export async function exportChatDb(accountId: string): Promise<ChatDb> {
  const db = await getDb(accountId);
  const messages = readAllMessages(accountId);
  return {
    meta: {
      ...db.meta,
      ...(db.meta.messagesSyncedAt ? { messagesSyncedAt: { ...db.meta.messagesSyncedAt } } : {}),
    },
    chats: { ...db.chats },
    messages,
  };
}

/** VylineBackup: 復元（マージ書き込み）。新規端末なら空 DB への上書きと同義 */
export async function importChatDb(
  accountId: string,
  data: Pick<ChatDb, "meta" | "chats" | "messages">,
): Promise<{ chats: number; messages: number }> {
  const db = await getDb(accountId);
  let chatCount = 0;
  let messageCount = 0;
  for (const [mid, chat] of Object.entries(data.chats ?? {})) {
    db.chats[mid] = chat;
    chatCount++;
  }
  for (const [chatMid, byChat] of Object.entries(data.messages ?? {})) {
    const target = db.messages[chatMid] ?? {};
    for (const [id, message] of Object.entries(byChat)) {
      target[id] = message;
      messageCount++;
    }
    db.messages[chatMid] = target;
  }
  const importedReadCursors = mergeReadCursors(db.meta.readCursors, data.meta?.readCursors);
  const importedLocalReadUpTo = mergeLocalReadUpTo(db.meta.localReadUpTo, data.meta?.localReadUpTo);
  if (importedReadCursors) db.meta.readCursors = importedReadCursors;
  if (importedLocalReadUpTo) db.meta.localReadUpTo = importedLocalReadUpTo;
  for (const [chatMid, messages] of Object.entries(db.messages)) {
    applyLocalReadWatermark(messages, db.meta.localReadUpTo?.[chatMid]?.messageId);
  }
  if (data.meta?.boxOrder && !db.meta.boxOrder) db.meta.boxOrder = data.meta.boxOrder;
  if (
    data.meta?.chatsSyncedAt &&
    (!db.meta.chatsSyncedAt || data.meta.chatsSyncedAt > db.meta.chatsSyncedAt)
  ) {
    db.meta.chatsSyncedAt = data.meta.chatsSyncedAt;
  }
  db.meta.messagesSyncedAt = db.meta.messagesSyncedAt ?? {};
  for (const [chatMid, iso] of Object.entries(data.meta?.messagesSyncedAt ?? {})) {
    if (!db.meta.messagesSyncedAt[chatMid] || iso > db.meta.messagesSyncedAt[chatMid]) {
      db.meta.messagesSyncedAt[chatMid] = iso;
    }
  }
  rebuildChatDbRecords(db);
  scheduleSave(accountId);
  return { chats: chatCount, messages: messageCount };
}

/** 外部履歴を追加専用でマージする。既存メッセージは上書きしないため再実行できる。 */
export function mergeChatDbRecords(
  target: ChatDbRecords,
  incoming: ChatDbRecords,
): ChatDbMergeResult {
  let importedChats = 0;
  let skippedChats = 0;
  let importedMessages = 0;
  let skippedMessages = 0;

  for (const [mid, incomingChat] of Object.entries(incoming.chats ?? {})) {
    const existing = target.chats[mid];
    if (!existing) {
      target.chats[mid] = incomingChat;
      importedChats++;
      continue;
    }

    skippedChats++;
    const incomingIsNewer = (incomingChat.lastMessageTime ?? 0) > (existing.lastMessageTime ?? 0);
    const incomingKindShouldWin =
      incomingChat.kind !== "unknown" &&
      (existing.kind === "unknown" ||
        ((mid.startsWith("c") || mid.startsWith("r")) && incomingChat.kind === "group"));
    target.chats[mid] = {
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
    };
  }

  for (const [chatMid, incomingMessages] of Object.entries(incoming.messages ?? {})) {
    const targetMessages = target.messages[chatMid] ?? {};
    for (const [id, incomingMessage] of Object.entries(incomingMessages)) {
      const existing = targetMessages[id];
      if (existing) {
        // 通常同期を優先しつつ、iOS側にしかない本文・メディア情報は欠損補完する。
        targetMessages[id] = {
          ...incomingMessage,
          ...existing,
          ...mergeStoredReadState(existing, incomingMessage),
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
          ...(existing.isDeleted || incomingMessage.isDeleted
            ? {
                isDeleted: existing.isDeleted ?? incomingMessage.isDeleted,
                deletedAt: existing.deletedAt ?? incomingMessage.deletedAt,
              }
            : {}),
        };
        skippedMessages++;
        continue;
      }
      targetMessages[id] = incomingMessage;
      importedMessages++;
    }

    target.messages[chatMid] = targetMessages;
  }

  rebuildChatDbRecords(target);
  return { importedChats, skippedChats, importedMessages, skippedMessages };
}

/**
 * iOS復元・通常同期で混在したレコードを、複合時刻順と実メッセージの最新値で正規化する。
 * レコードは削除せず、同一IDは既存の正本を保持する。
 */
export function rebuildChatDbRecords(target: ChatDbRecords): { chats: number; messages: number } {
  let messages = 0;
  const allMids = new Set([...Object.keys(target.chats), ...Object.keys(target.messages)]);
  for (const chatMid of allMids) {
    const byChat = target.messages[chatMid] ?? {};
    // Repair legacy restore records in-place as well. LINE group/room messages
    // always target the chat MID, regardless of who sent them.
    if (chatMid.startsWith("c") || chatMid.startsWith("r")) {
      for (const message of Object.values(byChat)) message.to = chatMid;
    }
    const ordered = Object.values(byChat).sort(compareMessagesOldestFirst);
    target.messages[chatMid] = Object.fromEntries(ordered.map((message) => [message.id, message]));
    messages += ordered.length;
    const latest = ordered.at(-1);
    if (!latest) continue;
    const existing = target.chats[chatMid];
    const preview = previewForMessage(latest);
    const preservedPreview =
      existing &&
      shouldPreserveResolvedLastMessagePreview(existing, {
        lastMessageId: latest.id,
        lastMessageTime: latest.createdTime,
        lastMessagePreview: preview,
      })
        ? existing.lastMessagePreview
        : preview;
    target.chats[chatMid] = {
      mid: chatMid,
      name: existing?.name || chatMid,
      kind: existing?.kind ?? "direct",
      hasMessages: true,
      lastMessageTime: latest.createdTime,
      lastMessageId: latest.id,
      ...(preservedPreview ? { lastMessagePreview: preservedPreview } : {}),
      ...(existing?.thumbnailUrl ? { thumbnailUrl: existing.thumbnailUrl } : {}),
      ...(existing?.unreadCount != null ? { unreadCount: existing.unreadCount } : {}),
      ...(existing?.isOfficial != null ? { isOfficial: existing.isOfficial } : {}),
      ...(existing?.restoredHistory ? { restoredHistory: true } : {}),
      updatedAt: existing?.updatedAt ?? latest.savedAt,
    };
  }
  return { chats: Object.keys(target.chats).length, messages };
}

/** iOS / 外部履歴復元用の永続マージ。 */
export async function mergeImportedChatDb(
  accountId: string,
  incoming: ChatDbRecords,
): Promise<ChatDbMergeResult> {
  const db = await getDb(accountId);
  const result = mergeChatDbRecords(db, incoming);
  const importedReadCursors = mergeReadCursors(db.meta.readCursors, incoming.meta?.readCursors);
  const importedLocalReadUpTo = mergeLocalReadUpTo(
    db.meta.localReadUpTo,
    incoming.meta?.localReadUpTo,
  );
  if (importedReadCursors) db.meta.readCursors = importedReadCursors;
  if (importedLocalReadUpTo) db.meta.localReadUpTo = importedLocalReadUpTo;
  if (incoming.meta?.boxOrder && !db.meta.boxOrder) db.meta.boxOrder = incoming.meta.boxOrder;
  if (
    incoming.meta?.chatsSyncedAt &&
    (!db.meta.chatsSyncedAt || incoming.meta.chatsSyncedAt > db.meta.chatsSyncedAt)
  ) {
    db.meta.chatsSyncedAt = incoming.meta.chatsSyncedAt;
  }
  db.meta.messagesSyncedAt = db.meta.messagesSyncedAt ?? {};
  for (const [chatMid, iso] of Object.entries(incoming.meta?.messagesSyncedAt ?? {})) {
    if (!db.meta.messagesSyncedAt[chatMid] || iso > db.meta.messagesSyncedAt[chatMid]) {
      db.meta.messagesSyncedAt[chatMid] = iso;
    }
  }
  for (const [chatMid, messages] of Object.entries(db.messages)) {
    applyLocalReadWatermark(messages, db.meta.localReadUpTo?.[chatMid]?.messageId);
  }
  // mergeChatDbRecords can normalize/repair records even when every incoming
  // message ID already exists, so every restore attempt must become durable.
  scheduleSave(accountId);
  return result;
}

/** 現在のアカウントDBを退避してから、順序とチャット要約を再構築する。 */
export async function rebuildAccountChatDb(
  accountId: string,
): Promise<{ chats: number; messages: number; backupFile: string }> {
  const db = await getDb(accountId);
  await flushDb(accountId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `chatdb.before-rebuild-${stamp}.json`;
  await writeFile(accountFile(accountId, backupFile), JSON.stringify(db), "utf8");
  const result = rebuildChatDbRecords(db);
  scheduleSave(accountId);
  await flushDb(accountId);
  return { ...result, backupFile };
}

/** 復元完了時に、遅延保存を待たずにDBへ確実に書き出す。 */
export async function flushAccountChatDb(accountId: string): Promise<void> {
  await flushDb(accountId);
}

/** VylineBackup: チャット一覧とメッセージ件数（選択 UI 用） */
export async function listChatsWithCounts(
  accountId: string,
): Promise<Array<{ mid: string; name: string; messageCount: number }>> {
  const db = await getDb(accountId);
  const sqlite = openSqlite(accountId);
  const countRows = sqlite
    .prepare("SELECT chat_mid, COUNT(*) AS count FROM messages GROUP BY chat_mid")
    .all() as Array<{ chat_mid: string; count: number }>;
  const counts = new Map<string, number>(countRows.map((row) => [row.chat_mid, row.count]));
  sqlite.close();
  return Object.keys(db.chats).map((mid) => {
    const chat = db.chats[mid];
    const messageCount = counts.get(mid) ?? 0;
    return { mid, name: chat?.name ?? mid, messageCount };
  });
}
