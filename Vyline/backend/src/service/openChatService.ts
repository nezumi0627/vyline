import type { Chat, Message, MessageReaction } from "@vyline/types";
import { getClient, runSendRpc } from "../line/clientManager.js";

type SquareRaw = Record<string, any>;
const reactionMap: Record<string, number> = { UNDO: 1, NICE: 2, LOVE: 3, FUN: 4, AMAZING: 5, SAD: 6, OMG: 7 };

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function asMessage(raw: SquareRaw, selfMemberMid?: string): Message {
  const message = raw.message ?? raw;
  const from = String(message.from ?? raw.from ?? "");
  const reactions = reactionList(raw.messageReactionStatus);
  return {
    id: String(message.id ?? ""), from, to: String(message.to ?? raw.squareChatMid ?? ""),
    text: message.text ?? null, contentType: String(message.contentType ?? "NONE"),
    createdTime: number(message.createdTime),
    isMyMessage: Boolean(selfMemberMid && from === selfMemberMid),
    contentMetadata: message.contentMetadata ?? {}, relatedMessageId: message.relatedMessageId ?? null,
    ...(reactions ? { reactions } : {}),
  };
}

function reactionList(status: SquareRaw | undefined): MessageReaction[] | undefined {
  if (!status?.myReaction) return undefined;
  const reaction = status.myReaction;
  return [{ fromMid: String(reaction.reactor?.squareMemberMid ?? "me"), atMillis: number(reaction.createdAt), type: number(reaction.reactionType) }];
}

export async function listOpenChats(accountId: string): Promise<Chat[]> {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const result = await client.base.square.getJoinedSquareChats({ request: {} } as any);
  return ((result as SquareRaw).squareChats ?? []).map((item: SquareRaw) => {
    const chat = item.squareChat ?? item;
    return { mid: String(chat.squareChatMid), name: String(chat.name ?? "OpenChat"), hasMessages: true,
      kind: "group", lastMessageTime: 0, thumbnailUrl: chat.squareChatImageStatus ?? undefined, unreadCount: number(item.unreadCount) };
  });
}

export async function fetchOpenChatMessages(accountId: string, squareChatMid: string, syncToken?: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const detail = await client.base.square.getSquareChat({ squareChatMid });
  const selfMemberMid = (detail as SquareRaw).squareChatMember?.squareMemberMid;
  const result = await client.base.square.fetchSquareChatEvents({ squareChatMid, ...(syncToken ? { syncToken } : {}), limit: 100 });
  const raw = result as SquareRaw;
  const messages = (raw.events ?? []).flatMap((event: SquareRaw) => {
    const message = event.payload?.receiveMessage?.squareMessage ?? event.payload?.sendMessage?.squareMessage;
    return message ? [asMessage(message, selfMemberMid)] : [];
  });
  return { messages, syncToken: String(raw.syncToken ?? ""), continuationToken: raw.continuationToken ? String(raw.continuationToken) : undefined };
}

export async function sendOpenChatMessage(accountId: string, squareChatMid: string, text: string, relatedMessageId?: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  return runSendRpc(accountId, async () => client.base.square.sendMessage({ squareChatMid, text, ...(relatedMessageId ? { relatedMessageId } : {}) }));
}

export async function sendOpenChatMedia(accountId: string, squareChatMid: string, bytes: Uint8Array, mimeType: string, filename: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const kind = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "image";
  const copy = new Uint8Array(Array.from(bytes));
  return runSendRpc(accountId, () => client.base.obs.uploadObjTalk(squareChatMid, kind, new Blob([copy.buffer], { type: mimeType }), undefined, filename));
}

export async function markOpenChatRead(accountId: string, squareChatMid: string, messageId: string) {
  const client = getClient(accountId); if (!client) throw new Error("not logged in");
  return client.base.square.markAsRead({ request: { squareChatMid, messageId } });
}

export async function reactOpenChatMessage(accountId: string, squareChatMid: string, messageId: string, reaction: keyof typeof reactionMap) {
  const client = getClient(accountId); if (!client) throw new Error("not logged in");
  if (!reactionMap[reaction]) throw new Error("unsupported reaction");
  return runSendRpc(accountId, () => client.base.square.reactToMessage({ request: { reqSeq: 0, squareChatMid, messageId, reactionType: reaction as any } }));
}

export async function listOpenChatMembers(accountId: string, squareChatMid: string) {
  const client = getClient(accountId); if (!client) throw new Error("not logged in");
  const result = await client.base.square.getSquareChatMembers({ squareChatMid });
  return (result as SquareRaw).squareChatMembers ?? [];
}
