import type { Chat, Message } from "../types/index.js";

export const ENCRYPTED_CHAT_PREVIEW = "暗号化メッセージ";

export function isUnresolvedChatPreview(value: string | null | undefined): boolean {
  const normalized = value?.trim().toUpperCase();
  return (
    normalized === ENCRYPTED_CHAT_PREVIEW ||
    normalized === "E2EE_UNAVAILABLE" ||
    normalized === "UNSENT" ||
    normalized === "UNSEND" ||
    normalized === "(UNSENT)" ||
    normalized === "(UNSEND)"
  );
}

type LastMessageCursor = Pick<Chat, "lastMessageId" | "lastMessageTime">;

export function isSameLastMessage(left: LastMessageCursor, right: LastMessageCursor): boolean {
  if (left.lastMessageId && right.lastMessageId) {
    return left.lastMessageId === right.lastMessageId;
  }
  const leftTime = left.lastMessageTime ?? 0;
  const rightTime = right.lastMessageTime ?? 0;
  return leftTime > 0 && leftTime === rightTime;
}

/**
 * A lightweight message-box refresh can only see an E2EE placeholder. Do not let
 * it clobber a preview that was already resolved from chatdb/bootstrap for the
 * exact same last message.
 */
export function mergeResolvedChatPreviews(previous: Chat[], incoming: Chat[]): Chat[] {
  if (previous.length === 0) return incoming;
  const previousByMid = new Map(previous.map((chat) => [chat.mid, chat]));

  return incoming.map((chat) => {
    const prev = previousByMid.get(chat.mid);
    if (!prev || !prev.lastMessagePreview || !isSameLastMessage(prev, chat)) return chat;

    if (isUnresolvedChatPreview(chat.lastMessagePreview)) {
      return { ...chat, lastMessagePreview: prev.lastMessagePreview };
    }

    // A bootstrap preview knows whether the message is ours, while message-box
    // previews do not. Preserve the richer prefix when the content is identical.
    if (
      chat.lastMessagePreview &&
      prev.lastMessagePreview === `あなた: ${chat.lastMessagePreview}`
    ) {
      return { ...chat, lastMessagePreview: prev.lastMessagePreview };
    }

    return chat;
  });
}

function bootstrapMessageMatchesChat(chat: Chat, message: Message): boolean {
  if (chat.lastMessageId) return chat.lastMessageId === message.id;
  const chatTime = chat.lastMessageTime ?? 0;
  return chatTime <= 0 || message.createdTime >= chatTime;
}

/**
 * Bootstrap already returns a small newest-first message window for the hottest
 * chats. Reuse the decoded local message as the list preview instead of waiting
 * until the user opens that conversation.
 */
export function hydrateBootstrapChatPreviews(
  chats: Chat[],
  messagesByChat: Record<string, Message[]>,
  toPreview: (message: Message, chat: Chat) => string,
): Chat[] {
  return chats.map((chat) => {
    const latest = messagesByChat[chat.mid]?.[0];
    if (!latest || !bootstrapMessageMatchesChat(chat, latest)) return chat;
    const preview = toPreview(latest, chat).trim();
    if (!preview || isUnresolvedChatPreview(preview)) return chat;
    return { ...chat, lastMessagePreview: preview };
  });
}
