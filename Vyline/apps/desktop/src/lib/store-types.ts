export type Screen = "lock" | "home" | "chat" | "settings" | "login";

export type { VyTheme } from "@vyline/themes";

export type MessageReaction = {
  fromMid: string;
  atMillis: number;
  /** MessageReactionType: NICE=2 LOVE=3 FUN=4 AMAZING=5 SAD=6 OMG=7 */
  type: number;
};

/** LINE メンション（contentMetadata.MENTION） */
export type MentionInfo = {
  /** 対象 mid（@ALL のときは undefined） */
  mid?: string;
  /** true なら @ALL */
  all?: boolean;
  /** 本文中の開始オフセット（UTF-16 code units） */
  S: number;
  /** 終了オフセット */
  E: number;
};

export type MessageStatus = "sending" | "sent" | "read" | "failed";
export type MessageKind =
  | "text"
  | "sticker"
  | "emoji"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "system"
  | "call"
  | "flex"
  | "rich"
  | "contact"
  | "location";

export type CallMessageMeta = {
  video: boolean;
  group: boolean;
  durationSec?: number;
  outcome: "ended" | "missed" | "declined" | "busy";
};

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  thumb: string;
  site: string;
};

export type MessageState = "normal" | "edited" | "revoked-by-other" | "revoked-by-self";

export type Message = {
  id: string;
  chatId: string;
  authorId: string;
  kind: MessageKind;
  text?: string;
  sticker?: string;
  imageSrc?: string;
  /** LINE 複数画像グループ（contentMetadata.GID/GSEQ/GTOTAL） */
  mediaGroup?: {
    id: string;
    sequence: number;
    total: number;
  };
  audioSrc?: string;
  audioSeconds?: number;
  /** Flex / RICH の ALT_TEXT（プレビュー・コピー用） */
  altText?: string;
  /** contentMetadata.FLEX_JSON をパースしたコンテナ */
  flexJson?: import("./flex/types.js").FlexContainer | null;
  /** contentMetadata.MARKUP_JSON（RICH） */
  richMarkup?: import("./flex/types.js").RichMarkup | null;
  /** RICH の DOWNLOAD_URL */
  richImageUrl?: string;
  /** LINE sticon（contentMetadata.REPLACE） */
  sticons?: import("../utils/lineSticon.js").SticonResource[];
  /** LINE メンション（contentMetadata.MENTION） */
  mentions?: MentionInfo[];
  /** 通話イベント用 */
  callMeta?: CallMessageMeta;
  /** ノート/アルバム作成時の POSTNOTIFICATION */
  postNotification?: {
    kind: "note" | "album" | "unknown";
    homeId?: string;
    postId?: string;
    albumId?: string;
    title?: string;
    mediaCount?: number;
    previewMedias?: Array<{ mediaOid: string; mediaType?: string }>;
  };
  createdAt: number;
  status: MessageStatus;
  read: boolean;
  readBy?: string[];
  readCount?: number;
  messageState: MessageState;
  replyToId?: string;
  /** 絵文字リアクション（type は MessageReactionType 数値） */
  reactions?: MessageReaction[];
  /** 動くスタンプ（STKOPT="A"） */
  stickerAnimated?: boolean;
  /** くっつきスタンプ（位置固定マーカーあり） */
  stickerSticky?: boolean;
  /** 編集済みフラグ */
  edited?: boolean;
  /** 編集日時 (ms) */
  editedAt?: number;
  /** 編集前の元テキスト */
  originalText?: string;
  /** 編集前の元テキストを表示中かどうか */
  showOriginal?: boolean;
  /** 状態変更履歴 */
  history?: Array<{
    state: MessageState;
    text: string | null;
    contentType: string;
    updatedTime: number;
  }>;
  /** 取り消し前のメッセージ本体スナップショット */
  revokedSnapshot?: MessageSnapshot;
  linkPreview?: LinkPreview;
  /** 失敗時の再送に使う送信意図（楽観メッセージに保持） */
  retry?: RetryIntent;
  /** 連絡先メッセージ（contentType=13）の名刺情報 */
  contact?: { mid?: string; name?: string; thumbnailUrl?: string };
  file?: { name?: string; size?: number };
  /** 位置情報メッセージ（contentType=15） */
  location?: {
    title?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
};

export type MessageSnapshot = Omit<Message, "history" | "revokedSnapshot">;

export type RetryIntent =
  | {
      kind: "text";
      text: string;
      relatedMessageId?: string;
      contentMetadata?: Record<string, string>;
    }
  | { kind: "sticker"; packageId: string; stickerId: string; isPremium?: boolean }
  | {
      kind: "combinationSticker";
      items: Array<{ packageId: string; stickerId: string; x?: number; y?: number; size?: number }>;
    }
  | { kind: "emoji"; packageId: string; sticonId: string };

export type Member = {
  id: string;
  name: string;
  avatar: string;
  avatarUrl?: string;
  color: string;
};

export type ChatType = "friend" | "group";

export type Chat = {
  id: string;
  type: ChatType;
  name: string;
  localName?: string;
  avatar: string;
  avatarUrl?: string;
  color: string;
  status: string;
  online?: boolean;
  /** 公式アカウント（userType=BOT） */
  isOfficial?: boolean;
  /** ステータスメッセージ（直接トーク相手） */
  statusMessage?: string;
  /** プロフィール背景 URL */
  backgroundUrl?: string;
  /** 自分自身（Keepメモ）トーク */
  isSelf?: boolean;
  members?: Member[];
  hidden?: boolean;
  pinned?: boolean;
  muted?: boolean;
  /** 退出・キック済みグループ */
  left?: boolean;
  /** 外部バックアップから復元された履歴を持つ */
  restoredHistory?: boolean;
  unread: number;
  /** 一覧用プレビュー（API） */
  lastMessagePreview?: string;
  /** API からの最終メッセージ時刻 (ms) — Desktop getMessageBoxes 準拠 */
  lastMessageTime?: number;
};

export type ChatSort = "recent" | "unread" | "custom";
export type AnimationMode = "vyline" | "feather" | "none";

export type Settings = {
  /** UIモーションの強さ（通信・同期設定とは独立） */
  animationMode: AnimationMode;
  readReceipts: boolean;
  showReaderList: boolean;
  streamerMode: boolean;
  compactDensity: boolean;
  fontScale: number;
  enterToSend: boolean;
  chatSort: ChatSort;
  bubbleTail: boolean;
  /** ヘッダーに相手のステータスメッセージを表示 */
  showStatusMessage: boolean;
  /** トーク背景に相手のプロフィール背景を表示 */
  showBackground: boolean;
  /** 画像送信時に圧縮せず元画質で送る（通信量は増加） */
  highQualityImages: boolean;
  /** HTTP/SOCKS プロキシ（例: http://127.0.0.1:7890） */
  proxyEnabled: boolean;
  proxyUrl: string;
  /** モバイルプッシュ通知の有効/無効（TalkService_setNotificationsEnabled, type=USER） */
  notificationsEnabled: boolean;
  /** ベータ: プロフィールにブロック確認導線を表示 */
  betaBlockCheckManual: boolean;
  /** ベータ: 友だち全員のブロック状態を自動確認 */
  betaBlockCheckAuto: boolean;
  /** ベータ: u* MID を直接指定してプロフィールを検索 */
  betaMidSearch: boolean;
  /** ベータ: Agent I AIアシスタント */
  betaAgentI: boolean;
  /** ベータ: Windows版LINEのメモリから認証候補を確認 */
  betaWindowsLineTokens: boolean;
};

export type SelfProfile = {
  name: string;
  avatar: string;
  avatarUrl?: string;
  status: string;
  phoneticName?: string;
  pictureStatus?: string;
  musicProfile?: string;
  birthday?: string;
  backgroundUrl?: string;
  mid?: string;
  profileId?: string;
  premium?: {
    active: boolean;
    planType?: string | number;
    validUntil?: number;
    onFreeTrial?: boolean;
    willExpire?: boolean;
  };
};
