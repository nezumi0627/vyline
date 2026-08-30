import type { Chat as LineChat, Message as LineMessage } from "@vyline/types";
import { extractStickerId, lineStickerUrl } from "../utils/lineMedia.js";
import { getCombinationStickerPreview } from "../utils/combinationStickers.js";
import {
  contentTypeLabel,
  isAudioContent,
  isCallContent,
  isFileContent,
  isContactContent,
  isImageContent,
  isLocationContent,
  isStickerContent,
  isSystemLikeContent,
  isVideoContent,
  systemEventLabel,
} from "../utils/format.js";
import {
  altTextFromMeta,
  isFlexContentType,
  isRichContentType,
  parseFlexContainer,
  parseRichMarkup,
  richDownloadUrl,
} from "./flex/parse.js";
import { parseSticonReplace } from "../utils/lineSticon.js";
import { parseMentions } from "../utils/mention.js";
import type { Chat, Member, Message, MessageKind, MessageStatus } from "./store-types.js";

const COLORS = ["#2aabee", "#06c755", "#f0728f", "#7c5cff", "#f5a623", "#2dd4bf", "#a78bfa"];

/** LINE mid っぽい文字列（u/c/r + hex32） */
export function looksLikeMid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[ucr][0-9a-f]{32}$/i.test(value.trim());
}

export type ContactInfo = {
  name?: string;
  thumbnailUrl?: string;
};

function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

function initial(name: string): string {
  const t = (name || "?").trim();
  if (!t || looksLikeMid(t)) return "?";
  return t.charAt(0).toUpperCase();
}

function sanitizeText(text: string | null | undefined): string | undefined {
  if (text == null) return undefined;
  if (typeof text !== "string") return String(text);
  const cleaned = text.replace(/\uFFFD/g, "").trim();
  return cleaned || undefined;
}

function parsePostNotification(meta: Record<string, unknown> | null) {
  if (!meta) return undefined;
  const serviceType = String(meta.serviceType ?? meta.SERVICE_TYPE ?? "").toUpperCase();
  const postEndUrl = typeof meta.postEndUrl === "string" ? meta.postEndUrl : "";
  const params = (() => {
    try {
      return postEndUrl ? new URL(postEndUrl).searchParams : null;
    } catch {
      return null;
    }
  })();
  const homeId = String(meta.chatId ?? meta.homeId ?? params?.get("homeId") ?? "") || undefined;
  const albumId =
    String(
      meta.cafeId ?? meta.albumId ?? params?.get("albumIdV2") ?? params?.get("albumId") ?? "",
    ) || undefined;
  const postId =
    String(meta.postId ?? meta.POST_ID ?? meta.noteId ?? params?.get("postId") ?? "") || undefined;
  const previewMedias = (() => {
    const raw = meta.previewMedias;
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return undefined;
      return parsed
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const media = item as Record<string, unknown>;
          const mediaOid = typeof media.mediaOid === "string" ? media.mediaOid : "";
          return mediaOid
            ? {
                mediaOid,
                mediaType: typeof media.mediaType === "string" ? media.mediaType : undefined,
              }
            : null;
        })
        .filter((item): item is { mediaOid: string; mediaType: string | undefined } =>
          Boolean(item),
        );
    } catch {
      return undefined;
    }
  })();
  if (serviceType === "AB" || albumId) {
    return {
      kind: "album" as const,
      homeId,
      albumId,
      title: typeof meta.albumName === "string" ? meta.albumName : undefined,
      mediaCount: Number(meta.mediaCount) || undefined,
      previewMedias,
    };
  }
  if (postId || serviceType === "NOTE" || serviceType === "NT") {
    return { kind: "note" as const, homeId, postId };
  }
  return { kind: "unknown" as const, homeId };
}

function resolveDisplayName(
  raw: string | null | undefined,
  fallbackMid: string,
  contact?: ContactInfo,
): string {
  const fromContact = contact?.name?.trim();
  if (fromContact && !looksLikeMid(fromContact)) return fromContact;
  const fromApi = raw?.trim();
  if (fromApi && !looksLikeMid(fromApi) && fromApi !== "(No Name)") return fromApi;
  return fallbackMid;
}

export function mapChat(
  c: LineChat,
  hidden = false,
  contactCache?: Map<string, ContactInfo>,
): Chat {
  const isGroup = c.kind === "group" || c.kind === "room";
  const contact = contactCache?.get(c.mid);
  const name = resolveDisplayName(c.name, c.mid, contact);
  const avatarUrl = c.thumbnailUrl || contact?.thumbnailUrl;
  const left = Boolean(c.left);
  return {
    id: c.mid,
    type: isGroup ? "group" : "friend",
    name,
    avatar: initial(name),
    avatarUrl,
    color: colorForId(c.mid),
    status: left ? "退出済み" : isGroup ? "グループ" : "",
    isOfficial: c.isOfficial,
    statusMessage: !isGroup ? c.statusMessage : undefined,
    backgroundUrl: c.backgroundUrl,
    isSelf: c.isSelf,
    left,
    restoredHistory: c.restoredHistory,
    unread: c.unreadCount ?? 0,
    hidden,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageTime: c.lastMessageTime > 0 ? c.lastMessageTime : undefined,
  };
}

export function mapMember(mid: string, name?: string, avatarUrl?: string): Member {
  const resolved = name && !looksLikeMid(name) ? name : looksLikeMid(mid) ? mid : name || mid;
  // MIDのままの場合は短く表示（u7c6ea... 形式）
  const displayName =
    resolved.length > 14 && looksLikeMid(resolved) ? `${resolved.slice(0, 12)}...` : resolved;
  return {
    id: mid,
    name: displayName,
    avatar: initial(resolved),
    avatarUrl,
    color: colorForId(mid),
  };
}

function messageStatus(m: LineMessage): MessageStatus {
  if (m.contentType === "UNSENT" || m.contentType === "UNSEND") return "read";
  if (m.isMyMessage) {
    if (m.seen || (m.readCount != null && m.readCount > 0)) return "read";
    return "sent";
  }
  // For received messages, status depends on whether we've read it
  if (m.seen || (m.readCount != null && m.readCount > 0)) return "read";
  return "sent";
}

function messageKind(m: LineMessage): MessageKind {
  const ct = m.contentType;
  if (ct === "E2EE_UNAVAILABLE") return "system";
  if (isCallContent(ct)) return "call";
  if (isSystemLikeContent(ct)) return "system";
  if (isStickerContent(ct) || Boolean(extractStickerId(m.contentMetadata ?? null)))
    return "sticker";
  if (isVideoContent(ct)) return "video";
  if (isImageContent(ct)) return "image";
  if (isAudioContent(ct)) return "audio";
  if (isFileContent(ct)) return "file";
  if (isLocationContent(ct)) return "location";
  if (isContactContent(ct)) return "contact";
  if (isFlexContentType(ct)) return "flex";
  if (isRichContentType(ct)) return "rich";
  const text = sanitizeText(m.text);
  // text が Flex JSON のときは flex 扱い（メタ欠落・誤 contentType 対策）
  if (text?.startsWith("{") && /"type"\s*:\s*"(bubble|carousel)"/.test(text)) {
    return "flex";
  }
  if (text && /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}){1,3}$/u.test(text)) {
    return "emoji";
  }
  return "text";
}

/**
 * CHATEVENT の LOC_KEY / LOC_ARGS を日本語テキストに変換する。
 * 例: C_ML → 「れんやさんが退出しました」 / C_MI → 「れんやさん、○○さんが参加しました」
 */
export function chatEventText(
  contentType: string,
  meta?: Record<string, unknown> | null,
  resolveName?: (mid: string) => string | undefined,
): string | null {
  if (String(contentType).toUpperCase() !== "CHATEVENT") return null;
  const lk = String(meta?.LOC_KEY ?? "").trim();
  if (!lk) return null;
  const args = String(meta?.LOC_ARGS ?? "")
    .split(/[\x1e\x1f]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const display = (mid: string) => {
    const n = resolveName?.(mid);
    return n && !looksLikeMid(n) ? n : mid.slice(0, 12);
  };
  const joinNames = () => args.map((a) => `${display(a)}さん`).join("、");

  switch (lk) {
    case "C_ML":
    case "A_ML":
      return args[0] ? `${display(args[0])}さんが退出しました` : "メンバーが退出しました";
    case "C_MI":
    case "A_MI":
      return args.length ? `${joinNames()}が参加しました` : "メンバーが参加しました";
    case "C_GI":
      return args.length ? `${joinNames()}を招待しました` : "メンバーを招待しました";
    case "C_MJ":
    case "A_MJ":
      return args.length ? `${joinNames()}がグループに参加しました` : "メンバーが参加しました";
    case "C_MR":
    case "A_MR":
      return args[0]
        ? `${display(args[0])}さんが退会させられました`
        : "メンバーが退会させられました";
    case "C_IC":
    case "A_IC":
      return args[0]
        ? `${display(args[0])}さんが招待を辞退しました`
        : "メンバーが招待を辞退しました";
    case "C_PN":
      return args[0] ? `グループ名が「${args[0]}」に変更されました` : "グループ名が変更されました";
    case "C_PI":
      return "グループのプロフィール画像が変更されました";
    case "C_PL":
      return "グループの制限が解除されました";
    case "C_MA":
      return "メッセージがアナウンスされました";
    case "C_OL":
      return "グループのメンバー上限に達したため招待できませんでした";
    case "C_BG":
    case "C_SN":
      return "招待リンクでの参加が許可されました";
    case "C_SP":
      return "招待リンクでの参加が無効化されました";
    default:
      return null;
  }
}

function parseAudioDuration(meta?: Record<string, string | undefined> | null): number | undefined {
  if (!meta) return undefined;
  const raw = meta.AUDLEN ?? meta.DURATION ?? meta.duration;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n > 1000 ? Math.round(n / 1000) : Math.round(n);
}

export function mapMessage(
  m: LineMessage,
  chatId: string,
  accountId: string,
  _contactCache?: Map<string, ContactInfo>,
): Message {
  const kind = messageKind(m);
  const messageState =
    m.messageState ??
    (m.contentType === "UNSENT" || m.contentType === "UNSEND"
      ? m.isMyMessage
        ? "revoked-by-self"
        : "revoked-by-other"
      : "normal");
  const meta = (m.contentMetadata ?? null) as Record<string, unknown> | null;
  const stickerId = extractStickerId(m.contentMetadata ?? null);
  const comboStickerId =
    typeof meta?.CSSTKID === "string" && meta.CSSTKID.trim() ? meta.CSSTKID.trim() : null;
  const authorId = m.isMyMessage ? "me" : m.from;

  let imageSrc: string | undefined;
  let audioSrc: string | undefined;
  if ((kind === "image" || kind === "video") && accountId) {
    imageSrc = `/api/line/${encodeURIComponent(accountId)}/media/${encodeURIComponent(chatId)}/${encodeURIComponent(m.id)}?preview=1`;
  }
  if (kind === "audio" && accountId) {
    audioSrc = `/api/line/${encodeURIComponent(accountId)}/media/${encodeURIComponent(chatId)}/${encodeURIComponent(m.id)}?preview=0`;
  }

  const isPersonalChat = chatId.startsWith("u");
  const read = m.isMyMessage
    ? isPersonalChat
      ? Boolean(m.seen)
      : Boolean(m.seen) || (m.readCount != null && m.readCount > 0)
    : isPersonalChat
      ? Boolean(m.seen)
      : Boolean(m.seen) || (m.readCount != null && m.readCount > 0);

  let text = sanitizeText(m.text);
  if (kind === "system") {
    if (m.contentType === "E2EE_UNAVAILABLE") {
      text = contentTypeLabel("E2EE_UNAVAILABLE");
    } else {
      // CHATEVENT は LOC_KEY/LOC_ARGS から実テキストを組み立てる
      const chatEvent = chatEventText(
        String(m.contentType),
        m.contentMetadata as Record<string, unknown> | null,
        (mid) => _contactCache?.get(mid)?.name,
      );
      text = chatEvent ?? (text || systemEventLabel(m.contentType, m.contentMetadata ?? null));
    }
  }

  const altText = altTextFromMeta(meta);
  if ((kind === "flex" || kind === "rich") && !text && altText) {
    text = altText;
  }
  // 未対応 contentType が空バブルになるのを防ぐ（FILE 等は専用 UI、その他はラベル表示）
  const ctUpper = String(m.contentType ?? "").toUpperCase();
  if (kind === "text" && !text && ctUpper !== "NONE" && ctUpper !== "0") {
    text = `[${contentTypeLabel(m.contentType)}]`;
  }
  // Flex JSON が text に入っているときはバブルに出さない
  if (kind === "flex" && text?.startsWith("{") && /"type"\s*:/.test(text)) {
    text = altText || undefined;
  }

  const flexJson =
    kind === "flex" ? parseFlexContainer(meta, sanitizeText(m.text) ?? null) : undefined;
  const richMarkup = kind === "rich" ? parseRichMarkup(meta) : undefined;

  const location =
    kind === "location"
      ? parseLocationFromMeta(m.contentMetadata as Record<string, unknown> | null, text)
      : undefined;
  const contact =
    kind === "contact"
      ? parseContactFromMeta(m.contentMetadata as Record<string, unknown> | null, text)
      : undefined;

  const file =
    kind === "file"
      ? {
          name:
            typeof meta?.FILE_NAME === "string" && meta.FILE_NAME
              ? meta.FILE_NAME
              : (sanitizeText(m.text) ?? "ファイル"),
          size: Number(meta?.FILE_SIZE) || undefined,
        }
      : undefined;

  let stickerSrc: string | undefined;
  if (kind === "sticker") {
    // コンビネーション: CSSTKID → メッセージID の順でローカルプレビューを引く。
    // 履歴レスポンスに CSSTKID が載らない場合でも、送信時に保存したプレビューで表示を維持する。
    const comboPreview = comboStickerId
      ? getCombinationStickerPreview(accountId, comboStickerId)
      : null;
    const preview = comboPreview ?? getCombinationStickerPreview(accountId, m.id);
    if (preview) stickerSrc = preview;
    else if (comboStickerId) stickerSrc = lineStickerUrl(comboStickerId);
    else if (stickerId) stickerSrc = lineStickerUrl(stickerId);
    else stickerSrc = "🧩";
  }

  const result: Message = {
    id: m.id,
    chatId,
    authorId,
    kind,
    text,
    sticker: stickerSrc,
    imageSrc,
    audioSrc,
    audioSeconds: kind === "audio" ? parseAudioDuration(m.contentMetadata ?? null) : undefined,
    altText,
    flexJson,
    richMarkup,
    richImageUrl: kind === "rich" ? richDownloadUrl(meta) : undefined,
    sticons:
      kind === "text" || kind === "emoji"
        ? parseSticonReplace(m.contentMetadata ?? null)
        : undefined,
    mentions:
      kind === "text"
        ? parseMentions(m.contentMetadata as Record<string, unknown> | null)
        : undefined,
    callMeta: kind === "call" ? parseCallMeta(m.contentType, meta) : undefined,
    postNotification:
      String(m.contentType ?? "").toUpperCase() === "POSTNOTIFICATION"
        ? parsePostNotification(meta)
        : undefined,
    createdAt: m.createdTime,
    status: messageStatus(m),
    read,
    readBy: m.readBy,
    messageState,
    replyToId: m.relatedMessageId ?? undefined,
    reactions: m.reactions
      ?.filter((r) => Number.isFinite(r.type))
      .map((r) => ({
        fromMid: r.fromMid,
        atMillis: r.atMillis,
        type: r.type,
      })),
    stickerAnimated: m.stickerAnimated,
    stickerSticky: m.stickerSticky,
    edited:
      m.isEdited ||
      (m.updatedTime != null && m.updatedTime > 0) ||
      meta?.EDITED === "1" ||
      meta?.is_edited === "true" ||
      Boolean(m.originalText),
    editedAt: m.updatedTime != null && m.updatedTime > 0 ? m.updatedTime : undefined,
    originalText: m.originalText || (meta?.ORIGINAL_TEXT as string | undefined),
    history: m.history?.length ? m.history : undefined,
    ...(m.revokedSnapshot
      ? { revokedSnapshot: mapMessage(m.revokedSnapshot, chatId, accountId, _contactCache) }
      : {}),
    contact,
    location,
    file,
  };

  // sticon のみの本文は emoji 扱いにして本家同等の大きさで表示
  if (result.kind === "text" && result.sticons && result.sticons.length > 0) {
    const stripped = (result.text ?? "").replace(/[￼$]/g, "");
    if (!stripped.trim()) result.kind = "emoji";
  }

  return result;
}

function parseLocationFromMeta(
  meta: Record<string, unknown> | null,
  text: string | undefined,
): Message["location"] {
  if (!meta) return { address: text };
  const num = (k: string) => {
    const v = meta?.[k];
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const lat = num("latitude") ?? num("lat");
  const lng = num("longitude") ?? num("lon") ?? num("long");
  const title = typeof meta.title === "string" ? meta.title.trim() : undefined;
  const address =
    typeof meta.address === "string" && meta.address.trim()
      ? meta.address.trim()
      : typeof text === "string" && text.trim()
        ? text.trim()
        : undefined;
  if (!lat && !lng && !title && !address) return undefined;
  return {
    title: title || undefined,
    address: address || undefined,
    latitude: lat,
    longitude: lng,
  };
}

function parseContactFromMeta(
  meta: Record<string, unknown> | null,
  text: string | undefined,
): Message["contact"] {
  if (!meta) return text ? { name: text } : undefined;
  const mid =
    typeof meta.mid === "string"
      ? meta.mid.trim()
      : typeof meta.MID === "string"
        ? meta.MID.trim()
        : undefined;
  const name =
    typeof meta.displayName === "string" && meta.displayName.trim()
      ? meta.displayName.trim()
      : typeof text === "string" && text.trim()
        ? text.trim()
        : undefined;
  if (!mid && !name) return undefined;
  return { mid, name };
}

function parseCallMeta(
  contentType: string,
  meta: Record<string, unknown> | null,
): import("./store-types.js").CallMessageMeta {
  const u = contentType.toUpperCase();
  const typeHint = String(meta?.CALL_TYPE ?? meta?.TYPE ?? "").toUpperCase();
  const video =
    (u.includes("VIDEO") && u.includes("CALL")) || typeHint.includes("VIDEO") || typeHint === "1";
  const group = u.includes("GROUP") || Boolean(meta?.GC_DURATION);
  const durationRaw = meta?.DURATION ?? meta?.GC_DURATION ?? meta?.duration;
  let durationSec: number | undefined;
  if (typeof durationRaw === "string" || typeof durationRaw === "number") {
    const n = Number(durationRaw);
    if (Number.isFinite(n) && n > 0) {
      durationSec = n > 10_000 ? Math.round(n / 1000) : Math.round(n);
    }
  }
  const result = String(meta?.RESULT ?? meta?.eventType ?? "").toLowerCase();
  let outcome: import("./store-types.js").CallMessageMeta["outcome"] = "ended";
  if (result.includes("cancel") || result.includes("miss") || result === "3") {
    outcome = "missed";
  } else if (result.includes("decline") || result.includes("reject") || result === "2") {
    outcome = "declined";
  } else if (result.includes("busy")) {
    outcome = "busy";
  } else if (!durationSec && !result) {
    outcome = "ended";
  }
  return { video, group, durationSec, outcome };
}

export function buildMembersFromMessages(
  messages: LineMessage[],
  contactCache?: Map<string, ContactInfo>,
): Member[] {
  const map = new Map<string, Member>();
  for (const m of messages) {
    if (m.isMyMessage || !m.from || map.has(m.from)) continue;
    const contact = contactCache?.get(m.from);
    map.set(
      m.from,
      mapMember(
        m.from,
        contact?.name && !looksLikeMid(contact.name) ? contact.name : undefined,
        contact?.thumbnailUrl,
      ),
    );
  }
  return [...map.values()];
}
