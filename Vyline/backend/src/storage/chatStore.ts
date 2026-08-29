/**
 * chatStore.ts — Desktop 相当のローカルメッセージキャッシュ
 *
 * LINE Desktop の .edb local-first に相当する JSON 永続化。
 * 起動時はディスク → メモリで即返却、RPC はバックグラウンド同期。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { accountFile, readAccountJson } from "./accountDirs.js";
import { writeTextAtomic } from "./safeFile.js";

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

const memory = new Map<string, ChatDb>();
const dirty = new Set<string>();
const dirtyVersion = new Map<string, number>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const flushInFlight = new Map<string, Promise<void>>();

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

async function loadDbFromDisk(accountId: string): Promise<ChatDb> {
  await ensureDataDir();
  const path = dbPath(accountId);
  const legacy = await readAccountJson<Partial<ChatDb>>(
    accountId,
    "chatdb.json",
    legacyDbPath(accountId),
  );
  if (legacy) {
    return {
      meta: legacy.meta ?? {},
      chats: legacy.chats ?? {},
      messages: legacy.messages ?? {},
    };
  }
  if (!existsSync(path)) return emptyDb();
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ChatDb>;
    return {
      meta: parsed.meta ?? {},
      chats: parsed.chats ?? {},
      messages: parsed.messages ?? {},
    };
  } catch (err) {
    log.warn({ accountId, err }, "failed to load chat db");
    return emptyDb();
  }
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
      // Serialize before the asynchronous write starts so mutations that occur
      // during I/O can be detected by dirtyVersion and written in a second pass.
      const serialized = JSON.stringify(db);
      try {
        await writeTextAtomic(dbPath(accountId), serialized);
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
  for (const message of messages) {
    const prev = byChat[message.id];
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
    byChat[message.id] = next;
  }
  db.messages[chatMid] = byChat;
  applyLocalReadWatermark(byChat, db.meta.localReadUpTo?.[chatMid]?.messageId);
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
): Promise<void> {
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
  scheduleSave(accountId);
}

/** push の DESTROY op で受け取った取消しを chatdb の該当メッセージへ反映 */
export async function markMessageRevoked(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<void> {
  const db = await getDb(accountId);
  const stored = db.messages[chatMid]?.[messageId];
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
  scheduleSave(accountId);
}

/** 取消し済みメッセージを元に戻す（ローカル永続化）。LINE サーバー側は元に戻せないため chatStore のみ更新 */
export async function restoreRevokedMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<{ text: string | null; contentType: string } | null> {
  const db = await getDb(accountId);
  const stored = db.messages[chatMid]?.[messageId];
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
  scheduleSave(accountId);
  return { text: restoredText, contentType: restoredContentType };
}

export async function getMessageHistory(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<Message["history"]> {
  const db = await getDb(accountId);
  const stored = db.messages[chatMid]?.[messageId];
  return stored?.history ?? [];
}

export async function getMessages(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: { beforeMessageId?: string; beforeDeliveredTime?: number },
): Promise<StoredMessage[]> {
  const db = await getDb(accountId);
  const byChat = db.messages[chatMid];
  if (!byChat) return [];
  const beforeTime = opts?.beforeDeliveredTime;
  const beforeIdBigInt = opts?.beforeMessageId
    ? (() => {
        try {
          return BigInt(opts.beforeMessageId);
        } catch {
          return null;
        }
      })()
    : null;
  return Object.values(byChat)
    .filter((message) => {
      if (beforeTime == null) return true;
      if (message.createdTime < beforeTime) return true;
      if (message.createdTime > beforeTime || beforeIdBigInt == null) return false;
      try {
        return BigInt(message.id) < beforeIdBigInt;
      } catch {
        return false;
      }
    })
    .sort(compareMessagesNewestFirst)
    .slice(0, limit);
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
    stored.chatMid.startsWith("c") || stored.chatMid.startsWith("r")
      ? stored.chatMid
      : stored.to;
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
  const messages: ChatDb["messages"] = {};
  for (const [chatMid, byChat] of Object.entries(db.messages)) {
    messages[chatMid] = { ...byChat };
  }
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
  for (const [chatMid, messages] of Object.entries(db.messages)) {
    applyLocalReadWatermark(messages, db.meta.localReadUpTo?.[chatMid]?.messageId);
  }
  if (data.meta?.boxOrder) db.meta.boxOrder = data.meta.boxOrder;
  if (data.meta?.chatsSyncedAt) db.meta.chatsSyncedAt = data.meta.chatsSyncedAt;
  db.meta.messagesSyncedAt = db.meta.messagesSyncedAt ?? {};
  for (const [chatMid, iso] of Object.entries(data.meta?.messagesSyncedAt ?? {})) {
    db.meta.messagesSyncedAt[chatMid] = iso;
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
      ...(existing.restoredHistory || incomingChat.restoredHistory ? { restoredHistory: true } : {}),
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
  return Object.keys(db.chats).map((mid) => {
    const chat = db.chats[mid];
    const messageCount = Object.keys(db.messages[mid] ?? {}).length;
    return { mid, name: chat?.name ?? mid, messageCount };
  });
}
