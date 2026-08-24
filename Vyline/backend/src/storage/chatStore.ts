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

const log = childLogger("chatStore");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");

const SAVE_DEBOUNCE_MS = Number(process.env.VYLINE_CHATDB_SAVE_MS ?? 400);
const BOOTSTRAP_TOP_CHATS = Number(process.env.VYLINE_BOOTSTRAP_TOP_CHATS ?? 12);
const BOOTSTRAP_MSG_LIMIT = Number(process.env.VYLINE_BOOTSTRAP_MSG_LIMIT ?? 40);
/** チャットあたりの保持上限。無制限保存はメモリ・ディスク・全体書き込みを肥大させるため抑止 */
const MAX_MESSAGES_PER_CHAT_DB = Number(process.env.VYLINE_CHATDB_MAX_MSGS_PER_CHAT ?? 500);

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

const memory = new Map<string, ChatDb>();
const dirty = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  const db = memory.get(accountId);
  if (!db) return;
  await ensureDataDir();
  try {
    await writeFile(dbPath(accountId), JSON.stringify(db), "utf-8");
  } catch (err) {
    log.warn({ accountId, err }, "failed to save chat db");
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
    db.chats[chat.mid] = chat;
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
  // 上限を超えたら古いものから落とす（全ファイル書き換えコストの抑止）
  const ids = Object.keys(byChat);
  if (ids.length > MAX_MESSAGES_PER_CHAT_DB) {
    const drop = ids
      .sort((a, b) => (byChat[a]?.createdTime ?? 0) - (byChat[b]?.createdTime ?? 0))
      .slice(0, ids.length - MAX_MESSAGES_PER_CHAT_DB);
    for (const id of drop) delete byChat[id];
  }
  db.meta.messagesSyncedAt = db.meta.messagesSyncedAt ?? {};
  db.meta.messagesSyncedAt[chatMid] = new Date().toISOString();
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
): Promise<StoredMessage[]> {
  const db = await getDb(accountId);
  const byChat = db.messages[chatMid];
  if (!byChat) return [];
  return Object.values(byChat)
    .sort((a, b) => b.createdTime - a.createdTime)
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
): Promise<Message[]> {
  const stored = await getMessages(accountId, chatMid, limit);
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
  if (data.meta?.boxOrder) db.meta.boxOrder = data.meta.boxOrder;
  if (data.meta?.chatsSyncedAt) db.meta.chatsSyncedAt = data.meta.chatsSyncedAt;
  db.meta.messagesSyncedAt = db.meta.messagesSyncedAt ?? {};
  for (const [chatMid, iso] of Object.entries(data.meta?.messagesSyncedAt ?? {})) {
    db.meta.messagesSyncedAt[chatMid] = iso;
  }
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
      if (targetMessages[id]) {
        skippedMessages++;
        continue;
      }
      targetMessages[id] = incomingMessage;
      importedMessages++;
    }

    const ids = Object.keys(targetMessages);
    if (ids.length > MAX_MESSAGES_PER_CHAT_DB) {
      const drop = ids
        .sort((a, b) => (targetMessages[a]?.createdTime ?? 0) - (targetMessages[b]?.createdTime ?? 0))
        .slice(0, ids.length - MAX_MESSAGES_PER_CHAT_DB);
      for (const id of drop) delete targetMessages[id];
    }
    target.messages[chatMid] = targetMessages;
  }

  return { importedChats, skippedChats, importedMessages, skippedMessages };
}

/** iOS / 外部履歴復元用の永続マージ。 */
export async function mergeImportedChatDb(
  accountId: string,
  incoming: ChatDbRecords,
): Promise<ChatDbMergeResult> {
  const db = await getDb(accountId);
  const result = mergeChatDbRecords(db, incoming);
  if (result.importedChats > 0 || result.importedMessages > 0) scheduleSave(accountId);
  return result;
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
