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
import type { Chat, Message, MessageContentMeta, MessageReaction } from "@vyline/types";
import { childLogger } from "../logger.js";

const log = childLogger("chatStore");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env["VYLINE_DATA_DIR"] ?? join(_dir, "..", "..", "data");

const SAVE_DEBOUNCE_MS = Number(process.env["VYLINE_CHATDB_SAVE_MS"] ?? 400);
const BOOTSTRAP_TOP_CHATS = Number(process.env["VYLINE_BOOTSTRAP_TOP_CHATS"] ?? 12);
const BOOTSTRAP_MSG_LIMIT = Number(process.env["VYLINE_BOOTSTRAP_MSG_LIMIT"] ?? 40);

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

const memory = new Map<string, ChatDb>();
const dirty = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function dbPath(accountId: string): string {
  return join(DATA_DIR, `chatdb-${accountId}.json`);
}

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
    byChat[message.id] = message;
  }
  db.messages[chatMid] = byChat;
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
  stored.contentType = "UNSENT";
  stored.text = null;
  scheduleSave(accountId);
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
  };
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

export function messageSyncAgeMs(
  meta: ChatDbMeta,
  chatMid: string,
): number | null {
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
