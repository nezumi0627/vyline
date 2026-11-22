import type {
  Chat,
  Message,
  MessageContentMeta,
  MessageReaction,
  MessageSnapshot,
} from "@vyline/types";

export interface StoredChat {
  mid: string;
  name: string;
  kind: Chat["kind"];
  hasMessages: boolean;
  lastMessageTime?: number | undefined;
  lastMessageId?: string | undefined;
  lastMessagePreview?: string | undefined;
  thumbnailUrl?: string;
  unreadCount?: number;
  isOfficial?: boolean;
  /** 外部バックアップから復元された履歴を持つ。退出済みグループも履歴として表示するために使う。 */
  restoredHistory?: boolean;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  chatMid: string;
  from: string;
  to: string;
  text: string | null;
  contentType: string;
  createdTime: number;
  isMyMessage: boolean;
  contentMetadata?: MessageContentMeta | null;
  readCount?: number;
  readBy?: string[];
  seen?: boolean;
  relatedMessageId?: string | null;
  stickerAnimated?: boolean;
  stickerSticky?: boolean;
  reactions?: MessageReaction[];
  savedAt: string;
  messageState?: Message["messageState"];
  history?: Message["history"];
  revokedSnapshot?: MessageSnapshot;
  /** UIからは通常隠すが、復元のためレコード自体はSQLiteに残す。 */
  isDeleted?: boolean;
  deletedAt?: string | null;
  /** reader MID → 既読になった時刻。readBy/readCountとの互換用。 */
  readAtBy?: Record<string, string>;
}
