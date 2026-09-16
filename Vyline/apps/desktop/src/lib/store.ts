import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, type Announcement } from "../api/client.js";
import {
  canUnsendMessage,
  type Chat as LineChat,
  type Message as LineMessage,
} from "@vyline/types";
import { THEME_PRESETS } from "@vyline/themes";
import type {
  Chat,
  ChatSort,
  Message,
  MessageReaction,
  MessageSnapshot,
  VyTheme,
  Settings,
  Screen,
  SelfProfile,
} from "./store-types.js";
import {
  buildMembersFromMessages,
  looksLikeMid,
  mapChat,
  mapMember,
  mapMessage,
  type ContactInfo,
} from "./mappers.js";
import { lineStickerUrl } from "../utils/lineMedia.js";
import {
  COMBO_EDITOR_SIZE,
  COMBO_ITEM_MAX_SIZE,
  COMBO_ITEM_MIN_SIZE,
  renderCombinationStickerPreview,
  setCombinationStickerPreview,
  type CombinationStickerPlacement,
} from "../utils/combinationStickers.js";
import { getDismissedChatMids, getRestoredChatMids } from "../utils/dismissedChats.js";
import { parseMentions, type MentionDraft } from "../utils/mention.js";
import { parseSticonReplace } from "../utils/lineSticon.js";
import { compressImageFile } from "../utils/compressImage.js";
import { setHiddenForAccount } from "../hooks/useHiddenChats.js";
import { invalidateMessage } from "./reactionCache.js";
import type { MessageState } from "./store-types.js";
import {
  addChatPane,
  closeChatPaneAt,
  equalChatPaneSizes,
  MAX_CHAT_PANES,
  normalizeChatPaneSizes,
  replaceFocusedChatPane,
} from "./chatPanes.js";
import { matchOptimisticMediaMessages } from "./mediaGroup.js";
import {
  maxMessageId,
  mergeReadByAt,
  mergeMemberReadRanges,
  mergeMemberReadWatermarks,
  readersForMessageId,
  readTimesForMessageId,
  type MemberReadRange,
} from "./readReceiptRanges.js";
import { compareLastMessageCursor, mergeLatestChatMetadata } from "./chatPreview.js";
import { emitAppEvent } from "./appEvents.js";

export type {
  Chat,
  ChatSort,
  Message,
  Member,
  VyTheme,
  Settings,
  Screen,
  MessageState,
} from "./store-types.js";

/** chatId → 送信済み lastMessageId（既読 API の重複抑止） */
const readReceiptSent = new Map<string, string>();
/** chatId → 進行中の既読ポーリング */
const readReceiptInflight = new Map<string, Promise<void>>();
/** 既読ウォーターマークのキャッシュ有効時間 — 読み込み高速化のため毎回の既読取得を避ける */
const READ_WATERMARK_TTL_MS = 30_000;
/** accountId → Talk poll カーソル */
const eventPollCursor = new Map<string, number>();
/** accountId → 進行中の poll */
const pollIncomingInflight = new Map<string, Promise<void>>();
/** accountId/chatId/モード → 進行中の履歴同期 */
const messageRefreshInflight = new Map<string, Promise<void>>();
/** accountId/chatId → 進行中の差分同期（着信ポーリングとは独立） */
const messageDeltaInflight = new Map<string, Promise<void>>();
/** showNotice の自動消去タイマー */
const noticeTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };
/** chatId → refresh 遅延タイマー（連続送信時の refreshMessages 抑制） */
const refreshDebounce = new Map<string, ReturnType<typeof setTimeout>>();
/** accountId → delta 実行間隔制御 */
const lastDeltaPollAt = new Map<string, number>();
/** messageId → リアクションのキャッシュ（高速読み込み用） */
const messageReactionCache = new Map<string, MessageReaction[]>();
/** chatId → 進行中のギャップ backfill（重複抑止） */
/** mid → プロフィール取得済み（重複 API 抑止） */
const contactFetched = new Set<string>();
/** reader MID → 最終プロフィール取得試行（失敗時の短時間連打を防ぐ） */
const readerProfileFetchAttemptAt = new Map<string, number>();
/** account/mid → 進行中の既読者プロフィール解決（複数の既読者表示から共有） */
const readerProfileResolveInflight = new Map<string, Promise<void>>();
const READER_PROFILE_RETRY_MS = 30_000;
/** このセッションでユーザーが明示的に開いた chatId（自動既読ガード） */
const sessionOpenedChats = new Set<string>();
/** 最近既読にした chat の時刻（サーバ反映前の未読上書き抑止） */
const recentlyReadAt = new Map<string, number>();
const RECENTLY_READ_WINDOW_MS = 60_000;
/** 楽観メディアID → 表示に使う Blob URL。確定置換まで生存させる。 */
const optimisticMediaObjectUrls = new Map<string, string>();

const accountChatKey = (accountId: string, chatId: string) => `${accountId}:${chatId}`;
const lastOpenedChatStorageKey = (accountId: string) => `vyline:last-opened-chat:${accountId}`;

function revokeObjectUrl(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

export function registerOptimisticMediaObjectUrl(messageId: string, url: string): void {
  const previous = optimisticMediaObjectUrls.get(messageId);
  if (previous && previous !== url) revokeObjectUrl(previous);
  optimisticMediaObjectUrls.set(messageId, url);
}

export function releaseOptimisticMediaObjectUrl(messageId: string): void {
  const url = optimisticMediaObjectUrls.get(messageId);
  if (!url) return;
  optimisticMediaObjectUrls.delete(messageId);
  revokeObjectUrl(url);
}

function releaseAllOptimisticMediaObjectUrls(): void {
  for (const url of optimisticMediaObjectUrls.values()) revokeObjectUrl(url);
  optimisticMediaObjectUrls.clear();
}

function rememberLastOpenedChat(accountId: string, chatId: string): void {
  try {
    localStorage.setItem(lastOpenedChatStorageKey(accountId), chatId);
  } catch {
    /* localStorage may be unavailable in restricted browser contexts */
  }
}

// push が機能しない環境でもアクティブチャットの受信を保証するための間隔
const DELTA_POLL_MIN_MS = 10_000;

function emptySelfProfile(): SelfProfile {
  return { name: "Vyline", avatar: "V", status: "" };
}

export function isResolvedMemberProfileName(name: string | null | undefined): name is string {
  const normalized = name?.trim();
  if (!normalized || looksLikeMid(normalized)) return false;
  if (/^[ucr][0-9a-f]{6,}\.\.\.$/i.test(normalized)) return false;
  return !["メンバー", "member", "(no name)", "unknown"].includes(normalized.toLowerCase());
}

function buildContactCache(chats: Chat[]): Map<string, ContactInfo> {
  const contactCache = new Map<string, ContactInfo>();
  for (const c of chats) {
    contactCache.set(c.id, { name: c.name, thumbnailUrl: c.avatarUrl });
    for (const m of c.members ?? []) {
      contactCache.set(m.id, { name: m.name, thumbnailUrl: m.avatarUrl });
    }
  }
  return contactCache;
}

function snapshotFromMessage(m: Message): MessageSnapshot {
  const { history: _history, revokedSnapshot: _revokedSnapshot, ...snapshot } = m;
  return snapshot;
}

/**
 * 楽観メッセージを確定メッセージへ差し替える。
 * push / delta が送信 API の応答より先に同じメッセージを届けていても 1 件に畳む。
 */
function replaceOptimisticMessage(
  messages: Message[],
  tempId: string,
  confirmed: Message,
): Message[] {
  const out: Message[] = [];
  let placed = false;
  for (const m of messages) {
    if (m.id !== tempId && m.id !== confirmed.id) {
      out.push(m);
      continue;
    }
    if (placed) continue;
    placed = true;
    out.push(confirmed);
  }
  if (!placed) out.push(confirmed);
  return out;
}

/**
 * 既読状態は単調にのみ進める。メッセージごとに「誰が・いつ最初に既読にしたか」を保持し、
 * あとから届いた新しい既読レンジで過去の既読時刻を上書きしない。
 */
function mergeMessageReadState(
  previous: Message | undefined,
  incoming: Message,
  selfMid?: string,
): Message {
  if (!previous) return incoming;
  const senderMid = incoming.authorId === "me" ? selfMid : incoming.authorId;
  const readByAt = mergeReadByAt(previous.readByAt, incoming.readByAt, senderMid);
  const readBy = [
    ...new Set([
      ...(previous.readBy ?? []).filter((mid) => mid !== senderMid),
      ...(incoming.readBy ?? []).filter((mid) => mid !== senderMid),
      ...Object.keys(readByAt),
    ]),
  ];
  const readCount = Math.max(previous.readCount ?? 0, incoming.readCount ?? 0, readBy.length);
  const read = previous.read || incoming.read || readCount > 0;
  return {
    ...incoming,
    read,
    status: read ? "read" : incoming.status,
    ...(readBy.length > 0 ? { readBy } : {}),
    ...(Object.keys(readByAt).length > 0 ? { readByAt } : {}),
    ...(readCount > 0 ? { readCount } : {}),
  };
}

/** グループ/ルーム、または自分の送信メッセージだけが既読者を持つ。 */
function tracksReadState(chatId: string, message: Message): boolean {
  return chatId.startsWith("c") || chatId.startsWith("r") || message.authorId === "me";
}

function isDataUrl(value?: string): boolean {
  return typeof value === "string" && value.startsWith("data:");
}

function mergePreservingComboStickerPreview(existing: Message, incoming: Message): Message {
  if (existing.kind !== "sticker" || incoming.kind !== "sticker") return incoming;
  if (!isDataUrl(existing.sticker)) return incoming;
  if (isDataUrl(incoming.sticker)) return incoming;
  // ローカル合成プレビューはサーバ再取得結果（🧩 や無効 URL）より常に優先
  return {
    ...incoming,
    sticker: existing.sticker,
  };
}

function combinationPlacementsFromItems(
  items: Array<{ packageId: string; stickerId: string; x?: number; y?: number; size?: number }>,
): CombinationStickerPlacement[] {
  return items.map((item, index) => {
    const size = Math.round(
      Math.max(
        COMBO_ITEM_MIN_SIZE,
        Math.min(COMBO_ITEM_MAX_SIZE, item.size ?? COMBO_ITEM_MAX_SIZE / 2),
      ),
    );
    const fallback = Math.max(
      0,
      COMBO_EDITOR_SIZE / 2 - size / 2 + (index % 3) * 16 + Math.floor(index / 3) * 16,
    );
    return {
      packageId: item.packageId,
      stickerId: item.stickerId,
      url: lineStickerUrl(item.stickerId),
      name: item.stickerId,
      x: item.x ?? fallback,
      y: item.y ?? fallback,
      size,
    };
  });
}

/** 送信済みコンビネーションのローカル合成プレビューを CSSTKID とメッセージIDの両方に保存 */
async function persistCombinationStickerPreview(
  accountId: string,
  message: LineMessage | null,
  placements: CombinationStickerPlacement[],
): Promise<string | null> {
  if (!message) return null;
  try {
    const dataUrl = await renderCombinationStickerPreview(placements);
    if (!dataUrl) return null;
    const meta = (message.contentMetadata ?? null) as Record<string, unknown> | null;
    const comboId =
      typeof meta?.CSSTKID === "string" && meta.CSSTKID.trim() ? meta.CSSTKID.trim() : null;
    if (comboId) setCombinationStickerPreview(accountId, comboId, dataUrl);
    const messageId = message.id != null ? String(message.id) : "";
    if (messageId && messageId !== comboId) {
      setCombinationStickerPreview(accountId, messageId, dataUrl);
    }
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * 既読ウォーターマークをローカルのメッセージへ適用する。
 * DM: 相手が既読した最大メッセージID 以前の自分のメッセージを全て既読化。
 * グループ: メンバーごとのウォーターマークで readBy/readCount を補完。
 * RPC を飛ばさず既存データから導出するため読み込みが高速。
 */
function applyReadWatermarkLocal(
  chatMessages: Message[],
  cache: {
    peerReadUpTo?: string;
    memberWatermarks?: Array<{ mid: string; upTo: string }>;
    memberReadRanges?: MemberReadRange[];
  },
  force: boolean,
  selfMid?: string,
): Map<string, Partial<Message>> | null {
  let changed = false;
  const patches = new Map<string, Partial<Message>>();

  if (cache.peerReadUpTo) {
    let upToN: bigint;
    try {
      upToN = BigInt(cache.peerReadUpTo);
    } catch {
      upToN = 0n;
    }
    for (const m of chatMessages) {
      if (m.authorId !== "me" || m.read) continue;
      let idN: bigint;
      try {
        idN = BigInt(m.id);
      } catch {
        continue;
      }
      // 相手の最終既読地点より前の自分のメッセージは既読
      if (idN <= upToN) {
        patches.set(m.id, { read: true, status: "read" });
        changed = true;
      }
    }
  }

  if (cache.memberReadRanges !== undefined || cache.memberWatermarks?.length) {
    for (const m of chatMessages) {
      const senderMid = m.authorId === "me" ? selfMid : m.authorId;
      const readBy =
        cache.memberReadRanges !== undefined
          ? readersForMessageId(cache.memberReadRanges, m.id, senderMid)
          : (cache.memberWatermarks ?? []).flatMap((watermark) => {
              if (senderMid && watermark.mid === senderMid) return [];
              try {
                return BigInt(watermark.upTo) >= BigInt(m.id) ? [watermark.mid] : [];
              } catch {
                return [];
              }
            });
      const readByAt = mergeReadByAt(
        m.readByAt,
        readTimesForMessageId(cache.memberReadRanges, m.id, senderMid, m.createdAt),
        senderMid,
      );
      const prevReadBy = (m.readBy ?? []).filter((mid) => mid !== senderMid);
      const prevReadCount = m.readCount ?? 0;
      // 既知の既読者より少なくならない範囲で補完する。
      const nextReadBy = [...new Set([...prevReadBy, ...readBy, ...Object.keys(readByAt)])];
      if (nextReadBy.length === 0) continue;
      const nextReadCount = Math.max(prevReadCount, nextReadBy.length);
      if (
        force ||
        nextReadBy.length > prevReadBy.length ||
        Object.keys(readByAt).length > Object.keys(m.readByAt ?? {}).length ||
        nextReadCount > prevReadCount ||
        !m.read
      ) {
        patches.set(m.id, {
          read: true,
          status: "read",
          readBy: nextReadBy,
          ...(Object.keys(readByAt).length > 0 ? { readByAt } : {}),
          readCount: nextReadCount,
        });
        changed = true;
      }
    }
  }

  return changed ? patches : null;
}

export function messagePreview(m: Message): string {
  if (m.messageState.startsWith("revoked")) {
    if (m.revokedSnapshot) return `取り消し済み: ${messagePreview(m.revokedSnapshot)}`;
    const last = m.history
      ? [...m.history].reverse().find((h) => h.state === "normal" || h.state === "edited")
      : undefined;
    if (last?.text) return `取り消し済み: ${last.text}`;
    return "取り消し済みのメッセージ";
  }
  switch (m.kind) {
    case "sticker":
      return m.altText || "スタンプ";
    case "image":
      return "写真";
    case "video":
      return "動画";
    case "audio":
      return "音声";
    case "flex":
    case "rich":
      return m.altText || m.text || (m.kind === "flex" ? "Flexメッセージ" : "リッチメッセージ");
    case "call": {
      const cm = m.callMeta;
      if (!cm) return "通話";
      return cm.video ? "ビデオ通話" : "音声通話";
    }
    case "emoji":
      return "絵文字";
    case "system":
      return m.text || "通知";
    default: {
      const t = m.text ?? "";
      const stripped = t.replace(/[￼�$]/g, "");
      if (t && !stripped) return "絵文字";
      return stripped.slice(0, 100) || "";
    }
  }
}

type ChatLastMessageSnapshot = Pick<
  Chat,
  "lastMessageId" | "lastMessagePreview" | "lastMessageTime"
>;

function messagePreviewForChat(m: Message): string {
  const preview = messagePreview(m);
  return m.authorId === "me" && preview ? `あなた: ${preview}` : preview;
}

export function updateChatsWithLatestMessage(
  chats: Chat[],
  chatId: string,
  message: Message,
  replacesMessageId?: string,
): Chat[] {
  const index = chats.findIndex((chat) => chat.id === chatId);
  if (index < 0) return chats;
  const current = chats[index]!;
  const candidate: Chat = {
    ...current,
    lastMessageId: message.id,
    lastMessagePreview: messagePreviewForChat(message),
    lastMessageTime: message.createdAt,
  };
  const updated =
    replacesMessageId && current.lastMessageId === replacesMessageId
      ? candidate
      : mergeLatestChatMetadata(current, candidate);
  if (
    updated.lastMessageId === current.lastMessageId &&
    updated.lastMessagePreview === current.lastMessagePreview &&
    updated.lastMessageTime === current.lastMessageTime
  ) {
    return chats;
  }

  const next = chats.filter((_, chatIndex) => chatIndex !== index);
  if (updated.lastMessageId !== message.id) {
    next.splice(index, 0, updated);
    return next;
  }

  // "最新順" は API の配列順を使うため、ローカル新着も同じ並びへ即時反映する。
  const firstUnpinned = next.findIndex((chat) => !chat.pinned);
  const insertAt = updated.pinned ? 0 : firstUnpinned < 0 ? next.length : firstUnpinned;
  next.splice(insertAt, 0, updated);
  return next;
}

function restoreOptimisticChatMetadata(
  chats: Chat[],
  chatId: string,
  optimisticMessageId: string,
  previous: ChatLastMessageSnapshot | undefined,
): Chat[] {
  if (!previous) return chats;
  return chats.map((chat) =>
    chat.id === chatId && chat.lastMessageId === optimisticMessageId
      ? {
          ...chat,
          lastMessageId: previous.lastMessageId,
          lastMessagePreview: previous.lastMessagePreview,
          lastMessageTime: previous.lastMessageTime,
        }
      : chat,
  );
}

function preserveLocallyNewerChatOrder(previous: Chat[], incoming: Chat[]): Chat[] {
  if (previous.length === 0 || incoming.length === 0) return incoming;
  const incomingById = new Map(incoming.map((chat) => [chat.id, chat]));
  const previousById = new Map(previous.map((chat) => [chat.id, chat]));
  const incomingIndex = new Map(incoming.map((chat, index) => [chat.id, index]));
  const locallyNewerIds = new Set(
    previous
      .filter((chat) => {
        const next = incomingById.get(chat.id);
        return next ? compareLastMessageCursor(chat, next) === 1 : false;
      })
      .map((chat) => chat.id),
  );
  if (locallyNewerIds.size === 0) return incoming;
  const effectiveById = new Map(
    incoming.map((chat) => {
      const prev = previousById.get(chat.id);
      return [chat.id, prev ? mergeLatestChatMetadata(prev, chat) : chat] as const;
    }),
  );

  const isPinned = (chat: Chat) => Boolean(previousById.get(chat.id)?.pinned ?? chat.pinned);
  const ordered = incoming.filter((chat) => !locallyNewerIds.has(chat.id));

  for (const previousChat of previous) {
    if (!locallyNewerIds.has(previousChat.id)) continue;
    const candidate = incomingById.get(previousChat.id);
    if (!candidate) continue;
    const candidatePinned = isPinned(candidate);
    const firstUnpinned = ordered.findIndex((chat) => !isPinned(chat));
    const groupStart = candidatePinned ? 0 : firstUnpinned < 0 ? ordered.length : firstUnpinned;
    const groupEnd = candidatePinned && firstUnpinned >= 0 ? firstUnpinned : ordered.length;
    let insertAt = groupEnd;
    for (let index = groupStart; index < groupEnd; index++) {
      const current = ordered[index]!;
      const freshness = compareLastMessageCursor(
        effectiveById.get(candidate.id)!,
        effectiveById.get(current.id)!,
      );
      if (freshness === 1) {
        insertAt = index;
        break;
      }
      if (
        (freshness === 0 || freshness === undefined) &&
        (incomingIndex.get(candidate.id) ?? 0) < (incomingIndex.get(current.id) ?? 0)
      ) {
        insertAt = index;
        break;
      }
    }
    ordered.splice(insertAt, 0, candidate);
  }

  return ordered;
}

export const UPDATE_NOTES = {
  version: "0.8.0-beta",
  title: "Vyline 0.8.0-beta — 設定・引継ぎ・同期安定化",
  items: [
    "Vyline Setup、アカウントごとの設定、改ざん検知付き設定引継ぎ、診断ログを追加",
    "Windows のセッション保護と、端末ごとに結び付くサブデバイス認証を強化",
    "未読位置・既読状態・仮想リストの同期を安定化し、開いたチャットの位置を復元",
  ],
};

/** 明示的な現在選択だけを維持し、保存履歴や一覧先頭からは自動選択しない。 */
export function resolveChatToOpen(
  _accountId: string | null,
  activeChatId: string | null,
  availableChatIds: readonly string[],
): string | null {
  if (activeChatId && availableChatIds.includes(activeChatId)) return activeChatId;
  return null;
}

type State = {
  screen: Screen;
  /** PRデモ用。true の間は実アカウント・外部APIを使用しない。 */
  demoMode: boolean;
  accountId: string | null;
  activeChatId: string | null;
  /** Desktop multi-pane chat IDs, ordered from left to right. */
  chatPaneIds: string[];
  /** Relative widths for chatPaneIds; normalized to 100. */
  chatPaneSizes: number[];
  focusedChatPane: number;
  theme: VyTheme;
  settings: Settings;
  chats: Chat[];
  messages: Message[];
  announcements: Record<string, Announcement[]>;
  drafts: Record<string, string>;
  draftSticons: Record<string, import("../utils/lineSticon.js").SticonResource[]>;
  draftMentions: Record<string, MentionDraft[]>;
  replyToId: string | null;
  highlightMessageId: string | null;
  /** チャットを開くときの初期位置。通常は常に最新（末尾）。 */
  initialChatScrollMessageId: string | null;
  initialChatScrollMode: "unread" | "bottom" | null;
  showUpdateNote: boolean;
  seenUpdateVersion: string;
  profileDrawerOpen: boolean;
  self: SelfProfile;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  customOrder: string[];
  memberProfile: { chatId: string; memberId: string } | null;
  /** Talk Operation から受け取った着信。CallController から Vyline で応答できる。 */
  incomingCall: {
    callMid: string;
    chatMid: string;
    callerMid: string;
    callType: "audio" | "video";
    /** 受信時刻（CANCEL 取りこぼし時の取り残し防止用） */
    receivedAt: number;
  } | null;
  /** UI からの発信要求。CallController が拾って実際に発信する。 */
  callRequest: { to: string; kind: "voice" | "video"; joinOnly?: boolean } | null;
  /** 現在展開中の既読者一覧。同時に開けるのは常に1件だけ。 */
  readersPanel: { chatId: string; messageId: string; loading: boolean } | null;
  loadingChats: boolean;
  loadingMessages: boolean;
  indexing: { active: boolean; label: string } | null;
  /** 個別チャットの「既読を無効化」設定（mid → 無効化） */
  readDisabledMids: Record<string, boolean>;
  /** ブロック中のユーザー MID 一覧（送信抑止・UI 表示に使用） */
  blockedMids: string[];
  /** 誤操作防止のため操作を禁止するチャット MID 一覧 */
  lockedChatMids: string[];

  /** chatId → 既読ウォーターマーク（DB永続化） */
  readWatermarks: Record<
    string,
    {
      peerReadUpTo?: string;
      memberWatermarks?: Array<{ mid: string; upTo: string }>;
      memberReadRanges?: MemberReadRange[];
      at: number;
    }
  >;

  setScreen: (s: Screen) => void;
  setAccountId: (id: string | null) => void;
  toggleChatReadDisabled: (id: string) => void;
  /** ブロック中一覧をサーバから再取得して反映（アカウント切替時・UI からの呼び出し） */
  syncBlockedMids: () => Promise<void>;
  /** ローカルにブロック状態を反映（block/unblock 直後に呼ぶ） */
  setBlockedMids: (mids: string[]) => void;
  /** ブロック中なら true（送信抑止用） */
  isBlockedMid: (mid: string) => boolean;
  syncChatLocks: () => Promise<void>;
  setChatLocked: (chatMid: string, locked: boolean) => Promise<boolean>;
  openChat: (id: string) => void;
  openChatInSplit: (id: string) => void;
  focusChatPane: (index: number) => void;
  closeChatPane: (index: number) => void;
  setChatPaneSizes: (sizes: number[]) => void;
  _activateChat: (id: string, opts?: { history?: boolean }) => void;
  closeChat: () => void;
  dismissUpdateNote: () => void;
  setProfileDrawer: (open: boolean) => void;
  setIndexing: (v: { active: boolean; label: string } | null) => void;
  /** 一時的な上部ステータス通知（自動消去） */
  showNotice: (msg: string, ms?: number) => void;
  notice: string | null;

  hydrateLineData: (payload: {
    profile: {
      mid?: string;
      displayName: string;
      statusMessage: string;
      thumbnailUrl?: string;
      phoneticName?: string;
      pictureStatus?: string;
      musicProfile?: string;
      birthday?: { display?: string } | null;
      backgroundUrl?: string;
      profileId?: string;
      premium?: {
        active: boolean;
        planType?: string | number;
        validUntil?: number;
        onFreeTrial?: boolean;
        willExpire?: boolean;
      } | null;
    } | null;
    chats: LineChat[];
    messages: LineMessage[];
    hiddenMids: Set<string>;
    contactCache: Map<string, ContactInfo>;
  }) => void;

  resetAccountData: () => void;

  sendMessage: (
    chatId: string,
    text: string,
    opts?: { contentMetadata?: Record<string, string>; mute?: boolean },
  ) => Promise<void>;
  sendSticker: (
    chatId: string,
    packageId: string,
    stickerId: string,
    isPremium?: boolean,
  ) => Promise<void>;
  sendCombinationSticker: (
    chatId: string,
    items: Array<{ packageId: string; stickerId: string; x?: number; y?: number; size?: number }>,
  ) => Promise<void>;
  sendLineEmoji: (chatId: string, packageId: string, sticonId: string) => Promise<void>;
  sendImageFile: (chatId: string, file: File) => Promise<void>;
  sendAudio: (chatId: string, seconds: number, blob: Blob) => Promise<void>;
  revokeMessage: (id: string, options?: { silent?: boolean }) => Promise<void>;
  editMessage: (id: string, newText: string) => Promise<void>;
  toggleShowOriginal: (id: string) => void;
  retryMessage: (id: string) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markChatRead: (
    id: string,
    lastMessageId?: string,
    options?: { forceReceipt?: boolean },
  ) => Promise<void>;
  markAllChatsRead: () => Promise<void>;
  setDraft: (chatId: string, text: string) => void;
  setDraftSticons: (
    chatId: string,
    sticons: import("../utils/lineSticon.js").SticonResource[],
  ) => void;
  setDraftMentions: (chatId: string, mentions: MentionDraft[]) => void;
  setReplyTo: (messageId: string | null) => void;
  scrollToMessage: (messageId: string) => void;
  openDirectChatWith: (memberMid: string) => void;

  togglePin: (id: string) => void;
  toggleHide: (id: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  toggleMute: (id: string) => void;
  setCustomOrder: (ids: string[]) => void;
  reorderChat: (dragId: string, targetId: string) => void;
  moveChat: (id: string, dir: -1 | 1) => void;

  setSidebarWidth: (w: number) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  openMemberProfile: (chatId: string, memberId: string) => void;
  closeMemberProfile: () => void;

  requestCall: (to: string, kind: "voice" | "video", joinOnly?: boolean) => void;
  clearCallRequest: () => void;
  dismissIncomingCall: () => void;

  /** 既読者一覧の開閉。開くときは対象メッセージの既読情報を強制取得する。 */
  toggleReadersPanel: (chatId: string, messageId: string) => void;
  closeReadersPanel: () => void;

  setTheme: (t: VyTheme) => void;
  updateThemeField: (field: keyof VyTheme, value: string | number) => void;
  updateSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  /** テーマ・設定・表示状態を初期値へ戻す（ログイン状態・チャット・メッセージは保持） */
  resetSettings: () => void;
  setLocalName: (chatId: string, name: string) => void;
  updateSelf: (patch: Partial<SelfProfile>) => void;

  refreshChats: () => Promise<void>;
  refreshChatsSilently: () => Promise<boolean>;
  refreshMessages: (chatId: string, opts?: { force?: boolean }) => Promise<void>;
  refreshReadReceipts: (
    chatId: string,
    opts?: { force?: boolean; messageId?: string },
  ) => Promise<void>;
  /** 既読通知（誰が・どこまで・いつ）を各メッセージの初回既読時刻として確定する */
  applyMemberReadNotification: (
    chatId: string,
    readerMid: string,
    upToMessageId: string,
    readAt: number,
  ) => void;
  mergeIncomingMessages: (
    chatId: string,
    incoming: LineMessage[],
    opts?: { silent?: boolean },
  ) => void;
  applyRevoked: (chatId: string, messageId: string) => void;
  /** 取消し済みメッセージを履歴から復元 */
  restoreRevokedMessage: (chatId: string, messageId: string) => Promise<void>;
  /** 楽観リアクション更新（UNDO は自分の全リアクション除去） */
  setMessageReaction: (messageId: string, reaction: string | NonNullable<NonNullable<Message["reactions"]>[number]["emoji"]>, myMid: string) => void;
  fetchMessageHistory: (chatId: string, messageId: string) => Promise<Message["history"]>;
  pollMessagesDelta: (chatId: string) => Promise<void>;
  pollIncoming: () => Promise<void>;
  loadAnnouncements: (chatId: string) => Promise<void>;
  addAnnouncement: (chatId: string, a: Announcement) => void;
  removeAnnouncement: (chatId: string, seq: string) => void;
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      screen: "home",
      demoMode: false,
      accountId: null,
      activeChatId: null,
      chatPaneIds: [],
      chatPaneSizes: [],
      focusedChatPane: 0,
      theme: THEME_PRESETS[0]!,
      settings: {
        animationMode: "vyline",
        readReceipts: true,
        showReaderList: true,
        streamerMode: false,
        compactDensity: false,
        fontScale: 1,
        enterToSend: true,
        alwaysMuteMessages: false,
        voiceMessagesEnabled: true,
        chatSort: "recent",
        bubbleTail: true,
        showStatusMessage: true,
        showBackground: true,
        highQualityImages: false,
        proxyEnabled: false,
        proxyUrl: "",
        notificationsEnabled: true,
        betaBlockCheckManual: false,
        betaBlockCheckAuto: false,
        betaMidSearch: false,
        betaAgentI: false,
      },
      chats: [],
      messages: [],
      drafts: {},
      draftSticons: {},
      draftMentions: {},
      replyToId: null,
      highlightMessageId: null,
      initialChatScrollMessageId: null,
      initialChatScrollMode: null,
      showUpdateNote: true,
      seenUpdateVersion: "",
      profileDrawerOpen: false,
      self: emptySelfProfile(),
      sidebarWidth: 360,
      sidebarCollapsed: false,
      customOrder: [],
      memberProfile: null,
      incomingCall: null,
      callRequest: null,
      readersPanel: null,
      loadingChats: false,
      loadingMessages: false,
      indexing: null,
      readDisabledMids: {},
      blockedMids: [],
      lockedChatMids: [],
      notice: null,
      announcements: {},
      readWatermarks: {},

      setScreen: (s) => {
        set({ screen: s });
      },

      setAccountId: (id) => {
        const currentAccountId = get().accountId;
        const accountChanged = id !== currentAccountId;
        if (accountChanged) {
          contactFetched.clear();
          readerProfileFetchAttemptAt.clear();
          readerProfileResolveInflight.clear();
          readReceiptSent.clear();
          readReceiptInflight.clear();
          messageRefreshInflight.clear();
          lastDeltaPollAt.clear();
          sessionOpenedChats.clear();
          eventPollCursor.delete(String(currentAccountId));
          for (const timer of refreshDebounce.values()) clearTimeout(timer);
          refreshDebounce.clear();
          releaseAllOptimisticMediaObjectUrls();
        }
        if (accountChanged && currentAccountId !== null) {
          // アカウント切替時に前アカウントの会話・既読・一時 UI を残さない。
          // 共有 MID をまたぐ表示漏れを防ぎ、後続 hydrate の正本を明確にする。
          set({
            accountId: id,
            chats: [],
            messages: [],
            activeChatId: null,
            chatPaneIds: [],
            chatPaneSizes: [],
            focusedChatPane: 0,
            initialChatScrollMessageId: null,
            initialChatScrollMode: null,
            memberProfile: null,
            readersPanel: null,
            profileDrawerOpen: false,
            self: emptySelfProfile(),
            readWatermarks: {},
            announcements: {},
            readDisabledMids: {},
            blockedMids: [],
            lockedChatMids: [],
            incomingCall: null,
            callRequest: null,
          });
        } else {
          set({
            accountId: id,
            ...(accountChanged
              ? {
                  activeChatId: null,
                  chatPaneIds: [],
                  chatPaneSizes: [],
                  focusedChatPane: 0,
                }
              : {}),
          });
        }
        if (id) void get().syncChatLocks();
      },

      resetAccountData: () => {
        for (const timer of refreshDebounce.values()) clearTimeout(timer);
        refreshDebounce.clear();
        messageRefreshInflight.clear();
        releaseAllOptimisticMediaObjectUrls();
        set({
          chats: [],
          messages: [],
          activeChatId: null,
          chatPaneIds: [],
          chatPaneSizes: [],
          focusedChatPane: 0,
          self: emptySelfProfile(),
          profileDrawerOpen: false,
          readersPanel: null,
          announcements: {},
          drafts: {},
          draftSticons: {},
          draftMentions: {},
          replyToId: null,
          highlightMessageId: null,
          initialChatScrollMessageId: null,
          initialChatScrollMode: null,
          customOrder: [],
          blockedMids: [],
          lockedChatMids: [],
          incomingCall: null,
          callRequest: null,
        });
      },

      toggleChatReadDisabled: (id) => {
        set((st) => {
          const next = { ...st.readDisabledMids };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { readDisabledMids: next };
        });
      },

      syncBlockedMids: async () => {
        const { accountId, demoMode } = get();
        if (demoMode) return;
        if (!accountId) return;
        try {
          const res = await api.line.blockedContacts(accountId);
          if (res.ok && Array.isArray(res.mids)) set({ blockedMids: res.mids });
        } catch {
          /* silent */
        }
      },

      setBlockedMids: (mids) => set({ blockedMids: mids }),

      isBlockedMid: (mid) => get().blockedMids.includes(mid),

      syncChatLocks: async () => {
        const { accountId, demoMode } = get();
        if (!accountId || demoMode) return;
        try {
          const res = await api.line.getChatLocks(accountId);
          if (res.ok && Array.isArray(res.chatMids) && get().accountId === accountId) {
            set({ lockedChatMids: res.chatMids });
          }
        } catch {
          /* silent */
        }
      },

      setChatLocked: async (chatMid, locked) => {
        const { accountId, demoMode } = get();
        if (demoMode) {
          set((st) => ({
            lockedChatMids: locked
              ? st.lockedChatMids.includes(chatMid)
                ? st.lockedChatMids
                : [...st.lockedChatMids, chatMid]
              : st.lockedChatMids.filter((id) => id !== chatMid),
          }));
          return true;
        }
        if (!accountId) return false;
        const res = await api.line.setChatLocked(accountId, chatMid, locked);
        if (!res.ok) return false;
        if (get().accountId === accountId) set({ lockedChatMids: res.chatMids ?? [] });
        return true;
      },

      openChat: (id) => {
        sessionOpenedChats.add(id);
        const state = get();
        const panes = replaceFocusedChatPane(
          state.chatPaneIds,
          state.chatPaneSizes,
          state.focusedChatPane,
          id,
        );
        set({
          chatPaneIds: panes.ids,
          chatPaneSizes: panes.sizes,
          focusedChatPane: panes.focusedIndex,
        });
        get()._activateChat(id, { history: true });
      },

      openChatInSplit: (id) => {
        sessionOpenedChats.add(id);
        const state = get();
        // Older persisted stores can have activeChatId while chatPaneIds is
        // still empty. Seed the visible pane first or "split" only replaces it.
        const currentIds =
          state.chatPaneIds.length > 0
            ? state.chatPaneIds
            : state.activeChatId
              ? [state.activeChatId]
              : [];
        const currentSizes =
          state.chatPaneIds.length > 0
            ? state.chatPaneSizes
            : equalChatPaneSizes(currentIds.length);
        if (currentIds.length >= MAX_CHAT_PANES && !currentIds.includes(id)) {
          get().showNotice(`同時に開けるトークは最大${MAX_CHAT_PANES}画面です`);
          return;
        }
        const panes = addChatPane(currentIds, currentSizes, id);
        set({
          chatPaneIds: panes.ids,
          chatPaneSizes: panes.sizes,
          focusedChatPane: panes.focusedIndex,
        });
        get()._activateChat(id, { history: false });
        if (!panes.added && currentIds.includes(id)) {
          get().showNotice("このトークはすでに表示中です");
        }
      },

      focusChatPane: (index) => {
        const state = get();
        const id = state.chatPaneIds[index];
        if (!id || (state.focusedChatPane === index && state.activeChatId === id)) return;
        sessionOpenedChats.add(id);
        set({ focusedChatPane: index });
        get()._activateChat(id, { history: false });
      },

      closeChatPane: (index) => {
        const state = get();
        const panes = closeChatPaneAt(
          state.chatPaneIds,
          state.chatPaneSizes,
          state.focusedChatPane,
          index,
        );
        const nextActive = panes.ids[panes.focusedIndex] ?? null;
        set({
          chatPaneIds: panes.ids,
          chatPaneSizes: panes.sizes,
          focusedChatPane: panes.focusedIndex,
          activeChatId: nextActive,
          initialChatScrollMessageId: null,
          initialChatScrollMode: nextActive ? "bottom" : null,
          profileDrawerOpen: false,
        });
        if (nextActive && state.accountId) rememberLastOpenedChat(state.accountId, nextActive);
        if (typeof window !== "undefined" && window.history) {
          const current = (window.history.state ?? {}) as Record<string, unknown> & {
            chatId?: string | null;
          };
          if ((current.chatId ?? null) !== nextActive) {
            window.history.replaceState({ ...current, chatId: nextActive }, "");
          }
        }
      },

      setChatPaneSizes: (sizes) =>
        set((state) => ({
          chatPaneSizes: normalizeChatPaneSizes(state.chatPaneIds.length, sizes),
        })),

      _activateChat: (id, opts) => {
        if (!id) {
          set({
            activeChatId: null,
            chatPaneIds: [],
            chatPaneSizes: [],
            focusedChatPane: 0,
            initialChatScrollMessageId: null,
            initialChatScrollMode: null,
            profileDrawerOpen: false,
            readersPanel: null,
          });
          return;
        }
        const opts2 = opts ?? {};
        const state = get();
        if (state.accountId) rememberLastOpenedChat(state.accountId, id);
        const paneState = replaceFocusedChatPane(
          state.chatPaneIds,
          state.chatPaneSizes,
          state.focusedChatPane,
          id,
        );
        set((st) => ({
          screen: "chat",
          activeChatId: id,
          chatPaneIds: paneState.ids,
          chatPaneSizes: paneState.sizes,
          focusedChatPane: paneState.focusedIndex,
          initialChatScrollMessageId: null,
          initialChatScrollMode: "bottom",
          profileDrawerOpen: false,
          readersPanel: st.readersPanel?.chatId === id ? st.readersPanel : null,
          chats: st.chats.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
        }));
        const { accountId, chats, demoMode } = get();
        if (demoMode) return;
        if (accountId) {
          void api.line.contactProfile(accountId, id).catch(() => undefined);
          const activeChat = chats.find((c) => c.id === id);
          const mids =
            activeChat?.type === "group"
              ? (activeChat.members?.slice(0, 6).map((member) => member.id) ?? [])
              : [];
          for (const mid of mids) {
            void api.line.contactProfile(accountId, mid).catch(() => undefined);
          }
          void get().loadAnnouncements(id);
        }
        if (opts2.history && typeof window !== "undefined" && window.history) {
          const current = (window.history.state ?? {}) as Record<string, unknown> & {
            chatId?: string | null;
          };
          if ((current.chatId ?? null) !== id) {
            const next = { ...current, chatId: id };
            const desktop = window.matchMedia?.("(min-width: 768px)").matches ?? true;
            if (desktop) window.history.pushState(next, "");
            else window.history.replaceState(next, "");
          }
        }
      },

      closeChat: () => {
        set({
          activeChatId: null,
          chatPaneIds: [],
          chatPaneSizes: [],
          focusedChatPane: 0,
          initialChatScrollMessageId: null,
          initialChatScrollMode: null,
          profileDrawerOpen: false,
          readersPanel: null,
        });
        if (typeof window !== "undefined" && window.history) {
          const current = (window.history.state ?? {}) as Record<string, unknown> & {
            chatId?: string | null;
          };
          if (current.chatId) window.history.replaceState({ ...current, chatId: null }, "");
        }
      },

      loadAnnouncements: async (chatId) => {
        const { accountId } = get();
        if (!accountId) return;
        try {
          const res = await api.line.announce.list(accountId, chatId);
          const list = (res as { ok: boolean; data: Announcement[] }).data ?? [];
          set((st) => ({ announcements: { ...st.announcements, [chatId]: list } }));
        } catch {
          // backend 未起動時等は静かに失敗
        }
      },

      addAnnouncement: (chatId, a) =>
        set((st) => ({
          announcements: {
            ...st.announcements,
            [chatId]: [a, ...(st.announcements[chatId] ?? [])],
          },
        })),

      removeAnnouncement: (chatId, seq) =>
        set((st) => ({
          announcements: {
            ...st.announcements,
            [chatId]: (st.announcements[chatId] ?? []).filter((x) => x.announcementSeq !== seq),
          },
        })),

      dismissUpdateNote: () =>
        set({
          showUpdateNote: false,
          seenUpdateVersion: UPDATE_NOTES.version,
          screen: "chat",
        }),
      setProfileDrawer: (open) => set({ profileDrawerOpen: open }),
      setIndexing: (v) => set({ indexing: v }),
      showNotice: (msg, ms = 4_000) => {
        set({ notice: msg });
        const prev = noticeTimer.current;
        if (prev) clearTimeout(prev);
        noticeTimer.current = setTimeout(() => set({ notice: null }), ms);
      },

      resetSettings: () =>
        set({
          theme: THEME_PRESETS[0]!,
          settings: {
            animationMode: "vyline",
            readReceipts: true,
            showReaderList: true,
            streamerMode: false,
            compactDensity: false,
            fontScale: 1,
            enterToSend: true,
            alwaysMuteMessages: false,
            voiceMessagesEnabled: true,
            chatSort: "recent",
            bubbleTail: true,
            showStatusMessage: true,
            showBackground: true,
            highQualityImages: false,
            proxyEnabled: false,
            proxyUrl: "",
            notificationsEnabled: true,
            betaBlockCheckManual: false,
            betaBlockCheckAuto: false,
            betaMidSearch: false,
            betaAgentI: false,
          },
          sidebarWidth: 360,
          customOrder: [],
        }),

      hydrateLineData: ({ profile, chats, messages, hiddenMids, contactCache }) => {
        // 空 chats で既存 UI を潰さない（bootstrap 前 race）
        if (!chats.length && get().chats.length > 0) {
          if (profile) {
            set((st) => ({
              self: {
                name: profile.displayName || "あなた",
                avatar: initial(profile.displayName),
                avatarUrl: profile.thumbnailUrl || st.self.avatarUrl,
                status: profile.statusMessage || "",
                phoneticName: profile.phoneticName || st.self.phoneticName,
                pictureStatus: profile.pictureStatus || st.self.pictureStatus,
                musicProfile: profile.musicProfile || st.self.musicProfile,
                birthday: profile.birthday?.display || st.self.birthday,
                backgroundUrl: profile.backgroundUrl || st.self.backgroundUrl,
                mid: profile.mid || st.self.mid,
                profileId: profile.profileId || st.self.profileId,
                premium: profile.premium ?? st.self.premium,
              },
            }));
          }
          return;
        }
        const accountId = get().accountId;
        const activeChatId = get().activeChatId;
        const dismissed = accountId ? getDismissedChatMids(accountId) : new Set<string>();
        const restored = accountId ? new Set(getRestoredChatMids(accountId)) : new Set<string>();
        const mappedChats = chats
          .filter((c) => (!dismissed.has(c.mid) || restored.has(c.mid)) && !c.left)
          .map((c) => {
            const base = mapChat(c, hiddenMids.has(c.mid), contactCache);
            const cached = contactCache.get(c.mid);
            return {
              ...base,
              avatarUrl: base.avatarUrl || cached?.thumbnailUrl,
              name:
                base.name && !looksLikeMid(base.name)
                  ? base.name
                  : cached?.name && !looksLikeMid(cached.name)
                    ? cached.name
                    : base.name,
              avatar: initial(
                base.name && !looksLikeMid(base.name)
                  ? base.name
                  : cached?.name && !looksLikeMid(cached.name)
                    ? cached.name
                    : base.name,
              ),
            };
          });

        // hide flag: always preserve prev.hidden when chat already exists,
        // taking precedence over the newly mapped hidden from hiddenMids
        const previousChatsById = new Map(get().chats.map((chat) => [chat.id, chat]));
        const hiddenByPrev = new Map<string, boolean>();
        mappedChats.forEach((c) => {
          const prev = previousChatsById.get(c.id);
          if (prev) hiddenByPrev.set(c.id, prev.hidden ?? false);
        });

        // Never auto-open the first chat during a background hydrate. On mobile,
        // closeChat() intentionally leaves activeChatId null so the list stays visible.
        // Re-selecting mappedChats[0] here caused every periodic sync to pull the user
        // back into a conversation while they were navigating the sidebar/settings.
        const chatId =
          activeChatId && (!dismissed.has(activeChatId) || restored.has(activeChatId))
            ? activeChatId
            : null;
        // 1on1 の受信メッセージは from=相手(chatId)/to=自分 になるため、from 側も対象に含める
        const chatMessageFilter = (m: LineMessage) => !m.to || m.to === chatId || m.from === chatId;
        const mappedMessages =
          chatId && accountId
            ? messages
                .filter(chatMessageFilter)
                .map((m) => mapMessage(m, chatId, accountId, contactCache))
            : [];

        const members = buildMembersFromMessages(messages.filter(chatMessageFilter), contactCache);

        set((st) => ({
          chats: preserveLocallyNewerChatOrder(
            st.chats,
            mappedChats.filter((c) => !dismissed.has(c.id) || restored.has(c.id)),
          ).map((c) => {
            const prev = st.chats.find((chat) => chat.id === c.id);
            const mergedName =
              c.name && !looksLikeMid(c.name)
                ? c.name
                : prev?.name && !looksLikeMid(prev.name)
                  ? prev.name
                  : c.name;
            const hiddenFromPrev = hiddenByPrev.get(c.id);
            return prev
              ? mergeLatestChatMetadata(prev, {
                  ...c,
                  name: mergedName,
                  avatar: initial(mergedName),
                  avatarUrl: c.avatarUrl || prev.avatarUrl,
                  pinned: prev.pinned,
                  muted: prev.muted,
                  hidden: hiddenFromPrev ?? prev.hidden,
                  localName: prev.localName,
                  members: c.members ?? prev.members,
                })
              : c;
          }),
          messages: (() => {
            if (!chatId) return st.messages;

            // hydrate は「現在フォーカス中のチャットの最新スナップショットを重ねる」だけにする。
            // 他ペインのメッセージを捨てない。これにより2〜4画面を同時表示しても、
            // フォーカス移動や contact 解決のたびに別ペインが空にならない。
            const retainedPaneIds = new Set(st.chatPaneIds);
            const otherChats = st.messages.filter(
              (message) => message.chatId !== chatId && retainedPaneIds.has(message.chatId),
            );
            const existingChat = st.messages.filter((m) => m.chatId === chatId);
            if (mappedMessages.length === 0) return st.messages;

            mappedMessages.forEach((m) => {
              if (m.id) {
                if (m.reactions?.length) {
                  messageReactionCache.set(m.id, m.reactions);
                } else {
                  messageReactionCache.delete(m.id);
                }
              }
            });

            const merged = new Map<string, Message>();
            for (const m of existingChat) merged.set(m.id, m);
            // API / local DB 側の値を新しい正本として上書きする。
            // ただし既読状態だけは、記録済みの初回既読時刻を失わないよう単調に合流する。
            for (const m of mappedMessages) {
              const prev = merged.get(m.id);
              merged.set(
                m.id,
                prev && tracksReadState(chatId, m)
                  ? mergeMessageReadState(prev, m, st.self?.mid)
                  : m,
              );
            }

            const currentChat = [...merged.values()].sort((a, b) => {
              if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
              return a.id.localeCompare(b.id);
            });
            return [...otherChats, ...currentChat];
          })(),
          activeChatId: st.activeChatId,
          customOrder: st.customOrder.length ? st.customOrder : mappedChats.map((c) => c.id),
          self: profile
            ? {
                name: profile.displayName || "あなた",
                avatar: initial(profile.displayName),
                avatarUrl: profile.thumbnailUrl || st.self.avatarUrl,
                status: profile.statusMessage || "",
                phoneticName: profile.phoneticName || st.self.phoneticName,
                pictureStatus: profile.pictureStatus || st.self.pictureStatus,
                musicProfile: profile.musicProfile || st.self.musicProfile,
                birthday: profile.birthday?.display || st.self.birthday,
                backgroundUrl: profile.backgroundUrl || st.self.backgroundUrl,
                mid: profile.mid || st.self.mid,
                profileId: profile.profileId || st.self.profileId,
                premium: profile.premium ?? st.self.premium,
              }
            : st.self,
        }));

        if (chatId) {
          set((st) => ({
            chats: st.chats.map((c) =>
              c.id === chatId && c.type === "group"
                ? {
                    ...c,
                    members: members.map((m) => {
                      const prev = c.members?.find((p) => p.id === m.id);
                      const previousName = prev?.name;
                      const name = isResolvedMemberProfileName(m.name)
                        ? m.name
                        : isResolvedMemberProfileName(previousName)
                          ? previousName
                          : m.name;
                      return {
                        ...m,
                        name,
                        avatar: initial(name),
                        avatarUrl: m.avatarUrl || prev?.avatarUrl,
                      };
                    }),
                  }
                : c,
            ),
          }));
        }
      },

      sendMessage: async (chatId, text, opts) => {
        const { accountId, demoMode, replyToId, blockedMids } = get();
        const relatedMessageId = get().messages.find(
          (message) => message.id === replyToId && message.chatId === chatId,
        )?.id;
        if (demoMode) {
          const trimmed = text;
          if (!trimmed.trim() && !trimmed.includes("\uFFFC")) return;
          const message: Message = {
            id: `demo_${Date.now()}`,
            chatId,
            authorId: "me",
            kind: "text",
            text: trimmed,
            sticons: parseSticonReplace(opts?.contentMetadata),
            mentions: parseMentions(opts?.contentMetadata),
            createdAt: Date.now(),
            status: "read",
            read: true,
            messageState: "normal",
            replyToId: relatedMessageId,
          };
          set((st) => ({
            messages: [...st.messages, message],
            chats: updateChatsWithLatestMessage(st.chats, chatId, message),
            drafts: { ...st.drafts, [chatId]: "" },
            replyToId: st.replyToId === relatedMessageId ? null : st.replyToId,
          }));
          emitAppEvent("chat:scroll-latest", { chatId, accountId: null });
          get().showNotice("デモ送信（外部通信なし）");
          return;
        }
        if (!accountId || (!text.trim() && !text.includes("\uFFFC"))) return;
        // ブロック中の友だちには送信しない（DM の chatId は相手 MID）
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const trimmed = text; // 文中 sticon の前後空白を落とさない
        const tempId = `pending_${Date.now()}`;
        let optimisticSticons: import("../utils/lineSticon.js").SticonResource[] | undefined;
        let optimisticMentions: import("../utils/mention.js").MentionInfo[] | undefined;
        try {
          const replace = opts?.contentMetadata?.REPLACE;
          if (replace) {
            const parsed = JSON.parse(replace) as {
              sticon?: { resources?: import("../utils/lineSticon.js").SticonResource[] };
            };
            optimisticSticons = parsed.sticon?.resources;
          }
          optimisticMentions = parseMentions(
            opts?.contentMetadata as Record<string, string> | null,
          );
        } catch {
          /* ignore */
        }
        const optimistic: Message = {
          id: tempId,
          chatId,
          authorId: "me",
          kind: "text",
          text: trimmed,
          createdAt: Date.now(),
          status: "sending",
          read: false,
          messageState: "normal",
          replyToId: relatedMessageId,
          retry: {
            kind: "text",
            text: trimmed,
            relatedMessageId,
            contentMetadata: opts?.contentMetadata,
          },
          ...(optimisticSticons?.length ? { sticons: optimisticSticons } : {}),
          ...(optimisticMentions?.length ? { mentions: optimisticMentions } : {}),
        };
        set((st) => ({
          messages: [...st.messages, optimistic],
          chats: updateChatsWithLatestMessage(st.chats, chatId, optimistic),
          drafts: { ...st.drafts, [chatId]: "" },
          replyToId: st.replyToId === relatedMessageId ? null : st.replyToId,
        }));
        emitAppEvent("chat:scroll-latest", { chatId, accountId });

        void (async () => {
          let res: Awaited<ReturnType<typeof api.line.send>>;
          try {
            res = await api.line.send(accountId!, chatId, trimmed, {
              relatedMessageId,
              contentMetadata: opts?.contentMetadata,
              mute: opts?.mute,
            });
          } catch {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
            }));
            return;
          }
          if (!res.ok) {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
            }));
            return;
          }
          if (res.message) {
            const contactCache = buildContactCache(get().chats);
            const mapped = mapMessage(res.message, chatId, accountId!, contactCache);
            set((st) => ({
              messages: replaceOptimisticMessage(st.messages, tempId, mapped),
              chats: updateChatsWithLatestMessage(st.chats, chatId, mapped, tempId),
            }));
          } else {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
            }));
          }
          const existing = refreshDebounce.get(chatId);
          if (existing) clearTimeout(existing);
          refreshDebounce.set(
            chatId,
            setTimeout(() => {
              refreshDebounce.delete(chatId);
              void get().refreshMessages(chatId, { force: true });
            }, 800),
          );
        })();
      },

      sendSticker: async (chatId, packageId, stickerId, isPremium?: boolean) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          if (!packageId || !stickerId) return;
          const message: Message = {
            id: `demo_sticker_${Date.now()}`,
            chatId,
            authorId: "me",
            kind: "sticker",
            sticker: `/demo/sticker-${stickerId}.svg`,
            altText: "デモスタンプ",
            createdAt: Date.now(),
            status: "read",
            read: true,
            messageState: "normal",
            retry: { kind: "sticker", packageId, stickerId, isPremium },
          };
          set((st) => ({
            messages: [...st.messages, message],
            chats: updateChatsWithLatestMessage(st.chats, chatId, message),
          }));
          emitAppEvent("chat:scroll-latest", { chatId, accountId: null });
          get().showNotice("デモスタンプ送信（外部通信なし）");
          return;
        }
        if (!accountId || !packageId || !stickerId) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const tempId = `pending_stk_${Date.now()}`;
        const optimistic: Message = {
          id: tempId,
          chatId,
          authorId: "me",
          kind: "sticker",
          sticker: lineStickerUrl(stickerId),
          createdAt: Date.now(),
          status: "sending",
          read: false,
          messageState: "normal",
          retry: { kind: "sticker", packageId, stickerId, isPremium },
        };
        set((st) => ({
          messages: [...st.messages, optimistic],
          chats: updateChatsWithLatestMessage(st.chats, chatId, optimistic),
        }));
        emitAppEvent("chat:scroll-latest", { chatId, accountId });

        void (async () => {
          try {
            const res = await api.line.sendSticker(accountId!, chatId, {
              packageId,
              stickerId,
              ...(isPremium ? { isPremium: true } : {}),
            });
            if (!res.ok) {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.id === tempId ? { ...m, status: "failed" } : m,
                ),
              }));
              return;
            }
            if (res.message) {
              const contactCache = buildContactCache(get().chats);
              const mapped = mapMessage(res.message, chatId, accountId!, contactCache);
              const finalMsg: Message = {
                ...mapped,
                kind: "sticker",
                sticker:
                  mapped.sticker?.startsWith("http") || mapped.sticker?.startsWith("/api/")
                    ? mapped.sticker
                    : lineStickerUrl(stickerId),
              };
              set((st) => ({
                messages: replaceOptimisticMessage(st.messages, tempId, finalMsg),
                chats: updateChatsWithLatestMessage(st.chats, chatId, finalMsg, tempId),
              }));
            } else {
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
              }));
            }
            const existing = refreshDebounce.get(chatId);
            if (existing) clearTimeout(existing);
            refreshDebounce.set(
              chatId,
              setTimeout(() => {
                refreshDebounce.delete(chatId);
                void get().refreshMessages(chatId, { force: true });
              }, 800),
            );
          } catch {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
            }));
          }
        })();
      },

      sendCombinationSticker: async (chatId, items) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          if (!items.length) return;
          const message: Message = {
            id: `demo_combo_${Date.now()}`,
            chatId,
            authorId: "me",
            kind: "sticker",
            sticker: "/demo/sticker-ok.svg",
            altText: "組み合わせスタンプ",
            createdAt: Date.now(),
            status: "read",
            read: true,
            messageState: "normal",
          };
          set((st) => ({
            messages: [...st.messages, message],
            chats: updateChatsWithLatestMessage(st.chats, chatId, message),
          }));
          emitAppEvent("chat:scroll-latest", { chatId, accountId: null });
          get().showNotice("組み合わせスタンプをデモ送信しました");
          return;
        }
        if (!accountId || !items.length) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const placements = combinationPlacementsFromItems(items);
        const tempId = `pending_combo_${Date.now()}`;
        const optimistic: Message = {
          id: tempId,
          chatId,
          authorId: "me",
          kind: "sticker",
          sticker: lineStickerUrl(items[0]!.stickerId),
          createdAt: Date.now(),
          status: "sending",
          read: false,
          messageState: "normal",
          retry: { kind: "combinationSticker", items: items.map((item) => ({ ...item })) },
        };
        set((st) => ({
          messages: [...st.messages, optimistic],
          chats: updateChatsWithLatestMessage(st.chats, chatId, optimistic),
        }));
        emitAppEvent("chat:scroll-latest", { chatId, accountId });

        void (async () => {
          try {
            const res = await api.line.sendCombinationSticker(accountId!, chatId, items);
            if (!res.ok) {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.id === tempId ? { ...m, status: "failed" } : m,
                ),
              }));
              return;
            }
            if (res.message) {
              const contactCache = buildContactCache(get().chats);
              const mapped = mapMessage(res.message, chatId, accountId!, contactCache);
              // 履歴表示は CSSTKID / メッセージID のどちらでもプレビューを引けるよう両方保存
              const preview = await persistCombinationStickerPreview(
                accountId!,
                res.message,
                placements,
              );
              const finalMsg: Message = {
                ...mapped,
                kind: "sticker",
                sticker: preview || mapped.sticker || "🧩",
              };
              set((st) => ({
                messages: replaceOptimisticMessage(st.messages, tempId, finalMsg),
                chats: updateChatsWithLatestMessage(st.chats, chatId, finalMsg, tempId),
              }));
            } else {
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
              }));
            }
            const existing = refreshDebounce.get(chatId);
            if (existing) clearTimeout(existing);
            refreshDebounce.set(
              chatId,
              setTimeout(() => {
                refreshDebounce.delete(chatId);
                void get().refreshMessages(chatId, { force: true });
              }, 800),
            );
          } catch {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
            }));
          }
        })();
      },

      sendLineEmoji: async (chatId, packageId, sticonId) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          if (!packageId || !sticonId) return;
          const message: Message = {
            id: `demo_emoji_${Date.now()}`,
            chatId,
            authorId: "me",
            kind: "emoji",
            text: sticonId === "smile" ? "😊" : "✨",
            createdAt: Date.now(),
            status: "read",
            read: true,
            messageState: "normal",
          };
          set((st) => ({
            messages: [...st.messages, message],
            chats: updateChatsWithLatestMessage(st.chats, chatId, message),
          }));
          emitAppEvent("chat:scroll-latest", { chatId, accountId: null });
          get().showNotice("LINE絵文字をデモ送信しました");
          return;
        }
        if (!accountId || !packageId || !sticonId) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;

        const tempId = `pending_emoji_${Date.now()}`;
        const optimistic: Message = {
          id: tempId,
          chatId,
          authorId: "me",
          kind: "text",
          text: "\uFFFC",
          sticons: [
            {
              productId: packageId,
              sticonId,
              S: 0,
              E: 1,
              alt: "emoji",
            },
          ],
          createdAt: Date.now(),
          status: "sending",
          read: false,
          messageState: "normal",
          retry: { kind: "emoji", packageId, sticonId },
        };
        set((st) => ({
          messages: [...st.messages, optimistic],
          chats: updateChatsWithLatestMessage(st.chats, chatId, optimistic),
        }));
        emitAppEvent("chat:scroll-latest", { chatId, accountId });

        void (async () => {
          try {
            const res = await api.line.sendEmoji(accountId!, chatId, {
              packageId,
              sticonId,
            });
            if (res.ok) {
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
              }));
              const existing = refreshDebounce.get(chatId);
              if (existing) clearTimeout(existing);
              refreshDebounce.set(
                chatId,
                setTimeout(() => {
                  refreshDebounce.delete(chatId);
                  void get().refreshMessages(chatId, { force: true });
                }, 800),
              );
            } else {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.id === tempId ? { ...m, status: "failed" } : m,
                ),
              }));
            }
          } catch {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
            }));
          }
        })();
      },

      sendImageFile: async (chatId, file) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          const isVideo = file.type.startsWith("video/");
          const localUrl = URL.createObjectURL(file);
          const message: Message = {
            id: `demo_media_${Date.now()}`,
            chatId,
            authorId: "me",
            kind: isVideo ? "video" : "image",
            imageSrc: localUrl,
            createdAt: Date.now(),
            status: "read",
            read: true,
            messageState: "normal",
          };
          set((st) => ({
            messages: [...st.messages, message],
            chats: updateChatsWithLatestMessage(st.chats, chatId, message),
          }));
          emitAppEvent("chat:scroll-latest", { chatId, accountId: null });
          get().showNotice(`${isVideo ? "動画" : "画像"}をデモ送信しました`);
          return;
        }
        if (!accountId) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const isVideo = file.type.startsWith("video/");
        // Acceptance follows the existing post-compression size check: rejected
        // media must not briefly insert a row or take timeline scroll ownership.
        let blob: Blob;
        let mime: string;
        try {
          const highQuality = get().settings.highQualityImages;
          ({ blob, mime } = highQuality
            ? { blob: file, mime: file.type || "application/octet-stream" }
            : await compressImageFile(file));
          if (blob.size > 11_000_000) {
            get().showNotice(
              blob === file
                ? "ファイルが大きすぎます（11MB まで）"
                : "画像が大きすぎます（圧縮後も 11MB 超）",
            );
            return;
          }
        } catch {
          return;
        }
        if (get().accountId !== accountId) return;
        const tempId = `pending_${isVideo ? "video" : "img"}_${Date.now()}`;
        const localUrl = URL.createObjectURL(file);
        const previousChat = get().chats.find((chat) => chat.id === chatId);
        const previousChatMetadata: ChatLastMessageSnapshot | undefined = previousChat
          ? {
              lastMessageId: previousChat.lastMessageId,
              lastMessagePreview: previousChat.lastMessagePreview,
              lastMessageTime: previousChat.lastMessageTime,
            }
          : undefined;
        registerOptimisticMediaObjectUrl(tempId, localUrl);
        const removeOptimistic = () => {
          set((st) => ({
            messages: st.messages.filter((m) => m.id !== tempId),
            chats: restoreOptimisticChatMetadata(st.chats, chatId, tempId, previousChatMetadata),
          }));
          releaseOptimisticMediaObjectUrl(tempId);
        };
        const optimistic: Message = {
          id: tempId,
          chatId,
          authorId: "me",
          kind: isVideo ? "video" : "image",
          imageSrc: localUrl,
          createdAt: Date.now(),
          status: "sending",
          read: false,
          messageState: "normal",
        };
        set((st) => ({
          messages: [...st.messages, optimistic],
          chats: updateChatsWithLatestMessage(st.chats, chatId, optimistic),
        }));
        emitAppEvent("chat:scroll-latest", { chatId, accountId });
        try {
          const filename =
            !isVideo && mime === "image/jpeg" && blob !== file
              ? `${(file.name || "image").replace(/\.[^.]+$/, "")}.jpg`
              : file.name || (isVideo ? "video.mp4" : "image.jpg");
          if (get().accountId !== accountId) {
            removeOptimistic();
            return;
          }
          const res = await api.line.sendMedia(accountId!, chatId, blob, {
            mimeType: mime,
            filename,
            mediaType: isVideo ? "video" : "image",
          });
          if (get().accountId !== accountId) {
            removeOptimistic();
            return;
          }
          if (res.ok) {
            set((st) => ({
              messages: st.messages.map((message) =>
                message.id === tempId ? { ...message, status: "sent" as const } : message,
              ),
            }));
            const existing = refreshDebounce.get(chatId);
            if (existing) clearTimeout(existing);
            refreshDebounce.set(
              chatId,
              setTimeout(() => {
                refreshDebounce.delete(chatId);
                void get().refreshMessages(chatId, { force: true });
              }, 800),
            );
          } else {
            // 画像は再送 UI を持たないので失敗時は楽観表示を除去
            removeOptimistic();
          }
        } catch {
          removeOptimistic();
        }
      },

      sendAudio: async (chatId, seconds, blob) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          const localUrl = URL.createObjectURL(blob);
          const message: Message = {
            id: `demo_audio_${Date.now()}`,
            chatId,
            authorId: "me",
            kind: "audio",
            audioSrc: localUrl,
            audioSeconds: Math.max(1, seconds),
            createdAt: Date.now(),
            status: "read",
            read: true,
            messageState: "normal",
          };
          set((st) => ({
            messages: [...st.messages, message],
            chats: updateChatsWithLatestMessage(st.chats, chatId, message),
          }));
          emitAppEvent("chat:scroll-latest", { chatId, accountId: null });
          get().showNotice("音声メッセージをデモ送信しました");
          return;
        }
        if (!accountId || !blob || blob.size === 0) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const tempId = `pending_audio_${Date.now()}`;
        const optimisticChatMessage: Message = {
          id: tempId,
          chatId,
          authorId: "me",
          kind: "audio",
          audioSeconds: Math.max(1, seconds),
          createdAt: Date.now(),
          status: "sending",
          read: false,
          messageState: "normal",
        };
        const previousChat = get().chats.find((chat) => chat.id === chatId);
        const previousChatMetadata: ChatLastMessageSnapshot | undefined = previousChat
          ? {
              lastMessageId: previousChat.lastMessageId,
              lastMessagePreview: previousChat.lastMessagePreview,
              lastMessageTime: previousChat.lastMessageTime,
            }
          : undefined;
        set((st) => ({
          chats: updateChatsWithLatestMessage(st.chats, chatId, optimisticChatMessage),
        }));
        const restoreChatPreview = () =>
          set((st) => ({
            chats: restoreOptimisticChatMetadata(st.chats, chatId, tempId, previousChatMetadata),
          }));
        void (async () => {
          try {
            const mime = blob.type || "audio/webm";
            const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
            const res = await api.line.sendMedia(accountId!, chatId, blob, {
              mimeType: mime,
              filename: `voice-${Math.round(seconds)}s.${ext}`,
              mediaType: "audio",
              durationMs: Math.max(1, Math.round(seconds * 1000)),
            });
            if (!res.ok) {
              restoreChatPreview();
              get().showNotice(res.error ?? "音声メッセージの送信に失敗しました");
              return;
            }
            const existing = refreshDebounce.get(chatId);
            if (existing) clearTimeout(existing);
            refreshDebounce.set(
              chatId,
              setTimeout(() => {
                refreshDebounce.delete(chatId);
                void get().refreshMessages(chatId, { force: true });
              }, 800),
            );
          } catch {
            restoreChatPreview();
            get().showNotice("音声メッセージの送信に失敗しました");
          }
        })();
      },

      revokeMessage: async (id, options) => {
        const { accountId, activeChatId, demoMode } = get();
        const silent = options?.silent === true;
        if (!accountId && !demoMode) return;
        const msg = get().messages.find((m) => m.id === id);
        // 送信中の楽観メッセージはサーバ未確定のため取り消せない
        if (!msg || msg.status === "sending" || id.startsWith("pending_")) {
          get().showNotice("送信が完了してから取り消しできます");
          return;
        }
        if (msg.messageState.startsWith("revoked") || msg.revokedSnapshot) {
          get().showNotice("一度取り消したメッセージは再度取り消せません");
          return;
        }
        const isPremium = Boolean(get().self.premium?.active);
        if (silent && !isPremium) {
          get().showNotice("通知せず取り消すにはLYPプレミアムが必要です");
          return;
        }
        if (!demoMode && !canUnsendMessage(msg.createdAt, silent ? true : isPremium)) {
          get().showNotice(
            silent || isPremium
              ? "送信取り消しできません（LYPプレミアムは送信後7日以内です）"
              : "送信取り消しできません（通常は送信後1時間以内です）",
          );
          return;
        }
        const prevState = msg.messageState ?? "normal";
        const historyEntry = {
          state: prevState,
          text: msg.text ?? null,
          contentType: msg.kind,
          updatedTime: Date.now(),
        };
        set((st) => ({
          messages: st.messages.map((m) =>
            m.id === id
              ? {
                  ...m,
                  history: [...(m.history ?? []), historyEntry],
                  revokedSnapshot: m.revokedSnapshot ?? snapshotFromMessage(m),
                  messageState: "revoked-by-self" as MessageState,
                  text: undefined,
                }
              : m,
          ),
        }));
        if (demoMode) {
          get().showNotice(
            silent
              ? "通知なし取り消しをデモ表示しました（LINEサーバーでは実行していません）"
              : "メッセージをデモ取り消ししました",
          );
          return;
        }
        const rollback = () =>
          set((st) => ({
            messages: st.messages.map((m) =>
              m.id === id
                ? {
                    ...m,
                    history: msg.history,
                    revokedSnapshot: msg.revokedSnapshot,
                    messageState: prevState,
                    text: msg.text,
                  }
                : m,
            ),
          }));

        let res;
        try {
          res = silent
            ? await api.line.silentUnsend(accountId!, id)
            : await api.line.unsend(accountId!, id);
        } catch (err) {
          rollback();
          const detail = err instanceof Error ? err.message : String(err);
          get().showNotice(`${silent ? "通知なし取り消し" : "取り消し"}に失敗しました: ${detail}`);
          return;
        }
        if (res.ok) {
          if (silent) get().showNotice("通知せず送信を取り消しました");
          if (activeChatId) await get().refreshMessages(activeChatId, { force: true });
        } else {
          rollback();
          const errText = res.error ?? "";
          if (silent && errText.includes("PREMIUM_REQUIRED")) {
            get().showNotice("通知せず取り消すには有効なLYPプレミアムが必要です");
          } else if (silent && errText.includes("SILENT_UNSEND_REJECTED")) {
            get().showNotice("LINEサーバーが通知なし取り消しを確認しませんでした");
          } else if (
            errText.includes("MESSAGE_NOT_DESTRUCTIBLE") ||
            errText.includes("message too old") ||
            errText.includes("too old")
          ) {
            get().showNotice("送信取り消しできません（送信取り消し可能な時間を過ぎています）");
          } else {
            get().showNotice(
              errText || (silent ? "通知なし取り消しに失敗しました" : "取り消しに失敗しました"),
            );
          }
        }
      },

      editMessage: async (id, newText) => {
        const { accountId, activeChatId, demoMode } = get();
        if (!accountId && !demoMode) return;
        // 送信中の楽観メッセージは編集できない
        const msg = get().messages.find((m) => m.id === id);
        if (!msg || msg.status === "sending" || id.startsWith("pending_")) {
          get().showNotice("送信が完了してから編集できます");
          return;
        }
        const prevText = msg.text ?? "";
        if (prevText === newText.trim()) return;

        // 楽観的にローカルメッセージを更新
        set((st) => ({
          messages: st.messages.map((m) =>
            m.id === id
              ? {
                  ...m,
                  text: newText,
                  edited: true,
                  editedAt: Date.now(),
                  originalText: m.originalText ?? prevText,
                  showOriginal: false,
                }
              : m,
          ),
        }));

        if (demoMode) {
          get().showNotice("メッセージをデモ編集しました");
          return;
        }

        try {
          const res = await api.line.editMessage(accountId!, msg.chatId, id, newText);
          if (res.ok) {
            get().showNotice("メッセージを編集しました");
            if (activeChatId) await get().refreshMessages(activeChatId, { force: true });
          } else {
            // 失敗時はロールバック
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === id ? { ...m, text: prevText, edited: msg.edited } : m,
              ),
            }));
            get().showNotice(res.error ?? "メッセージの編集に失敗しました");
          }
        } catch (err) {
          // 失敗時はロールバック
          set((st) => ({
            messages: st.messages.map((m) =>
              m.id === id ? { ...m, text: prevText, edited: msg.edited } : m,
            ),
          }));
          get().showNotice(`メッセージの編集に失敗しました: ${String(err)}`);
        }
      },

      toggleShowOriginal: (id) =>
        set((st) => ({
          messages: st.messages.map((m) =>
            m.id === id ? { ...m, showOriginal: !m.showOriginal } : m,
          ),
        })),

      retryMessage: async (id) => {
        const accountId = get().accountId;
        const msg = get().messages.find((m) => m.id === id);
        if (
          !accountId ||
          !msg ||
          msg.status !== "failed" ||
          msg.messageState.startsWith("revoked") ||
          !msg.retry
        )
          return;
        const chatId = msg.chatId;
        const intent = msg.retry;
        set((st) => ({
          messages: st.messages.map((m) => (m.id === id ? { ...m, status: "sending" } : m)),
        }));
        const markFailed = () =>
          set((st) => ({
            messages: st.messages.map((m) => (m.id === id ? { ...m, status: "failed" } : m)),
          }));
        try {
          let ok = false;
          let confirmed: LineMessage | null = null;
          if (intent.kind === "text") {
            const res = await api.line.send(accountId, chatId, intent.text, {
              relatedMessageId: intent.relatedMessageId,
              contentMetadata: intent.contentMetadata,
            });
            ok = res.ok;
            confirmed = res.ok ? (res.message ?? null) : null;
          } else if (intent.kind === "sticker") {
            const res = await api.line.sendSticker(accountId, chatId, {
              packageId: intent.packageId,
              stickerId: intent.stickerId,
              isPremium: intent.isPremium,
            });
            ok = res.ok;
            confirmed = res.ok ? (res.message ?? null) : null;
          } else if (intent.kind === "emoji") {
            const res = await api.line.sendEmoji(accountId, chatId, {
              packageId: intent.packageId,
              sticonId: intent.sticonId,
            });
            ok = res.ok;
          } else if (intent.kind === "combinationSticker") {
            const res = await api.line.sendCombinationSticker(accountId, chatId, intent.items);
            ok = res.ok;
            confirmed = res.ok ? (res.message ?? null) : null;
          }
          if (ok && confirmed && intent.kind === "combinationSticker") {
            // 再送でも送信時と同じくローカルプレビューを保存（mapMessage が CSSTKID/メッセージIDで引ける）
            await persistCombinationStickerPreview(
              accountId,
              confirmed,
              combinationPlacementsFromItems(intent.items),
            );
          }
          if (!ok) {
            markFailed();
            return;
          }
          if (confirmed) {
            const contactCache = buildContactCache(get().chats);
            const mapped = mapMessage(confirmed, chatId, accountId, contactCache);
            // 重い refreshMessages(force) は同期を止め得るため、確認済みメッセージで直接反映
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === id ? { ...m, ...mapped, id: mapped.id } : m,
              ),
              chats: updateChatsWithLatestMessage(st.chats, chatId, mapped, id),
            }));
          } else {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === id ? { ...m, status: "sent" } : m)),
            }));
          }
        } catch {
          markFailed();
        }
      },

      markRead: async (messageId) => {
        const { activeChatId } = get();
        if (!activeChatId) return;
        await get().markChatRead(activeChatId, messageId, { forceReceipt: true });
      },

      markChatRead: async (id, requestedMessageId, options) => {
        const { accountId, messages, settings, readDisabledMids, demoMode } = get();
        const forceReceipt = options?.forceReceipt === true;
        const received = messages
          .filter((m) => m.chatId === id && m.authorId !== "me" && !m.id.startsWith("pending_"))
          .sort((a, b) => {
            const byTime = b.createdAt - a.createdAt;
            if (byTime) return byTime;
            try {
              const left = BigInt(a.id);
              const right = BigInt(b.id);
              return left === right ? 0 : right > left ? 1 : -1;
            } catch {
              return b.id.localeCompare(a.id);
            }
          });
        const lastId = requestedMessageId ? requestedMessageId : received[0]?.id;
        const localKey = accountId ? accountChatKey(accountId, id) : null;
        if (localKey) recentlyReadAt.set(localKey, Date.now());

        let lastN: bigint | null = null;
        if (lastId) {
          try {
            lastN = BigInt(lastId);
          } catch {}
        }

        set((st) => {
          const nextMessages = st.messages.map((m) => {
            if (m.chatId !== id || m.authorId === "me" || lastN == null) return m;
            try {
              if (BigInt(m.id) > lastN) return m;
            } catch {
              return m;
            }
            return { ...m, read: true, status: "read" as const };
          });
          const remainingUnread = nextMessages.filter(
            (m) => m.chatId === id && m.authorId !== "me" && !m.read,
          ).length;
          return {
            chats: st.chats.map((c) =>
              c.id === id ? { ...c, unread: requestedMessageId ? remainingUnread : 0 } : c,
            ),
            messages: nextMessages,
          };
        });

        if (demoMode) return;
        // 通常の自動既読は全体/個別の無効化を尊重する。
        // 「このメッセージまで既読」は明示操作なので forceReceipt で一度だけ送れる。
        if (!accountId || (!forceReceipt && (!settings.readReceipts || readDisabledMids[id])))
          return;
        if (!lastId) return;

        const receiptKey = accountChatKey(accountId, id);
        const prev = readReceiptSent.get(receiptKey);
        // forceReceipt のときは重複チェックによるスキップを行わない（明示操作を必ず通す）
        if (!forceReceipt && prev === lastId) return;
        readReceiptSent.set(receiptKey, lastId);
        try {
          await api.line.markAsRead(accountId, id, lastId);
        } catch {
          if (!forceReceipt && prev) {
            readReceiptSent.set(receiptKey, prev);
          } else {
            readReceiptSent.delete(receiptKey);
          }
          if (localKey) recentlyReadAt.delete(localKey);
        }
      },

      markAllChatsRead: async () => {
        const { accountId, settings, readDisabledMids, demoMode } = get();
        if (demoMode || !accountId || !settings.readReceipts) return;
        const unreadChatIds = get()
          .chats.filter((chat) => chat.unread > 0 && !readDisabledMids[chat.id])
          .map((chat) => chat.id);
        if (unreadChatIds.length === 0) return;
        for (const chatId of unreadChatIds) {
          recentlyReadAt.set(accountChatKey(accountId, chatId), Date.now());
        }
        // バックエンドの bulk API で一括既読（個別ループより高速）
        try {
          await api.line.markAllAsRead(accountId, unreadChatIds);
        } catch {
          // フォールバック: 個別既読を試す
          for (const chatId of unreadChatIds) {
            try {
              await api.line.markAsRead(accountId, chatId);
            } catch {}
          }
        }
        set((st) => ({
          chats: st.chats.map((chat) =>
            unreadChatIds.includes(chat.id) ? { ...chat, unread: 0 } : chat,
          ),
          messages: st.messages.map((message) =>
            unreadChatIds.includes(message.chatId) && message.authorId !== "me"
              ? { ...message, read: true, status: "read" }
              : message,
          ),
        }));
      },

      setDraft: (chatId, text) => set((st) => ({ drafts: { ...st.drafts, [chatId]: text } })),

      setDraftSticons: (chatId, sticons) =>
        set((st) => ({ draftSticons: { ...st.draftSticons, [chatId]: sticons } })),

      setDraftMentions: (chatId, mentions) =>
        set((st) => ({ draftMentions: { ...st.draftMentions, [chatId]: mentions } })),

      setReplyTo: (messageId) => set({ replyToId: messageId }),

      scrollToMessage: (messageId) => {
        // chat-area が highlightMessageId を監視して仮想リスト内をスクロールする
        set({ highlightMessageId: messageId });
        window.setTimeout(() => set({ highlightMessageId: null }), 2200);
      },

      openDirectChatWith: (memberMid) => {
        if (!memberMid.startsWith("u")) return;
        set({ memberProfile: null, profileDrawerOpen: false });
        get().openChat(memberMid);
      },

      togglePin: (id) =>
        set((st) => ({
          chats: st.chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
        })),
      toggleHide: (id) =>
        set((st) => {
          const nextHidden = !st.chats.find((c) => c.id === id)?.hidden;
          if (st.accountId) setHiddenForAccount(st.accountId, id, nextHidden);
          return {
            chats: st.chats.map((c) => (c.id === id ? { ...c, hidden: nextHidden } : c)),
          };
        }),
      setHidden: (id, hidden) =>
        set((st) => {
          if (st.accountId) setHiddenForAccount(st.accountId, id, hidden);
          return {
            chats: st.chats.map((c) => (c.id === id ? { ...c, hidden } : c)),
          };
        }),
      toggleMute: (id) =>
        set((st) => ({
          chats: st.chats.map((c) => (c.id === id ? { ...c, muted: !c.muted } : c)),
        })),
      setCustomOrder: (ids) => set({ customOrder: ids }),
      reorderChat: (dragId, targetId) =>
        set((st) => {
          if (st.settings.chatSort !== "custom" || dragId === targetId) return {};
          const order = st.customOrder.length ? [...st.customOrder] : st.chats.map((c) => c.id);
          const from = order.indexOf(dragId);
          const to = order.indexOf(targetId);
          if (from < 0 || to < 0) return {};
          order.splice(from, 1);
          order.splice(to, 0, dragId);
          return { customOrder: order };
        }),
      moveChat: (id, dir) =>
        set((st) => {
          const order = st.customOrder.length ? [...st.customOrder] : st.chats.map((c) => c.id);
          const i = order.indexOf(id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= order.length) return {};
          [order[i], order[j]] = [order[j]!, order[i]!];
          return { customOrder: order };
        }),

      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(260, Math.min(520, w)) }),
      toggleSidebar: () => set((st) => ({ sidebarCollapsed: !st.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      openMemberProfile: (chatId, memberId) => set({ memberProfile: { chatId, memberId } }),
      closeMemberProfile: () => set({ memberProfile: null }),

      requestCall: (to, kind, joinOnly) =>
        set({ callRequest: { to, kind, ...(joinOnly ? { joinOnly } : {}) } }),
      clearCallRequest: () => set({ callRequest: null }),
      dismissIncomingCall: () => set({ incomingCall: null }),

      toggleReadersPanel: (chatId, messageId) => {
        const current = get().readersPanel;
        if (current && current.chatId === chatId && current.messageId === messageId) {
          set({ readersPanel: null });
          return;
        }
        set({ readersPanel: { chatId, messageId, loading: true } });
        const stillOpen = () => {
          const panel = get().readersPanel;
          return panel?.chatId === chatId && panel.messageId === messageId;
        };
        void get()
          .refreshReadReceipts(chatId, { force: true, messageId })
          .catch(() => {
            if (stillOpen()) get().showNotice("既読者の取得に失敗しました");
          })
          .finally(() => {
            if (stillOpen()) set({ readersPanel: { chatId, messageId, loading: false } });
          });
      },
      closeReadersPanel: () => set({ readersPanel: null }),

      setTheme: (t) => set({ theme: { ...t } }),
      updateThemeField: (field, value) =>
        set((st) => ({
          theme: { ...st.theme, [field]: value, id: "custom", name: "カスタム" },
        })),
      updateSetting: (k, v) => {
        set((st) => ({ settings: { ...st.settings, [k]: v } }));
      },
      setLocalName: (chatId, name) =>
        set((st) => ({
          chats: st.chats.map((c) =>
            c.id === chatId ? { ...c, localName: name || undefined } : c,
          ),
        })),
      updateSelf: (patch) => set((st) => ({ self: { ...st.self, ...patch } })),

      refreshChats: async () => {
        const { accountId } = get();
        if (!accountId) return;
        set({ loadingChats: true });
        try {
          await get().refreshChatsSilently();
        } finally {
          set({ loadingChats: false });
        }
      },

      refreshChatsSilently: async () => {
        const { accountId } = get();
        if (!accountId) return false;
        try {
          const res = await api.line.chats(accountId, { light: true, refresh: true });
          if (get().accountId !== accountId) return false;
          if (res.ok && res.chats) {
            const hidden = new Set(
              get()
                .chats.filter((c) => c.hidden)
                .map((c) => c.id),
            );
            const dismissed = getDismissedChatMids(accountId);
            const restored = new Set(getRestoredChatMids(accountId));
            set((st) => {
              const incoming = res
                .chats!.filter((c) => !dismissed.has(c.mid) || restored.has(c.mid))
                .map((c) => mapChat(c, hidden.has(c.mid)));
              return {
                chats: preserveLocallyNewerChatOrder(st.chats, incoming).map((base) => {
                  const prev = st.chats.find((p) => p.id === base.id);
                  const name =
                    base.name && !looksLikeMid(base.name)
                      ? base.name
                      : prev?.name && !looksLikeMid(prev.name)
                        ? prev.name
                        : base.name;
                  const recentlyKey = accountChatKey(accountId, base.id);
                  const recentAt = recentlyReadAt.get(recentlyKey);
                  const isRecentlyRead =
                    recentAt != null && Date.now() - recentAt < RECENTLY_READ_WINDOW_MS;
                  const serverUnread = base.unread ?? prev?.unread ?? 0;
                  // 最近既読にしたチャットはサーバ反映前でも未読0を維持（新着があれば poll で上書きされる）
                  const nextUnread =
                    isRecentlyRead && serverUnread > 0 && st.activeChatId !== base.id
                      ? 0
                      : serverUnread;
                  return prev
                    ? mergeLatestChatMetadata(prev, {
                        ...base,
                        name,
                        avatar: initial(name),
                        avatarUrl: base.avatarUrl || prev.avatarUrl,
                        pinned: prev.pinned,
                        muted: prev.muted,
                        hidden: prev.hidden,
                        localName: prev.localName,
                        members: prev.members,
                        unread: st.activeChatId === base.id ? 0 : nextUnread,
                      })
                    : base;
                }),
              };
            });
            // チャット一覧更新ではメッセージ履歴を触らない。
            // 新着は push / delta、古い履歴はユーザー操作時のページングだけが担当する。
            return true;
          }
        } catch {
          /* silent */
        }
        return false;
      },

      refreshMessages: async (chatId, opts) => {
        const { accountId } = get();
        if (!accountId || !chatId) return;
        const force = opts?.force === true;
        const refreshKey = `${accountChatKey(accountId, chatId)}:${force ? "force" : "local"}`;
        const inflight = messageRefreshInflight.get(refreshKey);
        if (inflight) return inflight;

        let task!: Promise<void>;
        task = (async () => {
          const showLoading = !get().messages.some((m) => m.chatId === chatId);
          if (showLoading) set({ loadingMessages: true });
          try {
            const res = await api.line.messages(accountId, chatId, 50, { force });
            if (get().accountId !== accountId) return;
            if (res.ok && res.messages) {
              const asc = [...res.messages].reverse();
              const contactCache = new Map<string, ContactInfo>();
              for (const c of get().chats) {
                contactCache.set(c.id, {
                  name: c.name,
                  thumbnailUrl: c.avatarUrl,
                });
                for (const m of c.members ?? []) {
                  contactCache.set(m.id, { name: m.name, thumbnailUrl: m.avatarUrl });
                }
              }
              const mapped = asc.map((m) => mapMessage(m, chatId, accountId, contactCache));
              const members = buildMembersFromMessages(asc, contactCache);
              const optimisticMediaToRelease: string[] = [];
              set((st) => {
                if (st.accountId !== accountId) return st;
                const mappedIds = new Set(mapped.map((m) => m.id));
                const existingChat = st.messages.filter((m) => m.chatId === chatId);
                const prevById = new Map(existingChat.map((m) => [m.id, m]));
                // 既読フラグ・既読者・初回時刻は一度取得できたらサーバ欠落でも落とさない。
                for (let i = 0; i < mapped.length; i++) {
                  const m = mapped[i]!;
                  const prev = prevById.get(m.id);
                  if (prev && tracksReadState(chatId, m)) {
                    mapped[i] = mergeMessageReadState(prev, m, st.self?.mid);
                  }
                  if (prev?.history?.length && !m.history?.length) {
                    mapped[i] = { ...m, history: prev.history };
                  }
                  if (
                    prev?.messageState?.startsWith("revoked") &&
                    !m.messageState?.startsWith("revoked")
                  ) {
                    mapped[i] = { ...m, messageState: prev.messageState };
                  }
                  // メッセージステートが undefined の場合もローカルの取り消し状態を優先
                  // （サーバが取り消し未処理の場合の fallback）
                  if (
                    prev?.messageState === "revoked-by-self" &&
                    m.messageState !== "revoked-by-self" &&
                    // undefined や normal になっている場合はローカル状態を優先
                    (m.messageState === undefined || m.messageState === "normal")
                  ) {
                    mapped[i] = { ...m, messageState: "revoked-by-self" as MessageState };
                  }
                  if (prev?.revokedSnapshot && !m.revokedSnapshot) {
                    mapped[i] = { ...m, revokedSnapshot: prev.revokedSnapshot };
                  }
                  if (prev && mapped[i]) {
                    mapped[i] = mergePreservingComboStickerPreview(prev, mapped[i]);
                  }
                }
                // pending / 送信直後の確定メッセージをサーバ欠落時も残す
                const confirmedOptimisticMediaIds = matchOptimisticMediaMessages(
                  existingChat,
                  mapped,
                );
                const keep = existingChat.filter((m) => {
                  if (mappedIds.has(m.id)) return false;
                  if (
                    m.id.startsWith("pending_") ||
                    m.status === "sending" ||
                    m.status === "failed"
                  ) {
                    // 同内容がサーバに載ったら捨てる
                    if (m.kind === "text" && m.text) {
                      return !mapped.some(
                        (x) =>
                          x.authorId === "me" &&
                          x.kind === "text" &&
                          x.text === m.text &&
                          Math.abs(x.createdAt - m.createdAt) < 120_000,
                      );
                    }
                    if (m.kind === "sticker" && m.sticker) {
                      return !mapped.some(
                        (x) =>
                          x.authorId === "me" &&
                          x.kind === "sticker" &&
                          x.sticker === m.sticker &&
                          Math.abs(x.createdAt - m.createdAt) < 120_000,
                      );
                    }
                    if (m.kind === "image" || m.kind === "video") {
                      return !confirmedOptimisticMediaIds.has(m.id);
                    }
                    return true;
                  }
                  // 送信 API で確定した直後の自分メッセージ（サーバ結果にまだ無い）
                  if (
                    m.authorId === "me" &&
                    Date.now() - m.createdAt < 120_000 &&
                    (m.status === "sent" || m.status === "read")
                  ) {
                    return true;
                  }
                  return false;
                });
                // refresh は最新50件を「置換」するのではなく、現在保持している履歴へ重ねる。
                // これにより送信・既読更新・手動 refresh 後も読み込み済みの古い履歴を維持する。
                const mergedMap = new Map<string, Message>();
                for (const m of existingChat) {
                  if (
                    m.id.startsWith("pending_") ||
                    m.status === "sending" ||
                    m.status === "failed"
                  ) {
                    continue;
                  }
                  mergedMap.set(m.id, m);
                }
                for (const m of mapped) mergedMap.set(m.id, m);
                for (const m of keep) {
                  if (!mergedMap.has(m.id)) mergedMap.set(m.id, m);
                }
                const forChat = [...mergedMap.values()].sort((a, b) => {
                  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
                  return a.id.localeCompare(b.id);
                });
                const retainedIds = new Set(forChat.map((message) => message.id));
                for (const message of existingChat) {
                  if (!retainedIds.has(message.id)) optimisticMediaToRelease.push(message.id);
                }
                return {
                  messages: [...st.messages.filter((m) => m.chatId !== chatId), ...forChat],
                  chats: st.chats.map((c) =>
                    c.id === chatId && c.type === "group"
                      ? {
                          ...c,
                          members: members.map((m) => {
                            const prev = c.members?.find((p) => p.id === m.id);
                            const previousName = prev?.name;
                            const name = isResolvedMemberProfileName(m.name)
                              ? m.name
                              : isResolvedMemberProfileName(previousName)
                                ? previousName
                                : m.name;
                            return {
                              ...m,
                              name,
                              avatar: initial(name),
                              avatarUrl: m.avatarUrl || prev?.avatarUrl,
                            };
                          }),
                        }
                      : c,
                  ),
                };
              });
              for (const messageId of optimisticMediaToRelease) {
                releaseOptimisticMediaObjectUrl(messageId);
              }
              if (
                get().settings.readReceipts &&
                get().activeChatId === chatId &&
                sessionOpenedChats.has(chatId)
              ) {
                void get().markChatRead(chatId);
                void get().refreshReadReceipts(chatId);
              }
            }
          } finally {
            if (showLoading && get().accountId === accountId) set({ loadingMessages: false });
          }
        })();
        messageRefreshInflight.set(refreshKey, task);
        try {
          await task;
        } finally {
          if (messageRefreshInflight.get(refreshKey) === task) {
            messageRefreshInflight.delete(refreshKey);
          }
        }
      },

      applyMemberReadNotification: (chatId, readerMid, upToMessageId, readAt) => {
        const accountId = get().accountId;
        if (!accountId || !readerMid.startsWith("u")) return;
        if (!chatId.startsWith("c") && !chatId.startsWith("r")) return;
        if (!Number.isSafeInteger(readAt) || readAt <= 0) return;
        let upTo: bigint;
        try {
          upTo = BigInt(upToMessageId);
        } catch {
          return;
        }
        const chatKey = accountChatKey(accountId, chatId);
        const cache = get().readWatermarks[chatKey];
        let watermark = 0n;
        for (const range of cache?.memberReadRanges ?? []) {
          if (range.mid !== readerMid) continue;
          try {
            const end = BigInt(range.endInclusive);
            if (end > watermark) watermark = end;
          } catch {
            /* 壊れたレンジは無視 */
          }
        }
        // 到達点が未知のうちは履歴全体をこの時刻で塗り潰さない。基準は既読レンジ取得に任せる。
        if (watermark <= 0n || upTo <= watermark) return;

        const nextCache = {
          ...cache,
          memberReadRanges: mergeMemberReadRanges(cache?.memberReadRanges, [
            {
              mid: readerMid,
              startExclusive: String(watermark),
              endInclusive: String(upTo),
              readAt,
            },
          ]),
          memberWatermarks: mergeMemberReadWatermarks(cache?.memberWatermarks, [
            { mid: readerMid, upTo: String(upTo) },
          ]),
          at: Date.now(),
        };

        set((st) => {
          if (st.accountId !== accountId) return st;
          const patches = applyReadWatermarkLocal(
            st.messages.filter((m) => m.chatId === chatId),
            nextCache,
            false,
            st.self?.mid,
          );
          return {
            readWatermarks: { ...st.readWatermarks, [chatKey]: nextCache },
            ...(patches
              ? {
                  messages: st.messages.map((m) => {
                    const patch = m.chatId === chatId ? patches.get(m.id) : undefined;
                    return patch ? { ...m, ...patch } : m;
                  }),
                }
              : {}),
          };
        });
      },

      refreshReadReceipts: async (chatId, opts) => {
        const accountId = get().accountId;
        if (!accountId) return;
        const chatKey = accountChatKey(accountId, chatId);
        const force = opts?.force === true;
        // ユーザーが別メッセージの既読者を同時に開いた場合、それぞれの対象IDを落とさない。
        const targetKey = opts?.messageId?.trim() || "*";
        const inflightKey = `${chatKey}:${force ? "force" : "normal"}:${targetKey}`;
        const inflight = readReceiptInflight.get(inflightKey);
        if (inflight) return inflight;

        let task!: Promise<void>;
        task = (async () => {
          const { messages } = get();

          const resolveReaderProfiles = async (
            readerMids: Iterable<string>,
            forceRetry = false,
          ): Promise<void> => {
            const requestedMids = [
              ...new Set([...readerMids].map((mid) => mid.trim()).filter(Boolean)),
            ];
            if (requestedMids.length === 0) return;

            // 解決は MID 単位で共有する。チャット単位で直列化すると、既読者一覧を
            // 続けて開いたときに後発の要求が先発の完了待ちで取りこぼしていた。
            const readersNeedFetch: string[] = [];
            const waits: Array<Promise<unknown>> = [];
            const currentMembers = get().chats.find((chat) => chat.id === chatId)?.members;
            const now = Date.now();
            for (const mid of requestedMids) {
              const contactKey = accountChatKey(accountId, mid);
              const currentName = currentMembers?.find((member) => member.id === mid)?.name;
              if (isResolvedMemberProfileName(currentName)) continue;
              const existing = readerProfileResolveInflight.get(contactKey);
              if (existing) {
                waits.push(existing.catch(() => undefined));
                continue;
              }
              const lastAttemptAt = readerProfileFetchAttemptAt.get(contactKey) ?? 0;
              if (!forceRetry && now - lastAttemptAt < READER_PROFILE_RETRY_MS) continue;
              readersNeedFetch.push(mid);
            }
            if (readersNeedFetch.length === 0) {
              await Promise.all(waits);
              return;
            }

            const profileTask = (async () => {
              const unresolved = new Set(readersNeedFetch);
              const resolved = new Map<string, { name: string; avatarUrl?: string }>();

              try {
                const warmRes = await api.line.vylineWarm(accountId, readersNeedFetch);
                if (get().accountId !== accountId) return;
                if (warmRes.ok && warmRes.profiles) {
                  for (const mid of readersNeedFetch) {
                    const profile = warmRes.profiles[mid] as
                      | { displayName?: string; thumbnailUrl?: string }
                      | undefined;
                    const name = profile?.displayName;
                    if (!isResolvedMemberProfileName(name)) continue;
                    resolved.set(mid, { name, avatarUrl: profile?.thumbnailUrl });
                    unresolved.delete(mid);
                  }
                }
              } catch {
                /* group member fallback below */
              }

              const isGroup = get().chats.find((chat) => chat.id === chatId)?.type === "group";
              if (isGroup && unresolved.size > 0) {
                try {
                  const membersRes = await api.line.chatMembers(accountId, chatId);
                  if (get().accountId !== accountId) return;
                  if (membersRes.ok && membersRes.members) {
                    for (const member of membersRes.members) {
                      if (!unresolved.has(member.mid)) continue;
                      if (!isResolvedMemberProfileName(member.displayName)) continue;
                      resolved.set(member.mid, {
                        name: member.displayName,
                        avatarUrl: member.thumbnailUrl,
                      });
                      unresolved.delete(member.mid);
                    }
                  }
                } catch {
                  /* 次回の既読更新で30秒後に再試行する */
                }
              }

              // 失敗した MID だけ backoff を刻む。成功分は次回すぐ再取得できるようにする。
              const failedAt = Date.now();
              for (const mid of unresolved) {
                readerProfileFetchAttemptAt.set(accountChatKey(accountId, mid), failedAt);
              }
              if (resolved.size === 0 || get().accountId !== accountId) return;
              for (const mid of resolved.keys()) {
                const contactKey = accountChatKey(accountId, mid);
                contactFetched.add(contactKey);
                readerProfileFetchAttemptAt.delete(contactKey);
              }
              set((st) => {
                if (st.accountId !== accountId) return st;
                return {
                  chats: st.chats.map((c) => {
                    if (c.id !== chatId) return c;
                    const members = [...(c.members ?? [])];
                    for (const [mid, profile] of resolved) {
                      const i = members.findIndex((member) => member.id === mid);
                      if (i >= 0) {
                        members[i] = {
                          ...members[i]!,
                          name: profile.name,
                          avatar: initial(profile.name),
                          avatarUrl: profile.avatarUrl || members[i]!.avatarUrl,
                        };
                      } else {
                        members.push(mapMember(mid, profile.name, profile.avatarUrl));
                      }
                    }
                    return { ...c, members };
                  }),
                };
              });
            })();
            for (const mid of readersNeedFetch) {
              readerProfileResolveInflight.set(accountChatKey(accountId, mid), profileTask);
            }
            try {
              await Promise.all([profileTask, ...waits]);
            } finally {
              for (const mid of readersNeedFetch) {
                const contactKey = accountChatKey(accountId, mid);
                if (readerProfileResolveInflight.get(contactKey) === profileTask) {
                  readerProfileResolveInflight.delete(contactKey);
                }
              }
            }
          };

          const isGroupReceipt = chatId.startsWith("c") || chatId.startsWith("r");
          const eligibleIds = messages
            .filter(
              (m) =>
                m.chatId === chatId &&
                (isGroupReceipt || m.authorId === "me") &&
                m.id &&
                !m.id.startsWith("pending_") &&
                !m.messageState.startsWith("revoked"),
            )
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((m) => m.id);
          const requestedId =
            opts?.messageId && eligibleIds.includes(opts.messageId) ? opts.messageId : undefined;
          const forceProfileRetry = force && requestedId != null;
          const recentIds = eligibleIds
            .filter((id) => id !== requestedId)
            .slice(requestedId ? -99 : -100);
          const receiptIds = requestedId ? [...recentIds, requestedId] : recentIds;
          if (receiptIds.length === 0) return;

          // グループは送受信両方、DM は自分の送信分について直近15分の変化を追う。
          const needsPoll = messages.some(
            (m) =>
              m.chatId === chatId &&
              (isGroupReceipt || m.authorId === "me") &&
              receiptIds.includes(m.id) &&
              Date.now() - m.createdAt < 15 * 60_000,
          );

          // キャッシュ済みウォーターマークがあれば先にローカル適用（読み込み高速化）
          // needsPoll に関係なく適用する（古いチャットを開き直したときも既読状態を即反映）
          const cached = get().readWatermarks[chatKey];
          let cachedProfileTask: Promise<void> | undefined;
          if (cached) {
            const patched = applyReadWatermarkLocal(
              messages.filter((m) => m.chatId === chatId),
              cached,
              force,
              get().self?.mid,
            );
            if (patched) {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.chatId === chatId && patched.get(m.id) ? { ...m, ...patched.get(m.id) } : m,
                ),
              }));
            }
            const cachedReaderMids = new Set<string>();
            for (const message of messages) {
              if (message.chatId !== chatId || (!isGroupReceipt && message.authorId !== "me"))
                continue;
              for (const mid of message.readBy ?? []) cachedReaderMids.add(mid);
              for (const mid of Object.keys(message.readByAt ?? {})) cachedReaderMids.add(mid);
            }
            for (const range of cached.memberReadRanges ?? []) cachedReaderMids.add(range.mid);
            for (const watermark of cached.memberWatermarks ?? []) {
              cachedReaderMids.add(watermark.mid);
            }
            cachedProfileTask = resolveReaderProfiles(cachedReaderMids, forceProfileRetry);
            // 強制でなければ、かつキャッシュが新しければ RPC を飛ばさない
            if (Date.now() - cached.at < READ_WATERMARK_TTL_MS && !force) {
              await cachedProfileTask;
              return;
            }
          }

          if (!needsPoll && !force) {
            await cachedProfileTask;
            return;
          }

          const res = await api.line.readReceipts(accountId, chatId, receiptIds, {
            force,
          });
          if (get().accountId !== accountId) return;
          if (!res.ok || !res.receipts) {
            await cachedProfileTask;
            return;
          }

          const previousCache = get().readWatermarks[chatKey];
          const mergedCache = {
            peerReadUpTo: maxMessageId(previousCache?.peerReadUpTo, res.peerReadUpTo),
            memberWatermarks: mergeMemberReadWatermarks(
              previousCache?.memberWatermarks,
              res.memberReadWatermarks,
            ),
            ...(previousCache?.memberReadRanges !== undefined || res.memberReadRanges !== undefined
              ? {
                  memberReadRanges: mergeMemberReadRanges(
                    previousCache?.memberReadRanges,
                    res.memberReadRanges,
                  ),
                }
              : {}),
            at: Date.now(),
          };

          // 古い・部分的な応答で既知の既読者を失わないよう、単調合流して保存する。
          set((st) =>
            st.accountId !== accountId
              ? st
              : {
                  readWatermarks: {
                    ...st.readWatermarks,
                    [chatKey]: mergedCache,
                  },
                },
          );

          // 既読者 MID のプロフィールを事前取得（メンバー一覧を開かなくても名前表示）
          const allReaderMids = new Set<string>();
          for (const patch of Object.values(res.receipts)) {
            for (const mid of (patch as { readBy?: string[] }).readBy ?? []) {
              allReaderMids.add(mid);
            }
            for (const mid of Object.keys(
              (patch as { readByAt?: Record<string, number> }).readByAt ?? {},
            )) {
              allReaderMids.add(mid);
            }
          }
          for (const range of mergedCache.memberReadRanges ?? []) {
            allReaderMids.add(range.mid);
          }
          for (const watermark of mergedCache.memberWatermarks ?? []) {
            allReaderMids.add(watermark.mid);
          }

          set((st) => {
            if (st.accountId !== accountId) return st;
            const localPatches = applyReadWatermarkLocal(
              st.messages.filter((m) => m.chatId === chatId),
              mergedCache,
              force,
              st.self?.mid,
            );
            return {
              messages: st.messages.map((m) => {
                if (m.chatId !== chatId || (!isGroupReceipt && m.authorId !== "me")) return m;
                const localPatch = localPatches?.get(m.id);
                const current = localPatch ? { ...m, ...localPatch } : m;
                const patch = res.receipts![m.id];
                if (!patch) return current;
                const senderMid = current.authorId === "me" ? st.self?.mid : current.authorId;
                const readByAt = mergeReadByAt(current.readByAt, patch.readByAt, senderMid);
                const mergedReadBy = [
                  ...new Set([
                    ...(current.readBy ?? []).filter((mid) => mid !== senderMid),
                    ...(patch.readBy ?? []).filter((mid) => mid !== senderMid),
                    ...Object.keys(readByAt),
                  ]),
                ];
                const alreadyRead = current.read;
                const read =
                  patch.seen === true ||
                  Boolean((patch as { read?: boolean }).read) ||
                  (patch.readCount != null && patch.readCount > 0) ||
                  mergedReadBy.length > 0;
                // 既読フラグが一度立っている場合は立てたままにする（未読にしない）
                const finalRead = alreadyRead ? true : read;
                const readCount = Math.max(
                  current.readCount ?? 0,
                  patch.readCount ?? 0,
                  mergedReadBy.length,
                );
                return {
                  ...current,
                  read: finalRead,
                  readBy: finalRead && mergedReadBy.length > 0 ? mergedReadBy : current.readBy,
                  readByAt:
                    finalRead && Object.keys(readByAt).length > 0 ? readByAt : current.readByAt,
                  readCount: finalRead && readCount > 0 ? readCount : current.readCount,
                  status: finalRead
                    ? ("read" as const)
                    : current.status === "read"
                      ? "sent"
                      : current.status,
                };
              }),
            };
          });

          // 「既読者を確認中…」は名前解決まで含めて待つ。
          // これにより初回だけ「メンバー」のまま残り、開き直すと直る競合を防ぐ。
          await Promise.all([
            cachedProfileTask,
            resolveReaderProfiles(allReaderMids, forceProfileRetry),
          ]);
        })();

        readReceiptInflight.set(inflightKey, task);
        void task
          .finally(() => {
            if (readReceiptInflight.get(inflightKey) === task) {
              readReceiptInflight.delete(inflightKey);
            }
          })
          .catch(() => undefined);
        return task;
      },

      mergeIncomingMessages: (chatId, incoming, opts) => {
        const { accountId, activeChatId, messages, chats } = get();
        if (!accountId || incoming.length === 0) return;

        const silent = opts?.silent === true;
        const contactCache = buildContactCache(chats);
        const mapped = incoming.map((m) => mapMessage(m, chatId, accountId, contactCache));
        const incomingById = new Map(mapped.map((m) => [m.id, m]));
        const existingIds = new Set(messages.filter((m) => m.chatId === chatId).map((m) => m.id));
        const fresh = mapped.filter((m) => !existingIds.has(m.id));

        // 既存メッセージにもリアクションや状態の更新を反映（同期で re-fetch された場合）
        const hasUpdates = [...incomingById.values()].some((m) => {
          if (!existingIds.has(m.id)) return false;
          const existing = messages.find((x) => x.id === m.id);
          if (!existing) return false;
          if (
            m.reactions?.length &&
            JSON.stringify(m.reactions) !== JSON.stringify(existing.reactions)
          )
            return true;
          if (
            m.messageState?.startsWith("revoked") &&
            !existing.messageState?.startsWith("revoked")
          )
            return true;
          if (m.read && !existing.read) return true;
          // 既知の既読者と同じ内容なら全件マップし直さない（2秒ごとの再描画を避ける）
          const senderMid = existing.authorId === "me" ? get().self?.mid : existing.authorId;
          if (
            (m.readBy ?? []).some(
              (mid) => mid !== senderMid && !(existing.readBy ?? []).includes(mid),
            )
          )
            return true;
          if (
            Object.entries(m.readByAt ?? {}).some(
              ([mid, at]) => mid !== senderMid && existing.readByAt?.[mid] !== at,
            )
          )
            return true;
          return (m.readCount ?? 0) > (existing.readCount ?? 0);
        });
        if (fresh.length === 0 && !hasUpdates) return;

        // キャッシュ済み既読ウォーターマークを新着にも即適用（RPC なしで既読化）
        const cachedWm = accountId
          ? get().readWatermarks[accountChatKey(accountId, chatId)]
          : undefined;
        if (cachedWm) {
          const patched = applyReadWatermarkLocal(mapped, cachedWm, false, get().self?.mid);
          if (patched) {
            for (const m of mapped) {
              const p = patched.get(m.id);
              if (p) Object.assign(m, p);
            }
          }
        }

        const latest = fresh.length
          ? fresh.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
          : undefined;
        const incomingFromPeer = fresh.filter((m) => m.authorId !== "me").length;

        set((st) => {
          const withUpdates = hasUpdates
            ? st.messages.map((m) => {
                if (m.chatId !== chatId) return m;
                const upd = incomingById.get(m.id);
                if (!upd) return m;
                const reactionChanged =
                  JSON.stringify(upd.reactions) !== JSON.stringify(m.reactions);
                const revokedChanged =
                  upd.messageState?.startsWith("revoked") && !m.messageState?.startsWith("revoked");
                const senderMid = m.authorId === "me" ? st.self?.mid : m.authorId;
                const readByAt = mergeReadByAt(m.readByAt, upd.readByAt, senderMid);
                const readBy = [
                  ...new Set([
                    ...(m.readBy ?? []).filter((mid) => mid !== senderMid),
                    ...(upd.readBy ?? []).filter((mid) => mid !== senderMid),
                    ...Object.keys(readByAt),
                  ]),
                ];
                const readCount = Math.max(m.readCount ?? 0, upd.readCount ?? 0, readBy.length);
                const read = m.read || upd.read || readCount > 0;
                const readChanged =
                  read !== m.read ||
                  readCount > (m.readCount ?? 0) ||
                  readBy.length > (m.readBy?.length ?? 0) ||
                  Object.entries(readByAt).some(([mid, at]) => m.readByAt?.[mid] !== at);
                if (!reactionChanged && !revokedChanged && !readChanged) return m;
                const updated = { ...m };
                if (readChanged) {
                  updated.read = read;
                  updated.status = read ? "read" : updated.status;
                  updated.readBy = readBy;
                  updated.readCount = readCount;
                  if (Object.keys(readByAt).length > 0) updated.readByAt = readByAt;
                }
                if (reactionChanged) {
                  if (upd.reactions?.length) {
                    messageReactionCache.set(m.id, upd.reactions);
                  } else {
                    messageReactionCache.delete(m.id);
                  }
                  updated.reactions = upd.reactions;
                }
                if (revokedChanged) {
                  updated.messageState = upd.messageState;
                  updated.revokedSnapshot =
                    m.revokedSnapshot ?? upd.revokedSnapshot ?? snapshotFromMessage(m);
                  const prevState = m.messageState ?? "normal";
                  updated.history = [
                    ...(m.history ?? []),
                    {
                      state: prevState,
                      text: m.text ?? null,
                      contentType: m.kind,
                      updatedTime: Date.now(),
                    },
                  ];
                  updated.text = undefined;
                }
                return mergePreservingComboStickerPreview(m, updated);
              })
            : st.messages;
          // 同一 ID が二重に並ぶと React キーが衝突し、再読込するまで表示が崩れる。
          const dedupedById = new Map<string, Message>();
          for (const m of [...withUpdates, ...fresh]) dedupedById.set(m.id, m);
          const merged = [...dedupedById.values()].sort((a, b) => a.createdAt - b.createdAt);
          const trimmed = merged.filter((m) => m.chatId !== chatId);
          const forChat = merged.filter((m) => m.chatId === chatId);
          const chatsWithLatest = latest
            ? updateChatsWithLatestMessage(st.chats, chatId, latest)
            : st.chats;
          return {
            messages: [...trimmed, ...forChat],
            chats: chatsWithLatest.map((c) => {
              if (c.id !== chatId) return c;
              return {
                ...c,
                unread: activeChatId === chatId || silent ? c.unread : c.unread + incomingFromPeer,
              };
            }),
          };
        });

        if (activeChatId === chatId && !silent && sessionOpenedChats.has(chatId)) {
          if (get().settings.readReceipts) void get().markChatRead(chatId);
          for (const m of fresh) {
            const contactKey = accountChatKey(accountId, m.authorId);
            if (m.authorId !== "me" && !contactFetched.has(contactKey)) {
              if (contactFetched.size >= 5000) {
                const iter = contactFetched.values();
                for (let i = 0; i < 500; i++) contactFetched.delete(iter.next().value!);
              }
              contactFetched.add(contactKey);
              void api.line.contactProfile(accountId, m.authorId).then((res) => {
                if (!res.ok || !res.profile) return;
                set((st) => ({
                  chats: st.chats.map((c) => {
                    if (c.id !== chatId) return c;
                    const members = [...(c.members ?? [])];
                    const i = members.findIndex((x) => x.id === m.authorId);
                    const name = res.profile!.displayName;
                    const thumbnailUrl = res.profile!.thumbnailUrl;
                    if (i >= 0) {
                      members[i] = {
                        ...members[i]!,
                        name: isResolvedMemberProfileName(name) ? name : members[i]!.name,
                        avatarUrl: thumbnailUrl || members[i]!.avatarUrl,
                      };
                    } else {
                      members.push(mapMember(m.authorId, name, thumbnailUrl));
                    }
                    return { ...c, members };
                  }),
                }));
              });
            }
          }
        }
      },

      applyRevoked: (chatId, messageId) => {
        set((st) => {
          const msgs = st.messages.map((m) => {
            if (m.chatId !== chatId || m.id !== messageId) return m;
            const prevState = m.messageState ?? "normal";
            const history = [
              ...(m.history ?? []),
              {
                state: prevState,
                text: m.text ?? null,
                contentType: m.kind,
                updatedTime: Date.now(),
              },
            ];
            return {
              ...m,
              messageState: (m.authorId === "me"
                ? "revoked-by-self"
                : "revoked-by-other") as MessageState,
              history,
              revokedSnapshot: m.revokedSnapshot ?? snapshotFromMessage(m),
              text: undefined,
            };
          });
          invalidateMessage(messageReactionCache, messageId);
          if (msgs.every((m, i) => m === st.messages[i])) return st;
          return { messages: msgs };
        });
      },

      fetchMessageHistory: async (chatId, messageId) => {
        const { accountId, demoMode } = get();
        if (demoMode) {
          return get().messages.find((message) => message.id === messageId)?.history ?? [];
        }
        if (!accountId) return [];
        const res = await api.line.messageHistory(accountId, chatId, messageId);
        if (res.ok) return res.history ?? [];
        return [];
      },

      restoreRevokedMessage: async (_chatId, messageId) => {
        const { accountId, demoMode } = get();
        if (!accountId && !demoMode) return;
        const msg = get().messages.find((m) => m.id === messageId);
        if (!msg || msg.messageState !== "revoked-by-self") return;
        const snapshot = msg.revokedSnapshot;
        const lastNormal = [...(msg.history ?? [])]
          .reverse()
          .find((h) => h.state === "normal" || h.state === "edited");
        if (!snapshot && !lastNormal) {
          get().showNotice("復元できる元のメッセージがありません");
          return;
        }
        const historyEntry = {
          state: "normal" as const,
          text: msg.text ?? null,
          contentType: msg.kind,
          updatedTime: Date.now(),
        };
        set((st) => ({
          messages: st.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  ...snapshot,
                  messageState: (snapshot?.messageState ??
                    (lastNormal?.state === "edited" ? "edited" : "normal")) as MessageState,
                  history: [...(m.history ?? []), historyEntry],
                  ...(snapshot
                    ? { revokedSnapshot: snapshot }
                    : m.revokedSnapshot
                      ? { revokedSnapshot: m.revokedSnapshot }
                      : {}),
                  text: snapshot?.text ?? lastNormal?.text ?? undefined,
                }
              : m,
          ),
        }));
        if (demoMode) {
          get().showNotice("取り消したメッセージをデモ復元しました");
          return;
        }
        try {
          await api.line.restoreRevokedMessage(accountId!, _chatId, messageId);
        } catch {
          /* local update already applied */
        }
      },

      setMessageReaction: (messageId, reaction, myMid) => {
        const emoji = typeof reaction === "object" ? reaction : undefined;
        const typeNum = typeof reaction === "string" ? (
          { NICE: 2, LOVE: 3, FUN: 4, AMAZING: 5, SAD: 6, OMG: 7 } as Record<string, number>
        )[reaction] : 0;
        if (reaction !== "UNDO" && !emoji && !typeNum) return;
        set((st) => {
          const msgs = st.messages.map((m) => {
            if (m.id !== messageId) return m;
            const mine = m.reactions?.filter((r) => r.fromMid === myMid) ?? [];
            let next = m.reactions ?? [];
            // 自分が既に別リアクションしていれば置き換え（LINE はメッセージごとに 1 つ）
            if (mine.length) {
              next = next.filter((r) => r.fromMid !== myMid);
            }
            if (reaction !== "UNDO") {
              next = [...next, { fromMid: myMid, atMillis: Date.now(), type: typeNum!, ...(emoji ? { emoji } : {}) }];
            }
            return { ...m, reactions: next.length ? next : undefined };
          });
          // キャッシュも更新
          for (const m of msgs) {
            if (!m.id) continue;
            if (m.reactions?.length) {
              messageReactionCache.set(m.id, m.reactions);
            } else {
              messageReactionCache.delete(m.id);
            }
          }
          if (msgs.every((m, i) => m === st.messages[i])) return st;
          return { messages: msgs };
        });
      },

      pollMessagesDelta: async (chatId) => {
        const { accountId, messages } = get();
        if (!accountId || !chatId) return;
        const now = Date.now();
        const chatKey = accountChatKey(accountId, chatId);
        const inflight = messageDeltaInflight.get(chatKey);
        if (inflight) return inflight;
        const lastAt = lastDeltaPollAt.get(chatKey) ?? 0;
        if (now - lastAt < DELTA_POLL_MIN_MS) return;

        const task = (async () => {
          const chatMsgs = messages.filter(
            (m) => m.chatId === chatId && m.id && !m.id.startsWith("pending_"),
          );
          // 配列末尾ではなく最大 messageId を基準にする。
          // createdAt 順と ID 順がずれると after 指定が巻き戻り、新着を取りこぼす。
          let lastId: string | undefined;
          let lastIdN = -1n;
          for (const m of chatMsgs) {
            let idN: bigint;
            try {
              idN = BigInt(m.id);
            } catch {
              continue;
            }
            if (idN > lastIdN) {
              lastIdN = idN;
              lastId = m.id;
            }
          }
          // 非 pending メッセージが無い（全送信中/初回）場合は通常取得にフォールバックして足場を作る
          if (!lastId) {
            lastDeltaPollAt.set(chatKey, Date.now());
            await get()
              .refreshMessages(chatId, { force: true })
              .catch(() => undefined);
            return;
          }
          const started = Date.now();
          try {
            const res = await api.line.messagesDelta(accountId, chatId, lastId, 15);
            if (get().accountId !== accountId) return;
            // 成功時のみスロットルを更新（失敗時は次のサイクルで再試行できるようにする）
            lastDeltaPollAt.set(chatKey, Date.now());
            if (res.ok && res.messages?.length) {
              get().mergeIncomingMessages(chatId, res.messages);
            }
          } catch {
            /* silent */
          }
          // 遅い RPC の後は次回を遅らせて RPC キューを空ける（重い E2EE グループ対策）
          if (Date.now() - started > 6_000) {
            lastDeltaPollAt.set(chatKey, Date.now());
          }
        })();
        messageDeltaInflight.set(chatKey, task);
        try {
          await task;
        } finally {
          if (messageDeltaInflight.get(chatKey) === task) messageDeltaInflight.delete(chatKey);
        }
      },

      pollIncoming: async () => {
        const accountId = get().accountId;
        if (!accountId) return;

        const inflight = pollIncomingInflight.get(accountId);
        if (inflight) return inflight;

        let task!: Promise<void>;
        task = (async () => {
          // CANCEL を取りこぼしても「着信中」が残り続けないよう、一定時間で自動消去。
          // Android 実機の呼び出しタイムアウト相当（~90s）。
          const stale = get().incomingCall;
          if (stale && Date.now() - stale.receivedAt > 90_000) {
            set({ incomingCall: null });
          }
          const cursor = eventPollCursor.get(accountId) ?? 0;
          try {
            const res = await api.line.pollEvents(accountId, cursor);
            if (get().accountId !== accountId) return;
            if (res.ok) {
              if (res.reset) {
                // バッファが失われた（再起動 / 追い出し）→ カーソルを現在に合わせ再同期
                eventPollCursor.set(accountId, res.seq ?? res.cursor ?? 0);
                void get().refreshChatsSilently();
                const { activeChatId } = get();
                if (activeChatId) void get().pollMessagesDelta(activeChatId);
                return;
              }
              if (res.cursor != null) eventPollCursor.set(accountId, res.cursor);
              if (res.events?.length) {
                const byChat = new Map<string, LineMessage[]>();
                for (const ev of res.events) {
                  if (ev.kind === "message") {
                    const list = byChat.get(ev.chatMid) ?? [];
                    list.push(ev.message);
                    byChat.set(ev.chatMid, list);
                  } else if (ev.kind === "revoke") {
                    get().applyRevoked(ev.chatMid, ev.messageId);
                  } else if (ev.kind === "read") {
                    const selfMid = get().self?.mid;
                    // 他メンバーの既読通知で自分の未読を消さない。MID 不明な旧イベントのみ従来動作。
                    const readerIsSelf = !ev.readerMid || (!!selfMid && ev.readerMid === selfMid);
                    if (readerIsSelf) {
                      // 外部クライアントで既読された場合もローカル未読を即時クリア
                      set((st) => ({
                        chats: st.chats.map((c) => (c.id === ev.chatMid ? { ...c, unread: 0 } : c)),
                        messages: st.messages.map((m) =>
                          m.chatId === ev.chatMid && m.authorId !== "me"
                            ? { ...m, read: true, status: "read" }
                            : m,
                        ),
                      }));
                      // 未読カウントのサーバ側整合も早めに取り直す
                      void get()
                        .refreshChatsSilently()
                        .catch(() => undefined);
                    } else if (ev.readerMid && ev.upToMessageId && ev.readAt) {
                      // 通知時刻をそのメッセージの初回既読時刻として確定させる
                      get().applyMemberReadNotification(
                        ev.chatMid,
                        ev.readerMid,
                        ev.upToMessageId,
                        ev.readAt,
                      );
                    }
                    if (get().settings.readReceipts) {
                      void get()
                        .refreshReadReceipts(ev.chatMid, { force: true })
                        .catch(() => undefined);
                    }
                  } else if (ev.kind === "call:incoming") {
                    const selfMid = get().self?.mid;
                    if (selfMid && (ev.callerMid === selfMid || ev.callMid === selfMid)) {
                      // 自分自身の発信は着信として扱わない
                      continue;
                    }
                    if (get().callRequest) {
                      // 自身が発信リクエスト中なら着信通知を無視
                      continue;
                    }
                    if (Date.now() - ev.receivedAt > 90_000) continue;
                    set({
                      incomingCall: {
                        callMid: ev.callMid,
                        chatMid: ev.chatMid,
                        callerMid: ev.callerMid,
                        callType: ev.callType,
                        receivedAt: ev.receivedAt,
                      },
                    });
                  } else if (ev.kind === "call:cancel" || ev.kind === "call:end") {
                    set({ incomingCall: null });
                  } else if (ev.kind === "reaction") {
                    // リアクション更新: delta 経由で reactions 付きメッセージを回収
                    const active = get().activeChatId;
                    if (active === ev.chatMid) {
                      lastDeltaPollAt.delete(accountChatKey(accountId, ev.chatMid));
                      void get()
                        .pollMessagesDelta(ev.chatMid)
                        .catch(() => undefined);
                    }
                  }
                }
                for (const [chatId, msgs] of byChat) {
                  get().mergeIncomingMessages(chatId, msgs);
                }
              }
            }
          } catch {
            /* silent poll */
          }

          if (get().accountId !== accountId) return;
          const { activeChatId } = get();
          // push が機能しない環境の保険: アクティブチャットは delta で毎回取りこぼしを回収
          if (activeChatId) {
            // 遅い履歴 RPC で次の着信イベント取得を止めない。
            void get()
              .pollMessagesDelta(activeChatId)
              .catch(() => undefined);
          }
        })();

        pollIncomingInflight.set(accountId, task);
        void task
          .finally(() => {
            if (pollIncomingInflight.get(accountId) === task) {
              pollIncomingInflight.delete(accountId);
            }
          })
          .catch(() => undefined);
        return task;
      },
    }),
    {
      name: "vyline:store",
      partialize: (s) => ({
        theme: s.theme,
        settings: s.settings,
        sidebarWidth: s.sidebarWidth,
        customOrder: s.customOrder,
        drafts: s.drafts,
        draftSticons: s.draftSticons,
        draftMentions: s.draftMentions,
        seenUpdateVersion: s.seenUpdateVersion,
        readDisabledMids: s.readDisabledMids,
        blockedMids: s.blockedMids,
        lockedChatMids: s.lockedChatMids,
        readWatermarks: s.readWatermarks,
        chats: s.chats.map((c) => ({
          id: c.id,
          pinned: c.pinned,
          muted: c.muted,
          hidden: c.hidden,
          localName: c.localName,
          name: c.name && !looksLikeMid(c.name) ? c.name : undefined,
          avatarUrl: c.avatarUrl,
        })),
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.settings.animationMode ??= "vyline";
        state.settings.alwaysMuteMessages ??= false;
        state.settings.voiceMessagesEnabled ??= true;
        // 旧バージョンで永続化された選択も破棄し、起動時は必ず一覧の選択待ちにする。
        state.activeChatId = null;
        state.chatPaneIds = [];
        state.chatPaneSizes = [];
        state.focusedChatPane = 0;
        state.initialChatScrollMessageId = null;
        state.initialChatScrollMode = null;
        state.profileDrawerOpen = false;
        const unseen = state.seenUpdateVersion !== UPDATE_NOTES.version;
        state.showUpdateNote = unseen;
        if (state.theme) {
          const match =
            THEME_PRESETS.find((p) => p.id === state.theme.id) ??
            THEME_PRESETS.find(
              (p) =>
                p.accent === state.theme.accent &&
                p.bg === state.theme.bg &&
                p.msgOut === state.theme.msgOut,
            );
          if (match) state.theme = { ...match, ...state.theme, id: match.id, name: match.name };
        }
        if (unseen) {
          state.screen = "home";
        } else {
          state.screen = "chat";
        }
      },
    },
  ),
);

// CALL history also signals completion when CANCEL is missing or delayed. Observe
// both sides of the state so polling, hydration, delta, and replay share the rule.
useStore.subscribe((state, previous) => {
  const incoming = state.incomingCall;
  if (!incoming || (incoming === previous.incomingCall && state.messages === previous.messages)) {
    return;
  }
  if (
    state.messages.some(
      (message) =>
        message.kind === "call" &&
        message.chatId === incoming.chatMid &&
        Number.isFinite(message.createdAt) &&
        message.createdAt >= incoming.receivedAt,
    )
  ) {
    state.dismissIncomingCall();
  }
});

// ブラウザの戻る/進むでチャット履歴をたどる
if (
  typeof window !== "undefined" &&
  !(window as unknown as { __vyPopstateBound?: boolean }).__vyPopstateBound
) {
  (window as unknown as { __vyPopstateBound?: boolean }).__vyPopstateBound = true;
  window.addEventListener("popstate", (event) => {
    const id = (event.state as { chatId?: string | null } | null)?.chatId ?? null;
    const state = useStore.getState();
    if (!id || !state.chats.some((chat) => chat.id === id)) {
      useStore.setState({
        activeChatId: null,
        chatPaneIds: [],
        chatPaneSizes: [],
        focusedChatPane: 0,
        initialChatScrollMessageId: null,
        initialChatScrollMode: null,
        profileDrawerOpen: false,
      });
      return;
    }
    state._activateChat(id, { history: false });
  });
}

function initial(name: string): string {
  const t = (name || "?").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

export function displayName(chat: Chat, streamerMode: boolean): string {
  if (streamerMode) return chat.type === "group" ? "グループ" : "友だち";
  if (chat.isSelf) return "Keepメモ";
  const n = chat.localName || chat.name;
  if (!n || looksLikeMid(n)) return chat.type === "group" ? "グループ" : "友だち";
  return n;
}

export function memberDisplayName(name: string, streamerMode: boolean): string {
  if (streamerMode) return "メンバー";
  if (!name || looksLikeMid(name)) return "メンバー";
  return name;
}

export function memberGlyph(glyph: string, streamerMode: boolean): string {
  return streamerMode ? "•" : glyph;
}

/** 指定メンバーと共通のグループ（members が読み込まれているもの） */
export function commonGroupsWith(chats: Chat[], memberId: string, excludeChatId?: string): Chat[] {
  return chats.filter(
    (c) =>
      c.type === "group" && c.id !== excludeChatId && c.members?.some((m) => m.id === memberId),
  );
}

export function sortChats(
  list: Chat[],
  sort: ChatSort,
  messages: Message[],
  customOrder: string[],
): Chat[] {
  const lastTs = (id: string, chat?: Chat) => {
    const fromMsg = messages.filter((m) => m.chatId === id).slice(-1)[0]?.createdAt ?? 0;
    const fromApi = chat?.lastMessageTime ?? 0;
    return Math.max(fromMsg, fromApi);
  };
  const arr = [...list];
  if (sort === "custom") {
    arr.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ia = customOrder.indexOf(a.id);
      const ib = customOrder.indexOf(b.id);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  } else if (sort === "unread") {
    arr.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (b.unread !== a.unread) return b.unread - a.unread;
      return lastTs(b.id, b) - lastTs(a.id, a);
    });
  } else {
    // Desktop 準拠: API 返却順（getMessageBoxes）を維持。時刻再ソートしない
    arr.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });
  }
  return arr;
}

export const CHAT_SORT_LABELS: Record<ChatSort, string> = {
  recent: "最新順",
  unread: "未読順",
  custom: "カスタム順",
};

export function serializeTheme(t: VyTheme): string {
  return JSON.stringify({ ...t, id: "custom", name: t.name || "カスタム" });
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

// ウィンドウがフォーカス/可視になったらアクティブチャットの既読を再送（Desktop 準拠）
if (typeof window !== "undefined") {
  const resendReadOnFocus = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const st = useStore.getState();
    const id = st.activeChatId;
    if (id && st.settings.readReceipts && !st.readDisabledMids[id] && sessionOpenedChats.has(id)) {
      void st.markChatRead(id);
    }
  };
  window.addEventListener("focus", resendReadOnFocus);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", resendReadOnFocus);
  }
}

export { THEME_PRESETS };
