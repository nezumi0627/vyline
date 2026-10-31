/**
 * chatStore.ts — Desktop 相当のローカルメッセージキャッシュ
 *
 * SQLite を正本とする local-first キャッシュ。旧 JSON は初回移行専用。
 * 起動時はディスク → メモリで即返却、RPC はバックグラウンド同期。
 */

import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Chat,
  Message,
  MessageContentMeta,
  MessageReaction,
  MessageSnapshot,
} from "@vyline/types";
import { childLogger } from "../logger.js";
import { accountFile, ensureAccount } from "./accountDirs.js";
import {
  deleteStoredMessage,
  deleteOperationInboxBatch,
  ensureRelationalChatSchema,
  getDeletedMessageIds,
  isStoredMessageDeleted,
  markMessagesReadThrough,
  readChatMeta,
  readStoredChat,
  readStoredChatById,
  readStoredChats,
  readLatestStoredMessage,
  readStoredMessage,
  readStoredMessages,
  readStoredMessagesByIds,
  scanStoredMessageRows,
  searchStoredMessageRows,
  readLocalReadPosition,
  readOperationSyncCursor as readStoredOperationSyncCursor,
  readOperationInboxBatches,
  writeChatMeta,
  writeChatBoxOrder,
  writeChatSyncState,
  writeLocalReadPosition,
  writeOperationSyncCursor as writeStoredOperationSyncCursor,
  insertOperationInboxBatch,
  writeMessagesSyncedAt,
  writeStoredChat,
  writeStoredMessage,
} from "./chatStoreRelational.js";
import { migrateOnce, sqlite } from "./sqlite.js";
import { decodeOperationBatch, encodeOperationBatch, operationBatchId } from "./operationInboxCodec.js";

const log = childLogger("chatStore");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");

const SAVE_DEBOUNCE_MS = Number(process.env.VYLINE_CHATDB_SAVE_MS ?? 400);
const BOOTSTRAP_TOP_CHATS = Number(process.env.VYLINE_BOOTSTRAP_TOP_CHATS ?? 12);
const BOOTSTRAP_MSG_LIMIT = Number(process.env.VYLINE_BOOTSTRAP_MSG_LIMIT ?? 40);

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
}

interface ChatDb {
  meta: ChatDbMeta;
  chats: Record<string, StoredChat>;
  messages: Record<string, Record<string, StoredMessage>>;
}

export interface ChatDbRecords {
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
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (!leftNumeric) return left.localeCompare(right);
  const byLength = left.length - right.length;
  return byLength || left.localeCompare(right);
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

const memory = new Map<string, ChatDb>();
const dirty = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
type DeferredWrites = {
  full: boolean;
  meta: boolean;
  syncState: boolean;
  boxOrder: boolean;
  chats: Set<string>;
  messages: Map<string, Set<string>>;
};
const deferredWrites = new Map<string, DeferredWrites>();
const chatMigrationChecked = new Set<string>();

function withoutDeletedPreview(accountId: string, chat: StoredChat): StoredChat {
  if (!chat.lastMessageId || !isStoredMessageDeleted(accountId, chat.mid, chat.lastMessageId)) return chat;
  const db = memory.get(accountId);
  const latest = dirty.has(accountId) && db
    ? Object.values(db.messages[chat.mid] ?? {})
      .filter((message) => !isStoredMessageDeleted(accountId, chat.mid, message.id))
      .sort(compareMessagesNewestFirst)[0]
    : readLatestStoredMessage(accountId, chat.mid);
  const updated = { ...chat, hasMessages: Boolean(latest) };
  delete updated.lastMessageId;
  delete updated.lastMessageTime;
  delete updated.lastMessagePreview;
  if (latest) {
    updated.lastMessageId = latest.id;
    updated.lastMessageTime = latest.createdTime;
    updated.lastMessagePreview = previewForMessage(latest);
  }
  return updated;
}

function importChatJsonOnce(accountId: string, legacy: ChatDb | null): void {
  ensureRelationalChatSchema();
  migrateOnce(`chatdb-json-v1:${accountId}`, () => {
    if (!legacy) return;
    for (const chat of Object.values(legacy?.chats ?? {})) {
      writeStoredChat(accountId, chat);
    }
    for (const [chatMid, messages] of Object.entries(legacy?.messages ?? {})) {
      applyLocalReadWatermark(messages, legacy?.meta?.localReadUpTo?.[chatMid]?.messageId);
      for (const message of Object.values(messages)) {
        writeStoredMessage(accountId, chatMid, message);
      }
    }
    writeChatMeta(accountId, legacy?.meta ?? {});
  });
}

function dbPath(accountId: string): string {
  return accountFile(accountId, "chatdb.json");
}
const legacyDbPath = (accountId: string) => join(DATA_DIR, `chatdb-${accountId}.json`);

function emptyDb(): ChatDb {
  return { meta: {}, chats: {}, messages: {} };
}

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function ensureChatDbImported(accountId: string): Promise<void> {
  if (chatMigrationChecked.has(accountId)) return;
  await ensureDataDir();
  ensureRelationalChatSchema();
  const migration = sqlite.query("SELECT 1 FROM app_migrations WHERE name = ?")
    .get(`chatdb-json-v1:${accountId}`);
  if (migration) {
    chatMigrationChecked.add(accountId);
    return;
  }
  ensureAccount(accountId);
  const path = dbPath(accountId);
  const sourcePath = existsSync(path) ? path : legacyDbPath(accountId);
  let parsed: Partial<ChatDb> | null = null;
  if (existsSync(sourcePath)) {
    try {
      parsed = JSON.parse(await readFile(sourcePath, "utf-8")) as Partial<ChatDb>;
    } catch (err) {
      log.error({ accountId, err }, "chat db JSON import failed; source left untouched");
      throw err;
    }
  }
  const initial: ChatDb | null = parsed ? {
    meta: parsed.meta ?? {}, chats: parsed.chats ?? {}, messages: parsed.messages ?? {},
  } : null;
  importChatJsonOnce(accountId, initial);
  chatMigrationChecked.add(accountId);
}

async function loadDbFromDisk(accountId: string): Promise<ChatDb> {
  await ensureChatDbImported(accountId);
  const db = emptyDb();
  db.meta = readChatMeta(accountId);
  for (const chat of readStoredChats(accountId)) {
    db.chats[chat.mid] = chat;
  }
  for (const chat of Object.keys(db.chats)) {
    for (const message of readStoredMessages(accountId, chat)) {
      (db.messages[chat] ??= {})[message.id] = message;
    }
  }
  return db;
}

async function getDb(accountId: string): Promise<ChatDb> {
  const mem = memory.get(accountId);
  if (mem) return mem;
  const db = await loadDbFromDisk(accountId);
  memory.set(accountId, db);
  return db;
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

function scheduleSave(
  accountId: string,
  changes?: {
    meta?: boolean;
    syncState?: boolean;
    boxOrder?: boolean;
    chats?: Iterable<string>;
    messages?: Iterable<readonly [string, Iterable<string>]>;
  },
): void {
  dirty.add(accountId);
  let pending = deferredWrites.get(accountId);
  if (!pending) {
    pending = { full: false, meta: false, syncState: false, boxOrder: false, chats: new Set(), messages: new Map() };
    deferredWrites.set(accountId, pending);
  }
  if (!changes) pending.full = true;
  else {
    pending.meta ||= changes.meta === true;
    pending.syncState ||= changes.syncState === true;
    pending.boxOrder ||= changes.boxOrder === true;
    for (const mid of changes.chats ?? []) pending.chats.add(mid);
    for (const [chatMid, messageIds] of changes.messages ?? []) {
      let ids = pending.messages.get(chatMid);
      if (!ids) pending.messages.set(chatMid, (ids = new Set()));
      for (const id of messageIds) ids.add(id);
    }
  }
  const prev = saveTimers.get(accountId);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    accountId,
    setTimeout(() => {
      void flushDb(accountId);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** 既読情報はサーバ応答の欠落で巻き戻さない。未読を既読へ昇格させるのは明示値だけにする。 */
export function mergeStoredReadState(
  previous: Pick<StoredMessage, "seen" | "readCount" | "readBy"> | undefined,
  incoming: Pick<StoredMessage, "seen" | "readCount" | "readBy">,
): Pick<StoredMessage, "seen" | "readCount" | "readBy"> {
  const readBy = [...new Set([...(previous?.readBy ?? []), ...(incoming.readBy ?? [])])];
  const readCount = Math.max(previous?.readCount ?? 0, incoming.readCount ?? 0, readBy.length);
  return {
    ...(previous?.seen === true || incoming.seen === true ? { seen: true } : {}),
    ...(readCount > 0 ? { readCount } : {}),
    ...(readBy.length > 0 ? { readBy } : {}),
  };
}

async function flushDb(accountId: string): Promise<void> {
  if (!dirty.has(accountId)) return;
  dirty.delete(accountId);
  const pending = deferredWrites.get(accountId) ?? {
    full: true, meta: true, syncState: false, boxOrder: false,
    chats: new Set<string>(), messages: new Map<string, Set<string>>(),
  };
  deferredWrites.delete(accountId);
  const db = memory.get(accountId);
  if (!db) return;
  try {
    await ensureDataDir();
    ensureRelationalChatSchema();
    sqlite.transaction(() => {
      if (pending.full || pending.meta) writeChatMeta(accountId, db.meta);
      else {
        if (pending.boxOrder) writeChatBoxOrder(accountId, db.meta.boxOrder ?? []);
        if (pending.syncState) writeChatSyncState(accountId, db.meta.lastOpRevision, db.meta.chatsSyncedAt ?? new Date().toISOString());
      }
      const chatMids = pending.full ? Object.keys(db.chats) : pending.chats;
      for (const mid of chatMids) {
        const chat = db.chats[mid];
        if (chat) writeStoredChat(accountId, withoutDeletedPreview(accountId, chat));
      }
      const messageEntries = pending.full
        ? Object.entries(db.messages).map(([mid, messages]) => [mid, Object.keys(messages)] as const)
        : [...pending.messages].map(([mid, ids]) => [mid, [...ids]] as const);
      for (const [chatMid, messageIds] of messageEntries) {
        const messages = db.messages[chatMid];
        for (const id of messageIds) {
          const message = messages?.[id];
          if (!message) continue;
          writeStoredMessage(accountId, chatMid, message);
        }
      }
    }).immediate();
    // Dirty-mode account snapshots are only needed while a deferred write is
    // pending. Keeping every restored account resident after flush pins its
    // complete message history in memory without helping the SQLite read path.
    if (!dirty.has(accountId) && memory.get(accountId) === db) memory.delete(accountId);
  } catch (err) {
    // Keep the in-memory update eligible for persistence after transient I/O failures.
    scheduleSave(accountId);
    log.warn({ accountId, err }, "failed to save chat db");
  }
}

/** セッション復元直後にディスクをメモリへ載せる */
export async function warmAccountCache(accountId: string): Promise<void> {
  await ensureChatDbImported(accountId);
  log.debug({ accountId }, "chat database ready");
}

export async function upsertChats(
  accountId: string,
  chats: StoredChat[],
  meta?: Partial<Pick<ChatDbMeta, "boxOrder" | "lastOpRevision">>,
): Promise<void> {
  if (!dirty.has(accountId)) {
    await ensureChatDbImported(accountId);
    const db = memory.get(accountId);
    const stamp = new Date().toISOString();
    sqlite.transaction(() => {
      for (const incoming of chats) {
        const readUpTo = readLocalReadPosition(accountId, incoming.mid)?.messageId;
        const chat = withoutDeletedPreview(accountId, reconcileStoredUnreadWithReadPosition(incoming, readUpTo));
        writeStoredChat(accountId, chat);
        if (db) db.chats[chat.mid] = chat;
      }
      if (meta?.boxOrder) {
        writeChatBoxOrder(accountId, meta.boxOrder);
      }
      writeChatSyncState(accountId, meta?.lastOpRevision, stamp);
    }).immediate();
    if (db) {
      if (meta?.boxOrder) db.meta.boxOrder = meta.boxOrder;
      if (meta?.lastOpRevision != null) db.meta.lastOpRevision = meta.lastOpRevision;
      db.meta.chatsSyncedAt = stamp;
    }
    return;
  }
  const db = await getDb(accountId);
  for (const chat of chats) {
    const readUpTo = db.meta.localReadUpTo?.[chat.mid]?.messageId;
    db.chats[chat.mid] = withoutDeletedPreview(accountId, reconcileStoredUnreadWithReadPosition(chat, readUpTo));
  }
  if (meta?.boxOrder) db.meta.boxOrder = meta.boxOrder;
  if (meta?.lastOpRevision != null) db.meta.lastOpRevision = meta.lastOpRevision;
  db.meta.chatsSyncedAt = new Date().toISOString();
  scheduleSave(accountId, {
    chats: chats.map((chat) => chat.mid),
    syncState: true,
    boxOrder: Boolean(meta?.boxOrder),
  });
}

/** Persisted read position wins over a stale unread count for messages already read. */
export function reconcileStoredUnreadWithReadPosition<T extends {
  lastMessageId?: string;
  unreadCount?: number;
}>(chat: T, readUpTo?: string): T {
  if (chat.unreadCount == null || chat.unreadCount <= 0 || !readUpTo || !chat.lastMessageId) return chat;
  try {
    if (BigInt(readUpTo) >= BigInt(chat.lastMessageId)) return { ...chat, unreadCount: 0 };
  } catch {
    // Keep the LINE count if message ID ordering cannot be established.
  }
  return chat;
}

export async function upsertMessages(
  accountId: string,
  chatMid: string,
  messages: StoredMessage[],
): Promise<void> {
  if (!dirty.has(accountId)) {
    await ensureChatDbImported(accountId);
    const db = memory.get(accountId);
    const localReadMessageId = readLocalReadPosition(accountId, chatMid)?.messageId;
    const cachedChat = db?.messages[chatMid];
    const previousById = cachedChat
      ? cachedChat
      : new Map(
          readStoredMessagesByIds(accountId, chatMid, messages.map((message) => message.id))
            .map((message) => [message.id, message] as const),
        );
    const stamp = new Date().toISOString();
    sqlite.transaction(() => {
      for (const message of messages) {
        if (isStoredMessageDeleted(accountId, chatMid, message.id)) continue;
        const prev = previousById instanceof Map
          ? previousById.get(message.id)
          : previousById[message.id];
        const prevRevoked = Boolean(prev?.revokedSnapshot) || Boolean(prev?.messageState?.startsWith("revoked"));
        const incomingRevoked = Boolean(message.revokedSnapshot) || Boolean(message.messageState?.startsWith("revoked"));
        const next: StoredMessage = {
          ...message,
          savedAt: prev?.savedAt ?? message.savedAt,
          history: prev?.history?.length ? prev.history : message.history,
          ...mergeStoredReadState(prev, message),
        };
        const revokedSnapshot = prev?.revokedSnapshot ?? message.revokedSnapshot;
        if (revokedSnapshot) next.revokedSnapshot = revokedSnapshot;
        if (prevRevoked && !incomingRevoked) {
          next.messageState = prev?.messageState ?? (prev?.isMyMessage ? "revoked-by-self" : "revoked-by-other");
          next.contentType = prev ? prev.contentType : message.contentType;
          next.text = prev ? prev.text : message.text;
        }
        applyLocalReadWatermark({ [next.id]: next }, localReadMessageId);
        if (!prev || !isDeepStrictEqual(prev, next)) {
          writeStoredMessage(accountId, chatMid, next);
          if (db) (db.messages[chatMid] ??= {})[next.id] = next;
        }
      }
      writeMessagesSyncedAt(accountId, chatMid, stamp);
    }).immediate();
    if (db) db.meta.messagesSyncedAt = { ...db.meta.messagesSyncedAt, [chatMid]: stamp };
    return;
  }
  const db = await getDb(accountId);
  const byChat = db.messages[chatMid] ?? {};
  for (const message of messages) {
    if (isStoredMessageDeleted(accountId, chatMid, message.id)) continue;
    const prev = byChat[message.id];
    const prevRevoked =
      Boolean(prev?.revokedSnapshot) || Boolean(prev?.messageState?.startsWith("revoked"));
    const incomingRevoked =
      Boolean(message.revokedSnapshot) || Boolean(message.messageState?.startsWith("revoked"));
    const next: StoredMessage = {
      ...message,
      savedAt: prev?.savedAt ?? message.savedAt,
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
    if (!prev || !isDeepStrictEqual(prev, next)) byChat[message.id] = next;
  }
  db.messages[chatMid] = byChat;
  const watermarkUpdates = applyLocalReadWatermark(byChat, db.meta.localReadUpTo?.[chatMid]?.messageId);
  db.meta.messagesSyncedAt = db.meta.messagesSyncedAt ?? {};
  db.meta.messagesSyncedAt[chatMid] = new Date().toISOString();
  scheduleSave(accountId, {
    messages: [[chatMid, [...messages.map((message) => message.id), ...watermarkUpdates]]],
    meta: true,
  });
}

/**
 * 自分が送った既読位置を、受信メッセージだけへ単調に反映する。
 * 相手が読んだ自分のメッセージの既読状態とは別の情報である。
 */
export function applyLocalReadWatermark(
  messages: Record<string, StoredMessage>,
  upToMessageId: string | undefined,
): string[] {
  if (!upToMessageId) return [];
  let upTo: bigint;
  try {
    upTo = BigInt(upToMessageId);
  } catch {
    return [];
  }
  const marked: string[] = [];
  for (const message of Object.values(messages)) {
    if (message.isMyMessage) continue;
    try {
      if (BigInt(message.id) <= upTo && message.seen !== true) {
        message.seen = true;
        marked.push(message.id);
      }
    } catch {
      /* non-numeric local IDs cannot be part of a server read range */
    }
  }
  return marked;
}

/** 既読リクエスト成功後、同じ地点以前の受信メッセージをDBへ単調に保存する。 */
export async function markStoredMessagesReadThrough(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<void> {
  if (!dirty.has(accountId)) {
    await ensureChatDbImported(accountId);
    const current = readLocalReadPosition(accountId, chatMid)?.messageId;
    try { if (current && BigInt(current) > BigInt(messageId)) return; } catch { /* replace malformed cursor */ }
    const at = new Date().toISOString();
    const db = memory.get(accountId);
    const chat = db?.chats[chatMid] ?? readStoredChatById(accountId, chatMid);
    if (chat) chat.unreadCount = 0;
    sqlite.transaction(() => {
      writeLocalReadPosition(accountId, chatMid, messageId, at);
      if (chat) writeStoredChat(accountId, chat);
      markMessagesReadThrough(accountId, chatMid, messageId);
    }).immediate();
    if (db) applyLocalReadWatermark(db.messages[chatMid] ?? {}, messageId);
    if (db) {
      db.meta.localReadUpTo = { ...db.meta.localReadUpTo, [chatMid]: { messageId, at } };
      if (chat) db.chats[chatMid] = chat;
    }
    return;
  }
  const db = await getDb(accountId);
  const current = db.meta.localReadUpTo?.[chatMid]?.messageId;
  try {
    if (current && BigInt(current) > BigInt(messageId)) return;
  } catch {
    /* replace malformed legacy cursor */
  }
  db.meta.localReadUpTo = {
    ...db.meta.localReadUpTo,
    [chatMid]: { messageId, at: new Date().toISOString() },
  };
  applyLocalReadWatermark(db.messages[chatMid] ?? {}, messageId);
  const chat = db.chats[chatMid];
  if (chat) chat.unreadCount = 0;
  scheduleSave(accountId, {
    chats: db.chats[chatMid] ? [chatMid] : [],
    messages: [[chatMid, Object.keys(db.messages[chatMid] ?? {})]],
    meta: true,
  });
}

/** push の DESTROY op で受け取った取消しを chatdb の該当メッセージへ反映 */
export async function markMessageRevoked(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<void> {
  let db = memory.get(accountId);
  if (dirty.has(accountId)) db = await getDb(accountId);
  else await ensureChatDbImported(accountId);
  const stored = db?.messages[chatMid]?.[messageId] ?? (!dirty.has(accountId)
    ? readStoredMessage(accountId, chatMid, messageId)
    : undefined);
  if (!stored) return;
  if (stored.messageState?.startsWith("revoked")) return;
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
  if (dirty.has(accountId)) scheduleSave(accountId, { messages: [[chatMid, [messageId]]] });
  else {
    sqlite.transaction(() => writeStoredMessage(accountId, chatMid, stored))();
    if (db) (db.messages[chatMid] ??= {})[messageId] = stored;
  }
}

/**
 * Local deletion keeps only an account/chat-scoped ID tombstone to reject future sync.
 * Existing backup files are separate copies and are not purged by this operation.
 */
export async function deleteRevokedMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<"deleted" | "not-found" | "not-revoked"> {
  await ensureChatDbImported(accountId);
  const db = memory.get(accountId);
  let updatedChat: StoredChat | undefined;
  const result = sqlite.transaction(() => {
    if (isStoredMessageDeleted(accountId, chatMid, messageId)) return "deleted" as const;
    const stored = db?.messages[chatMid]?.[messageId] ?? readStoredMessage(accountId, chatMid, messageId);
    if (!stored) return "not-found" as const;
    if (!stored.messageState?.startsWith("revoked") && !stored.revokedSnapshot && stored.contentType !== "UNSENT") {
      return "not-revoked" as const;
    }
    deleteStoredMessage(accountId, chatMid, messageId);
    const chat = db?.chats[chatMid] ?? readStoredChatById(accountId, chatMid);
    if (chat?.lastMessageId === messageId) {
      updatedChat = withoutDeletedPreview(accountId, chat);
      writeStoredChat(accountId, updatedChat);
    }
    return "deleted" as const;
  }).immediate();
  if (result === "deleted") {
    // Commit can fail after all statements succeed (for example, deferred constraints).
    if (db && updatedChat) db.chats[chatMid] = updatedChat;
    if (db?.messages[chatMid]) delete db.messages[chatMid][messageId];
    deferredWrites.get(accountId)?.messages.get(chatMid)?.delete(messageId);
  }
  return result;
}

/** Filter network results too: the service may merge raw RPC rows after its DB upsert. */
export async function filterLocallyDeletedMessages<T extends { id: string }>(
  accountId: string,
  chatMid: string,
  messages: T[],
): Promise<T[]> {
  await ensureChatDbImported(accountId);
  const deletedIds = getDeletedMessageIds(accountId, chatMid, messages.map((message) => message.id));
  return messages.filter((message) => !deletedIds.has(message.id));
}

/** 取消し済みメッセージを元に戻す（ローカル永続化）。LINE サーバー側は元に戻せないため chatStore のみ更新 */
export async function restoreRevokedMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<{ text: string | null; contentType: string } | null> {
  let db = memory.get(accountId);
  if (dirty.has(accountId)) db = await getDb(accountId);
  else await ensureChatDbImported(accountId);
  const stored = db?.messages[chatMid]?.[messageId] ?? (!dirty.has(accountId)
    ? readStoredMessage(accountId, chatMid, messageId)
    : undefined);
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
  if (dirty.has(accountId)) scheduleSave(accountId, { messages: [[chatMid, [messageId]]] });
  else {
    sqlite.transaction(() => writeStoredMessage(accountId, chatMid, stored))();
    if (db) (db.messages[chatMid] ??= {})[messageId] = stored;
  }
  return { text: restoredText, contentType: restoredContentType };
}

export async function getMessageHistory(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<Message["history"]> {
  if (dirty.has(accountId)) return (await getDb(accountId)).messages[chatMid]?.[messageId]?.history ?? [];
  await ensureChatDbImported(accountId);
  return sqlite.query(`SELECT state, text, content_type AS contentType, updated_time AS updatedTime
    FROM chat_message_history_v2 WHERE account_id=? AND chat_mid=? AND message_id=? ORDER BY position`)
    .all(accountId, chatMid, messageId) as Message["history"];
}

export async function getMessages(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number },
): Promise<StoredMessage[]> {
  const pageLimit = Math.max(0, Math.floor(limit));
  if (pageLimit === 0) return [];
  if (!dirty.has(accountId)) await ensureChatDbImported(accountId);
  const pending = deferredWrites.get(accountId);
  const pendingIds = pending?.messages.get(chatMid);
  if (dirty.has(accountId) && pending?.full) {
    const cached = (await getDb(accountId)).messages[chatMid] ?? {};
    const before = opts?.beforeDeliveredTime;
    const beforeId = opts?.beforeMessageId;
    return Object.values(cached)
      .filter((message) => {
        if (before == null) return true;
        if (message.createdTime < before) return true;
        if (message.createdTime > before || beforeId == null) return false;
        return compareMessagesNewestFirst(message, { id: beforeId, createdTime: before }) > 0;
      })
      .sort(compareMessagesNewestFirst)
      .slice(0, pageLimit);
  }
  const queryLimit = pageLimit + (dirty.has(accountId) ? (pendingIds?.size ?? 0) : 0);
  const beforeTime = opts?.beforeDeliveredTime;
  const beforeId = opts?.beforeMessageId;
  let rows: Array<{ message_id: string }>;
  if (beforeTime == null) {
    rows = sqlite.query(`SELECT message_id FROM chat_messages_v2
      WHERE account_id = ? AND chat_mid = ?
      ORDER BY created_time DESC, CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = ''
        THEN 1 ELSE 0 END DESC,
        CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 0 ELSE length(message_id) END DESC,
        message_id DESC LIMIT ?`)
      .all(accountId, chatMid, queryLimit) as Array<{ message_id: string }>;
  } else {
    if (beforeId == null) {
      rows = sqlite.query(`SELECT message_id FROM chat_messages_v2 WHERE account_id = ? AND chat_mid = ? AND created_time < ?
          ORDER BY created_time DESC, CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = ''
            THEN 1 ELSE 0 END DESC,
            CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 0 ELSE length(message_id) END DESC,
            message_id DESC LIMIT ?`)
        .all(accountId, chatMid, beforeTime, queryLimit) as Array<{ message_id: string }>;
    } else if (/^\d+$/.test(beforeId)) {
      rows = sqlite.query(`SELECT message_id FROM chat_messages_v2 WHERE account_id = ? AND chat_mid = ?
          AND (created_time < ? OR (created_time = ? AND
            (message_id != '' AND message_id NOT GLOB '*[^0-9]*' AND (length(message_id) < length(?) OR
              (length(message_id) = length(?) AND message_id < ?)))))
          ORDER BY created_time DESC, CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = ''
            THEN 1 ELSE 0 END DESC,
            CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 0 ELSE length(message_id) END DESC,
            message_id DESC LIMIT ?`)
        .all(accountId, chatMid, beforeTime, beforeTime, beforeId, beforeId, beforeId, queryLimit) as Array<{ message_id: string }>;
    } else {
      rows = sqlite.query(`SELECT message_id FROM chat_messages_v2 WHERE account_id = ? AND chat_mid = ?
          AND (created_time < ? OR (created_time = ? AND
            (message_id = '' OR message_id GLOB '*[^0-9]*') AND message_id < ? OR
            (created_time = ? AND message_id != '' AND message_id NOT GLOB '*[^0-9]*')))
          ORDER BY created_time DESC, CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = ''
            THEN 1 ELSE 0 END DESC,
            CASE WHEN message_id GLOB '*[^0-9]*' OR message_id = '' THEN 0 ELSE length(message_id) END DESC,
            message_id DESC LIMIT ?`)
        .all(accountId, chatMid, beforeTime, beforeTime, beforeId, beforeTime, queryLimit) as Array<{ message_id: string }>;
    }
  }
  const messages = readStoredMessagesByIds(accountId, chatMid, rows.map((row) => row.message_id));
  if (!dirty.has(accountId) || !pendingIds?.size) return messages.slice(0, pageLimit);

  const byId = new Map(
    messages.filter((message) => !pendingIds.has(message.id)).map((message) => [message.id, message]),
  );
  const cached = (await getDb(accountId)).messages[chatMid] ?? {};
  const before = opts?.beforeDeliveredTime;
  const cursorId = opts?.beforeMessageId;
  for (const id of pendingIds) {
    const message = cached[id];
    if (!message) continue;
    if (
      before == null ||
      message.createdTime < before ||
      (message.createdTime === before && cursorId != null &&
        compareMessagesNewestFirst(message, { id: cursorId, createdTime: before }) > 0)
    ) {
      byId.set(id, message);
    }
  }
  return [...byId.values()].sort(compareMessagesNewestFirst).slice(0, pageLimit);
}

export async function findStoredMessageById(
  accountId: string,
  messageId: string,
): Promise<{ chatMid: string; message: StoredMessage } | null> {
  if (dirty.has(accountId)) {
    const db = await getDb(accountId);
    for (const [chatMid, messages] of Object.entries(db.messages)) {
      const message = messages[messageId];
      if (message) return { chatMid, message };
    }
    return null;
  }
  await ensureChatDbImported(accountId);
  const row = sqlite.query(`SELECT chat_mid FROM chat_messages_v2
    WHERE account_id = ? AND message_id = ? LIMIT 1`).get(accountId, messageId) as { chat_mid: string } | null;
  const message = row ? readStoredMessage(accountId, row.chat_mid, messageId) : undefined;
  return row && message ? { chatMid: row.chat_mid, message } : null;
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
  return chat;
}

function storedMessageToMessage(stored: StoredMessage): Message {
  const msg: Message = {
    id: stored.id,
    from: stored.from,
    to: stored.to,
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

const MESSAGE_SEARCH_RESULT_LIMIT = 100;
const MESSAGE_REGEX_SCAN_LIMIT = 1_000;

/** SQLite-backed search over the complete local chat history; regex scans are bounded. */
export async function searchStoredMessages(
  accountId: string,
  chatMid: string,
  query: string,
  regexMode = false,
): Promise<{ messages: Message[]; truncated: boolean }> {
  await ensureChatDbImported(accountId);
  const value = query.trim();
  if (!value || value.length > 256) throw new Error("検索語は1〜256文字で入力してください");

  let ids: string[];
  let truncated = false;
  if (regexMode) {
    // Bound both candidate count and regex complexity to avoid blocking the backend
    // with catastrophic backtracking. The accepted subset still supports common
    // anchors, character classes, alternation and one quantifier.
    if (/\\[1-9]|\\k[<']|\(\?[=!<]|\)[+*?{]/.test(value)) {
      throw new Error("この正規表現は安全のため使用できません（後方参照・先読み・入れ子量指定）");
    }
    const quantifiers = value.match(/(?<!\\)(?:[+*?]|\{\d+(?:,\d*)?\})/g) ?? [];
    if (quantifiers.length > 1 || /\{\d{3,}(?:,\d*)?\}/.test(value)) {
      throw new Error("正規表現の量指定は1つまで、上限は99です");
    }
    let pattern: RegExp;
    try {
      pattern = new RegExp(value, "i");
    } catch {
      throw new Error("正規表現の書式が正しくありません");
    }
    const candidates = scanStoredMessageRows(accountId, chatMid, MESSAGE_REGEX_SCAN_LIMIT + 1);
    truncated = candidates.length > MESSAGE_REGEX_SCAN_LIMIT;
    const matched = candidates.slice(0, MESSAGE_REGEX_SCAN_LIMIT)
      .filter((row) => typeof row.text === "string" && pattern.test(row.text.slice(0, 8_000)))
      .map((row) => row.message_id);
    truncated ||= matched.length > MESSAGE_SEARCH_RESULT_LIMIT;
    ids = matched.slice(0, MESSAGE_SEARCH_RESULT_LIMIT);
  } else {
    const rows = searchStoredMessageRows(accountId, chatMid, value, MESSAGE_SEARCH_RESULT_LIMIT + 1);
    truncated = rows.length > MESSAGE_SEARCH_RESULT_LIMIT;
    ids = rows.slice(0, MESSAGE_SEARCH_RESULT_LIMIT).map((row) => row.message_id);
  }

  const messages = readStoredMessagesByIds(accountId, chatMid, ids)
    .filter((message) => !isStoredMessageDeleted(accountId, chatMid, message.id))
    .map(storedMessageToMessage);
  return { messages, truncated };
}

/** Desktop 準拠: boxOrder 順、無ければ lastMessageTime 降順 */
export async function getStoredChats(accountId: string): Promise<Chat[]> {
  let chats: StoredChat[];
  let metadata: ChatDbMeta;
  if (dirty.has(accountId)) {
    const db = await getDb(accountId);
    chats = Object.values(db.chats);
    metadata = db.meta;
  } else {
    await ensureChatDbImported(accountId);
    chats = readStoredChats(accountId);
    metadata = readChatMeta(accountId) as ChatDbMeta;
  }
  if (chats.length === 0) return [];

  const order = metadata.boxOrder ?? [];
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
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number },
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
  const meta = await getCacheMeta(accountId);
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
    syncedAt: meta.chatsSyncedAt ?? null,
    chatsSyncedAt: meta.chatsSyncedAt ?? null,
  };
}

export async function getCacheMeta(accountId: string): Promise<ChatDbMeta> {
  if (dirty.has(accountId)) return { ...(await getDb(accountId)).meta };
  await ensureChatDbImported(accountId);
  const meta = readChatMeta(accountId) as ChatDbMeta;
  return { ...meta };
}

export async function getOperationSyncCursor(accountId: string): Promise<{
  revision: string;
  globalRevision: string;
  individualRevision: string;
} | undefined> {
  await ensureChatDbImported(accountId);
  return readStoredOperationSyncCursor(accountId);
}

export async function saveOperationSyncCursor(
  accountId: string,
  cursor: { revision: string; globalRevision: string; individualRevision: string },
): Promise<void> {
  await ensureChatDbImported(accountId);
  await flushDb(accountId);
  if (dirty.has(accountId)) throw new Error("pending message writes could not be committed before sync cursor");
  const meta = readChatMeta(accountId);
  sqlite.transaction(() => {
    writeStoredOperationSyncCursor(accountId, cursor);
    writeChatSyncState(accountId, cursor.revision, meta.chatsSyncedAt ?? new Date().toISOString());
  }).immediate();
  const db = memory.get(accountId);
  if (db) db.meta.lastOpRevision = cursor.revision;
}

export async function stageOperationInboxBatch<T>(
  accountId: string,
  startCursor: { revision: string; globalRevision: string; individualRevision: string },
  cursor: { revision: string; globalRevision: string; individualRevision: string },
  operations: readonly T[],
): Promise<string> {
  await ensureChatDbImported(accountId);
  const payload = encodeOperationBatch(operations);
  const batchId = operationBatchId(startCursor, cursor, payload);
  sqlite.transaction(() => insertOperationInboxBatch(accountId, batchId, payload, cursor)).immediate();
  return batchId;
}

export async function getPendingOperationInboxBatches<T>(
  accountId: string,
): Promise<Array<{
  batchId: string;
  operations: T[];
  cursor: { revision: string; globalRevision: string; individualRevision: string };
}>> {
  await ensureChatDbImported(accountId);
  return readOperationInboxBatches(accountId).map((batch) => ({
    batchId: batch.batchId,
    operations: decodeOperationBatch<T>(batch.payload),
    cursor: batch.cursor,
  }));
}

export async function completeOperationInboxBatch(
  accountId: string,
  batchId: string,
  cursor: { revision: string; globalRevision: string; individualRevision: string },
  events: readonly unknown[] = [],
  sequenceFloor = 0,
): Promise<number[]> {
  await ensureChatDbImported(accountId);
  await flushDb(accountId);
  if (dirty.has(accountId)) throw new Error("pending message writes could not be committed before inbox acknowledgement");
  const meta = readChatMeta(accountId);
  const sequences: number[] = [];
  sqlite.transaction(() => {
    const state = sqlite.query(`SELECT last_seq AS lastSeq FROM talk_event_outbox_state_v1 WHERE account_id=?`)
      .get(accountId) as { lastSeq: number } | null;
    let nextSeq = Math.max(state?.lastSeq ?? 0, sequenceFloor);
    for (const event of events) {
      nextSeq += 1;
      sqlite.query(`INSERT INTO talk_event_outbox_v1(account_id,seq,payload_json,created_at) VALUES (?,?,?,?)`)
        .run(accountId, nextSeq, encodeOperationBatch([event]), new Date().toISOString());
      sequences.push(nextSeq);
    }
    if (events.length > 0) {
      sqlite.query(`INSERT INTO talk_event_outbox_state_v1(account_id,last_seq) VALUES (?,?)
        ON CONFLICT(account_id) DO UPDATE SET last_seq=excluded.last_seq`)
        .run(accountId, nextSeq);
      sqlite.query(`DELETE FROM talk_event_outbox_v1 WHERE account_id=? AND seq<=?`)
        .run(accountId, Math.max(0, nextSeq - 400));
    }
    writeStoredOperationSyncCursor(accountId, cursor);
    writeChatSyncState(accountId, cursor.revision, meta.chatsSyncedAt ?? new Date().toISOString());
    deleteOperationInboxBatch(accountId, batchId);
  }).immediate();
  const db = memory.get(accountId);
  if (db) db.meta.lastOpRevision = cursor.revision;
  return sequences;
}

export async function getTalkEventOutbox<T>(accountId: string): Promise<{ events: Array<{ seq: number; event: T }>; seq: number }> {
  await ensureChatDbImported(accountId);
  const rows = sqlite.query(`SELECT seq,payload_json AS payload FROM talk_event_outbox_v1
    WHERE account_id=? ORDER BY seq`).all(accountId) as Array<{ seq: number; payload: string }>;
  const state = sqlite.query(`SELECT last_seq AS lastSeq FROM talk_event_outbox_state_v1 WHERE account_id=?`)
    .get(accountId) as { lastSeq: number } | null;
  return {
    events: rows.map((row) => ({ seq: row.seq, event: decodeOperationBatch<T>(row.payload)[0]! })),
    seq: state?.lastSeq ?? 0,
  };
}

export function messageSyncAgeMs(meta: ChatDbMeta, chatMid: string): number | null {
  const iso = meta.messagesSyncedAt?.[chatMid];
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Date.now() - t : null;
}

export async function saveBoxOrder(accountId: string, boxOrder: string[]): Promise<void> {
  if (!dirty.has(accountId)) {
    await ensureChatDbImported(accountId);
    writeChatBoxOrder(accountId, boxOrder);
    const db = memory.get(accountId);
    if (db) db.meta.boxOrder = boxOrder;
    return;
  }
  const db = await getDb(accountId);
  db.meta.boxOrder = boxOrder;
  scheduleSave(accountId, { meta: true });
}

/** Flushes pending writes and guarantees the relational backup source is ready. */
export async function prepareChatDbBackup(accountId: string): Promise<void> {
  await flushDb(accountId);
  if (dirty.has(accountId)) throw new Error("chat database could not be flushed before backup");
  await ensureChatDbImported(accountId);
  memory.delete(accountId);
}

/** VylineBackup: 復元（マージ書き込み）。新規端末なら空 DB への上書きと同義 */
export async function importChatDb(
  accountId: string,
  data: Pick<ChatDb, "meta" | "chats" | "messages">,
): Promise<{ chats: number; messages: number }> {
  await flushDb(accountId);
  if (dirty.has(accountId)) throw new Error("chat database could not be flushed before restore");
  await ensureChatDbImported(accountId);
  const meta = readChatMeta(accountId) as ChatDbMeta;
  let chatCount = 0;
  let messageCount = 0;
  const importedChatMids = new Set(Object.keys(data.messages ?? {}));
  for (const [chatMid, messages] of Object.entries(data.messages ?? {})) {
    for (const message of Object.values(messages)) {
      if (isStoredMessageDeleted(accountId, chatMid, message.id)) continue;
      applyLocalReadWatermark({ [message.id]: message }, meta.localReadUpTo?.[chatMid]?.messageId);
      messageCount++;
    }
  }

  sqlite.transaction(() => {
    for (const chat of Object.values(data.chats ?? {})) {
      writeStoredChat(accountId, withoutDeletedPreview(accountId, chat));
      chatCount++;
    }
    for (const [chatMid, messages] of Object.entries(data.messages ?? {})) {
      for (const message of Object.values(messages)) writeStoredMessage(accountId, chatMid, message);
    }
    for (const chatMid of importedChatMids) {
      const latest = readLatestStoredMessage(accountId, chatMid);
      if (!latest) continue;
      const existing = data.chats?.[chatMid] ?? readStoredChatById(accountId, chatMid) ?? {
        mid: chatMid, name: chatMid, kind: "direct" as const, hasMessages: false, updatedAt: latest.savedAt,
      };
      writeStoredChat(accountId, {
        ...existing,
        hasMessages: true,
        lastMessageTime: latest.createdTime,
        lastMessageId: latest.id,
        lastMessagePreview: previewForMessage(latest),
      });
    }
    if (data.meta?.boxOrder) meta.boxOrder = data.meta.boxOrder;
    if (data.meta?.chatsSyncedAt) meta.chatsSyncedAt = data.meta.chatsSyncedAt;
    meta.messagesSyncedAt = meta.messagesSyncedAt ?? {};
    Object.assign(meta.messagesSyncedAt, data.meta?.messagesSyncedAt ?? {});
    writeChatMeta(accountId, meta);
  }).immediate();
  memory.delete(accountId);
  return { chats: chatCount, messages: messageCount };
}

/** Import a relational SQLite backup without materializing the target history in memory. */
export async function importChatDbFromSqlite(
  accountId: string,
  backupPath: string,
  selectedChatMids?: string[],
): Promise<{ chats: number; messages: number }> {
  await flushDb(accountId);
  if (dirty.has(accountId)) throw new Error("chat database could not be flushed before restore");
  await ensureChatDbImported(accountId);
  const alias = `vyline_restore_${randomUUID().replaceAll("-", "")}`;
  sqlite.query(`ATTACH DATABASE ? AS ${alias}`).run(backupPath);
  try {
    const info = sqlite.query(`SELECT schema_name,version,account_id FROM ${alias}.backup_info LIMIT 1`)
      .get() as { schema_name: string; version: number; account_id: string } | null;
    if (info?.schema_name !== "vyline-backup" || info.version !== 1 || info.account_id !== accountId) {
      throw new Error("backup database is not compatible with this account");
    }

    const picks = selectedChatMids?.length ? [...new Set(selectedChatMids)] : [];
    const pickClause = (column: string, aliasName = "source") =>
      picks.length ? ` AND ${aliasName}.${column} IN (${picks.map(() => "?").join(",")})` : "";
    const pickArgs = picks;
    const notDeleted = ` AND NOT EXISTS (SELECT 1 FROM main.chat_message_tombstones_v2 tombstone
      WHERE tombstone.account_id=source.account_id AND tombstone.chat_mid=source.chat_mid
        AND tombstone.message_id=source.message_id)`;
    const chats = (sqlite.query(`SELECT source.mid FROM ${alias}.chat_records_v2 source WHERE source.account_id=?${pickClause("mid")}`)
      .all(accountId, ...pickArgs) as Array<{ mid: string }>).map((row) => row.mid);
    const messageCount = (sqlite.query(`SELECT COUNT(*) AS count FROM ${alias}.chat_messages_v2 source
      WHERE source.account_id=?${pickClause("chat_mid")}${notDeleted}`).get(accountId, ...pickArgs) as { count: number }).count;
    const tables = [
      "chat_records_v2",
      "chat_messages_v2",
      "chat_message_snapshots_v2",
      "chat_message_metadata_v2",
      "chat_message_readers_v2",
      "chat_message_reactions_v2",
      "chat_message_history_v2",
    ] as const;
    const relationTables = [
      "chat_message_snapshots_v2",
      "chat_message_metadata_v2",
      "chat_message_readers_v2",
      "chat_message_reactions_v2",
      "chat_message_history_v2",
    ] as const;

    sqlite.transaction(() => {
      for (const table of relationTables) {
        sqlite.query(`DELETE FROM main.${table} WHERE account_id=? AND EXISTS (
          SELECT 1 FROM ${alias}.chat_messages_v2 source
          WHERE source.account_id=? AND source.chat_mid=main.${table}.chat_mid
            AND source.message_id=main.${table}.message_id${pickClause("chat_mid")})`)
          .run(accountId, accountId, ...pickArgs);
      }
      for (const table of tables) {
        const columns = sqlite.query(`PRAGMA main.table_info('${table}')`).all() as Array<{ name: string }>;
        const columnList = columns.map(({ name }) => `"${name}"`).join(",");
        const projection = columns.map(({ name }) => name === "account_id" ? "? AS account_id" : `source."${name}"`).join(",");
        const filterColumn = table === "chat_records_v2" ? "mid" : "chat_mid";
        sqlite.query(`INSERT OR REPLACE INTO main.${table} (${columnList})
          SELECT ${projection} FROM ${alias}.${table} source
          WHERE source.account_id=?${pickClause(filterColumn)}${table === "chat_records_v2" ? "" : notDeleted}`)
          .run(accountId, accountId, ...pickArgs);
      }
      for (const chatMid of chats) {
        const localReadId = readLocalReadPosition(accountId, chatMid)?.messageId;
        if (localReadId && /^\d+$/.test(localReadId)) {
          const readCursor = localReadId.replace(/^0+/, "") || "0";
          sqlite.query(`UPDATE main.chat_messages_v2 SET seen=1
            WHERE account_id=? AND chat_mid=? AND is_my_message=0
              AND message_id != '' AND message_id NOT GLOB '*[^0-9]*'
              AND (length(CASE WHEN ltrim(message_id,'0')='' THEN '0' ELSE ltrim(message_id,'0') END)<length(?)
                OR (length(CASE WHEN ltrim(message_id,'0')='' THEN '0' ELSE ltrim(message_id,'0') END)=length(?)
                  AND CASE WHEN ltrim(message_id,'0')='' THEN '0' ELSE ltrim(message_id,'0') END<=?))`)
            .run(accountId, chatMid, readCursor, readCursor, readCursor);
        }
        const latest = readLatestStoredMessage(accountId, chatMid);
        const chat = readStoredChatById(accountId, chatMid);
        if (latest && chat) writeStoredChat(accountId, {
          ...chat,
          hasMessages: true,
          lastMessageTime: latest.createdTime,
          lastMessageId: latest.id,
          lastMessagePreview: previewForMessage(latest),
        });
        else if (chat) writeStoredChat(accountId, withoutDeletedPreview(accountId, chat));
      }
    }).immediate();
    memory.delete(accountId);
    return { chats: chats.length, messages: messageCount };
  } finally {
    sqlite.exec(`DETACH DATABASE ${alias}`);
  }
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
    target.chats[mid] = {
      ...existing,
      hasMessages: existing.hasMessages || incomingChat.hasMessages,
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
    const ordered = Object.values(target.messages[chatMid] ?? {}).sort(compareMessagesOldestFirst);
    target.messages[chatMid] = Object.fromEntries(ordered.map((message) => [message.id, message]));
    messages += ordered.length;
    const latest = ordered.at(-1);
    if (!latest) continue;
    const existing = target.chats[chatMid];
    target.chats[chatMid] = {
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
  const filtered: ChatDbRecords = { chats: incoming.chats, messages: {} };
  let deletedCount = 0;
  for (const [mid, messages] of Object.entries(incoming.messages ?? {})) {
    filtered.messages[mid] = Object.fromEntries(Object.entries(messages).filter(([, message]) => {
      if (!isStoredMessageDeleted(accountId, mid, message.id)) return true;
      deletedCount++;
      return false;
    }));
  }
  const result = mergeChatDbRecords(db, filtered);
  result.skippedMessages += deletedCount;
  for (const chat of Object.values(db.chats)) db.chats[chat.mid] = withoutDeletedPreview(accountId, chat);
  const messageWrites = new Map<string, Set<string>>();
  for (const [chatMid, messages] of Object.entries(incoming.messages ?? {})) {
    messageWrites.set(chatMid, new Set(Object.keys(messages)));
  }
  for (const [chatMid, messages] of Object.entries(db.messages)) {
    const marked = applyLocalReadWatermark(messages, db.meta.localReadUpTo?.[chatMid]?.messageId);
    if (marked.length) {
      let ids = messageWrites.get(chatMid);
      if (!ids) messageWrites.set(chatMid, (ids = new Set()));
      for (const id of marked) ids.add(id);
    }
  }
  if (result.importedChats > 0 || result.importedMessages > 0) {
    const chats = new Set([
      ...Object.keys(incoming.chats ?? {}),
      ...Object.keys(incoming.messages ?? {}),
      ...Object.keys(db.messages),
    ]);
    scheduleSave(accountId, {
      chats,
      messages: [...messageWrites].map(([mid, ids]) => [mid, ids] as const),
    });
  }
  return result;
}

/** チャット要約と索引上の最新位置を再構築する。本文履歴には触れない。 */
export async function rebuildAccountChatDb(
  accountId: string,
): Promise<{ chats: number; messages: number; backupFile: string }> {
  await flushDb(accountId);
  if (dirty.has(accountId)) {
    throw new Error("chat database could not be flushed before rebuild");
  }
  await ensureChatDbImported(accountId);
  const chats = readStoredChats(accountId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `chatdb.before-rebuild-${stamp}-${randomUUID().slice(0, 8)}.sqlite`;
  const backupPath = accountFile(accountId, backupFile);
  await mkdir(dirname(backupPath), { recursive: true });
  // Rebuild changes only derived chat summaries. Preserve summaries and metadata
  // in a small SQLite snapshot without loading message history into memory.
  const backup = new Database(backupPath);
  try {
    backup.exec("CREATE TABLE snapshot_info (account_id TEXT NOT NULL, created_at TEXT NOT NULL)");
    backup.query("INSERT INTO snapshot_info VALUES (?,?)").run(accountId, new Date().toISOString());
    for (const table of [
      "chat_records_v2",
      "chat_account_state_v2",
      "chat_box_order_v2",
      "chat_messages_synced_v2",
      "chat_local_read_v2",
    ]) {
      const columns = sqlite.query(`PRAGMA main.table_info('${table}')`).all() as Array<{
        name: string;
        type: string;
      }>;
      backup.exec(`CREATE TABLE ${table} (${columns.map((column) =>
        `"${column.name}" ${column.type || ""}`.trim(),
      ).join(",")})`);
      const rows = sqlite.query(`SELECT * FROM main.${table} WHERE account_id=?`).all(accountId) as Array<Record<string, unknown>>;
      if (rows.length === 0) continue;
      const names = columns.map((column) => `"${column.name}"`).join(",");
      const placeholders = columns.map(() => "?").join(",");
      const insert = backup.query(`INSERT INTO ${table} (${names}) VALUES (${placeholders})`);
      const insertRows = backup.transaction(() => {
        for (const row of rows) {
          const values = columns.map((column) => row[column.name]) as Array<
            string | number | bigint | boolean | null | Uint8Array
          >;
          insert.run(...values);
        }
      });
      insertRows();
    }
  } finally {
    backup.close();
  }
  const messageCount = (sqlite.query("SELECT COUNT(*) AS count FROM chat_messages_v2 WHERE account_id=?")
    .get(accountId) as { count: number }).count;
  sqlite.transaction(() => {
    for (const chat of chats) {
      const latest = readLatestStoredMessage(accountId, chat.mid);
      if (!latest) continue;
      writeStoredChat(accountId, {
        ...chat,
        hasMessages: true,
        lastMessageTime: latest.createdTime,
        lastMessageId: latest.id,
        lastMessagePreview: previewForMessage(latest),
      });
    }
  }).immediate();
  memory.delete(accountId);
  return { chats: chats.length, messages: messageCount, backupFile };
}

/** 復元完了時に、遅延保存を待たずにDBへ確実に書き出す。 */
export async function flushAccountChatDb(accountId: string): Promise<void> {
  await flushDb(accountId);
}

/** VylineBackup: チャット一覧とメッセージ件数（選択 UI 用） */
export async function listChatsWithCounts(
  accountId: string,
): Promise<Array<{ mid: string; name: string; messageCount: number }>> {
  if (dirty.has(accountId)) {
    const db = await getDb(accountId);
    return Object.keys(db.chats).map((mid) => ({
      mid, name: db.chats[mid]?.name ?? mid, messageCount: Object.keys(db.messages[mid] ?? {}).length,
    }));
  }
  await ensureChatDbImported(accountId);
  return sqlite.query(`SELECT c.mid, c.name,
      COUNT(m.message_id) AS messageCount
    FROM chat_records_v2 c LEFT JOIN chat_messages_v2 m
      ON m.account_id = c.account_id AND m.chat_mid = c.mid
    WHERE c.account_id = ? GROUP BY c.mid ORDER BY c.rowid`)
    .all(accountId) as Array<{ mid: string; name: string; messageCount: number }>;
}
