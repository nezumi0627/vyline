import type { Message } from "@vyline/types";

export function safeCliMessage(
  message: Message & { chatMid?: string; savedAt?: string },
  fallbackChatMid?: string,
) {
  return {
    id: message.id,
    chatMid: message.chatMid ?? fallbackChatMid,
    from: message.from,
    to: message.to,
    text: message.text,
    contentType: message.contentType,
    createdTime: message.createdTime,
    isMyMessage: message.isMyMessage,
    ...(message.seen !== undefined ? { seen: message.seen } : {}),
    ...(message.readCount !== undefined ? { readCount: message.readCount } : {}),
    ...(message.relatedMessageId !== undefined ? { relatedMessageId: message.relatedMessageId } : {}),
    ...(message.reactions !== undefined ? { reactions: message.reactions } : {}),
    ...(message.messageState !== undefined ? { messageState: message.messageState } : {}),
  };
}
