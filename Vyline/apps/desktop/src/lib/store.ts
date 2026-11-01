import { create } from "zustand";
import { persist } from "zustand/middleware";
import { indexedDbPersistStorage } from "./indexedDbStorage.js";
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
import { compressImageFile } from "../utils/compressImage.js";
import { setHiddenForAccount } from "../hooks/useHiddenChats.js";
import type { MessageState } from "./store-types.js";
import {
  countReceivedMessages,
  findLatestReceivedMessage,
  markReceivedMessagesReadThrough,
  resolveInitialUnreadScrollTarget,
  rollbackReceiptAttempt,
} from "./readReceiptSelection.js";
import { retainMessagesForChat } from "./chatMessageSelector.js";
import { shouldThrottleDeltaPoll } from "./deltaPollPolicy.js";

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
const readReceiptForceInflight = new Map<string, Promise<void>>();
const messageReactionCache = new Map<string, NonNullable<Message["reactions"]>>();
/** 既読ウォーターマークのキャッシュ有効時間 — 読み込み高速化のため毎回の既読取得を避ける */
const READ_WATERMARK_TTL_MS = 5_000;
const MAX_CACHED_READ_CHATS = 96;
/** accountId → Talk poll カーソル */
const eventPollCursor = new Map<string, number>();
/** accountId → 進行中の poll */
const pollIncomingInflight = new Map<string, Promise<void>>();
/** showNotice の自動消去タイマー */
const noticeTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };
/** chatId → refresh 遅延タイマー（連続送信時の refreshMessages 抑制） */
const refreshDebounce = new Map<string, ReturnType<typeof setTimeout>>();
/** accountId → delta 実行間隔制御 */
const lastDeltaPollAt = new Map<string, number>();
/** chatId → 進行中のギャップ backfill（重複抑止） */
const backfillInflight = new Map<string, Promise<void>>();
/** mid → プロフィール取得済み（重複 API 抑止） */
const contactFetched = new Set<string>();
/** このセッションでユーザーが明示的に開いた chatId（自動既読ガード） */
const sessionOpenedChats = new Set<string>();
/** 最近既読にした chat の時刻（サーバ反映前の未読上書き抑止） */
const recentlyReadAt = new Map<string, number>();
const RECENTLY_READ_WINDOW_MS = 60_000;

const accountChatKey = (accountId: string, chatId: string) => `${accountId}:${chatId}`;
export const accountDraftKey = (accountId: string | null, chatId: string) =>
  `${accountId ?? "anonymous"}:${chatId}`;
function indexReadIntervalsV4(
  intervals: Array<{ readerMid: string; startMessageId: string; endMessageId: string }>,
) {
  const byReader = new Map<string, Array<{ start: bigint; end: bigint }>>();
  for (const interval of intervals) {
    try {
      const rows = byReader.get(interval.readerMid) ?? [];
      rows.push({ start: BigInt(interval.startMessageId), end: BigInt(interval.endMessageId) });
      byReader.set(interval.readerMid, rows);
    } catch {
      /* malformed range */
    }
  }
  const index = new Map<string, { starts: bigint[]; prefixEnds: bigint[] }>();
  for (const [mid, rows] of byReader) {
    rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    let maxEnd = -1n;
    const prefixEnds = rows.map((row) => {
      if (row.end > maxEnd) maxEnd = row.end;
      return maxEnd;
    });
    index.set(mid, { starts: rows.map((row) => row.start), prefixEnds });
  }
  return index;
}

function readersAtMessageV4(
  index: Map<string, { starts: bigint[]; prefixEnds: bigint[] }>,
  messageId: bigint,
): string[] {
  const readers: string[] = [];
  for (const [mid, ranges] of index) {
    let low = 0;
    let high = ranges.starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges.starts[middle]! <= messageId) low = middle + 1;
      else high = middle;
    }
    if (low > 0 && ranges.prefixEnds[low - 1]! >= messageId) readers.push(mid);
  }
  return readers;
}

function createPendingMessageId(kind = ""): string {
  const unique =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pending_${kind ? `${kind}_` : ""}${unique}`;
}

function scheduleMessageRefresh(
  accountId: string,
  chatId: string,
  isAccountActive: () => boolean,
  refresh: () => void,
): void {
  const key = JSON.stringify([accountId, chatId]);
  const previous = refreshDebounce.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    if (refreshDebounce.get(key) !== timer) return;
    refreshDebounce.delete(key);
    if (isAccountActive()) refresh();
  }, 800);
  refreshDebounce.set(key, timer);
}

// push が機能しない環境でもアクティブチャットの受信を保証するための間隔
const DELTA_POLL_MIN_MS = 10_000;

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

function sendFailureStatus(result: { deliveryStatus?: string }): Message["status"] {
  if (result.deliveryStatus === "unknown") return "uncertain";
  if (result.deliveryStatus === "restricted") return "restricted";
  if (result.deliveryStatus === "rejected") return "rejected";
  return "failed";
}

function isDataUrl(value?: string): boolean {
  return typeof value === "string" && value.startsWith("data:");
}

function revokeObjectUrl(value?: string): void {
  if (typeof value === "string" && value.startsWith("blob:")) URL.revokeObjectURL(value);
}

function revokeMessageObjectUrls(messages: Message[]): void {
  for (const message of messages) {
    revokeObjectUrl(message.imageSrc);
    revokeObjectUrl(message.audioSrc);
  }
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
    readSnapshotV4?: {
      version: number;
      observedAt: string;
      stale: boolean;
      intervals: Array<{ readerMid: string; startMessageId: string; endMessageId: string }>;
    };
  },
  force: boolean,
): Map<string, Partial<Message>> | null {
  let changed = false;
  const patches = new Map<string, Partial<Message>>();

  if (cache.readSnapshotV4 && !cache.readSnapshotV4.stale) {
    const chatId = chatMessages[0]?.chatId ?? "";
    const selfMid = useStore.getState().self.mid;
    const index = indexReadIntervalsV4(cache.readSnapshotV4.intervals);
    for (const message of chatMessages) {
      if (
        message.authorId !== "me" ||
        message.id.startsWith("pending_") ||
        message.messageState.startsWith("revoked") ||
        (message.status !== "sent" && message.status !== "read")
      )
        continue;
      let messageId: bigint;
      try {
        messageId = BigInt(message.id);
      } catch {
        continue;
      }
      const readBy = readersAtMessageV4(index, messageId).filter((mid) =>
        chatId.startsWith("u") ? mid === chatId : mid !== selfMid,
      );
      const read = readBy.length > 0;
      const sameReaders =
        (message.readBy?.length ?? 0) === readBy.length &&
        readBy.every((mid) => message.readBy?.includes(mid));
      if (
        message.read !== read ||
        message.status !== (read ? "read" : "sent") ||
        (!chatId.startsWith("u") && ((message.readCount ?? 0) !== readBy.length || !sameReaders))
      ) {
        patches.set(message.id, {
          read,
          status: read ? "read" : "sent",
          ...(!chatId.startsWith("u") ? { readBy, readCount: readBy.length } : {}),
        });
        changed = true;
      }
    }
    return changed ? patches : null;
  }

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

  if (cache.memberWatermarks?.length) {
    for (const m of chatMessages) {
      if (m.authorId !== "me") continue;
      let idN: bigint;
      try {
        idN = BigInt(m.id);
      } catch {
        continue;
      }
      const readers = cache.memberWatermarks.filter((w) => {
        try {
          return BigInt(w.upTo) >= idN;
        } catch {
          return false;
        }
      });
      if (readers.length === 0) continue;
      const readBy = readers.map((w) => w.mid);
      const readCount = readBy.length;
      const prevReadBy = m.readBy ?? [];
      const prevReadCount = m.readCount ?? 0;
      // 既知の既読者より少なくならない範囲で補完（force 時は上書き）
      const nextReadBy = [...new Set([...prevReadBy, ...readBy])];
      if (force || readCount > prevReadCount || (readBy.length > 0 && prevReadBy.length === 0)) {
        patches.set(m.id, {
          read: true,
          status: "read",
          readBy: nextReadBy,
          readCount: Math.max(prevReadCount, readCount),
        });
        changed = true;
      }
    }
  }

  return changed ? patches : null;
}

function mergeReadWatermarks(
  current:
    | {
        peerReadUpTo?: string;
        memberWatermarks?: Array<{ mid: string; upTo: string }>;
        readSnapshotV4?: {
          version: number;
          observedAt: string;
          stale: boolean;
          intervals: Array<{
            readerMid: string;
            startMessageId: string;
            endMessageId: string;
            startTime?: string;
            endTime?: string;
          }>;
        };
      }
    | undefined,
  incoming: {
    peerReadUpTo?: string;
    memberReadWatermarks?: Array<{ mid: string; upTo: string }>;
    readSnapshotV4?: {
      version: number;
      observedAt: string;
      stale: boolean;
      intervals: Array<{
        readerMid: string;
        startMessageId: string;
        endMessageId: string;
        startTime?: string;
        endTime?: string;
      }>;
    };
  },
) {
  const maxId = (left?: string, right?: string) => {
    if (!left) return right;
    if (!right) return left;
    try {
      return BigInt(left) >= BigInt(right) ? left : right;
    } catch {
      return right;
    }
  };
  const members = new Map((current?.memberWatermarks ?? []).map((item) => [item.mid, item.upTo]));
  for (const item of incoming.memberReadWatermarks ?? []) {
    members.set(item.mid, maxId(members.get(item.mid), item.upTo)!);
  }
  return {
    ...(maxId(current?.peerReadUpTo, incoming.peerReadUpTo)
      ? { peerReadUpTo: maxId(current?.peerReadUpTo, incoming.peerReadUpTo) }
      : {}),
    ...(members.size
      ? { memberWatermarks: [...members].map(([mid, upTo]) => ({ mid, upTo })) }
      : {}),
    ...(incoming.readSnapshotV4 &&
    (!current?.readSnapshotV4 || incoming.readSnapshotV4.version >= current.readSnapshotV4.version)
      ? { readSnapshotV4: incoming.readSnapshotV4 }
      : current?.readSnapshotV4
        ? { readSnapshotV4: current.readSnapshotV4 }
        : {}),
  };
}

function messagePreview(m: Message): string {
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

export const UPDATE_NOTES = {
  version: "0.8.0-beta",
  title: "Vyline 0.8.0-beta — 設定・引継ぎ・同期安定化",
  items: [
    "Vyline Setup、アカウントごとの設定、改ざん検知付き設定引継ぎ、診断ログを追加",
    "Windows のセッション保護と、端末ごとに結び付くサブデバイス認証を強化",
    "未読位置・既読状態・仮想リストの同期を安定化し、開いたチャットの位置を復元",
  ],
};

/** 起動時にチャットを自動選択せず、明示的な有効選択だけを維持する。 */
export function resolveChatToOpen(
  _accountId: string | null,
  activeChatId: string | null,
  availableChatIds: readonly string[],
): string | null {
  return activeChatId && availableChatIds.includes(activeChatId) ? activeChatId : null;
}

type State = {
  screen: Screen;
  /** PRデモ用。true の間は実アカウント・外部APIを使用しない。 */
  demoMode: boolean;
  accountId: string | null;
  activeChatId: string | null;
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
  /** チャットを開くときの初期位置。未読の先頭、なければ末尾。 */
  initialChatScrollMessageId: string | null;
  /** 未読件数はチャットを開くと即時0になるため、初期位置確定まで保持する。 */
  initialChatScrollUnreadCount: number;
  /** 初回履歴が届くまで初期スクロールを確定しない。 */
  initialChatScrollPending: boolean;
  initialChatScrollMode: "unread" | "bottom" | null;
  showUpdateNote: boolean;
  seenUpdateVersion: string;
  profileDrawerOpen: boolean;
  self: SelfProfile;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  customOrder: string[];
  memberProfile: { chatId: string; memberId: string } | null;
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
      readSnapshotV4?: {
        version: number;
        observedAt: string;
        stale: boolean;
        intervals: Array<{
          readerMid: string;
          startMessageId: string;
          endMessageId: string;
          startTime?: string;
          endTime?: string;
        }>;
      };
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
    readyChatId: string | null;
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
  revokeMessage: (id: string) => Promise<void>;
  editMessage: (id: string, newText: string) => Promise<void>;
  toggleShowOriginal: (id: string) => void;
  retryMessage: (id: string) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markChatRead: (id: string, target?: string | { force?: boolean }) => Promise<void>;
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

  setTheme: (t: VyTheme) => void;
  updateThemeField: (field: keyof VyTheme, value: string | number) => void;
  updateSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  /** テーマ・設定・表示状態を初期値へ戻す（ログイン状態・チャット・メッセージは保持） */
  resetSettings: () => void;
  setLocalName: (chatId: string, name: string) => void;
  updateSelf: (patch: Partial<SelfProfile>) => void;

  refreshChats: () => Promise<void>;
  refreshChatsSilently: () => Promise<void>;
  refreshMessages: (chatId: string, opts?: { force?: boolean }) => Promise<void>;
  refreshReadReceipts: (chatId: string, opts?: { force?: boolean }) => Promise<void>;
  mergeIncomingMessages: (
    chatId: string,
    incoming: LineMessage[],
    opts?: { silent?: boolean },
  ) => void;
  applyRevoked: (chatId: string, messageId: string) => void;
  /** 取消し済みメッセージを履歴から復元 */
  restoreRevokedMessage: (chatId: string, messageId: string) => Promise<void>;
  /** 楽観リアクション更新（UNDO は自分の全リアクション除去） */
  setMessageReaction: (messageId: string, reaction: "UNDO" | string, myMid: string) => void;
  fetchMessageHistory: (chatId: string, messageId: string) => Promise<Message["history"]>;
  backfillChat: (chatId: string) => Promise<void>;
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
      theme: THEME_PRESETS[0]!,
      settings: {
        animationMode: "vyline",
        readReceipts: true,
        showReaderList: true,
        streamerMode: false,
        streamerMaskNames: true,
        streamerMaskAvatars: true,
        streamerMaskUrls: true,
        compactDensity: false,
        fontScale: 1,
        enterToSend: true,
        chatSort: "recent",
        bubbleTail: true,
        showStatusMessage: true,
        showBackground: true,
        highQualityImages: false,
        mediaAutoSave: true,
        linkPreviewLimit: 3,
        proxyEnabled: false,
        proxyUrl: "",
        notificationsEnabled: true,
        webNotificationsEnabled: false,
        hideNotificationContent: true,
        betaBlockCheckManual: false,
        betaBlockCheckAuto: false,
        betaMidSearch: false,
        betaAgentI: false,
        betaBlockedListSqliteSync: false,
        aiEnabled: true,
        betaWindowsLineTokens: false,
      },
      chats: [],
      messages: [],
      drafts: {},
      draftSticons: {},
      draftMentions: {},
      replyToId: null,
      highlightMessageId: null,
      initialChatScrollMessageId: null,
      initialChatScrollUnreadCount: 0,
      initialChatScrollPending: false,
      initialChatScrollMode: null,
      showUpdateNote: true,
      seenUpdateVersion: "",
      profileDrawerOpen: false,
      self: { name: "Vyline", avatar: "V", status: "" },
      sidebarWidth: 360,
      sidebarCollapsed: false,
      customOrder: [],
      memberProfile: null,
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
          readReceiptSent.clear();
          readReceiptInflight.clear();
          readReceiptForceInflight.clear();
          backfillInflight.clear();
          eventPollCursor.clear();
          pollIncomingInflight.clear();
          messageReactionCache.clear();
          recentlyReadAt.clear();
          for (const timer of refreshDebounce.values()) clearTimeout(timer);
          refreshDebounce.clear();
          lastDeltaPollAt.clear();
          sessionOpenedChats.clear();
        }
        if (accountChanged) {
          revokeMessageObjectUrls(get().messages);
          revokeObjectUrl(get().self.avatarUrl);
          revokeObjectUrl(get().self.backgroundUrl);
          // アカウント切替時に前アカウントの会話・既読・一時 UI を残さない。
          // 共有 MID をまたぐ表示漏れを防ぎ、後続 hydrate の正本を明確にする。
          set({
            accountId: id,
            activeChatId: null,
            chats: [],
            messages: [],
            loadingChats: false,
            loadingMessages: false,
            initialChatScrollMessageId: null,
            initialChatScrollUnreadCount: 0,
            initialChatScrollPending: false,
            initialChatScrollMode: null,
            memberProfile: null,
            readWatermarks: {},
            announcements: {},
            readDisabledMids: {},
            blockedMids: [],
            lockedChatMids: [],
          });
        } else {
          set({ accountId: id });
        }
        if (id) void get().syncChatLocks();
      },

      resetAccountData: () =>
        set((st) => {
          revokeMessageObjectUrls(st.messages);
          revokeObjectUrl(st.self.avatarUrl);
          revokeObjectUrl(st.self.backgroundUrl);
          eventPollCursor.clear();
          pollIncomingInflight.clear();
          messageReactionCache.clear();
          recentlyReadAt.clear();
          readReceiptSent.clear();
          readReceiptInflight.clear();
          readReceiptForceInflight.clear();
          backfillInflight.clear();
          lastDeltaPollAt.clear();
          sessionOpenedChats.clear();
          for (const timer of refreshDebounce.values()) clearTimeout(timer);
          refreshDebounce.clear();
          return {
            chats: [],
            messages: [],
            activeChatId: null,
            loadingChats: false,
            loadingMessages: false,
            profileDrawerOpen: false,
            memberProfile: null,
            announcements: {},
            drafts: {},
            draftSticons: {},
            draftMentions: {},
            replyToId: null,
            highlightMessageId: null,
            initialChatScrollMessageId: null,
            initialChatScrollUnreadCount: 0,
            initialChatScrollPending: false,
            initialChatScrollMode: null,
            customOrder: [],
            readDisabledMids: {},
            blockedMids: [],
            lockedChatMids: [],
            readWatermarks: {},
          };
        }),

      toggleChatReadDisabled: (id) => {
        set((st) => {
          const next = { ...st.readDisabledMids };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { readDisabledMids: next };
        });
        const st = get();
        if (
          !st.readDisabledMids[id] &&
          st.settings.readReceipts &&
          st.activeChatId === id &&
          sessionOpenedChats.has(id)
        ) {
          void st.markChatRead(id);
        }
      },

      syncBlockedMids: async () => {
        const { accountId, demoMode } = get();
        if (demoMode) return;
        if (!accountId) return;
        try {
          const res = await api.line.getBlockedContactIds(accountId);
          if (get().accountId !== accountId) return;
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
        get()._activateChat(id, { history: true });
      },

      _activateChat: (id, opts) => {
        const opts2 = opts ?? {};
        const current = get();
        const chatMessages = retainMessagesForChat(current.messages, id);
        const unreadCount = current.chats.find((chat) => chat.id === id)?.unread ?? 0;
        const unreadTarget = resolveInitialUnreadScrollTarget(chatMessages, id, null, unreadCount);
        set((st) => ({
          screen: "chat",
          activeChatId: id,
          messages: chatMessages,
          initialChatScrollMessageId: unreadTarget,
          initialChatScrollUnreadCount: unreadCount,
          initialChatScrollPending: Boolean(id),
          initialChatScrollMode: unreadTarget || unreadCount > 0 ? "unread" : "bottom",
          profileDrawerOpen: false,
          chats: st.chats.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
        }));
        const { accountId, settings, chats, demoMode, readDisabledMids } = get();
        if (
          !demoMode &&
          accountId &&
          settings.readReceipts &&
          !readDisabledMids[id] &&
          chatMessages.length > 0
        ) {
          void get().markChatRead(id);
        }
        if (accountId) {
          void api.line.getContact(accountId, id).catch(() => undefined);
          const chat = chats.find((c) => c.id === id);
          const mids =
            chat?.type === "group" ? (chat.members?.slice(0, 6).map((m) => m.id) ?? []) : [];
          for (const mid of mids) {
            void api.line.getContact(accountId, mid).catch(() => undefined);
          }
          void get().loadAnnouncements(id);
        }
        if (opts2.history && typeof window !== "undefined" && window.history) {
          const current = window.history.state as { chatId?: string } | null;
          if ((current?.chatId ?? null) !== id) {
            window.history.pushState({ chatId: id }, "");
          }
        }
      },

      closeChat: () =>
        set({
          activeChatId: null,
          messages: [],
          initialChatScrollMessageId: null,
          initialChatScrollUnreadCount: 0,
          initialChatScrollPending: false,
          initialChatScrollMode: null,
          profileDrawerOpen: false,
        }),

      loadAnnouncements: async (chatId) => {
        const { accountId } = get();
        if (!accountId) return;
        try {
          const res = await api.line.announce.getChatRoomAnnouncements(accountId, chatId);
          if (get().accountId !== accountId) return;
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
            streamerMaskNames: true,
            streamerMaskAvatars: true,
            streamerMaskUrls: true,
            compactDensity: false,
            fontScale: 1,
            enterToSend: true,
            chatSort: "recent",
            bubbleTail: true,
            showStatusMessage: true,
            showBackground: true,
            highQualityImages: false,
            mediaAutoSave: true,
            linkPreviewLimit: 3,
            proxyEnabled: false,
            proxyUrl: "",
            notificationsEnabled: true,
            webNotificationsEnabled: false,
            hideNotificationContent: true,
            betaBlockCheckManual: false,
            betaBlockCheckAuto: false,
            betaMidSearch: false,
            betaAgentI: false,
            betaBlockedListSqliteSync: false,
            aiEnabled: true,
            betaWindowsLineTokens: false,
          },
          sidebarWidth: 360,
          customOrder: [],
        }),

      hydrateLineData: ({ profile, chats, messages, readyChatId, hiddenMids, contactCache }) => {
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
        const previousChats = new Map(get().chats.map((chat) => [chat.id, chat]));
        const hiddenByPrev = new Map<string, boolean>();
        mappedChats.forEach((c) => {
          const prev = previousChats.get(c.id);
          if (prev) hiddenByPrev.set(c.id, prev.hidden ?? false);
        });

        const chatId =
          activeChatId && mappedChats.some((c) => c.id === activeChatId) ? activeChatId : null;
        // 1on1 の受信メッセージは from=相手(chatId)/to=自分 になるため、from 側も対象に含める
        const chatMessageFilter = (m: LineMessage) => !m.to || m.to === chatId || m.from === chatId;
        const mappedMessages =
          chatId && accountId
            ? messages
                .filter(chatMessageFilter)
                .map((m) =>
                  mapMessage(
                    m,
                    chatId,
                    accountId,
                    contactCache,
                    get().settings.mediaAutoSave ?? true,
                  ),
                )
            : [];
        if (chatId && accountId && mappedMessages.length > 0) {
          const previousById = new Map(get().messages.map((message) => [message.id, message]));
          for (const message of mappedMessages) {
            const previous = previousById.get(message.id);
            if (!previous) continue;
            const readBy = [...new Set([...(previous.readBy ?? []), ...(message.readBy ?? [])])];
            const readCount = Math.max(
              previous.readCount ?? 0,
              message.readCount ?? 0,
              readBy.length,
            );
            if (previous.read || previous.status === "read" || readCount > 0) {
              message.read = true;
              message.status = "read";
              if (readBy.length > 0) message.readBy = readBy;
              if (readCount > 0) message.readCount = readCount;
            }
          }
          const watermark = get().readWatermarks[accountChatKey(accountId, chatId)];
          if (watermark) {
            const patched = applyReadWatermarkLocal(mappedMessages, watermark, false);
            if (patched) {
              for (const message of mappedMessages) {
                const patch = patched.get(message.id);
                if (patch) Object.assign(message, patch);
              }
            }
          }
        }
        const resolveInitialScroll = Boolean(
          chatId &&
            readyChatId === chatId &&
            get().activeChatId === chatId &&
            get().initialChatScrollPending,
        );
        const initialUnreadCount = get().initialChatScrollUnreadCount;
        const hasUnreadWindow =
          mappedMessages.length === 0 ||
          initialUnreadCount <= countReceivedMessages(mappedMessages, chatId ?? "");
        const canResolveInitialScroll = resolveInitialScroll && hasUnreadWindow;
        const unreadScrollTarget = canResolveInitialScroll
          ? resolveInitialUnreadScrollTarget(
              mappedMessages,
              chatId!,
              get().initialChatScrollMessageId,
              initialUnreadCount,
            )
          : null;

        const members = buildMembersFromMessages(messages.filter(chatMessageFilter), contactCache);

        set((st) => ({
          chats: mappedChats
            .filter((c) => !dismissed.has(c.id) || restored.has(c.id))
            .map((c) => {
              const prev = previousChats.get(c.id);
              const mergedName =
                c.name && !looksLikeMid(c.name)
                  ? c.name
                  : prev?.name && !looksLikeMid(prev.name)
                    ? prev.name
                    : c.name;
              const hiddenFromPrev = hiddenByPrev.get(c.id);
              return prev
                ? {
                    ...c,
                    name: mergedName,
                    avatar: initial(mergedName),
                    avatarUrl: c.avatarUrl || prev.avatarUrl,
                    pinned: prev.pinned,
                    muted: prev.muted,
                    hidden: hiddenFromPrev ?? prev.hidden,
                    localName: prev.localName,
                    members: c.members ?? prev.members,
                  }
                : c;
            }),
          messages: (() => {
            if (!chatId) return st.messages;
            const existingChat = st.messages.filter((m) => m.chatId === chatId);
            const pending = existingChat.filter(
              (m) =>
                m.id.startsWith("pending_") ||
                m.status === "sending" ||
                m.status === "failed" ||
                m.status === "uncertain",
            );
            const merged = new Map<string, Message>();
            for (const m of existingChat) merged.set(m.id, m);
            for (const m of mappedMessages) {
              if (m.reactions?.length) messageReactionCache.set(m.id, m.reactions);
              else messageReactionCache.delete(m.id);
              merged.set(m.id, m);
            }
            for (const m of pending) {
              if (!merged.has(m.id)) merged.set(m.id, m);
            }
            const forChat = [...merged.values()].sort((a, b) => {
              if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
              return a.id.localeCompare(b.id);
            });
            return [...st.messages.filter((m) => m.chatId !== chatId), ...forChat];
          })(),
          activeChatId: chatId,
          ...(resolveInitialScroll
            ? {
                ...(canResolveInitialScroll
                  ? {
                      initialChatScrollMessageId: unreadScrollTarget,
                      initialChatScrollUnreadCount: 0,
                    }
                  : {}),
                initialChatScrollPending: !canResolveInitialScroll,
              }
            : {}),
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
                      const name =
                        m.name && !looksLikeMid(m.name)
                          ? m.name
                          : prev?.name && !looksLikeMid(prev.name)
                            ? prev.name
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
        if (
          resolveInitialScroll &&
          get().settings.readReceipts &&
          sessionOpenedChats.has(chatId!)
        ) {
          void get().markChatRead(chatId!);
        }
      },

      sendMessage: async (chatId, text, opts) => {
        const { accountId, demoMode, replyToId, blockedMids } = get();
        if (demoMode) {
          const trimmed = text;
          if (!trimmed.trim() && !trimmed.includes("\uFFFC")) return;
          const message: Message = {
            id: `demo_${Date.now()}`,
            chatId,
            authorId: "me",
            kind: "text",
            text: trimmed,
            createdAt: Date.now(),
            status: "read",
            read: true,
            messageState: "normal",
            replyToId: replyToId ?? undefined,
          };
          set((st) => ({
            messages: [...st.messages, message],
            drafts: { ...st.drafts, [accountDraftKey(st.accountId, chatId)]: "" },
            replyToId: null,
          }));
          get().showNotice("デモ送信（外部通信なし）");
          return;
        }
        if (!accountId || (!text.trim() && !text.includes("\uFFFC"))) return;
        // ブロック中の友だちには送信しない（DM の chatId は相手 MID）
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const trimmed = text; // 文中 sticon の前後空白を落とさない
        const relatedMessageId = replyToId ?? undefined;
        const tempId = createPendingMessageId();
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
          drafts: { ...st.drafts, [accountDraftKey(st.accountId, chatId)]: "" },
          replyToId: null,
        }));

        void (async () => {
          let res: Awaited<ReturnType<typeof api.line.sendMessage>>;
          try {
            res = await api.line.sendMessage(accountId!, chatId, trimmed, {
              relatedMessageId,
              contentMetadata: opts?.contentMetadata,
              mute: opts?.mute,
            });
            if (get().accountId !== accountId) return;
          } catch {
            if (get().accountId !== accountId) return;
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === tempId ? { ...m, status: "uncertain" } : m,
              ),
            }));
            return;
          }
          if (get().accountId !== accountId) return;
          if (!res.ok) {
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === tempId ? { ...m, status: sendFailureStatus(res) } : m,
              ),
            }));
            return;
          }
          if (res.message) {
            const contactCache = buildContactCache(get().chats);
            const mapped = mapMessage(
              res.message,
              chatId,
              accountId!,
              contactCache,
              get().settings.mediaAutoSave ?? true,
            );
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? mapped : m)),
              chats: st.chats.map((c) =>
                c.id === chatId
                  ? {
                      ...c,
                      lastMessagePreview: messagePreview(mapped),
                      lastMessageTime: Math.max(c.lastMessageTime ?? 0, mapped.createdAt),
                    }
                  : c,
              ),
            }));
          } else {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
            }));
          }
          scheduleMessageRefresh(
            accountId,
            chatId,
            () => get().accountId === accountId,
            () => {
              void get().refreshMessages(chatId, { force: true });
            },
          );
        })();
      },

      sendSticker: async (chatId, packageId, stickerId, isPremium?: boolean) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          if (!packageId || !stickerId) return;
          set((st) => ({
            messages: [
              ...st.messages,
              {
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
              },
            ],
          }));
          get().showNotice("デモスタンプ送信（外部通信なし）");
          return;
        }
        if (!accountId || !packageId || !stickerId) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const tempId = createPendingMessageId("sticker");
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
        set((st) => ({ messages: [...st.messages, optimistic] }));

        void (async () => {
          try {
            const res = await api.line.sendSticker(accountId!, chatId, {
              packageId,
              stickerId,
              ...(isPremium ? { isPremium: true } : {}),
            });
            if (get().accountId !== accountId) return;
            if (!res.ok) {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.id === tempId ? { ...m, status: sendFailureStatus(res) } : m,
                ),
              }));
              return;
            }
            if (res.message) {
              const contactCache = buildContactCache(get().chats);
              const mapped = mapMessage(
                res.message,
                chatId,
                accountId!,
                contactCache,
                get().settings.mediaAutoSave ?? true,
              );
              const finalMsg: Message = {
                ...mapped,
                kind: "sticker",
                sticker:
                  mapped.sticker?.startsWith("http") || mapped.sticker?.startsWith("/api/")
                    ? mapped.sticker
                    : lineStickerUrl(stickerId),
              };
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? finalMsg : m)),
                chats: st.chats.map((c) =>
                  c.id === chatId
                    ? {
                        ...c,
                        lastMessagePreview: "スタンプ",
                        lastMessageTime: Math.max(c.lastMessageTime ?? 0, finalMsg.createdAt),
                      }
                    : c,
                ),
              }));
            } else {
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
              }));
            }
            scheduleMessageRefresh(
              accountId,
              chatId,
              () => get().accountId === accountId,
              () => {
                void get().refreshMessages(chatId, { force: true });
              },
            );
          } catch {
            if (get().accountId !== accountId) return;
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === tempId ? { ...m, status: "uncertain" } : m,
              ),
            }));
          }
        })();
      },

      sendCombinationSticker: async (chatId, items) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          if (!items.length) return;
          set((st) => ({
            messages: [
              ...st.messages,
              {
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
              },
            ],
          }));
          get().showNotice("組み合わせスタンプをデモ送信しました");
          return;
        }
        if (!accountId || !items.length) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const placements = combinationPlacementsFromItems(items);
        const tempId = createPendingMessageId("combo");
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
        set((st) => ({ messages: [...st.messages, optimistic] }));

        void (async () => {
          try {
            const res = await api.line.sendCombinationSticker(accountId!, chatId, items);
            if (get().accountId !== accountId) return;
            if (!res.ok) {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.id === tempId ? { ...m, status: sendFailureStatus(res) } : m,
                ),
              }));
              return;
            }
            if (res.message) {
              // 送信レスポンスの実証用ログ（ID・キー名のみ。トークン等は出さない）
              try {
                const meta = (res.message.contentMetadata ?? null) as Record<
                  string,
                  unknown
                > | null;
                console.debug("[vyline] combination sticker sent", {
                  messageId: res.message.id,
                  metaKeys: meta ? Object.keys(meta) : null,
                  csstkId: typeof meta?.CSSTKID === "string" ? meta.CSSTKID : null,
                });
              } catch {
                /* ignore */
              }
              const contactCache = buildContactCache(get().chats);
              const mapped = mapMessage(
                res.message,
                chatId,
                accountId!,
                contactCache,
                get().settings.mediaAutoSave ?? true,
              );
              // 履歴表示は CSSTKID / メッセージID のどちらでもプレビューを引けるよう両方保存
              const preview = await persistCombinationStickerPreview(
                accountId!,
                res.message,
                placements,
              );
              if (get().accountId !== accountId) return;
              const finalMsg: Message = {
                ...mapped,
                kind: "sticker",
                sticker: preview || mapped.sticker || "🧩",
              };
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? finalMsg : m)),
                chats: st.chats.map((c) =>
                  c.id === chatId
                    ? {
                        ...c,
                        lastMessagePreview: "スタンプ",
                        lastMessageTime: Math.max(c.lastMessageTime ?? 0, finalMsg.createdAt),
                      }
                    : c,
                ),
              }));
            } else {
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
              }));
            }
            scheduleMessageRefresh(
              accountId,
              chatId,
              () => get().accountId === accountId,
              () => {
                void get().refreshMessages(chatId, { force: true });
              },
            );
          } catch {
            if (get().accountId !== accountId) return;
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === tempId ? { ...m, status: "uncertain" } : m,
              ),
            }));
          }
        })();
      },

      sendLineEmoji: async (chatId, packageId, sticonId) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          if (!packageId || !sticonId) return;
          set((st) => ({
            messages: [
              ...st.messages,
              {
                id: `demo_emoji_${Date.now()}`,
                chatId,
                authorId: "me",
                kind: "emoji",
                text: sticonId === "smile" ? "😊" : "✨",
                createdAt: Date.now(),
                status: "read",
                read: true,
                messageState: "normal",
              },
            ],
          }));
          get().showNotice("LINE絵文字をデモ送信しました");
          return;
        }
        if (!accountId || !packageId || !sticonId) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;

        const tempId = createPendingMessageId("emoji");
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
        set((st) => ({ messages: [...st.messages, optimistic] }));

        void (async () => {
          try {
            const res = await api.line.sendEmoji(accountId!, chatId, {
              packageId,
              sticonId,
            });
            if (get().accountId !== accountId) return;
            if (res.ok) {
              set((st) => ({
                messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "sent" } : m)),
              }));
              scheduleMessageRefresh(
                accountId,
                chatId,
                () => get().accountId === accountId,
                () => {
                  void get().refreshMessages(chatId, { force: true });
                },
              );
            } else {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.id === tempId ? { ...m, status: sendFailureStatus(res) } : m,
                ),
              }));
            }
          } catch {
            if (get().accountId !== accountId) return;
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === tempId ? { ...m, status: "uncertain" } : m,
              ),
            }));
          }
        })();
      },

      sendImageFile: async (chatId, file) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          const isVideo = file.type.startsWith("video/");
          const localUrl = URL.createObjectURL(file);
          set((st) => ({
            messages: [
              ...st.messages,
              {
                id: `demo_media_${Date.now()}`,
                chatId,
                authorId: "me",
                kind: isVideo ? "video" : "image",
                imageSrc: localUrl,
                createdAt: Date.now(),
                status: "read",
                read: true,
                messageState: "normal",
              },
            ],
          }));
          get().showNotice(`${isVideo ? "動画" : "画像"}をデモ送信しました`);
          return;
        }
        if (!accountId) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const isVideo = file.type.startsWith("video/");
        const tempId = createPendingMessageId(isVideo ? "video" : "image");
        const localUrl = URL.createObjectURL(file);
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
        set((st) => ({ messages: [...st.messages, optimistic] }));
        let uploadStarted = false;
        try {
          const highQuality = get().settings.highQualityImages;
          const { blob, mime } = highQuality
            ? { blob: file, mime: file.type || "application/octet-stream" }
            : await compressImageFile(file);
          if (blob.size > 11_000_000) {
            window.alert(
              blob === file
                ? "ファイルが大きすぎます（11MB まで）"
                : "画像が大きすぎます（圧縮後も 11MB 超）",
            );
            set((st) => ({ messages: st.messages.filter((m) => m.id !== tempId) }));
            return;
          }
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const dataBase64 = btoa(binary);
          uploadStarted = true;
          const filename =
            !isVideo && mime === "image/jpeg" && blob !== file
              ? `${(file.name || "image").replace(/\.[^.]+$/, "")}.jpg`
              : file.name || (isVideo ? "video.mp4" : "image.jpg");
          const res = await api.line.sendMedia(accountId!, chatId, dataBase64, {
            mimeType: mime,
            filename,
            mediaType: isVideo ? "video" : "image",
          });
          if (get().accountId !== accountId) return;
          if (res.ok) {
            scheduleMessageRefresh(
              accountId,
              chatId,
              () => get().accountId === accountId,
              () => {
                void get().refreshMessages(chatId, { force: true });
              },
            );
          } else {
            set((st) => ({
              messages:
                res.deliveryStatus === "unknown"
                  ? st.messages.map((m) => (m.id === tempId ? { ...m, status: "uncertain" } : m))
                  : st.messages.filter((m) => m.id !== tempId),
            }));
          }
        } catch {
          if (get().accountId !== accountId) return;
          set((st) => ({
            messages: uploadStarted
              ? st.messages.map((m) => (m.id === tempId ? { ...m, status: "uncertain" } : m))
              : st.messages.filter((m) => m.id !== tempId),
          }));
        } finally {
          // 送信完了後にローカルURLを解放（60s 後でも安全な間隔）
          setTimeout(() => URL.revokeObjectURL(localUrl), 60_000);
        }
      },

      sendAudio: async (chatId, seconds, blob) => {
        const { accountId, demoMode, blockedMids } = get();
        if (demoMode) {
          const localUrl = URL.createObjectURL(blob);
          set((st) => ({
            messages: [
              ...st.messages,
              {
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
              },
            ],
          }));
          get().showNotice("音声メッセージをデモ送信しました");
          return;
        }
        if (!accountId || !blob || blob.size === 0) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        void (async () => {
          let requestStarted = false;
          try {
            const buf = await blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            const dataBase64 = btoa(binary);
            const mime = blob.type || "audio/webm";
            const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
            requestStarted = true;
            const res = await api.line.sendMedia(accountId!, chatId, dataBase64, {
              mimeType: mime,
              filename: `voice-${seconds}s.${ext}`,
              mediaType: "audio",
            });
            if (get().accountId !== accountId) return;
            if (!res.ok) {
              window.alert(
                res.deliveryStatus === "unknown"
                  ? "音声メッセージの送信結果を確認できません。トーク履歴を更新して確認してください。"
                  : (res.error ?? "音声メッセージの送信に失敗しました"),
              );
              return;
            }
            scheduleMessageRefresh(
              accountId,
              chatId,
              () => get().accountId === accountId,
              () => {
                void get().refreshMessages(chatId, { force: true });
              },
            );
          } catch {
            if (get().accountId !== accountId) return;
            window.alert(
              requestStarted
                ? "音声メッセージの送信結果を確認できません。トーク履歴を更新して確認してください。"
                : "音声メッセージを送信する前の準備に失敗しました。",
            );
          }
        })();
      },

      revokeMessage: async (id) => {
        const { accountId, activeChatId, demoMode } = get();
        if (!accountId && !demoMode) return;
        const msg = get().messages.find((m) => m.id === id);
        // 未送信・失敗・送信中のメッセージはサーバ側に取消対象がない。
        if (!msg || (msg.status !== "sent" && msg.status !== "read") || id.startsWith("pending_")) {
          get().showNotice(
            msg?.status === "failed"
              ? "送信失敗のメッセージは取り消せません。再送してください"
              : "送信が完了してから取り消しできます",
          );
          return;
        }
        if (msg.messageState.startsWith("revoked") || msg.revokedSnapshot) {
          get().showNotice("一度取り消したメッセージは再度取り消せません");
          return;
        }
        const isPremium = Boolean(get().self.premium?.active);
        if (!demoMode && !canUnsendMessage(msg.createdAt, isPremium)) {
          get().showNotice(
            isPremium
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
          get().showNotice("メッセージをデモ取り消ししました");
          return;
        }
        let errText = "";
        try {
          const res = await api.line.unsendMessage(accountId!, id);
          if (get().accountId !== accountId) return;
          if (!res.ok) throw new Error(res.error || "取り消しに失敗しました");
        } catch (err) {
          if (get().accountId !== accountId) return;
          set((st) => ({
            messages: st.messages.map((m) =>
              m.id === id && m.messageState === "revoked-by-self" ? msg : m,
            ),
          }));
          errText = err instanceof Error ? err.message : String(err);
          if (
            errText.includes("MESSAGE_NOT_DESTRUCTIBLE") ||
            errText.includes("message too old") ||
            errText.includes("too old")
          ) {
            get().showNotice("送信取り消しできません（送信取り消し可能な時間を過ぎています）");
          } else {
            get().showNotice(errText || "取り消しに失敗しました");
          }
          return;
        }
        if (get().accountId !== accountId) return;
        const currentChatId = get().activeChatId ?? activeChatId;
        if (currentChatId) await get().refreshMessages(currentChatId, { force: true });
      },

      editMessage: async (id, newText) => {
        const { accountId, activeChatId, demoMode } = get();
        if (!accountId && !demoMode) return;
        // 送信中の楽観メッセージは編集できない
        const msg = get().messages.find((m) => m.id === id);
        if (!msg || msg.status === "sending" || id.startsWith("pending_")) {
          window.alert("送信が完了してから編集できます");
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
          if (get().accountId !== accountId) return;
          if (res.ok) {
            get().showNotice("メッセージを編集しました");
            const currentChatId = get().activeChatId ?? activeChatId;
            if (currentChatId) await get().refreshMessages(currentChatId, { force: true });
          } else {
            // 失敗時はロールバック
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === id ? { ...m, text: prevText, edited: msg.edited } : m,
              ),
            }));
            window.alert(res.error ?? "メッセージの編集に失敗しました");
          }
        } catch (err) {
          if (get().accountId !== accountId) return;
          // 失敗時はロールバック
          set((st) => ({
            messages: st.messages.map((m) =>
              m.id === id ? { ...m, text: prevText, edited: msg.edited } : m,
            ),
          }));
          window.alert(`メッセージの編集に失敗しました: ${String(err)}`);
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
          (msg.status !== "failed" && msg.status !== "uncertain") ||
          msg.messageState.startsWith("revoked") ||
          !msg.retry
        )
          return;
        const chatId = msg.chatId;
        const intent = msg.retry;
        set((st) => ({
          messages: st.messages.map((m) => (m.id === id ? { ...m, status: "sending" } : m)),
        }));
        const markFailed = (status: Message["status"] = "failed") => {
          if (get().accountId !== accountId) return;
          set((st) => ({
            messages: st.messages.map((m) => (m.id === id ? { ...m, status } : m)),
          }));
        };
        try {
          let ok = false;
          let failureStatus: Message["status"] = "failed";
          let confirmed: LineMessage | null = null;
          if (intent.kind === "text") {
            const res = await api.line.sendMessage(accountId, chatId, intent.text, {
              relatedMessageId: intent.relatedMessageId,
              contentMetadata: intent.contentMetadata,
            });
            ok = res.ok;
            if (!res.ok) failureStatus = sendFailureStatus(res);
            confirmed = res.ok ? (res.message ?? null) : null;
          } else if (intent.kind === "sticker") {
            const res = await api.line.sendSticker(accountId, chatId, {
              packageId: intent.packageId,
              stickerId: intent.stickerId,
              isPremium: intent.isPremium,
            });
            ok = res.ok;
            if (!res.ok) failureStatus = sendFailureStatus(res);
            confirmed = res.ok ? (res.message ?? null) : null;
          } else if (intent.kind === "emoji") {
            const res = await api.line.sendEmoji(accountId, chatId, {
              packageId: intent.packageId,
              sticonId: intent.sticonId,
            });
            ok = res.ok;
            if (!res.ok) failureStatus = sendFailureStatus(res);
          } else if (intent.kind === "combinationSticker") {
            const res = await api.line.sendCombinationSticker(accountId, chatId, intent.items);
            ok = res.ok;
            if (!res.ok) failureStatus = sendFailureStatus(res);
            confirmed = res.ok ? (res.message ?? null) : null;
          }
          if (get().accountId !== accountId) return;
          if (ok && confirmed && intent.kind === "combinationSticker") {
            // 再送でも送信時と同じくローカルプレビューを保存（mapMessage が CSSTKID/メッセージIDで引ける）
            await persistCombinationStickerPreview(
              accountId,
              confirmed,
              combinationPlacementsFromItems(intent.items),
            );
            if (get().accountId !== accountId) return;
          }
          if (!ok) {
            markFailed(failureStatus);
            return;
          }
          if (confirmed) {
            const contactCache = buildContactCache(get().chats);
            const mapped = mapMessage(
              confirmed,
              chatId,
              accountId,
              contactCache,
              get().settings.mediaAutoSave ?? true,
            );
            // 重い refreshMessages(force) は同期を止め得るため、確認済みメッセージで直接反映
            set((st) => ({
              messages: st.messages.map((m) =>
                m.id === id ? { ...m, ...mapped, id: mapped.id } : m,
              ),
              chats: st.chats.map((c) =>
                c.id === chatId
                  ? {
                      ...c,
                      lastMessagePreview: messagePreview(mapped),
                      lastMessageTime: Math.max(c.lastMessageTime ?? 0, mapped.createdAt),
                    }
                  : c,
              ),
            }));
          } else {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === id ? { ...m, status: "sent" } : m)),
            }));
          }
        } catch {
          markFailed("uncertain");
        }
      },

      markRead: async (messageId) => {
        const { activeChatId } = get();
        if (!activeChatId) return;
        await get().markChatRead(activeChatId, messageId);
      },

      markChatRead: async (id, target) => {
        const force = typeof target === "object" && target?.force === true;
        const requestedMessageId = typeof target === "string" ? target : undefined;
        const { accountId, messages, settings, readDisabledMids, demoMode } = get();
        const latest = findLatestReceivedMessage(messages, id);
        const last =
          (requestedMessageId
            ? messages.find(
                (message) =>
                  message.chatId === id &&
                  message.id === requestedMessageId &&
                  message.authorId !== "me" &&
                  !message.id.startsWith("pending_"),
              )
            : undefined) ?? latest;
        const localKey = accountId ? accountChatKey(accountId, id) : null;
        if (localKey) recentlyReadAt.set(localKey, Date.now());
        set((st) => {
          const nextMessages = last
            ? markReceivedMessagesReadThrough(st.messages, id, last)
            : st.messages;
          const hasUnreadChat = st.chats.some((chat) => chat.id === id && chat.unread !== 0);
          if (nextMessages === st.messages && !hasUnreadChat) return st;
          return {
            chats: hasUnreadChat
              ? st.chats.map((chat) => (chat.id === id ? { ...chat, unread: 0 } : chat))
              : st.chats,
            messages: nextMessages,
          };
        });
        if (demoMode) return;
        if (!accountId || (!force && (!settings.readReceipts || readDisabledMids[id]))) return;
        const lastId = last?.id;
        // 同じ最終メッセージへの既読は再送しない
        const receiptKey = accountChatKey(accountId, id);
        const prev = readReceiptSent.get(receiptKey);
        if (!force && lastId && prev === lastId) return;
        if (lastId) readReceiptSent.set(receiptKey, lastId);
        try {
          const result = await api.line.sendChatChecked(accountId, id, lastId);
          if (!result.ok) throw new Error("既読の送信に失敗しました");
        } catch {
          if (lastId) rollbackReceiptAttempt(readReceiptSent, receiptKey, lastId);
          if (localKey) recentlyReadAt.delete(localKey);
          if (force) {
            get().showNotice(
              "既読を送信できませんでした。接続を確認して、もう一度お試しください。",
            );
          }
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
              await api.line.sendChatChecked(accountId, chatId);
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

      setDraft: (chatId, text) =>
        set((st) => ({
          drafts: { ...st.drafts, [accountDraftKey(st.accountId, chatId)]: text },
        })),

      setDraftSticons: (chatId, sticons) =>
        set((st) => ({
          draftSticons: {
            ...st.draftSticons,
            [accountDraftKey(st.accountId, chatId)]: sticons,
          },
        })),

      setDraftMentions: (chatId, mentions) =>
        set((st) => ({
          draftMentions: {
            ...st.draftMentions,
            [accountDraftKey(st.accountId, chatId)]: mentions,
          },
        })),

      setReplyTo: (messageId) => set({ replyToId: messageId }),

      scrollToMessage: (messageId) => {
        // chat-area が highlightMessageId を監視して仮想リスト内をスクロールする
        set({ highlightMessageId: messageId });
      },

      openDirectChatWith: (memberMid) => {
        if (!memberMid.startsWith("u")) return;
        sessionOpenedChats.add(memberMid);
        const chatMessages = retainMessagesForChat(get().messages, memberMid);
        const unreadCount = get().chats.find((chat) => chat.id === memberMid)?.unread ?? 0;
        const unreadTarget = resolveInitialUnreadScrollTarget(
          chatMessages,
          memberMid,
          null,
          unreadCount,
        );
        set({
          memberProfile: null,
          profileDrawerOpen: false,
          screen: "chat",
          activeChatId: memberMid,
          messages: chatMessages,
          initialChatScrollMessageId: unreadTarget,
          initialChatScrollUnreadCount: unreadCount,
          initialChatScrollPending: true,
          initialChatScrollMode: unreadTarget || unreadCount > 0 ? "unread" : "bottom",
        });
        const { accountId, settings, readDisabledMids, demoMode } = get();
        if (
          !demoMode &&
          accountId &&
          settings.readReceipts &&
          !readDisabledMids[memberMid] &&
          chatMessages.length > 0
        ) {
          void get().markChatRead(memberMid);
        }
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

      setTheme: (t) => set({ theme: { ...t } }),
      updateThemeField: (field, value) =>
        set((st) => ({
          theme: { ...st.theme, [field]: value, id: "custom", name: "カスタム" },
        })),
      updateSetting: (k, v) => {
        set((st) => ({ settings: { ...st.settings, [k]: v } }));
        if (k === "aiEnabled") {
          try {
            localStorage.setItem("vyline:ai-enabled-v1", v ? "1" : "0");
          } catch {
            /* app remains disabled only for this session */
          }
        }
        if (k === "readReceipts" && v === true) {
          const st = get();
          if (st.activeChatId && sessionOpenedChats.has(st.activeChatId)) {
            void st.markChatRead(st.activeChatId);
          }
        }
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
          if (get().accountId === accountId) set({ loadingChats: false });
        }
      },

      refreshChatsSilently: async () => {
        const { accountId } = get();
        if (!accountId) return;
        try {
          const res = await api.line.getMessageBoxes(accountId, { light: true, refresh: true });
          if (get().accountId !== accountId) return;
          if (res.ok && res.chats) {
            const hidden = new Set(
              get()
                .chats.filter((c) => c.hidden)
                .map((c) => c.id),
            );
            const dismissed = getDismissedChatMids(accountId);
            const restored = new Set(getRestoredChatMids(accountId));
            set((st) => ({
              chats: res.chats
                .filter((c) => (!dismissed.has(c.mid) || restored.has(c.mid)) && !c.left)
                .map((c) => {
                  const base = mapChat(c, hidden.has(c.mid));
                  const prev = st.chats.find((p) => p.id === c.mid);
                  const name =
                    base.name && !looksLikeMid(base.name)
                      ? base.name
                      : prev?.name && !looksLikeMid(prev.name)
                        ? prev.name
                        : base.name;
                  const recentlyKey = accountChatKey(accountId, c.mid);
                  const recentAt = recentlyReadAt.get(recentlyKey);
                  const isRecentlyRead =
                    recentAt != null && Date.now() - recentAt < RECENTLY_READ_WINDOW_MS;
                  const serverUnread = c.unreadCount ?? prev?.unread ?? 0;
                  const nextUnread =
                    isRecentlyRead && serverUnread > 0 && st.activeChatId !== c.mid
                      ? 0
                      : serverUnread;
                  return prev
                    ? {
                        ...base,
                        name,
                        avatar: initial(name),
                        avatarUrl: base.avatarUrl || prev.avatarUrl,
                        pinned: prev.pinned,
                        muted: prev.muted,
                        hidden: prev.hidden,
                        localName: prev.localName,
                        members: prev.members,
                        unread: st.activeChatId === c.mid ? 0 : nextUnread,
                        lastMessagePreview:
                          c.lastMessagePreview && c.lastMessagePreview !== "暗号化メッセージ"
                            ? c.lastMessagePreview
                            : prev.lastMessagePreview,
                        lastMessageTime: c.lastMessageTime ?? prev.lastMessageTime,
                      }
                    : base;
                }),
            }));
          }
        } catch {
          /* silent */
        }
      },

      refreshMessages: async (chatId, opts) => {
        const { accountId } = get();
        if (!accountId || !chatId) return;
        const showLoading = !get().messages.some((m) => m.chatId === chatId);
        if (showLoading) set({ loadingMessages: true });
        try {
          const res = await api.line.getPreviousMessagesV2WithRequest(accountId, chatId, 50, {
            force: opts?.force === true,
          });
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
            const mapped = asc.map((m) =>
              mapMessage(m, chatId, accountId, contactCache, get().settings.mediaAutoSave ?? true),
            );
            const members = buildMembersFromMessages(asc, contactCache);
            set((st) => {
              const mappedIds = new Set(mapped.map((m) => m.id));
              const existingChat = st.messages.filter((m) => m.chatId === chatId);
              const prevById = new Map(existingChat.map((m) => [m.id, m]));
              // 既読フラグ・既読者リストは一度取得できたらサーバ欠落でも落とさない
              for (let i = 0; i < mapped.length; i++) {
                const m = mapped[i]!;
                const prev = prevById.get(m.id);
                if (m.authorId === "me" && prev?.read && !m.read) {
                  mapped[i] = {
                    ...m,
                    read: true,
                    status: "read",
                    readBy: m.readBy?.length ? m.readBy : prev.readBy,
                    readCount: m.readCount ?? prev.readCount,
                  };
                } else if (
                  m.authorId === "me" &&
                  prev?.readBy?.length &&
                  (!m.readBy?.length || !m.read)
                ) {
                  mapped[i] = {
                    ...m,
                    read: true,
                    readBy: prev.readBy,
                    readCount: m.readCount ?? prev.readCount,
                  };
                } else if (
                  m.authorId === "me" &&
                  prev?.readBy?.length &&
                  m.readBy?.length &&
                  prev.readBy.length > m.readBy.length
                ) {
                  mapped[i] = {
                    ...m,
                    read: true,
                    readBy: prev.readBy,
                    readCount: m.readCount ?? prev.readCount,
                  };
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
              const keep = existingChat.filter((m) => {
                if (mappedIds.has(m.id)) return false;
                if (
                  m.id.startsWith("pending_") ||
                  m.status === "sending" ||
                  m.status === "failed" ||
                  m.status === "uncertain"
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
                    // 送信直後の楽観画像は、確定メッセージが届いたら破棄（2 分以内）
                    return !mapped.some(
                      (x) =>
                        x.authorId === "me" &&
                        (x.kind === "image" || x.kind === "video") &&
                        Math.abs(x.createdAt - m.createdAt) < 120_000,
                    );
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
              return {
                messages:
                  st.activeChatId === chatId
                    ? [...st.messages.filter((m) => m.chatId !== chatId), ...forChat]
                    : st.messages,
                chats: st.chats.map((c) =>
                  c.id === chatId && c.type === "group"
                    ? {
                        ...c,
                        members: members.map((m) => {
                          const prev = c.members?.find((p) => p.id === m.id);
                          const name =
                            m.name && !looksLikeMid(m.name)
                              ? m.name
                              : prev?.name && !looksLikeMid(prev.name)
                                ? prev.name
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
            if (get().activeChatId === chatId && sessionOpenedChats.has(chatId)) {
              if (get().settings.readReceipts) void get().markChatRead(chatId);
              // 既読送信をOFFにしても、自分の送信メッセージの既読状態取得は継続する。
              void get().refreshReadReceipts(chatId);
            }
          }
        } finally {
          if (showLoading && get().accountId === accountId) set({ loadingMessages: false });
        }
      },

      refreshReadReceipts: async (chatId, opts) => {
        const accountId = get().accountId;
        if (!accountId) return;
        const chatKey = accountChatKey(accountId, chatId);
        const inflight = readReceiptInflight.get(chatKey);
        if (inflight) {
          if (!opts?.force) return inflight;
          const forced = readReceiptForceInflight.get(chatKey);
          if (forced) return forced;
          const followup = inflight.then(() =>
            get().accountId === accountId
              ? get().refreshReadReceipts(chatId, { force: true })
              : undefined,
          );
          readReceiptForceInflight.set(chatKey, followup);
          const clearForced = () => {
            if (readReceiptForceInflight.get(chatKey) === followup) {
              readReceiptForceInflight.delete(chatKey);
            }
          };
          void followup.then(clearForced, clearForced);
          return followup;
        }

        let task!: Promise<void>;
        task = (async () => {
          const { messages } = get();
          const chatMessages = messages.filter((m) => m.chatId === chatId);
          const myMessages = chatMessages.filter(
            (m) =>
              m.authorId === "me" &&
              !m.id.startsWith("pending_") &&
              !m.messageState.startsWith("revoked"),
          );
          if (myMessages.length === 0) return;

          // DM は未読の自分の送信を相手が読むまで追跡する。
          // グループは既読者が増える可能性があるため、直近15分を追跡する。
          const needsPoll = myMessages.some((m) => {
            if (chatId.startsWith("u")) return !m.read && m.status !== "read";
            return Date.now() - m.createdAt < 15 * 60_000;
          });

          // キャッシュ済みウォーターマークがあれば先にローカル適用（読み込み高速化）
          // needsPoll に関係なく適用する（古いチャットを開き直したときも既読状態を即反映）
          const cached = get().readWatermarks[chatKey];
          if (cached) {
            const patched = applyReadWatermarkLocal(chatMessages, cached, opts?.force === true);
            if (patched) {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.chatId === chatId && patched.get(m.id) ? { ...m, ...patched.get(m.id) } : m,
                ),
              }));
            }
            // 強制でなければ、かつキャッシュが新しければ RPC を飛ばさない
            if (Date.now() - cached.at < READ_WATERMARK_TTL_MS && !opts?.force) return;
          }

          if (!needsPoll) return;

          const myIds = myMessages.map((message) => message.id);
          const res = await api.line.getMessageReadRange(accountId, chatId, myIds, {
            force: opts?.force === true,
          });
          if (get().accountId !== accountId) return;
          if (!res.ok || !res.receipts) return;

          const watermark = mergeReadWatermarks(get().readWatermarks[chatKey], res);
          set((st) => ({
            readWatermarks: Object.fromEntries(
              Object.entries({
                ...st.readWatermarks,
                [chatKey]: { ...watermark, at: Date.now() },
              })
                .sort(([, left], [, right]) => right.at - left.at)
                .slice(0, MAX_CACHED_READ_CHATS),
            ),
          }));

          // 既読者 MID のプロフィールを事前取得（メンバー一覧を開かなくても名前表示）
          const allReaderMids = new Set<string>();
          for (const item of watermark.memberWatermarks ?? []) allReaderMids.add(item.mid);
          const memberMidSet = new Set(
            get()
              .chats.find((chat) => chat.id === chatId)
              ?.members?.map((member) => member.id) ?? [],
          );
          const readersNeedFetch: string[] = [];
          for (const mid of allReaderMids) {
            const contactKey = accountChatKey(accountId, mid);
            if (contactFetched.has(contactKey)) continue;
            if (memberMidSet.has(mid)) continue;
            contactFetched.add(contactKey);
            readersNeedFetch.push(mid);
          }
          if (readersNeedFetch.length > 0) {
            void api.line.warmCache(accountId, readersNeedFetch).then((warmRes) => {
              if (!warmRes.ok || !warmRes.profiles) return;
              const profiles = warmRes.profiles;
              set((st) => ({
                chats: st.chats.map((c) => {
                  if (c.id !== chatId) return c;
                  const members = [...(c.members ?? [])];
                  for (const mid of readersNeedFetch) {
                    const profile = profiles[mid];
                    if (!profile) continue;
                    const name = (profile as { displayName?: string }).displayName ?? mid;
                    const avatarUrl = (profile as { thumbnailUrl?: string }).thumbnailUrl;
                    const i = members.findIndex((x) => x.id === mid);
                    if (i >= 0) {
                      members[i] = {
                        ...members[i]!,
                        name: name && !looksLikeMid(name) ? name : members[i]!.name,
                        avatarUrl: avatarUrl || members[i]!.avatarUrl,
                      };
                    } else {
                      members.push(mapMember(mid, name, avatarUrl));
                    }
                  }
                  return { ...c, members };
                }),
              }));
            });
          }

          const patched = applyReadWatermarkLocal(chatMessages, watermark, opts?.force === true);
          if (patched) {
            set((st) => ({
              messages: st.messages.map((message) => {
                const patch = message.chatId === chatId ? patched.get(message.id) : undefined;
                return patch ? { ...message, ...patch } : message;
              }),
            }));
          }
        })();

        readReceiptInflight.set(chatKey, task);
        const clearInflight = () => {
          if (readReceiptInflight.get(chatKey) === task) {
            readReceiptInflight.delete(chatKey);
          }
        };
        void task.then(clearInflight, clearInflight);
        return task;
      },

      mergeIncomingMessages: (chatId, incoming, opts) => {
        const { accountId, activeChatId, messages, chats } = get();
        if (!accountId || incoming.length === 0) return;

        const silent = opts?.silent === true;
        const contactCache = buildContactCache(chats);
        const mapped = incoming.map((m) =>
          mapMessage(m, chatId, accountId, contactCache, get().settings.mediaAutoSave ?? true),
        );
        const incomingById = new Map(mapped.map((m) => [m.id, m]));
        const existingForChat = messages.filter((m) => m.chatId === chatId);
        const existingById = new Map(existingForChat.map((message) => [message.id, message]));
        const existingIds = new Set(existingById.keys());
        const fresh = mapped.filter((m) => !existingIds.has(m.id));

        // 既存メッセージにもリアクションや状態の更新を反映（同期で re-fetch された場合）
        const hasUpdates = [...incomingById.values()].some((m) => {
          if (!existingIds.has(m.id)) return false;
          const existing = existingById.get(m.id);
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
          return false;
        });
        if (fresh.length === 0 && !hasUpdates) return;

        // キャッシュ済み既読ウォーターマークを新着にも即適用（RPC なしで既読化）
        const cachedWm = accountId
          ? get().readWatermarks[accountChatKey(accountId, chatId)]
          : undefined;
        if (cachedWm) {
          const patched = applyReadWatermarkLocal(mapped, cachedWm, false);
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

        // Inactive chats need only their sidebar summary and unread count in
        // memory. Their message page is reloaded from SQLite when opened.
        if (activeChatId !== chatId) {
          set((st) => ({
            chats: st.chats.map((chat) => {
              if (chat.id !== chatId) return chat;
              return {
                ...chat,
                unread: silent ? chat.unread : chat.unread + incomingFromPeer,
                ...(latest
                  ? {
                      lastMessagePreview: messagePreview(latest),
                      lastMessageTime: Math.max(chat.lastMessageTime ?? 0, latest.createdAt),
                    }
                  : {}),
              };
            }),
          }));
          return;
        }

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
                if (!reactionChanged && !revokedChanged) return m;
                const updated = { ...m };
                if (reactionChanged) {
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
          const trimmed: Message[] = [];
          const mergedById = new Map<string, Message>();
          for (const message of withUpdates) {
            if (message.chatId === chatId) mergedById.set(message.id, message);
            else trimmed.push(message);
          }
          for (const message of fresh) mergedById.set(message.id, message);
          const forChat = [...mergedById.values()].sort((a, b) => a.createdAt - b.createdAt);
          return {
            messages: [...trimmed, ...forChat],
            chats: st.chats.map((c) => {
              if (c.id !== chatId) return c;
              return {
                ...c,
                unread: activeChatId === chatId || silent ? c.unread : c.unread + incomingFromPeer,
                ...(latest
                  ? {
                      lastMessagePreview: messagePreview(latest),
                      lastMessageTime: Math.max(c.lastMessageTime ?? 0, latest.createdAt),
                    }
                  : {}),
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
              void api.line.getContact(accountId, m.authorId).then((res) => {
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
                        name: name && !looksLikeMid(name) ? name : members[i]!.name,
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
        const res = await api.line.getMessageHistory(accountId, chatId, messageId);
        if (res.ok) return res.history ?? [];
        return [];
      },

      restoreRevokedMessage: async (chatId, messageId) => {
        const { accountId, demoMode } = get();
        if (!accountId && !demoMode) return;
        const initial = get().messages.find(
          (message) => message.chatId === chatId && message.id === messageId,
        );
        if (!initial || initial.messageState !== "revoked-by-self") return;
        if (
          !initial.revokedSnapshot &&
          !initial.history?.some((entry) => entry.state === "normal" || entry.state === "edited")
        ) {
          window.alert("復元できる元のメッセージがありません");
          return;
        }
        if (!demoMode) {
          try {
            const result = await api.line.restoreRevokedMessage(accountId!, chatId, messageId);
            if (get().accountId !== accountId) return;
            if (!result.ok) {
              get().showNotice(result.error ?? "取り消し表示の解除に失敗しました");
              return;
            }
          } catch (error) {
            if (get().accountId !== accountId) return;
            get().showNotice(
              error instanceof Error ? error.message : "取り消し表示の解除に失敗しました",
            );
            return;
          }
        }
        const msg = get().messages.find(
          (message) => message.chatId === chatId && message.id === messageId,
        );
        if (!msg || msg.messageState !== "revoked-by-self") return;
        const snapshot = msg.revokedSnapshot;
        const lastNormal = [...(msg.history ?? [])]
          .reverse()
          .find((entry) => entry.state === "normal" || entry.state === "edited");
        if (!snapshot && !lastNormal) return;
        const historyEntry = {
          state: "normal" as const,
          text: msg.text ?? null,
          contentType: msg.kind,
          updatedTime: Date.now(),
        };
        set((st) => ({
          messages: st.messages.map((message) =>
            message.chatId === chatId &&
            message.id === messageId &&
            message.messageState === "revoked-by-self"
              ? {
                  ...message,
                  ...snapshot,
                  messageState: (snapshot?.messageState ??
                    (lastNormal?.state === "edited" ? "edited" : "normal")) as MessageState,
                  history: [...(message.history ?? []), historyEntry],
                  ...(snapshot
                    ? { revokedSnapshot: snapshot }
                    : message.revokedSnapshot
                      ? { revokedSnapshot: message.revokedSnapshot }
                      : {}),
                  text: snapshot?.text ?? lastNormal?.text ?? undefined,
                }
              : message,
          ),
        }));
        if (demoMode) get().showNotice("取り消したメッセージをデモ復元しました");
      },

      setMessageReaction: (messageId, reaction, myMid) => {
        const typeNum = (
          { NICE: 2, LOVE: 3, FUN: 4, AMAZING: 5, SAD: 6, OMG: 7 } as Record<string, number>
        )[reaction];
        if (reaction !== "UNDO" && !typeNum) return;
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
              next = [...next, { fromMid: myMid, atMillis: Date.now(), type: typeNum! }];
            }
            return { ...m, reactions: next.length ? next : undefined };
          });
          if (msgs.every((m, i) => m === st.messages[i])) return st;
          return { messages: msgs };
        });
      },

      backfillChat: async (chatId) => {
        const accountId = get().accountId;
        if (!accountId || !chatId) return;
        const chatKey = accountChatKey(accountId, chatId);
        const inflight = backfillInflight.get(chatKey);
        if (inflight) return inflight;

        let task!: Promise<void>;
        task = (async () => {
          try {
            const res = await api.line.getPreviousMessagesV2WithRequest(accountId, chatId, 50, {
              force: true,
            });
            if (get().accountId !== accountId) return;
            if (res.ok && res.messages?.length) {
              get().mergeIncomingMessages(chatId, res.messages, { silent: true });
            }
          } catch {
            /* silent */
          }
        })();
        backfillInflight.set(chatKey, task);
        void task.finally(() => {
          if (backfillInflight.get(chatKey) === task) backfillInflight.delete(chatKey);
        });
        return task;
      },
      pollMessagesDelta: async (chatId) => {
        const { accountId, messages } = get();
        if (!accountId || !chatId) return;
        const now = Date.now();
        const chatKey = accountChatKey(accountId, chatId);
        const lastAt = lastDeltaPollAt.get(chatKey) ?? 0;
        if (now - lastAt < DELTA_POLL_MIN_MS) return;

        const chatMsgs = messages.filter(
          (m) => m.chatId === chatId && m.id && !m.id.startsWith("pending_"),
        );
        const lastId = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1]!.id : undefined;
        // 非 pending メッセージが無い（全送信中/初回）場合は通常取得にフォールバックして足場を作る
        if (!lastId) {
          lastDeltaPollAt.set(chatKey, Date.now());
          await get()
            .refreshMessages(chatId, { force: true })
            .catch(() => undefined);
          return;
        }
        const started = Date.now();
        let responseOk = false;
        try {
          const res = await api.line.getMessageDelta(accountId, chatId, lastId, 15);
          if (get().accountId !== accountId) return;
          responseOk = res.ok;
          if (res.ok && res.messages?.length) {
            get().mergeIncomingMessages(chatId, res.messages);
          }
        } catch {
          /* silent */
        }
        // 成功、またはRPC が遅かった場合のみ間隔を空けてキュー負荷を抑える。
        if (shouldThrottleDeltaPoll(responseOk, Date.now() - started)) {
          lastDeltaPollAt.set(chatKey, Date.now());
        }
      },

      pollIncoming: async () => {
        const accountId = get().accountId;
        if (!accountId) return;

        const inflight = pollIncomingInflight.get(accountId);
        if (inflight) return inflight;

        let task!: Promise<void>;
        task = (async () => {
          const cursor = eventPollCursor.get(accountId) ?? 0;
          try {
            const res = await api.line.fetchOperations(accountId, cursor);
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
                    // 外部クライアントで既読された場合も自分の未読をすぐ反映する。
                    set((st) => {
                      const latest = findLatestReceivedMessage(st.messages, ev.chatMid);
                      return {
                        chats: st.chats.map((chat) =>
                          chat.id === ev.chatMid ? { ...chat, unread: 0 } : chat,
                        ),
                        messages: latest
                          ? markReceivedMessagesReadThrough(st.messages, ev.chatMid, latest)
                          : st.messages,
                      };
                    });
                    void get()
                      .refreshReadReceipts(ev.chatMid, { force: true })
                      .catch(() => undefined);
                    void get()
                      .refreshChatsSilently()
                      .catch(() => undefined);
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
                  const state = get();
                  if (
                    state.settings.webNotificationsEnabled &&
                    document.visibilityState === "hidden" &&
                    state.activeChatId !== chatId &&
                    typeof Notification !== "undefined" &&
                    Notification.permission === "granted"
                  ) {
                    const knownIds = new Set(
                      state.messages
                        .filter((message) => message.chatId === chatId)
                        .map((message) => message.id),
                    );
                    const chat = state.chats.find((item) => item.id === chatId);
                    const fresh = msgs.find(
                      (message) =>
                        !knownIds.has(message.id) &&
                        message.from !== state.self.mid &&
                        message.from !== state.accountId &&
                        (!chat?.lastMessageTime || message.createdTime >= chat.lastMessageTime),
                    );
                    if (fresh) {
                      new Notification(
                        state.settings.hideNotificationContent
                          ? "新しいメッセージ"
                          : chat?.name || "Vyline",
                        {
                          body: state.settings.hideNotificationContent
                            ? "メッセージを受信しました"
                            : (fresh.text || "メディアを受信しました").slice(0, 160),
                          tag: `vyline:${accountId}:${chatId}`,
                        },
                      );
                    }
                  }
                  get().mergeIncomingMessages(chatId, msgs);
                }
              }
            }
          } catch {
            /* silent poll */
          }

          if (get().accountId !== accountId) return;
          const { activeChatId } = get();
          // Push の取りこぼしを差分で補う。遅いRPCを待ってイベントpollを止めない。
          if (activeChatId) {
            void get().pollMessagesDelta(activeChatId);
          }
        })();

        pollIncomingInflight.set(accountId, task);
        void task.finally(() => {
          if (pollIncomingInflight.get(accountId) === task) {
            pollIncomingInflight.delete(accountId);
          }
        });
        return task;
      },
    }),
    {
      name: "vyline:store",
      storage: indexedDbPersistStorage,
      skipHydration: true,
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
        // Keep chat selection transient: restarting the browser restores the roster,
        // but must not reopen a conversation or fetch its message history.
        state.activeChatId = null;
        state.messages = [];
        state.initialChatScrollMessageId = null;
        state.initialChatScrollUnreadCount = 0;
        state.initialChatScrollPending = false;
        state.initialChatScrollMode = null;
        state.settings.animationMode ??= "vyline";
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
        state.screen = "home";
      },
    },
  ),
);

// ブラウザの戻る/進むでチャット履歴をたどる
if (
  typeof window !== "undefined" &&
  !(window as unknown as { __vyPopstateBound?: boolean }).__vyPopstateBound
) {
  (window as unknown as { __vyPopstateBound?: boolean }).__vyPopstateBound = true;
  window.addEventListener("popstate", (e) => {
    const id = (e.state as { chatId?: string } | null)?.chatId ?? null;
    useStore.getState()._activateChat(id ?? "", { history: false });
  });
}

function initial(name: string): string {
  const t = (name || "?").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

export function displayName(chat: Chat, streamerMode: boolean): string {
  if (streamerMode && useStore.getState().settings.streamerMaskNames)
    return chat.type === "group" ? "グループ" : "友だち";
  if (chat.isSelf) return "Keepメモ";
  const n = chat.localName || chat.name;
  if (!n || looksLikeMid(n)) return chat.type === "group" ? "グループ" : "友だち";
  return n;
}

export function memberDisplayName(name: string, streamerMode: boolean): string {
  if (streamerMode && useStore.getState().settings.streamerMaskNames) return "メンバー";
  if (!name || looksLikeMid(name)) return "メンバー";
  return name;
}

export function memberGlyph(glyph: string, streamerMode: boolean): string {
  return shouldMaskStreamerAvatars(streamerMode) ? "•" : glyph;
}

export function shouldMaskStreamerAvatars(streamerMode: boolean): boolean {
  return streamerMode && useStore.getState().settings.streamerMaskAvatars;
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
  const lastMessageTimes = new Map<string, number>();
  if (sort === "unread") {
    for (const message of messages) lastMessageTimes.set(message.chatId, message.createdAt);
  }
  const lastTs = (id: string, chat?: Chat) => {
    const fromMsg = lastMessageTimes.get(id) ?? 0;
    const fromApi = chat?.lastMessageTime ?? 0;
    return Math.max(fromMsg, fromApi);
  };
  const arr = [...list];
  if (sort === "custom") {
    const orderById = new Map(customOrder.map((id, index) => [id, index]));
    arr.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const rawA = orderById.get(a.id) ?? -1;
      const rawB = orderById.get(b.id) ?? -1;
      return (rawA < 0 ? 999 : rawA) - (rawB < 0 ? 999 : rawB);
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
