import type { Chat } from "@vyline/types";
import type { StoredChat, StoredMessage } from "../storage/chatStore.js";

export interface DesktopMessageRow {
  _chatId: unknown;
  _id: unknown;
  _from: unknown;
  _to: unknown;
  _createdTime: unknown;
  _text: unknown;
  _contentType: unknown;
  _contentMetadata: unknown;
}

export interface DesktopChatDescriptor {
  mid: string;
  name: string;
  kind: Chat["kind"];
}

const CONTENT_TYPES: Record<number, string> = {
  0: "NONE",
  1: "IMAGE",
  2: "VIDEO",
  3: "AUDIO",
  4: "HTML",
  5: "PDF",
  6: "CALL",
  7: "STICKER",
  8: "PRESENCE",
  9: "GIFT",
  10: "GROUPBOARD",
  11: "APPLINK",
  12: "LINK",
  13: "CONTACT",
  14: "FILE",
  15: "LOCATION",
  16: "POSTNOTIFICATION",
  17: "RICH",
  18: "CHATEVENT",
  22: "FLEX",
};

function parseContentMetadata(value: unknown): StoredMessage["contentMetadata"] {
  if (typeof value !== "string" || value.length > 256_000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const metadata: NonNullable<StoredMessage["contentMetadata"]> = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item === "string") metadata[key] = item;
      else if (typeof item === "number" || typeof item === "boolean") metadata[key] = String(item);
    }
    return Object.keys(metadata).length ? metadata : null;
  } catch {
    return null;
  }
}

export function mapDesktopMessageRow(
  row: DesktopMessageRow,
  myMid: string,
  savedAt: string,
): StoredMessage | null {
  const chatMid = typeof row._chatId === "string" ? row._chatId.trim() : "";
  const id = typeof row._id === "string" || typeof row._id === "number" ? String(row._id) : "";
  const from = typeof row._from === "string" && row._from ? row._from : myMid;
  const createdTime = Number(row._createdTime);
  const contentTypeNumber = Number(row._contentType);
  if (!chatMid || !id || !Number.isSafeInteger(createdTime) || createdTime < 0) return null;

  const isMyMessage = from === myMid;
  const sourceTo = typeof row._to === "string" && row._to ? row._to : null;
  const to =
    sourceTo ??
    (chatMid.startsWith("c") || chatMid.startsWith("r") || isMyMessage ? chatMid : myMid);
  const contentMetadata = parseContentMetadata(row._contentMetadata);

  return {
    id,
    chatMid,
    from,
    to,
    text: typeof row._text === "string" ? row._text : null,
    contentType: CONTENT_TYPES[contentTypeNumber] ?? String(row._contentType ?? "UNKNOWN"),
    createdTime,
    isMyMessage,
    ...(contentMetadata !== undefined ? { contentMetadata } : {}),
    savedAt,
  };
}

export function mergeRestoredDesktopChat(
  existing: Chat | undefined,
  source: DesktopChatDescriptor,
  latest: Pick<StoredMessage, "id" | "createdTime" | "text" | "contentType">,
  updatedAt: string,
): StoredChat {
  const existingTime = existing?.lastMessageTime ?? 0;
  const sourceNameIsFallback = !source.name || source.name === source.mid;
  const existingNameIsFallback = !existing?.name || existing.name === existing.mid;
  const useSourceLatest = latest.createdTime > existingTime;
  return {
    mid: source.mid,
    name:
      existing && !existingNameIsFallback
        ? existing.name
        : sourceNameIsFallback
          ? (existing?.name ?? source.mid)
          : source.name,
    kind: existing?.kind && existing.kind !== "unknown" ? existing.kind : source.kind,
    hasMessages: true,
    lastMessageTime: Math.max(existingTime, latest.createdTime),
    lastMessageId: useSourceLatest ? latest.id : (existing?.lastMessageId ?? latest.id),
    ...(useSourceLatest
      ? { lastMessagePreview: latest.text || `[${latest.contentType}]` }
      : existing?.lastMessagePreview !== undefined
        ? { lastMessagePreview: existing.lastMessagePreview }
        : {}),
    ...(existing?.thumbnailUrl !== undefined ? { thumbnailUrl: existing.thumbnailUrl } : {}),
    ...(existing?.unreadCount !== undefined ? { unreadCount: existing.unreadCount } : {}),
    ...(existing?.isOfficial !== undefined ? { isOfficial: existing.isOfficial } : {}),
    restoredHistory: true,
    updatedAt,
  };
}
