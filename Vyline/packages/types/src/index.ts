/**
 * packages/types/src/index.ts
 *
 * フロントエンド・バックエンド共有の型定義。
 * ここを single source of truth にする。
 */

// ─── Account ──────────────────────────────────

export interface LineBirthday {
	/** "YYYY" or empty when year hidden */
	year?: string;
	/** "MMDD" (LINE 形式) or "MM-DD" */
	day?: string;
	/** 表示用 "M月D日" / "YYYY年M月D日" */
	display?: string;
	yearEnabled?: boolean;
	dayEnabled?: boolean;
}

export interface LineProfile {
	mid: string;
	userid: string;
	displayName: string;
	phoneticName: string;
	pictureStatus: string;
	thumbnailUrl: string;
	statusMessage: string;
	picturePath: string;
	musicProfile: string;
	videoProfile: string;
	profileId: string;
	/** プロフィール背景（カバー）URL */
	backgroundUrl?: string | undefined;
	birthday?: LineBirthday | null | undefined;
	/** アカウント種別: USER=1 / BOT=2（公式アカウントは BOT） */
	userType?: number;
}

/** VylineCache から返す軽量プロフィール */
export interface VylineCachedProfile {
	mid: string;
	displayName: string;
	thumbnailUrl?: string;
	statusMessage?: string;
	musicProfile?: string;
	birthday?: string;
	backgroundUrl?: string;
	updatedAt: number;
}

export interface VylineCachedGroup {
	chatMid: string;
	name: string;
	thumbnailUrl?: string;
	memberMids: string[];
	members: Array<{ mid: string; displayName: string; thumbnailUrl?: string }>;
	updatedAt: number;
}

// ─── Chat ─────────────────────────────────────

export type ChatKind = "group" | "room" | "direct" | "unknown";

export interface Chat {
	mid: string;
	name: string;
	hasMessages: boolean;
	kind: ChatKind;
	lastMessageTime: number;
	/** 最終メッセージ ID（getMessageBoxes の lastDeliveredMessageId） */
	lastMessageId?: string;
	/** プロフィール/グループアイコン URL（無ければ空） */
	thumbnailUrl?: string;
	/** 一覧用の最終メッセージ短いプレビュー */
	lastMessagePreview?: string;
	/** 未読数（取得できない場合は undefined） */
	unreadCount?: number;
	/** 退出・キック済み（joined に無いが messageBox に残る） */
	left?: boolean;
	/** 公式アカウント（userType=BOT） */
	isOfficial?: boolean;
	/** ステータスメッセージ（直接トーク相手） */
	statusMessage?: string;
	/** プロフィール背景 URL */
	backgroundUrl?: string;
	/** 自分自身（Keepメモ）トーク */
	isSelf?: boolean;
}

// ─── Message ──────────────────────────────────

export interface MessageContentMeta {
	STKPKGID?: string;
	STKID?: string;
	STKVER?: string;
	STKTXT?: string;
	/** 通話・イベント系の表示用ヒント */
	eventType?: string;
	/** Flex / RICH 共通 */
	ALT_TEXT?: string;
	/** Flex Message JSON（通常は JSON 文字列。オブジェクトで来る場合もある） */
	FLEX_JSON?: string;
	FLEX_VER?: string;
	EFFECT_TAG?: string;
	/** RICH (contentType=17) Image Map */
	MARKUP_JSON?: string;
	DOWNLOAD_URL?: string;
	SPEC_REV?: string;
	PUBLIC?: string;
	/** 通話系メタ（Desktop / サーバ依存） */
	DURATION?: string;
	GC_DURATION?: string;
	CALL_TYPE?: string;
	RESULT?: string;
	TYPE?: string;
	[key: string]: string | undefined;
}

export interface Message {
	id: string;
	from: string;
	to: string;
	text: string | null;
	contentType: string;
	createdTime: number;
	isMyMessage: boolean;
	/** LINE contentMetadata（スタンプ ID 等） */
	contentMetadata?: MessageContentMeta | null;
	/** グループ既読数（取得できる場合） */
	readCount?: number;
	/** グループ: 既読したメンバー mid（分かる範囲） */
	readBy?: string[];
	/** DM: 相手が既読したか（自分の送信分） */
	seen?: boolean;
	/** 返信先メッセージ ID（LINE の「返信」機能。テキストへの引用埋め込みではない） */
	relatedMessageId?: string | null;
	/** 絵文字リアクション（LINE MessageReactionType の数値） */
	reactions?: MessageReaction[];
	/** 動くスタンプ（STKOPT="A"） */
	stickerAnimated?: boolean;
	/** くっつきスタンプ（位置固定マーカーあり） */
	stickerSticky?: boolean;
	/**
	 * 送信取り消し（UNSENT）前の元テキスト。サーバー側は常に保存するが、
	 * フロントはローカル設定（keepRevokedMessages）が ON の時のみ表示する。
	 */
	revokedText?: string | null;
	/** 送信取り消しを検知した時刻 (ISO8601) */
	revokedAt?: string | null;
}

export interface MessageReaction {
	/** リアクションしたユーザー mid */
	fromMid: string;
	/** リアクション時刻 (ms) */
	atMillis: number;
	/** MessageReactionType: NICE=2 LOVE=3 FUN=4 AMAZING=5 SAD=6 OMG=7 */
	type: number;
}

// ─── API Response shapes ──────────────────────

export interface ApiOk {
	ok: true;
}

export interface ApiError {
	ok: false;
	error: string;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

export type ProfileResponse = ApiResult<{ profile: LineProfile }>;
export type ChatsResponse = ApiResult<{
	chats: Chat[];
	fromCache?: boolean;
}>;
export type BootstrapResponse = ApiResult<{
	chats: Chat[];
	messagesByChat: Record<string, Message[]>;
	syncedAt: string | null;
	chatsSyncedAt: string | null;
	fromCache?: boolean;
}>;
export type MessagesResponse = ApiResult<{
	messages: Message[];
	hasMore?: boolean;
	fromCache?: boolean;
	timedOut?: boolean;
}>;
export type MessagesDeltaResponse = ApiResult<{ messages: Message[] }>;
export type TalkPollEvent =
	| { kind: "message"; seq: number; chatMid: string; message: Message }
	| { kind: "revoke"; seq: number; chatMid: string; messageId: string }
	| { kind: "read"; seq: number; chatMid: string }
	| { kind: "reaction"; seq: number; chatMid: string; messageId: string };
export type EventsPollResponse = ApiResult<{
	cursor: number;
	events: TalkPollEvent[];
	reset?: boolean;
	seq?: number;
}>;
export type ReadReceiptsResponse = ApiResult<{
	receipts: Record<
		string,
		{ seen?: boolean; readCount?: number; readBy?: string[] }
	>;
	peerReadUpTo?: string;
	memberReadWatermarks?: Array<{ mid: string; upTo: string }>;
	memberMids?: string[];
}>;
export type SendResponse = ApiResult<{ code?: string; message?: Message }>;
export type UnsendResponse = ApiResult<Record<string, never>>;

export type SavedSession = {
	accountId: string;
	savedAt: string;
	hasToken: boolean;
	active?: boolean;
	mid?: string;
	displayName?: string;
	picturePath?: string;
	statusMessage?: string;
};

export type AccountsResponse = ApiResult<{
	active: string[];
	saved: string[];
	sessions?: SavedSession[];
}>;

export type SessionsResponse = ApiResult<{ sessions: SavedSession[] }>;

// ─── Call ─────────────────────────────────────

export type CallType = "AUDIO" | "VIDEO";

export type CallSessionState =
	| "idle"
	| "acquiring"
	| "connecting"
	| "ringing"
	| "in-call"
	| "ending"
	| "ended"
	| "failed";

export interface CallSessionInfo {
	sessionId: string;
	accountId: string;
	to: string;
	kind: CallType;
	state: CallSessionState;
	transport: "planet" | "andromeda" | "unknown";
	startedAt: number;
	error?: string;
}

export interface CallRoute {
	/** サーバーが割り当てた通話識別子 */
	callId?: string;
	/** メディアサーバーホスト (cscf) */
	cscfHost?: string;
	/** ミックスサーバーホスト */
	mixHost?: string;
	/** フロムトークン */
	fromToken?: string;
	[key: string]: unknown;
}

export type CallRouteResponse = ApiResult<{ route: CallRoute }>;
export type CallStartResponse = ApiResult<{ session: CallSessionInfo }>;
export type CallStatusResponse = ApiResult<{ session: CallSessionInfo }>;
export type CallActiveResponse = ApiResult<{ sessions: CallSessionInfo[] }>;
export type CallResponse = ApiResult<Record<string, never>>;
export type LoginResult = ApiResult<{ message?: string; accountId?: string }>;

export type QrPollResponse = ApiResult<{
	status: "idle" | "waiting" | "pending" | "expired" | "completed";
	qrUrl: string | null;
	pincode: string | null;
}>;

export type EmailPollResponse = ApiResult<{
	status: "idle" | "pending" | "completed" | "failed";
	pincode: string | null;
	error: string | null;
}>;
