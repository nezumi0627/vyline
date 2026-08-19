import { create } from "zustand";
import { persist } from "zustand/middleware";
import { usePrivacyStore } from "../stores/privacyStore";
import { api, type Announcement } from "../api/client.js";
import type { Chat as LineChat, Message as LineMessage } from "@vyline/types";
import { THEME_PRESETS } from "./theme-presets.js";
import type {
  Chat,
  ChatSort,
  Message,
  VyTheme,
  Screen,
  SelfProfile,
  Settings,
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
import { getDismissedChatMids } from "../utils/dismissedChats.js";
import { parseMentions, type MentionDraft } from "../utils/mention.js";
import { compressImageFile } from "../utils/compressImage.js";
import { setHiddenForAccount } from "../hooks/useHiddenChats.js";
import {
  showNotification,
  showActionableNotification,
  shouldNotifyForChat,
} from "./notify.js";

export type { Chat, ChatSort, Message, Member, VyTheme, Settings, Screen } from "./store-types.js";

/** chatId → 送信済み lastMessageId（既読 API の重複抑止） */
const readReceiptSent = new Map<string, string>();
/** chatId → 進行中の既読ポーリング */
const readReceiptInflight = new Map<string, Promise<void>>();
/** chatId → 既読ウォーターマークキャッシュ（相手の最終既読地点） */
const readWatermarkCache = new Map<
  string,
  {
    peerReadUpTo?: string;
    memberWatermarks?: Array<{ mid: string; upTo: string }>;
    at: number;
  }
>();
/** 既読ウォーターマークのキャッシュ有効時間 — 読み込み高速化のため毎回の既読取得を避ける */
const READ_WATERMARK_TTL_MS = 30_000;
/** 直近で取得済みの自分のメッセージID（ウォーターマークでまとめて既読化するため参照） */
const myMessageIdsByChat = new Map<string, string[]>();
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

const MAX_MESSAGES_PER_CHAT = 120;
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
  },
  force: boolean,
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
      const nextReadBy =
        force || readBy.length >= prevReadBy.length ? readBy : prevReadBy;
      if (
        force ||
        readCount > prevReadCount ||
        (readBy.length > 0 && prevReadBy.length === 0)
      ) {
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

function messagePreview(m: Message): string {
  if (m.revoked) return "メッセージの送信を取り消しました";
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
  version: "0.4.0-beta",
  title: "Vyline 0.4.0-beta — Beta Release",
  items: [
    "メンション（@ALL / @名前）の送受信・ハイライト表示",
    "画像送信: クライアント側圧縮 + 本家クライアントでも表示される E2EE メディア対応",
    "チャットイベントの実テキスト化（参加/退出/名前変更等を正確に表示）",
    "公式バッジを緑のチェックマークに刷新",
    "LINE 絵文字（sticon）の描画バグ修正 — 本文中の絵文字が正しく表示されるように",
    "Flex カルーセルのマウスドラッグ対応",
    "連続送信・取り消しの安定化",
    "リアクションの削除（トグル方式）",
    "プロフィール背景画像・ステータスメッセージの表示",
    "チャット一覧のスクロールバウンス修正",
    "受信ポーリング高速化（4s/12s/60s → 2s/8s/60s）",
    "deltaAfterId 最適化（getMessageBoxes RPC 省略）",
    "既読ウォーターマークキャッシュ（30s TTL）",
    "ブロック機能（送信防止・GUI統合）",
    "VylineBackup（トーク履歴・メディアスナップショット）",
    "チャット詳細ログ（JSONL記録）",
    "高画質画像送信トグル",
  ],
};

type State = {
  screen: Screen;
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
  unlocked: boolean;
  indexing: { active: boolean; label: string } | null;
  /** 個別チャットの「既読を無効化」設定（mid → 無効化） */
  readDisabledMids: Record<string, boolean>;
  /** ブロック中のユーザー MID 一覧（送信抑止・UI 表示に使用） */
  blockedMids: string[];
  pendingScreen: Screen | null;
  pendingChatId: string | null;

  setScreen: (s: Screen) => void;
  setAccountId: (id: string | null) => void;
  toggleChatReadDisabled: (id: string) => void;
  /** ブロック中一覧をサーバから再取得して反映（アカウント切替時・UI からの呼び出し） */
  syncBlockedMids: () => Promise<void>;
  /** ローカルにブロック状態を反映（block/unblock 直後に呼ぶ） */
  setBlockedMids: (mids: string[]) => void;
  /** ブロック中なら true（送信抑止用） */
  isBlockedMid: (mid: string) => boolean;
  openChat: (id: string) => void;
  _activateChat: (id: string, opts?: { history?: boolean }) => void;
  closeChat: () => void;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
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
      musicProfile?: string;
      birthday?: { display?: string } | null;
      backgroundUrl?: string;
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
    opts?: { contentMetadata?: Record<string, string> },
  ) => Promise<void>;
  sendSticker: (
    chatId: string,
    packageId: string,
    stickerId: string,
    isPremium?: boolean,
  ) => Promise<void>;
  sendLineEmoji: (chatId: string, packageId: string, sticonId: string) => Promise<void>;
  sendImageFile: (chatId: string, file: File) => Promise<void>;
  sendAudio: (chatId: string, seconds: number, blob: Blob) => Promise<void>;
  revokeMessage: (id: string) => Promise<void>;
  retryMessage: (id: string) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markChatRead: (id: string) => Promise<void>;
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
  /** 楽観リアクション更新（UNDO は自分の全リアクション除去） */
  setMessageReaction: (messageId: string, reaction: "UNDO" | string, myMid: string) => void;
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
      accountId: null,
      activeChatId: null,
      theme: THEME_PRESETS[0]!,
      settings: {
        readReceipts: true,
        showReaderList: true,
        streamerMode: false,
        compactDensity: false,
        fontScale: 1,
        enterToSend: true,
        pinEnabled: false,
        pin: "",
        requirePinForOpen: false,
        chatSort: "recent",
        customCursor: false,
        bubbleTail: true,
        showStatusMessage: true,
        showBackground: true,
        highQualityImages: false,
        proxyEnabled: false,
        proxyUrl: "",
        keepRevokedMessages: false,
        themeSyncWithSystem: false,
      },
      chats: [],
      messages: [],
      drafts: {},
      draftSticons: {},
      draftMentions: {},
      replyToId: null,
      highlightMessageId: null,
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
      unlocked: true,
      indexing: null,
      readDisabledMids: {},
      blockedMids: [],
      pendingScreen: null,
      pendingChatId: null,
      notice: null,
      announcements: {},

      setScreen: (s) => {
        const { settings, unlocked } = get();
        if (settings.pinEnabled && !unlocked && s !== "lock" && s !== "login") return;
        if (settings.requirePinForOpen && !unlocked && (s === "chat" || s === "settings")) {
          set({ pendingScreen: s, screen: "lock" });
          return;
        }
        set({ screen: s, pendingScreen: null });
      },

  setAccountId: (id) => {
    if (id !== get().accountId) {
      contactFetched.clear();
      readReceiptSent.clear();
      readReceiptInflight.clear();
      sessionOpenedChats.clear();
      eventPollCursor.delete(String(id));
    }
    set({ accountId: id });
  },

resetAccountData: () =>
        set({
          chats: [],
          messages: [],
          activeChatId: null,
          profileDrawerOpen: false,
          announcements: {},
          drafts: {},
          draftSticons: {},
          draftMentions: {},
          replyToId: null,
          highlightMessageId: null,
          customOrder: [],
          readDisabledMids: {},
          blockedMids: [],
        }),


      toggleChatReadDisabled: (id) => {
        set((st) => {
          const next = { ...st.readDisabledMids };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { readDisabledMids: next };
        });
      },

      syncBlockedMids: async () => {
        const { accountId } = get();
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

      openChat: (id) => {
        const { settings, unlocked } = get();
        if (settings.requirePinForOpen && !unlocked) {
          set({ pendingScreen: "chat", pendingChatId: id });
          set({ screen: "lock" });
          return;
        }
        sessionOpenedChats.add(id);
        get()._activateChat(id, { history: true });
      },

      _activateChat: (id, opts) => {
        const opts2 = opts ?? {};
        set((st) => ({
          screen: "chat",
          activeChatId: id,
          profileDrawerOpen: false,
          chats: st.chats.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
        }));
        const { accountId, settings, chats } = get();
        if (accountId && settings.readReceipts) {
          void get().markChatRead(id);
        }
        if (accountId) {
          void api.line.contactProfile(accountId, id).catch(() => undefined);
          const chat = chats.find((c) => c.id === id);
          const mids =
            chat?.type === "group" ? (chat.members?.slice(0, 6).map((m) => m.id) ?? []) : [];
          for (const mid of mids) {
            void api.line.contactProfile(accountId, mid).catch(() => undefined);
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

      closeChat: () => set({ activeChatId: null, profileDrawerOpen: false }),

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

      unlock: async (pin) => {
        const { settings, seenUpdateVersion, pendingScreen, pendingChatId } = get();
        const nextScreen = seenUpdateVersion !== UPDATE_NOTES.version ? "home" : "chat";
        if (!settings.pinEnabled || !settings.pin) {
          set({
            unlocked: true,
            screen: nextScreen,
            showUpdateNote: nextScreen === "home",
          });
          return true;
        }
        // Validate PIN length (4-8 digits)
        if (!/^\d{4,8}$/.test(pin)) {
          return false;
        }
        const privacyStore = usePrivacyStore.getState();
        const ok = await privacyStore.unlock(pin);
        if (ok) {
          // If there's a pending screen (chat or settings), navigate there
          const targetScreen = pendingScreen || nextScreen;
          const targetChatId = pendingChatId;
          set({
            unlocked: true,
            screen: targetScreen,
            pendingScreen: null,
            pendingChatId: null,
            showUpdateNote: targetScreen === "home",
          });
          if (targetScreen === "chat" && targetChatId) {
            sessionOpenedChats.add(targetChatId);
            get()._activateChat(targetChatId, { history: true });
          }
          return true;
        }
        return false;
      },

      lock: () => {
        const { settings } = get();
        if (settings.pinEnabled) set({ unlocked: false, screen: "lock" });
      },

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
        if (prev) window.clearTimeout(prev);
        noticeTimer.current = window.setTimeout(() => set({ notice: null }), ms);
      },

      resetSettings: () =>
        set({
          theme: THEME_PRESETS[0]!,
          settings: {
            readReceipts: true,
            showReaderList: true,
            streamerMode: false,
            compactDensity: false,
            fontScale: 1,
            enterToSend: true,
            pinEnabled: false,
            pin: "",
            requirePinForOpen: false,
            chatSort: "recent",
            customCursor: false,
            bubbleTail: true,
            showStatusMessage: true,
            showBackground: true,
            highQualityImages: false,
            keepRevokedMessages: false,
            themeSyncWithSystem: false,
            proxyEnabled: false,
            proxyUrl: "",
          },
          sidebarWidth: 360,
          customOrder: [],
          unlocked: true,
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
                musicProfile: profile.musicProfile || st.self.musicProfile,
                birthday: profile.birthday?.display || st.self.birthday,
                backgroundUrl: profile.backgroundUrl || st.self.backgroundUrl,
                mid: profile.mid || st.self.mid,
              },
            }));
          }
          return;
        }
        const accountId = get().accountId;
        const activeChatId = get().activeChatId;
        const dismissed = accountId ? getDismissedChatMids(accountId) : new Set<string>();
        const mappedChats = chats
          .filter((c) => !dismissed.has(c.mid) && !c.left)
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

        const chatId =
          activeChatId && !dismissed.has(activeChatId)
            ? activeChatId
            : (mappedChats[0]?.id ?? null);
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
          chats: mappedChats
            .filter((c) => !dismissed.has(c.id))
            .map((c) => {
              const prev = st.chats.find((p) => p.id === c.id);
              const mergedName =
                c.name && !looksLikeMid(c.name)
                  ? c.name
                  : prev?.name && !looksLikeMid(prev.name)
                    ? prev.name
                    : c.name;
              return prev
                ? {
                    ...c,
                    name: mergedName,
                    avatar: initial(mergedName),
                    avatarUrl: c.avatarUrl || prev.avatarUrl,
                    pinned: prev.pinned,
                    muted: prev.muted,
                    hidden: prev.hidden,
                    localName: prev.localName,
                    members: c.members ?? prev.members,
                  }
                : c;
            }),
          messages: (() => {
            if (mappedMessages.length === 0 && st.messages.length > 0) return st.messages;
            const pending = st.messages.filter(
              (m) => m.id.startsWith("pending_") || m.status === "sending" || m.status === "failed",
            );
            if (pending.length === 0) return mappedMessages;
            const ids = new Set(mappedMessages.map((m) => m.id));
            const keep = pending.filter((p) => !ids.has(p.id));
            return [...mappedMessages, ...keep];
          })(),
          activeChatId: st.activeChatId ?? chatId,
          customOrder: st.customOrder.length ? st.customOrder : mappedChats.map((c) => c.id),
          self: profile
            ? {
                name: profile.displayName || "あなた",
                avatar: initial(profile.displayName),
                avatarUrl: profile.thumbnailUrl || st.self.avatarUrl,
                status: profile.statusMessage || "",
                musicProfile: profile.musicProfile || st.self.musicProfile,
                birthday: profile.birthday?.display || st.self.birthday,
                backgroundUrl: profile.backgroundUrl || st.self.backgroundUrl,
                mid: profile.mid || st.self.mid,
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

        // 自動選択チャットも「開いた」扱いにし、既読を送信する
        if (chatId && !sessionOpenedChats.has(chatId)) {
          sessionOpenedChats.add(chatId);
          const { accountId, settings, readDisabledMids } = get();
          if (accountId && settings.readReceipts && !readDisabledMids[chatId]) {
            void get().markChatRead(chatId);
          }
        }
      },

      sendMessage: async (chatId, text, opts) => {
        const { accountId, replyToId, blockedMids } = get();
        if (!accountId || (!text.trim() && !text.includes("\uFFFC"))) return;
        // ブロック中の友だちには送信しない（DM の chatId は相手 MID）
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const trimmed = text; // 文中 sticon の前後空白を落とさない
        const relatedMessageId = replyToId ?? undefined;
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
          drafts: { ...st.drafts, [chatId]: "" },
          replyToId: null,
        }));

        void (async () => {
          let res: Awaited<ReturnType<typeof api.line.send>>;
          try {
            res = await api.line.send(accountId!, chatId, trimmed, {
              relatedMessageId,
              contentMetadata: opts?.contentMetadata,
            });
          } catch {
            set((st) => ({
              messages: st.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
            }));
            return;
          }
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
        const { accountId, blockedMids } = get();
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
        const { accountId, blockedMids } = get();
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
          retry: { kind: "emoji", packageId, sticonId },
        };
        set((st) => ({ messages: [...st.messages, optimistic] }));

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
        const { accountId, blockedMids } = get();
        if (!accountId) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        const isVideo = file.type.startsWith("video/");
        const tempId = `pending_${isVideo ? "video" : "img"}_${Date.now()}`;
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
        };
        set((st) => ({ messages: [...st.messages, optimistic] }));
        void (async () => {
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
            const res = await api.line.sendMedia(accountId!, chatId, dataBase64, {
              mimeType: mime,
              filename: file.name || (isVideo ? "video.mp4" : "image.jpg"),
              mediaType: isVideo ? "video" : "image",
            });
            if (res.ok) {
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
              set((st) => ({ messages: st.messages.filter((m) => m.id !== tempId) }));
            }
          } catch {
            set((st) => ({ messages: st.messages.filter((m) => m.id !== tempId) }));
          } finally {
            // 送信完了後にローカルURLを解放（60s 後でも安全な間隔）
            setTimeout(() => URL.revokeObjectURL(localUrl), 60_000);
          }
        })();
      },

      sendAudio: async (chatId, seconds, blob) => {
        const { accountId, blockedMids } = get();
        if (!accountId || !blob || blob.size === 0) return;
        if (chatId.startsWith("u") && blockedMids.includes(chatId)) return;
        void (async () => {
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
            const res = await api.line.sendMedia(accountId!, chatId, dataBase64, {
              mimeType: mime,
              filename: `voice-${seconds}s.${ext}`,
              mediaType: "audio",
            });
            if (!res.ok) {
              window.alert(res.error ?? "音声メッセージの送信に失敗しました");
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
            window.alert("音声メッセージの送信に失敗しました");
          }
        })();
      },

      revokeMessage: async (id) => {
        const { accountId, activeChatId } = get();
        if (!accountId) return;
        const msg = get().messages.find((m) => m.id === id);
        // 送信中の楽観メッセージはサーバ未確定のため取り消せない
        if (!msg || msg.status === "sending" || id.startsWith("pending_")) {
          window.alert("送信が完了してから取り消しできます");
          return;
        }
        const res = await api.line.unsend(accountId, id);
        if (res.ok && activeChatId) await get().refreshMessages(activeChatId, { force: true });
        else if (!res.ok) {
          const errText = res.error ?? "";
          // 送信取り消し可能な時間を過ぎた（MESSAGE_NOT_DESTRUCTIBLE / message too old）
          if (
            errText.includes("MESSAGE_NOT_DESTRUCTIBLE") ||
            errText.includes("message too old") ||
            errText.includes("too old")
          ) {
            get().showNotice("取り消し失敗(送信取り消し可能な時間を過ぎています)");
          } else {
            window.alert(errText || "取り消しに失敗しました");
          }
        }
      },

      retryMessage: async (id) => {
        const accountId = get().accountId;
        const msg = get().messages.find((m) => m.id === id);
        if (!accountId || !msg || msg.status !== "failed" || msg.revoked || !msg.retry) return;
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
          markFailed();
        }
      },

      markRead: async (id) => {
        const { accountId, activeChatId } = get();
        if (!accountId || !activeChatId) return;
        await api.line.markAsRead(accountId, activeChatId, id).catch(() => {});
        set((st) => ({
          messages: st.messages.map((m) =>
            m.id === id ? { ...m, read: true, status: "read" } : m,
          ),
        }));
      },

      markChatRead: async (id) => {
        const { accountId, messages, settings, readDisabledMids } = get();
        set((st) => ({
          chats: st.chats.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
        }));
        // 全体無効（設定）または個別無効（右クリック）なら送信しない
        if (!accountId || !settings.readReceipts || readDisabledMids[id]) return;
        const last = [...messages]
          .reverse()
          .find((m) => m.chatId === id && m.id && !m.id.startsWith("pending_"));
        if (!last?.id) return;
        // 同じ最終メッセージへの既読は再送しない
        const prev = readReceiptSent.get(id);
        if (prev === last.id) return;
        readReceiptSent.set(id, last.id);
        try {
          await api.line.markAsRead(accountId, id, last.id);
        } catch {
          readReceiptSent.delete(id);
        }
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
        sessionOpenedChats.add(memberMid);
        set({
          memberProfile: null,
          profileDrawerOpen: false,
          screen: "chat",
          activeChatId: memberMid,
        });
        const { accountId, settings } = get();
        if (accountId && settings.readReceipts) {
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
        if (k === "pinEnabled" && !v) set({ unlocked: true });
        if (k === "pinEnabled" && v) set({ unlocked: false, screen: "lock" });
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
        if (!accountId) return;
        try {
          const res = await api.line.chats(accountId, { light: true, refresh: true });
          if (res.ok && res.chats) {
            const hidden = new Set(
              get()
                .chats.filter((c) => c.hidden)
                .map((c) => c.id),
            );
            const dismissed = getDismissedChatMids(accountId);
            set((st) => ({
              chats: res
                .chats!.filter((c) => !dismissed.has(c.mid))
                .map((c) => {
                  const base = mapChat(c, hidden.has(c.mid));
                  const prev = st.chats.find((p) => p.id === c.mid);
                  const name =
                    base.name && !looksLikeMid(base.name)
                      ? base.name
                      : prev?.name && !looksLikeMid(prev.name)
                        ? prev.name
                        : base.name;
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
                        unread: st.activeChatId === c.mid ? 0 : (c.unreadCount ?? prev.unread),
                        lastMessagePreview:
                          c.lastMessagePreview && c.lastMessagePreview !== "暗号化メッセージ"
                            ? c.lastMessagePreview
                            : prev.lastMessagePreview,
                        lastMessageTime: c.lastMessageTime ?? prev.lastMessageTime,
                      }
                    : base;
                }),
            }));
            // ギャップ回復: 既知だが欠落のある chat を最新ページで修復
            // （getMessageBoxes の lastMessageTime が store の最新より新しい）
            const activeChatId = get().activeChatId;
            const msgs = get().messages;
            const candidates = res.chats
              .filter((c) => {
                const newest = msgs
                  .filter((m) => m.chatId === c.mid)
                  .reduce((t, m) => Math.max(t, m.createdAt), 0);
                return newest > 0 && newest < (c.lastMessageTime ?? 0);
              })
              .sort((a, b) => (b.mid === activeChatId ? 1 : 0) - (a.mid === activeChatId ? 1 : 0));
            for (const c of candidates.slice(0, 3)) {
              void get()
                .backfillChat(c.mid)
                .catch(() => undefined);
            }
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
          const res = await api.line.messages(accountId, chatId, 50, {
            force: opts?.force === true,
          });
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
            set((st) => {
              const mappedIds = new Set(mapped.map((m) => m.id));
              const existingChat = st.messages.filter((m) => m.chatId === chatId);
              const prevById = new Map(existingChat.map((m) => [m.id, m]));
              // 既読フラグ・既読者リストは一度取得できたらサーバ欠落でも落とさない
              for (let i = 0; i < mapped.length; i++) {
                const m = mapped[i]!;
                const prev = prevById.get(m.id);
                if (prev?.read && !m.read) {
                  mapped[i] = {
                    ...m,
                    read: true,
                    status: "read",
                    readBy: m.readBy?.length ? m.readBy : prev.readBy,
                    readCount: m.readCount ?? prev.readCount,
                  };
                } else if (prev?.readBy?.length && !m.readBy?.length) {
                  mapped[i] = {
                    ...m,
                    readBy: prev.readBy,
                    readCount: m.readCount ?? prev.readCount,
                  };
                }
              }
              // pending / 送信直後の確定メッセージをサーバ欠落時も残す
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
              const mergedMap = new Map<string, Message>();
              for (const m of mapped) mergedMap.set(m.id, m);
              for (const m of keep) {
                if (!mergedMap.has(m.id)) mergedMap.set(m.id, m);
              }
              const forChat = [...mergedMap.values()].sort((a, b) => a.createdAt - b.createdAt);
              return {
                messages: [
                  ...st.messages.filter((m) => m.chatId !== chatId),
                  ...forChat.slice(-MAX_MESSAGES_PER_CHAT),
                ],
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
          if (showLoading) set({ loadingMessages: false });
        }
      },

      refreshReadReceipts: async (chatId, opts) => {
        const inflight = readReceiptInflight.get(chatId);
        if (inflight) return inflight;

        let task!: Promise<void>;
        task = (async () => {
          const { accountId, messages } = get();
          if (!accountId) return;

          const myIds = messages
            .filter(
              (m) =>
                m.chatId === chatId &&
                m.authorId === "me" &&
                m.id &&
                !m.id.startsWith("pending_") &&
                !m.revoked,
            )
            .map((m) => m.id)
            .slice(-50);
          myMessageIdsByChat.set(chatId, myIds);
          if (myIds.length === 0) return;

          // 既読済みでも直近 15 分のメッセージは既読者一覧を追い続ける
          const needsPoll = messages.some(
            (m) =>
              m.chatId === chatId &&
              m.authorId === "me" &&
              myIds.includes(m.id) &&
              Date.now() - m.createdAt < 15 * 60_000,
          );

          // キャッシュ済みウォーターマークがあれば先にローカル適用（読み込み高速化）
          // needsPoll に関係なく適用する（古いチャットを開き直したときも既読状態を即反映）
          const cached = readWatermarkCache.get(chatId);
          if (cached && Date.now() - cached.at < READ_WATERMARK_TTL_MS) {
            const patched = applyReadWatermarkLocal(
              messages.filter((m) => m.chatId === chatId),
              cached,
              opts?.force === true,
            );
            if (patched) {
              set((st) => ({
                messages: st.messages.map((m) =>
                  m.chatId === chatId && patched.get(m.id)
                    ? { ...m, ...patched.get(m.id) }
                    : m,
                ),
              }));
            }
            // 強制でなければ RPC を飛ばさない（毎回の既読取得を避ける）
            if (!opts?.force) return;
          }

          if (!needsPoll) return;

          const res = await api.line.readReceipts(accountId, chatId, myIds);
          if (!res.ok || !res.receipts) return;

          // ウォーターマークをキャッシュ（相手の最終既読地点）
          readWatermarkCache.set(chatId, {
            peerReadUpTo: res.peerReadUpTo,
            memberWatermarks: res.memberReadWatermarks,
            at: Date.now(),
          });

          // 既読者 MID のプロフィールを事前取得（メンバー一覧を開かなくても名前表示）
          const allReaderMids = new Set<string>();
          for (const patch of Object.values(res.receipts)) {
            for (const mid of (patch as { readBy?: string[] }).readBy ?? []) {
              allReaderMids.add(mid);
            }
          }
          const memberMidSet = new Set(res.memberMids ?? []);
          const readersNeedFetch: string[] = [];
          for (const mid of allReaderMids) {
            if (contactFetched.has(mid)) continue;
            if (memberMidSet.has(mid)) continue;
            contactFetched.add(mid);
            readersNeedFetch.push(mid);
          }
          if (readersNeedFetch.length > 0) {
            void api.line.vylineWarm(accountId, readersNeedFetch).then((warmRes) => {
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

          set((st) => ({
            messages: st.messages.map((m) => {
              if (m.chatId !== chatId || m.authorId !== "me") return m;
              const patch = res.receipts![m.id];
              if (!patch) return m;
              const readBy = patch.readBy ?? [];
              const read =
                patch.seen === true ||
                Boolean((patch as { read?: boolean }).read) ||
                (patch.readCount != null && patch.readCount > 0) ||
                readBy.length > 0;
              return {
                ...m,
                read,
                readBy: readBy.length ? readBy : m.readBy,
                readCount: patch.readCount ?? m.readCount,
                status: read ? ("read" as const) : m.status === "read" ? "sent" : m.status,
              };
            }),
          }));
        })();

        readReceiptInflight.set(chatId, task);
        void task.finally(() => {
          if (readReceiptInflight.get(chatId) === task) {
            readReceiptInflight.delete(chatId);
          }
        });
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

        // 既存メッセージにもリアクション等の更新を反映（同期で re-fetch された場合）
        const hasUpdates = [...incomingById.values()].some(
          (m) => existingIds.has(m.id) && m.reactions && m.reactions.length > 0,
        );
        if (fresh.length === 0 && !hasUpdates) return;

        // キャッシュ済み既読ウォーターマークを新着にも即適用（RPC なしで既読化）
        const cachedWm = readWatermarkCache.get(chatId);
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

        set((st) => {
          const withUpdates = hasUpdates
            ? st.messages.map((m) => {
                if (m.chatId !== chatId) return m;
                const upd = incomingById.get(m.id);
                if (!upd || !upd.reactions?.length) return m;
                if (JSON.stringify(upd.reactions) === JSON.stringify(m.reactions)) return m;
                return { ...m, reactions: upd.reactions };
              })
            : st.messages;
          const merged = [...withUpdates, ...fresh].sort((a, b) => a.createdAt - b.createdAt);
          const trimmed = merged.filter((m) => m.chatId !== chatId);
          const forChat = merged.filter((m) => m.chatId === chatId).slice(-MAX_MESSAGES_PER_CHAT);
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

        // デスクトップ通知（LEINs の「グループ通知」等を参考に、ミュート・アクティブ中チャットは除外）
        if (!silent && incomingFromPeer > 0) {
          const chat = get().chats.find((c) => c.id === chatId);
          if (chat && !chat.muted && shouldNotifyForChat(chatId, get().activeChatId)) {
            const peerFresh = fresh.filter((m) => m.authorId !== "me");
            const last = peerFresh[peerFresh.length - 1];
            if (last) {
              void showActionableNotification(chat.name || "Vyline", {
                body: messagePreview(last),
                icon: chat.avatarUrl,
                tag: `vyline-msg-${chatId}`,
                onClick: () => {
                  get().setScreen("chat");
                  get().openChat(chatId);
                },
                actions: [
                  { action: "mark-read", title: "既読にする" },
                  { action: "copy", title: "コピー" },
                ],
                data: {
                  url: "/",
                  chatId,
                  messageId: last.id,
                  text: last.text ?? undefined,
                },
              });
            }
          }
        }

        if (activeChatId === chatId && !silent && sessionOpenedChats.has(chatId)) {
          if (get().settings.readReceipts) void get().markChatRead(chatId);
          for (const m of fresh) {
            if (m.authorId !== "me" && !contactFetched.has(m.authorId)) {
              if (contactFetched.size >= 5000) {
                const iter = contactFetched.values();
                for (let i = 0; i < 500; i++) contactFetched.delete(iter.next().value!);
              }
              contactFetched.add(m.authorId);
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
          const msgs = st.messages.map((m) =>
            m.chatId === chatId && m.id === messageId ? { ...m, revoked: true } : m,
          );
          if (msgs.every((m, i) => m === st.messages[i])) return st;
          return { messages: msgs };
        });
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
        const inflight = backfillInflight.get(chatId);
        if (inflight) return inflight;

        let task!: Promise<void>;
        task = (async () => {
          try {
            const res = await api.line.messages(accountId, chatId, 50, { force: true });
            if (res.ok && res.messages?.length) {
              get().mergeIncomingMessages(chatId, res.messages, { silent: true });
            }
          } catch {
            /* silent */
          }
        })();
        backfillInflight.set(chatId, task);
        void task.finally(() => {
          if (backfillInflight.get(chatId) === task) backfillInflight.delete(chatId);
        });
        return task;
      },

      pollMessagesDelta: async (chatId) => {
        const { accountId, messages } = get();
        if (!accountId || !chatId) return;
        const now = Date.now();
        const lastAt = lastDeltaPollAt.get(chatId) ?? 0;
        if (now - lastAt < DELTA_POLL_MIN_MS) return;

        const chatMsgs = messages.filter(
          (m) => m.chatId === chatId && m.id && !m.id.startsWith("pending_"),
        );
        const lastId = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1]!.id : undefined;
        // 非 pending メッセージが無い（全送信中/初回）場合は通常取得にフォールバックして足場を作る
        if (!lastId) {
          lastDeltaPollAt.set(chatId, Date.now());
          await get().refreshMessages(chatId, { force: true }).catch(() => undefined);
          return;
        }
        const started = Date.now();
        try {
          const res = await api.line.messagesDelta(accountId, chatId, lastId, 15);
          // 成功時のみスロットルを更新（失敗時は次のサイクルで再試行できるようにする）
          lastDeltaPollAt.set(chatId, Date.now());
          if (res.ok && res.messages?.length) {
            get().mergeIncomingMessages(chatId, res.messages);
          }
        } catch {
          /* silent */
        }
        // 遅い RPC の後は次回を遅らせて RPC キューを空ける（重い E2EE グループ対策）
        if (Date.now() - started > 6_000) {
          lastDeltaPollAt.set(chatId, Date.now());
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
            const res = await api.line.pollEvents(accountId, cursor);
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
                    if (get().settings.readReceipts) {
                      // 既読イベントは実既読地点が変わった可能性 → force で実値取得
                      void get()
                        .refreshReadReceipts(ev.chatMid, { force: true })
                        .catch(() => undefined);
                    }
                  } else if (ev.kind === "reaction") {
                    // リアクション更新: delta 経由で reactions 付きメッセージを回収
                    const active = get().activeChatId;
                    if (active === ev.chatMid) {
                      lastDeltaPollAt.delete(ev.chatMid);
                      void get()
                        .pollMessagesDelta(ev.chatMid)
                        .catch(() => undefined);
                    }
                    // リアクション通知: 自分のメッセージへのリアクションのみ。
                    // 非アクティブチャットでも内容を取得できるよう pollMessagesDelta を呼ぶ（active 制限なし）。
                    const targetMsg = get().messages.find((m) => m.id === ev.messageId);
                    if (targetMsg?.authorId === "me") {
                      const chat = get().chats.find((c) => c.id === ev.chatMid);
                      if (
                        chat &&
                        !chat.muted &&
                        shouldNotifyForChat(ev.chatMid, get().activeChatId)
                      ) {
                        showNotification(chat.name || "Vyline", {
                          body: "メッセージにリアクションが届きました",
                          icon: chat.avatarUrl,
                          tag: `vyline-reaction-${ev.chatMid}`,
                          onClick: () => {
                            get().setScreen("chat");
                            get().openChat(ev.chatMid);
                          },
                        });
                      }
                    }
                    if (active !== ev.chatMid) {
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

          const { activeChatId } = get();
          // push が機能しない環境の保険: アクティブチャットは delta で毎回取りこぼしを回収
          if (activeChatId) {
            await get().pollMessagesDelta(activeChatId);
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
        activeChatId: s.activeChatId,
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
        const unseen = state.seenUpdateVersion !== UPDATE_NOTES.version;
        state.showUpdateNote = unseen;
        // 適用済みプリセットに id を揃える（チェック表示用）
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
        if (state.settings.pinEnabled) {
          state.unlocked = false;
          state.screen = "lock";
        } else if (unseen) {
          state.screen = "home";
        } else {
          state.screen = "chat";
        }
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
