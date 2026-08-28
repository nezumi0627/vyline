import type { Chat, Message, MessageReaction } from "@vyline/types";
import { getClient, runSendRpc } from "../line/clientManager.js";

type SquareRaw = Record<string, any>;
type OpenChatRole = "ADMIN" | "CO_ADMIN" | "MEMBER" | "";
export const OPEN_CHAT_REACTIONS = [
  "UNDO",
  "NICE",
  "LOVE",
  "FUN",
  "AMAZING",
  "SAD",
  "OMG",
] as const;
export type OpenChatReaction = (typeof OPEN_CHAT_REACTIONS)[number];

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

/** LINE thrift values include Int64/BigInt; never leak them to Hono JSON. */
export function toOpenChatJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toOpenChatJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toOpenChatJson(item),
      ]),
    );
  }
  return value;
}

export function mapOpenChatMessage(raw: SquareRaw, selfMemberMid?: string): Message {
  const message = raw.message ?? raw;
  const from = String(message.from ?? raw.from ?? "");
  const reactions = reactionList(raw.messageReactionStatus);
  return {
    id: String(message.id ?? ""),
    from,
    to: String(message.to ?? raw.squareChatMid ?? ""),
    text: message.text ?? null,
    contentType: String(message.contentType ?? "NONE"),
    createdTime: number(message.createdTime),
    isMyMessage: Boolean(selfMemberMid && from === selfMemberMid),
    contentMetadata: message.contentMetadata ?? {},
    relatedMessageId: message.relatedMessageId ?? null,
    ...(reactions ? { reactions } : {}),
  };
}

/** Convert SquareMember's Int64 fields before crossing the JSON BFF boundary. */
export function mapOpenChatMember(member: SquareRaw) {
  const role = String(member.role ?? "") as OpenChatRole;
  return {
    squareMemberMid: String(member.squareMemberMid ?? ""),
    squareMid: String(member.squareMid ?? ""),
    displayName: String(member.displayName ?? ""),
    profileImageObsHash: String(member.profileImageObsHash ?? ""),
    ableToReceiveMessage: Boolean(member.ableToReceiveMessage),
    membershipState: String(member.membershipState ?? ""),
    role,
    roleLabel: role === "ADMIN" ? "管理人" : role === "CO_ADMIN" ? "副管理人" : null,
    revision: String(member.revision ?? ""),
    createdAt: number(member.createdAt),
    selfIntroduction: String(member.selfIntroduction ?? ""),
  };
}

function reactionList(status: SquareRaw | undefined): MessageReaction[] | undefined {
  if (!status?.myReaction) return undefined;
  const reaction = status.myReaction;
  return [
    {
      fromMid: String(reaction.reactor?.squareMemberMid ?? "me"),
      atMillis: number(reaction.createdAt),
      type: number(reaction.reactionType),
    },
  ];
}

export async function listOpenChats(accountId: string): Promise<Chat[]> {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  // linejs uses fetchMyEvents because this is the source that carries every
  // chat membership event. getJoinedSquareChats is not the stable high-level API.
  const squareChats = await client.fetchJoinedSquareChats();
  return squareChats.map(({ raw: chat }) => {
    return {
      mid: String(chat.squareChatMid),
      name: String(chat.name ?? "OpenChat"),
      hasMessages: true,
      kind: "group",
      lastMessageTime: 0,
      unreadCount: 0,
    };
  });
}

export async function fetchOpenChatMessages(
  accountId: string,
  squareChatMid: string,
  syncToken?: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const detail = await client.base.square.getSquareChat({ squareChatMid });
  const selfMemberMid = (detail as SquareRaw).squareChatMember?.squareMemberMid;
  const result = await client.base.square.fetchSquareChatEvents({
    squareChatMid,
    ...(syncToken ? { syncToken } : {}),
    limit: 100,
  });
  const raw = result as SquareRaw;
  const messages = (raw.events ?? []).flatMap((event: SquareRaw) => {
    const message =
      event.payload?.receiveMessage?.squareMessage ?? event.payload?.sendMessage?.squareMessage;
    return message ? [mapOpenChatMessage(message, selfMemberMid)] : [];
  });
  return {
    messages,
    syncToken: String(raw.syncToken ?? ""),
    continuationToken: raw.continuationToken ? String(raw.continuationToken) : undefined,
  };
}

export async function sendOpenChatMessage(
  accountId: string,
  squareChatMid: string,
  text: string,
  relatedMessageId?: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  return runSendRpc(accountId, async () =>
    client.base.square.sendMessage({
      squareChatMid,
      text,
      ...(relatedMessageId ? { relatedMessageId } : {}),
    }),
  );
}

export async function sendOpenChatMedia(
  accountId: string,
  squareChatMid: string,
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
  durationMs?: number,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const kind = mimeType.startsWith("video/")
    ? "video"
    : mimeType.startsWith("audio/")
      ? "audio"
      : "image";
  const copy = new Uint8Array(Array.from(bytes));
  // Square media must use OBS reqseq mode (oid omitted). LINE creates the
  // message during upload, therefore media replies are not supported.
  return runSendRpc(accountId, () =>
    client.base.obs.uploadObjTalk(
      squareChatMid,
      kind,
      new Blob([copy.buffer], { type: mimeType }),
      undefined,
      filename,
      durationMs,
    ),
  );
}

export async function markOpenChatRead(
  accountId: string,
  squareChatMid: string,
  messageId: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  return client.base.square.markAsRead({ request: { squareChatMid, messageId } });
}

/** Cancels one of the current account's OpenChat messages. */
export async function unsendOpenChatMessage(
  accountId: string,
  squareChatMid: string,
  messageId: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  return runSendRpc(accountId, () =>
    client.base.square.unsendMessage({ squareChatMid, messageId }),
  );
}

export async function reactOpenChatMessage(
  accountId: string,
  squareChatMid: string,
  messageId: string,
  reaction: OpenChatReaction,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  if (!OPEN_CHAT_REACTIONS.includes(reaction)) throw new Error("unsupported reaction");
  return runSendRpc(accountId, () =>
    client.base.square.reactToMessage({
      request: {
        reqSeq: 0,
        squareChatMid,
        messageId,
        reactionType: reaction,
      },
    }),
  );
}

export async function listOpenChatReactions(
  accountId: string,
  squareChatMid: string,
  messageId: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const reactions: SquareRaw[] = [];
  let continuationToken: string | undefined;

  // SquareService returns reaction members in pages. Keep the upper bound so a
  // malformed continuation token cannot turn one UI request into an endless RPC loop.
  for (let page = 0; page < 20; page += 1) {
    const result = await client.base.square.getMessageReactions({
      request: {
        squareChatMid,
        messageId,
        type: "ALL",
        limit: 100,
        ...(continuationToken ? { continuationToken } : {}),
      },
    });
    const raw = result as SquareRaw;
    reactions.push(...((raw.reactions ?? []) as SquareRaw[]));
    continuationToken = raw.continuationToken ? String(raw.continuationToken) : undefined;
    if (!continuationToken) break;
  }
  return reactions;
}

export async function listOpenChatMembers(accountId: string, squareChatMid: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const chat = await client.getSquareChat(squareChatMid);
  return (await chat.getMembers()).map(mapOpenChatMember);
}

export async function getOpenChatInfo(accountId: string, squareChatMid: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const detail = await client.base.square.getSquareChat({ squareChatMid });
  const raw = detail as SquareRaw;
  const [square, profile] = await Promise.all([
    client.base.square.getSquare({ squareMid: raw.squareChat.squareMid }),
    client.base.square.getSquareMember({ squareMemberMid: raw.squareChatMember.squareMemberMid }),
  ]);
  return toOpenChatJson({
    chat: raw.squareChat,
    chatStatus: raw.squareChatStatus,
    selfChatMember: raw.squareChatMember,
    square: (square as SquareRaw).square,
    selfProfile: (profile as SquareRaw).squareMember,
  });
}

/** Lists the main OpenChat room and any sub-chats in the same Square. */
export async function listRelatedOpenChats(accountId: string, squareChatMid: string) {
  const { client, squareMid } = await getOpenChatSquareMid(accountId, squareChatMid);
  const chats = (await client.fetchJoinedSquareChats())
    .map(({ raw }) => raw as SquareRaw)
    .filter((chat) => String(chat.squareMid) === squareMid);
  const mainChat = chats.find((chat) => chat.type === "SQUARE_DEFAULT");
  return toOpenChatJson({
    mainChat: mainChat ?? null,
    subChats: chats.filter((chat) => chat !== mainChat),
  });
}

/** Updates only the signed-in member's OpenChat profile fields. */
export async function updateOpenChatSelfProfile(
  accountId: string,
  squareChatMid: string,
  input: { displayName?: string; selfIntroduction?: string },
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const detail = await client.base.square.getSquareChat({ squareChatMid });
  const memberMid = String((detail as SquareRaw).squareChatMember?.squareMemberMid ?? "");
  if (!memberMid) throw new Error("OpenChat member profile not found");
  const current = (await client.base.square.getSquareMember({
    squareMemberMid: memberMid,
  })) as SquareRaw;
  const squareMember = current.squareMember as SquareRaw | undefined;
  if (!squareMember) throw new Error("OpenChat member profile not found");

  const updatedAttrs: Array<"DISPLAY_NAME" | "SELF_INTRODUCTION"> = [];
  const next: SquareRaw = { ...squareMember };
  if (input.displayName !== undefined) {
    next.displayName = input.displayName;
    updatedAttrs.push("DISPLAY_NAME");
  }
  if (input.selfIntroduction !== undefined) {
    next.selfIntroduction = input.selfIntroduction;
    updatedAttrs.push("SELF_INTRODUCTION");
  }
  if (updatedAttrs.length === 0) throw new Error("no profile fields to update");

  const result = await runSendRpc(accountId, () =>
    client.base.square.updateSquareMember({
      request: { updatedAttrs, updatedPreferenceAttrs: [], squareMember: next },
    }),
  );
  return toOpenChatJson(result);
}

export async function listOpenChatAnnouncements(accountId: string, squareChatMid: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const result = await client.base.square.getSquareChatAnnouncements({
    getSquareChatAnnouncementsRequest: { squareChatMid },
  });
  return toOpenChatJson((result as SquareRaw).announcements ?? []);
}

export async function createOpenChatAnnouncement(
  accountId: string,
  squareChatMid: string,
  messageId: string,
  text: string,
  createdAt: number,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const detail = await client.base.square.getSquareChat({ squareChatMid });
  const senderMid = (detail as SquareRaw).squareChatMember.squareMemberMid;
  return toOpenChatJson(
    await client.base.square.createSquareChatAnnouncement({
      squareChatMid,
      senderMid,
      messageId,
      text,
      createdAt,
    }),
  );
}

export async function deleteOpenChatAnnouncement(
  accountId: string,
  squareChatMid: string,
  announcementSeq: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  return toOpenChatJson(
    await client.base.square.deleteSquareChatAnnouncement({
      deleteSquareChatAnnouncementRequest: {
        squareChatMid,
        announcementSeq: BigInt(announcementSeq),
      },
    }),
  );
}

export async function getOpenChatThread(
  accountId: string,
  squareChatMid: string,
  messageId: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const mid = await client.base.square.getSquareThreadMid({
    request: { chatMid: squareChatMid, messageId },
  });
  const threadMid = String((mid as SquareRaw).threadMid);
  const thread = await client.base.square.getSquareThread({
    request: { threadMid, includeRootMessage: true },
  });
  return toOpenChatJson({ threadMid, ...(thread as SquareRaw) });
}

export async function fetchOpenChatThreadMessages(
  accountId: string,
  squareChatMid: string,
  threadMid: string,
  syncToken?: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const result = await client.base.square.fetchSquareChatEvents({
    squareChatMid,
    threadMid,
    ...(syncToken ? { syncToken } : {}),
    limit: 100,
  });
  const raw = result as SquareRaw;
  return toOpenChatJson({
    events: raw.events ?? [],
    syncToken: raw.syncToken ?? "",
    continuationToken: raw.continuationToken,
  });
}

export async function sendOpenChatThreadMessage(
  accountId: string,
  squareChatMid: string,
  threadMid: string,
  text: string,
  relatedMessageId?: string,
) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  return toOpenChatJson(
    await runSendRpc(accountId, () =>
      client.base.square.sendSquareThreadMessage({
        request: {
          reqSeq: 0,
          chatMid: squareChatMid,
          threadMid,
          threadMessage: {
            message: {
              to: squareChatMid,
              toType: "SQUARE_THREAD",
              text,
              contentType: "NONE",
              ...(relatedMessageId
                ? {
                    relatedMessageId,
                    relatedMessageServiceCode: "SQUARE",
                    messageRelationType: "REPLY",
                  }
                : {}),
            },
          },
        },
      }),
    ),
  );
}

async function getOpenChatSquareMid(accountId: string, squareChatMid: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const detail = await client.base.square.getSquareChat({ squareChatMid });
  return { client, squareMid: String((detail as SquareRaw).squareChat.squareMid) };
}

export async function listOpenChatNotes(accountId: string, squareChatMid: string) {
  const { client, squareMid } = await getOpenChatSquareMid(accountId, squareChatMid);
  return toOpenChatJson(
    await client.base.timeline.listPost({ homeId: squareMid, sourceType: "TALKROOM" }),
  );
}

export async function createOpenChatNote(accountId: string, squareChatMid: string, text: string) {
  const { client, squareMid } = await getOpenChatSquareMid(accountId, squareChatMid);
  return toOpenChatJson(
    await client.base.timeline.createPost({
      homeId: squareMid,
      text,
      readPermissionType: "ALL",
      sourceType: "TIMELINE",
    }),
  );
}

export async function deleteOpenChatNote(accountId: string, squareChatMid: string, postId: string) {
  const { client, squareMid } = await getOpenChatSquareMid(accountId, squareChatMid);
  return toOpenChatJson(await client.base.timeline.deletePost({ homeId: squareMid, postId }));
}
