export const COMPOSE_CHANNEL = "vyline-ui";
export const COMPOSE_VERSION = 1;

export type ComposeSidebarSnapshot = {
  mode: "apple" | "fluent" | "miuix";
  dark: boolean;
  reducedMotion: boolean;
  query: string;
  tab: string;
  tabs: { id: string; label: string }[];
  rows: {
    id: string;
    title: string;
    preview: string;
    time: string;
    unread: number;
    avatar: string;
    color: string;
    avatarUrl?: string;
    selected: boolean;
    pinned: boolean;
    muted: boolean;
    locked: boolean;
  }[];
  profile: { name: string; status: string; avatar?: string; avatarUrl?: string };
  sortLabel: string;
  chatSort?: "recent" | "unread" | "custom";
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  desktopInteraction?: boolean;
  canRefresh: boolean;
  splitPick: boolean;
};

export type KmpTextSegment = {
  type: "text" | "sticon" | "mention" | "link";
  value?: string;
  url?: string;
  alt?: string;
  mid?: string;
  all?: boolean;
};

export type KmpMessage = {
  id: string;
  authorId: string;
  authorName: string;
  avatar: string;
  avatarUrl?: string;
  color: string;
  kind: string;
  text: string;
  createdAt: number;
  time: string;
  status: string;
  canRetry?: boolean;
  canReact?: boolean;
  messageState: string;
  readCount: number;
  readers?: { id: string; name: string; readAt?: number }[];
  stickerAnimated?: boolean;
  hostContent?: boolean;
  hostRichContent?: boolean;
  callDetail?: string;
  callVideo?: boolean;
  callMissed?: boolean;
  callJoin?: boolean;
  replyToId?: string;
  replyText?: string;
  edited?: boolean;
  segments?: KmpTextSegment[];
  mediaUrl?: string;
  audioSeconds?: number;
  fileName?: string;
  reactions: {
    type: number;
    key: string;
    iconUrl: string;
    count: number;
    selected: boolean;
    reactors: { id: string; name: string; atMillis: number }[];
  }[];
  groupStart: boolean;
  groupEnd: boolean;
};

export type KmpAppSnapshot = ComposeSidebarSnapshot & {
  epoch: number;
  view: "chat" | "settings";
  appearance: "system" | "light" | "dark";
  chat: {
    id: string;
    title: string;
    status: string;
    avatar: string;
    color: string;
    avatarUrl?: string;
    isGroup: boolean;
    locked: boolean;
    blocked: boolean;
    muted?: boolean;
    pinned?: boolean;
    canCall?: boolean;
    canVideoCall?: boolean;
    canBlock?: boolean;
    members?: { id: string; name: string; avatar: string; color: string; avatarUrl?: string }[];
  } | null;
  messages: KmpMessage[];
  composer: {
    text: string;
    replyToId?: string;
    replyText?: string;
    pending: { id: string; name: string; url: string; kind: string }[];
    recording: boolean;
    recordingSeconds: number;
    recordingLevels?: number[];
    sending: boolean;
    enterToSend: boolean;
    voiceEnabled: boolean;
    mute: boolean;
    available?: boolean;
    selectionStart?: number;
    selectionEnd?: number;
    mentionOptions?: { mid?: string; all?: boolean; name: string }[];
    mentionIndex?: number;
    canSendMedia?: boolean;
    segments?: KmpTextSegment[];
  };
  settings: {
    enterToSend: boolean;
    voiceMessagesEnabled: boolean;
    compactDensity: boolean;
    bubbleTail: boolean;
    fontScale: number;
    showReaderList: boolean;
  };
  notice: string;
  history?: { loading: boolean; hasMore: boolean };
  hostMenu?: NativeMenuSnapshot | null;
  nativePanel?: import("./native-panel").NativePanelSnapshot | null;
  controllerDialog?: import("./controller-dialog").ControllerDialog | null;
  controllerCall?: import("./native-panel").NativePanelSnapshot | null;
  readersPanel?: { messageId: string; loading: boolean } | null;
  hostContentHeights?: Record<string, number>;
  hostContentModels?: Record<string, import("./native-panel").NativePanelSnapshot>;
  chatUi?: Omit<import("@/lib/appEvents").ChatPresentation, "chatId" | "accountId"> | null;
  announcements?: { id: string; text: string; messageId?: string }[];
  highlightMessageId?: string | null;
  scrollLatest?: number;
  profileOpen?: boolean;
  panes?: KmpPaneSnapshot[];
  paneRects?: { x: number; y: number; width: number; height: number }[];
  paneLayout?: string;
};

export type KmpPaneSnapshot = Pick<
  KmpAppSnapshot,
  | "chat"
  | "messages"
  | "composer"
  | "history"
  | "chatUi"
  | "announcements"
  | "highlightMessageId"
  | "scrollLatest"
  | "profileOpen"
  | "readersPanel"
> & { id: string };
export type KmpPanePatch = Partial<Omit<KmpPaneSnapshot, "id">> & {
  messageDelta?: KmpMessageDelta;
};

export type KmpMessageDelta = { updates: KmpMessage[]; ids?: string[] };
export type KmpAppPatch = Partial<KmpAppSnapshot> & {
  messageDelta?: KmpMessageDelta;
  panePatches?: Record<string, KmpPanePatch>;
};

const ACTIONS = [
  "open",
  "context",
  "search",
  "tab",
  "settings",
  "profile",
  "refresh",
  "sort",
  "mark-all-read",
  "sidebar-width",
  "sidebar-toggle",
  "reorder-chat",
  "drop-chat",
  "create-group",
  "panel-action",
  "panel-change",
  "panel-selection",
  "panel-secondary",
  "panel-close",
  "panel-confirm",
  "panel-cancel",
  "controller-dialog-accept",
  "controller-dialog-cancel",
  "split-pick",
  "pane-focus",
  "pane-close",
  "pane-layout",
  "pane-resize",
  "pane-main-ratio",
  "pane-cross-ratio",
  "pane-move",
  "back",
  "draft",
  "send",
  "reply",
  "cancel-reply",
  "attach",
  "record-start",
  "record-stop",
  "remove-attachment",
  "send-attachments",
  "sticker-picker",
  "chat-tools",
  "readers",
  "close-readers",
  "reader-profile",
  "chat-search",
  "chat-search-query",
  "chat-search-next",
  "chat-search-previous",
  "chat-search-close",
  "chat-refresh",
  "join-call",
  "chat-menu",
  "jump-message",
  "announcement-remove",
  "announcement-toggle",
  "view-rich",
  "message-menu",
  "load-older",
  "appearance",
  "ui-mode",
  "setting",
  "retry",
  "edit",
  "revoke",
  "react",
  "call",
  "advanced-settings",
  "mention",
  "mute",
  "record-cancel",
  "clear-attachments",
  "chat-details",
  "close-details",
  "chat-mute",
  "pin-chat",
  "block-chat",
  "open-member",
  "host-menu",
  "dismiss-host-menu",
] as const;
export type ComposeAction = {
  action: (typeof ACTIONS)[number];
  id?: string;
  value?: string;
  x: number;
  y: number;
  selectionStart?: number;
  selectionEnd?: number;
  epoch?: number;
  chatId?: string;
};

const CHAT_ACTIONS = new Set<string>([
  "pane-focus",
  "pane-close",
  "pane-move",
  "content-slot",
  "content-slot-removed",
  "draft",
  "send",
  "reply",
  "cancel-reply",
  "attach",
  "record-start",
  "record-stop",
  "record-cancel",
  "remove-attachment",
  "clear-attachments",
  "send-attachments",
  "sticker-picker",
  "chat-tools",
  "readers",
  "close-readers",
  "reader-profile",
  "chat-search",
  "chat-search-query",
  "chat-search-next",
  "chat-search-previous",
  "chat-search-close",
  "chat-refresh",
  "join-call",
  "chat-menu",
  "jump-message",
  "announcement-remove",
  "announcement-toggle",
  "view-rich",
  "message-menu",
  "load-older",
  "retry",
  "edit",
  "revoke",
  "react",
  "call",
  "mention",
  "mute",
  "chat-details",
  "close-details",
  "chat-mute",
  "pin-chat",
  "block-chat",
  "open-member",
  "files",
]);

export function matchesKmpContext(
  value: { epoch?: unknown; chatId?: unknown; action?: unknown; type?: unknown },
  epoch: number,
  chatId: string | null,
): boolean {
  if (value.epoch !== epoch) return false;
  return (
    !CHAT_ACTIONS.has(String(value.action ?? value.type)) ||
    (chatId !== null && value.chatId === chatId)
  );
}

/** Global/tab commands carry a scope too, but must not reactivate its previous chat. */
export function isKmpChatInteraction(action: ComposeAction["action"]): boolean {
  return (
    CHAT_ACTIONS.has(action) &&
    !action.startsWith("pane-") &&
    action !== "close-details" &&
    action !== "close-readers"
  );
}

/** The iframe cannot invoke arbitrary store methods or supply product state. */
export function readComposeAction(value: unknown): ComposeAction | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (
    event.channel !== COMPOSE_CHANNEL ||
    event.version !== COMPOSE_VERSION ||
    event.type !== "action" ||
    !ACTIONS.some((action) => action === event.action)
  )
    return null;
  if (event.id !== undefined && (typeof event.id !== "string" || event.id.length > 512))
    return null;
  if (event.value !== undefined && (typeof event.value !== "string" || event.value.length > 65_536))
    return null;
  return {
    action: event.action as ComposeAction["action"],
    id: event.id as string | undefined,
    value: event.value as string | undefined,
    x: typeof event.x === "number" && Number.isFinite(event.x) ? event.x : 16,
    y: typeof event.y === "number" && Number.isFinite(event.y) ? event.y : 16,
    ...(typeof event.selectionStart === "number" &&
    Number.isInteger(event.selectionStart) &&
    event.selectionStart >= 0
      ? { selectionStart: event.selectionStart }
      : {}),
    ...(typeof event.selectionEnd === "number" &&
    Number.isInteger(event.selectionEnd) &&
    event.selectionEnd >= 0
      ? { selectionEnd: event.selectionEnd }
      : {}),
    ...(typeof event.epoch === "number" && Number.isSafeInteger(event.epoch)
      ? { epoch: event.epoch }
      : {}),
    ...(typeof event.chatId === "string" && event.chatId.length <= 512
      ? { chatId: event.chatId }
      : {}),
  };
}
import type { NativeMenuSnapshot } from "./native-menu";
