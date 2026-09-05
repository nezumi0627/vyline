/**
 * Pure chat-store records and merge helpers shared by the SQLite persistence layer.
 * Keep this file free of filesystem/database access so restore/import logic remains
 * easy to test independently from Bun's SQLite driver.
 */

import type {
  Chat,
  Message,
  MessageContentMeta,
  MessageReaction,
  MessageSnapshot,
} from "@vyline/types";

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
  // SQLite JSON columns can deserialize to undefined when an old/corrupt value is
  // encountered. Explicitly allow that value while keeping the property optional.
  revokedSnapshot?: MessageSnapshot | undefined;
}

export interface ChatDbMeta {
  lastOpRevision?: string;
  boxOrder?: string[];
  chatsSyncedAt?: string;
  messagesSyncedAt?: Record<string, string>;
  localReadUpTo?: Record<string, { messageId: string; at: string }>;
}

export interface ChatDb {
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

export function compareMessageIdsAscending(left: string, right: string): number {
  if (left === right) return 0;
  try {
    return BigInt(left) < BigInt(right) ? -1 : 1;
  } catch {
    return left.localeCompare(right);
  }
}

export function compareMessagesNewestFirst(left: MessageCursor, right: MessageCursor): number {
  const byTime = right.createdTime - left.createdTime;
  return byTime || -compareMessageIdsAscending(left.id, right.id);
}

export function compareMessagesOldestFirst(left: MessageCursor, right: MessageCursor): number {
  const byTime = left.createdTime - right.createdTime;
  return byTime || compareMessageIdsAscending(left.id, right.id);
}

export const ENCRYPTED_LAST_MESSAGE_PREVIEW = "暗号化メッセージ";

export function isUnresolvedLastMessagePreview(value: string | null | undefined): boolean {
  const normalized = value?.trim().toUpperCase();
  return (
    !normalized ||
    normalized === ENCRYPTED_LAST_MESSAGE_PREVIEW ||
    normalized === "E2EE_UNAVAILABLE" ||
    normalized === "UNSENT" ||
    normalized === "UNSEND" ||
    normalized === "(UNSENT)" ||
    normalized === "(UNSEND)" ||
    normalized === "CHATEVENT" ||
    normalized === "NONE" ||
    normalized === "0"
  );
}

type ChatLastMessageCursor = Pick<StoredChat, "lastMessageId" | "lastMessageTime">;

export function isSameStoredLastMessage(
  left: ChatLastMessageCursor,
  right: ChatLastMessageCursor,
): boolean {
  if (left.lastMessageId && right.lastMessageId) return left.lastMessageId === right.lastMessageId;
  const leftTime = left.lastMessageTime ?? 0;
  const rightTime = right.lastMessageTime ?? 0;
  return leftTime > 0 && leftTime === rightTime;
}

export function shouldPreserveResolvedLastMessagePreview(
  existing: Pick<StoredChat, "lastMessageId" | "lastMessageTime" | "lastMessagePreview">,
  incoming: Pick<StoredChat, "lastMessageId" | "lastMessageTime" | "lastMessagePreview">,
): boolean {
  return Boolean(
    existing.lastMessagePreview &&
      !isUnresolvedLastMessagePreview(existing.lastMessagePreview) &&
      isUnresolvedLastMessagePreview(incoming.lastMessagePreview) &&
      isSameStoredLastMessage(existing, incoming),
  );
}

export function previewForMessage(message: StoredMessage): string {
  let preview = "";
  if (message.messageState?.startsWith("revoked")) {
    const snapshotText = message.revokedSnapshot?.text?.trim();
    const historyText = message.history
      ? [...message.history]
          .reverse()
          .find((entry) => entry.state === "normal" || entry.state === "edited")
          ?.text?.trim()
      : undefined;
    const previousText = snapshotText || historyText;
    preview = previousText
      ? `取り消し済み: ${previousText.slice(0, 100)}`
      : "取り消し済みのメッセージ";
  } else {
    const text = message.text?.trim();
    if (text) {
      preview = text.slice(0, 120);
    } else {
      switch (message.contentType.toUpperCase()) {
        case "IMAGE":
        case "1":
          preview = "写真";
          break;
        case "VIDEO":
        case "2":
          preview = "動画";
          break;
        case "AUDIO":
        case "3":
          preview = "音声";
          break;
        case "STICKER":
        case "7":
          preview = "スタンプ";
          break;
        case "FILE":
        case "14":
          preview = "ファイル";
          break;
        case "LOCATION":
        case "15":
          preview = "位置情報";
          break;
        case "CALL":
        case "6":
          preview = "通話";
          break;
        case "CONTACT":
        case "13":
          preview = "連絡先";
          break;
        case "E2EE_UNAVAILABLE":
          preview = ENCRYPTED_LAST_MESSAGE_PREVIEW;
          break;
        case "UNSENT":
        case "UNSEND":
          preview = "取り消し済みのメッセージ";
          break;
        case "NONE":
        case "0":
          preview = "";
          break;
        default:
          preview = message.contentType || "メッセージ";
          break;
      }
    }
  }
  return message.isMyMessage && preview ? `あなた: ${preview}` : preview;
}

export function messageIsAtLeastAsNewAsChat(message: StoredMessage, chat: StoredChat): boolean {
  const chatTime = chat.lastMessageTime ?? 0;
  if (message.createdTime > chatTime) return true;
  if (message.createdTime < chatTime) return false;
  if (!chat.lastMessageId) return true;
  return compareMessageIdsAscending(message.id, chat.lastMessageId) >= 0;
}

export function inferredChatKind(chatMid: string): Chat["kind"] {
  if (chatMid.startsWith("c")) return "group";
  if (chatMid.startsWith("r")) return "room";
  if (chatMid.startsWith("u")) return "direct";
  return "unknown";
}

export function repairStoredChatSummaries(target: ChatDbRecords): number {
  let repaired = 0;
  for (const [chatMid, byId] of Object.entries(target.messages)) {
    let latest: StoredMessage | undefined;
    for (const message of Object.values(byId)) {
      if (!latest || compareMessagesNewestFirst(message, latest) < 0) latest = message;
    }
    if (!latest) continue;

    const existing = target.chats[chatMid];
    if (!existing) {
      target.chats[chatMid] = {
        mid: chatMid,
        name: chatMid,
        kind: inferredChatKind(chatMid),
        hasMessages: true,
        lastMessageTime: latest.createdTime,
        lastMessageId: latest.id,
        lastMessagePreview: previewForMessage(latest),
        updatedAt: latest.savedAt,
      };
      repaired++;
      continue;
    }

    const existingTime = existing.lastMessageTime ?? 0;
    const sameCursor =
      existing.lastMessageId === latest.id ||
      (!existing.lastMessageId && existingTime > 0 && existingTime === latest.createdTime);
    const latestIsNewer =
      latest.createdTime > existingTime ||
      (latest.createdTime === existingTime &&
        (!existing.lastMessageId || compareMessageIdsAscending(latest.id, existing.lastMessageId) > 0));
    const computedPreview = previewForMessage(latest);
    const computedPreviewIsUseful = !isUnresolvedLastMessagePreview(computedPreview);
    const sameCursorNeedsRepair =
      sameCursor &&
      (isUnresolvedLastMessagePreview(existing.lastMessagePreview) ||
        (computedPreviewIsUseful && existing.lastMessagePreview !== computedPreview));
    const normalizedPreview = existing.lastMessagePreview?.trim().toUpperCase();
    const emptySummaryNeedsFallback =
      (!normalizedPreview ||
        normalizedPreview === "CHATEVENT" ||
        normalizedPreview === "NONE" ||
        normalizedPreview === "0") &&
      computedPreviewIsUseful;

    if (!latestIsNewer && !sameCursorNeedsRepair && !emptySummaryNeedsFallback) continue;
    existing.hasMessages = true;
    if (latestIsNewer) {
      existing.lastMessageTime = latest.createdTime;
      existing.lastMessageId = latest.id;
    }
    existing.lastMessagePreview = computedPreview;
    if (latestIsNewer || sameCursor) existing.updatedAt = latest.savedAt || existing.updatedAt;
    repaired++;
  }
  return repaired;
}

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

export function storedChatToChat(stored: StoredChat): Chat {
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

export function storedMessageToMessage(stored: StoredMessage): Message {
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

export function messageSyncAgeMs(meta: ChatDbMeta, chatMid: string): number | null {
  const iso = meta.messagesSyncedAt?.[chatMid];
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? Date.now() - time : null;
}

export function chatDbStorageBytes(db: ChatDb): number {
  const mapBytes = <T>(entries: Record<string, T>, size: (value: T) => number): number => {
    let bytes = 2;
    let count = 0;
    for (const [key, value] of Object.entries(entries)) {
      bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + size(value);
      if (count++ > 0) bytes++;
    }
    return bytes;
  };
  const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  return (
    jsonBytes({ meta: db.meta, chats: {}, messages: {} }) - 4 +
    mapBytes(db.chats, jsonBytes) +
    mapBytes(db.messages, (messages) => mapBytes(messages, jsonBytes))
  );
}

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

export function rebuildChatDbRecords(target: ChatDbRecords): { chats: number; messages: number } {
  let messages = 0;
  const allMids = new Set([...Object.keys(target.chats), ...Object.keys(target.messages)]);
  for (const chatMid of allMids) {
    const byChat = target.messages[chatMid] ?? {};
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
