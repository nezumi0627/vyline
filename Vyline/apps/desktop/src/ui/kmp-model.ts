import { reactionSticonUrl } from "@/lib/reactionImages";
import { displayName, formatTime, memberDisplayName } from "@/lib/store";
import type { Chat, Message } from "@/lib/store-types";
import { compareMessagesOldestFirst } from "@/lib/messageOrder";
import { lineAvatarUrl, stickerAnimationUrl } from "@/utils/lineMedia";
import { messageReaders } from "@/lib/messageReaders";
import { canReactToMessage } from "@/lib/messageActions";
import { looksLikeMid } from "@/lib/mappers";
import { segmentTextWithMentions } from "@/utils/mention";
import { splitTextLinks } from "@/lib/linkifyText";
import { sameMessageRun } from "./message-grouping";
import { callEventLabel } from "@/lib/callEventLabel";
import type {
  KmpMessage,
  KmpMessageDelta,
  KmpPanePatch,
  KmpPaneSnapshot,
  KmpTextSegment,
} from "./compose-contract";

/** Keep every specialist message card intact; generic form projection loses its layout and controls. */
export function usesHostedMessageLayout(message: Message): boolean {
  return !message.messageState.startsWith("revoked") &&
    (["flex", "rich", "contact", "location", "file", "emoji"].includes(message.kind) ||
      !!message.postNotification || !!message.combinationStickerId || !!message.linkPreview);
}

function messageSegments(message: Message): KmpTextSegment[] | undefined {
  const segments = segmentTextWithMentions(
    message.text ?? "",
    message.sticons ?? [],
    message.mentions ?? [],
  ).flatMap<KmpTextSegment>((segment) =>
    segment.type !== "text"
      ? [segment]
      : splitTextLinks(segment.value ?? "").map((part) =>
          part.type === "link" ? { type: "link", value: part.value, url: part.href } : part,
        ),
  );
  return segments.some((segment) => segment.type !== "text") ? segments : undefined;
}

type CachedMessage = {
  source: Message;
  before?: Message;
  after?: Message;
  reply?: Message;
  value: KmpMessage;
};

/** Keep unchanged projections referentially stable so the bridge can send deltas. */
export function createKmpMessageProjector() {
  let cache = new Map<string, CachedMessage>();
  let context = "";
  let memberSource: Chat["members"];
  return (
    messages: Message[],
    chat: Chat | undefined,
    streamerMode: boolean,
    selfMid?: string,
  ): KmpMessage[] => {
    if (!chat) {
      cache.clear();
      return [];
    }
    const nextContext = JSON.stringify([
      chat.id,
      chat.name,
      chat.localName,
      chat.type,
      chat.isOfficial,
      chat.avatar,
      chat.avatarUrl,
      chat.color,
      streamerMode,
      selfMid,
    ]);
    if (context !== nextContext || memberSource !== chat.members) cache.clear();
    context = nextContext;
    memberSource = chat.members;
    const nextCache = new Map<string, CachedMessage>();
    const members = new Map(chat.members?.map((member) => [member.id, member]) ?? []);
    const selected = messages
      .filter((message) => message.chatId === chat.id)
      .sort(compareMessagesOldestFirst);
    const byId = new Map(selected.map((message) => [message.id, message]));
    const result = selected.map((message, index) => {
      const before = selected[index - 1];
      const after = selected[index + 1];
      const reply = message.replyToId ? byId.get(message.replyToId) : undefined;
      const cached = cache.get(message.id);
      const canReact = canReactToMessage(message, chat);
      if (
        cached?.source === message &&
        cached.before === before &&
        cached.after === after &&
        cached.reply === reply &&
        cached.value.canReact === canReact
      ) {
        nextCache.set(message.id, cached);
        return cached.value;
      }
      const member = members.get(message.authorId);
      const readers = messageReaders(message, chat, streamerMode);
      const mine = message.authorId === "me";
      const call = message.kind === "call" ? (message.callMeta ?? { video: false, group: false, outcome: "ended" as const }) : undefined;
      const callLabel = call ? callEventLabel(call) : undefined;
      const reactions = new Map<string, {
        type: number;
        key: string;
        iconUrl: string;
        count: number;
        selected: boolean;
        reactors: { id: string; name: string; atMillis: number }[];
      }>();
      for (const reaction of message.reactions ?? []) {
        const key = reaction.emoji ? `${reaction.emoji.productId}:${reaction.emoji.emojiId}` : String(reaction.type);
        const previous = reactions.get(key);
        const reactorMember = members.get(reaction.fromMid);
        const reactorName = reaction.fromMid === (selfMid ?? "")
          ? "自分"
          : reactorMember
            ? memberDisplayName(reactorMember.name, streamerMode)
            : chat.type === "friend"
              ? displayName(chat, streamerMode)
              : memberDisplayName(reaction.fromMid, streamerMode);
        reactions.set(key, {
          key, iconUrl: reactionSticonUrl(reaction.type, reaction.emoji),
          type: reaction.type,
          count: (previous?.count ?? 0) + 1,
          selected: !!previous?.selected || reaction.fromMid === (selfMid ?? ""),
          reactors: [...(previous?.reactors ?? []), {
            id: reaction.fromMid,
            name: reactorName,
            atMillis: reaction.atMillis,
          }],
        });
      }
      const value: KmpMessage = {
        id: message.id,
        authorId: message.authorId,
        authorName: mine
          ? "自分"
          : streamerMode
            ? "メンバー"
            : (member?.name && !looksLikeMid(member.name) ? member.name : undefined) ||
              (chat.type === "friend" ? displayName(chat, false) : "メンバー"),
        avatar: mine ? "" : streamerMode ? "•" : member?.avatar || chat.avatar,
        avatarUrl: !mine && !streamerMode
          ? lineAvatarUrl(member?.avatarUrl || (chat.type === "friend" ? chat.avatarUrl : undefined))
          : undefined,
        color: member?.color || chat.color,
        kind: message.kind,
        hostRichContent: usesHostedMessageLayout(message),
        hostContent: usesHostedMessageLayout(message),
        text: message.messageState.startsWith("revoked")
          ? "取り消されたメッセージ"
          : callLabel?.title || message.text || message.altText || "",
        callDetail: callLabel?.detail,
        callVideo: call?.video,
        callMissed: call ? ["missed", "declined", "cancelled", "no-answer"].includes(call.outcome) : undefined,
        callJoin: call?.group && call.outcome === "started",
        segments: message.messageState.startsWith("revoked") ? undefined : messageSegments(message),
        edited: !!message.edited || message.messageState === "edited",
        createdAt: message.createdAt,
        time: formatTime(message.createdAt),
        status: message.status,
        canRetry: message.authorId === "me" && message.status === "failed" && !!message.retry,
        canReact,
        messageState: message.messageState,
        readCount: Math.max(message.readCount ?? 0, readers.length, message.read ? 1 : 0),
        readers,
        replyToId: message.replyToId,
        replyText: reply?.messageState.startsWith("revoked")
          ? "取り消されたメッセージ"
          : reply?.text || reply?.altText || (reply ? "添付メッセージ" : undefined),
        mediaUrl:
          message.messageState.startsWith("revoked") || streamerMode
            ? undefined
            : message.kind === "video"
              ? message.imageSrc?.replace(/preview=1/, "preview=0")
              : message.stickerAnimated
                ? stickerAnimationUrl(message.sticker)
                : message.imageSrc || message.audioSrc || message.sticker,
        stickerAnimated: !!message.stickerAnimated,
        audioSeconds: message.audioSeconds,
        fileName: message.file?.name,
        reactions: [...reactions.values()],
        groupStart: !sameMessageRun(selected[index - 1], message),
        groupEnd: !sameMessageRun(message, selected[index + 1]),
      };
      nextCache.set(message.id, { source: message, before, after, reply, value });
      return value;
    });
    cache = nextCache;
    return result;
  };
}

export function messageDelta(previous: KmpMessage[], next: KmpMessage[]): KmpMessageDelta {
  const old = new Map(previous.map((message) => [message.id, message]));
  const updates = next.filter((message) => old.get(message.id) !== message);
  const orderChanged =
    previous.length !== next.length ||
    next.some((message, index) => message.id !== previous[index]?.id);
  return { updates, ...(orderChanged ? { ids: next.map((message) => message.id) } : {}) };
}

/** Membership/order use a full pane list; steady-state changes touch only their pane. */
export function panePatches(
  previous: KmpPaneSnapshot[],
  next: KmpPaneSnapshot[],
): Record<string, KmpPanePatch> {
  const result: Record<string, KmpPanePatch> = {};
  for (const pane of next) {
    const before = previous.find((entry) => entry.id === pane.id);
    if (!before) continue;
    let patch: KmpPanePatch = Object.fromEntries(
      Object.entries(pane).filter(
        ([key, value]) => key !== "id" && before[key as keyof KmpPaneSnapshot] !== value,
      ),
    );
    if (patch.messages) {
      const delta = messageDelta(before.messages, pane.messages);
      patch = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "messages"));
      if (delta.updates.length || delta.ids) patch.messageDelta = delta;
    }
    if (Object.keys(patch).length) result[pane.id] = patch;
  }
  return result;
}
