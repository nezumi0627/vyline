import { z } from "zod";
import { MEDIA_SEND_MAX_BATCH_ITEMS } from "../service/mediaSendStaging.js";

// Only reviewed BFF operations are exposed. Never accept a caller-provided URL,
// method, account switch, or arbitrary RPC name.
export const accountId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\p{L}\p{N}_-]+$/u);
export const mid = z.string().regex(/^[ucr][0-9a-f]{32}$/);
export const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
export const text = z.string().min(1).max(10000);
export const count = z.number().int().min(1).max(100);
export const time = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const flag = z.enum(["0", "1"]);
const mids = z.array(mid).min(1).max(100);
const ids = z.array(id).min(1).max(100);

export interface RouteTool {
  name: string;
  description: string;
  method: string;
  path: string;
  schema: z.ZodObject;
  write: boolean;
  query: string[];
  serverAdmin: boolean;
}
function route(
  name: string,
  description: string,
  method: string,
  path: string,
  fields: z.ZodRawShape = {},
  options: { write?: boolean; query?: string[]; serverAdmin?: boolean } = {},
): RouteTool {
  return {
    name,
    description,
    method,
    path: `/:accountId${path}`,
    schema: z.strictObject({ accountId, ...fields }),
    write: options.write ?? method !== "GET",
    query: options.query ?? [],
    serverAdmin: options.serverAdmin ?? false,
  };
}
const chat = { chatMid: mid };
const message = { ...chat, messageId: id };
const note = { homeId: mid, postId: id };
const noteContent = {
  text: text.optional(),
  sharedPostId: id.optional(),
  stickerIds: ids.optional(),
  stickerPackageIds: ids.optional(),
  mediaObjectIds: ids.optional(),
  mediaObjectTypes: z
    .array(z.enum(["PHOTO", "VIDEO"]))
    .max(100)
    .optional(),
};
const album = { albumId: id, chatId: mid };
const poll = { ...chat, questionId: id };
const schedule = { ...chat, eventId: id };
const combination = {
  items: z
    .array(
      z.strictObject({
        packageId: id,
        stickerId: id,
        x: z.number().optional(),
        y: z.number().optional(),
        size: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(20),
  idOfPreviousVersionOfCombinationSticker: id.optional(),
};

export const routeTools: RouteTool[] = [
  route("get_profile", "指定アカウント自身のプロフィール。", "GET", "/profile"),
  route(
    "get_friend",
    "MIDを指定して友人の名前・プロフィールを取得。",
    "GET",
    "/contact/:targetMid",
    { targetMid: mid },
  ),
  route(
    "send_message",
    "指定アカウントからテキストを送信。返信はrelatedMessageId。明示された宛先と本文だけを送る。",
    "POST",
    "/send",
    {
      ...chat,
      text,
      relatedMessageId: id.optional(),
      mute: z.boolean().optional(),
      contentMetadata: z.strictObject({ MENTION: z.string().max(10000).optional() }).optional(),
    },
  ),
  route("edit_message", "送信済みメッセージの本文を編集。", "POST", "/edit", { ...message, text }),
  route("unsend_message", "送信済みメッセージを取り消す。", "POST", "/unsend", { messageId: id }),
  route(
    "get_message_history",
    "指定メッセージの編集・取消履歴。",
    "GET",
    "/messages/:chatMid/:messageId/history",
    message,
  ),
  route(
    "mark_read",
    "指定メッセージまで既読を送信。履歴を読むだけではこのtoolを呼ばない。",
    "POST",
    "/read",
    message,
  ),
  route("mark_all_read", "指定アカウントの全トークを既読にする。", "POST", "/read-all"),
  route(
    "get_read_receipts",
    "送信メッセージの既読状況。idsはメッセージIDをカンマ区切りで指定。",
    "GET",
    "/read-receipts/:chatMid",
    { ...chat, ids: z.string().regex(/^[0-9]+(?:,[0-9]+){0,99}$/), force: flag.optional() },
  ),
  route(
    "poll_events",
    "指定アカウントの新着・既読・着信イベント。返されたcursorを次回に渡す。reset=trueはバッファ欠落を示すため履歴を再取得する。自動プッシュ通知ではない。",
    "GET",
    "/events/poll",
    { cursor: time.default(0) },
  ),
  route("get_stickers", "利用可能なスタンプ・絵文字一覧。", "GET", "/stickers"),
  route("send_sticker", "指定トークへスタンプを送信。", "POST", "/send-sticker", {
    ...chat,
    packageId: id,
    stickerId: id,
    isPremium: z.boolean().optional(),
  }),
  route("send_emoji", "指定トークへLINE絵文字を送信。", "POST", "/send-emoji", {
    ...chat,
    packageId: id,
    sticonId: id,
  }),
  route(
    "react_to_message",
    "メッセージへリアクション。UNDOで解除。",
    "POST",
    "/messages/:messageId/react",
    { messageId: id, reaction: z.enum(["NICE", "LOVE", "FUN", "AMAZING", "SAD", "OMG", "UNDO"]) },
  ),
  route("update_profile", "自身の表示名・ステータス・検索許可を更新。", "PATCH", "/profile", {
    displayName: text.optional(),
    statusMessage: z.string().max(500).optional(),
    phoneticName: text.optional(),
    allowSearchByUserid: z.boolean().optional(),
    allowSearchByEmail: z.boolean().optional(),
    hiddenFromList: z.boolean().optional(),
  }),
  route("rename_friend", "友人の表示名を変更。nullで上書きを解除。", "PATCH", "/contacts/:mid", {
    mid,
    displayNameOverride: text.nullable(),
  }),
  route("block_friend", "友人をブロック。", "POST", "/contacts/:mid/block", { mid }),
  route("unblock_friend", "友人のブロックを解除。", "DELETE", "/contacts/:mid/block", { mid }),
  route("list_blocked_friends", "ブロック中の友人MID一覧。", "GET", "/blocked"),
  route(
    "check_friend_block_status",
    "送信テストをせず友人・ブロック状態を照会。",
    "POST",
    "/block-verification",
    { mid: mid.optional() },
    { write: false },
  ),
  route("get_common_groups", "友人との共通グループを取得。", "GET", "/common-groups/:targetMid", {
    targetMid: mid,
  }),
  route(
    "get_group_members",
    "トークのメンバー名とMIDを取得。",
    "GET",
    "/chats/:chatMid/members",
    chat,
  ),
  route("create_group", "グループを作成。", "POST", "/chats/create-group", {
    name: text,
    memberMids: mids,
  }),
  route("rename_group", "グループ名を変更。", "PATCH", "/chats/:chatMid", { ...chat, name: text }),
  route("invite_to_group", "指定した友人をグループへ招待。", "POST", "/chats/:chatMid/invite", {
    ...chat,
    memberMids: mids,
  }),
  route("leave_group", "指定グループから退室。", "POST", "/chats/:chatMid/leave", chat),
  route("set_notifications", "指定アカウントの通知設定を変更。", "POST", "/notifications", {
    enable: z.boolean(),
  }),
  route("get_announcements", "トークのアナウンスを取得。", "GET", "/announcements/:chatMid", chat),
  route("create_announcement", "トークへアナウンスを作成。", "POST", "/announcements", {
    ...chat,
    text,
    messageId: id.optional(),
  }),
  route("delete_announcement", "アナウンスを削除。", "DELETE", "/announcements/:chatMid/:seq", {
    ...chat,
    seq: id,
  }),
  route("list_active_calls", "指定アカウントで稼働している通話を確認。", "GET", "/call/active"),
  route("get_call_status", "指定アカウントに属する通話の状態。", "GET", "/call/status", {
    sessionId: z.uuid(),
  }),
  route("get_group_call_status", "グループ通話の状態。", "GET", "/call/group-status", chat),
  route(
    "start_call",
    "通話を開始。音声・映像自体はVylineの通話画面で接続する必要がある。",
    "POST",
    "/call/start",
    {
      to: mid,
      callType: z.enum(["AUDIO", "VIDEO"]).default("AUDIO"),
      joinOnly: z.boolean().optional(),
    },
  ),
  route("answer_call", "着信へ応答。音声・映像はVyline画面で接続。", "POST", "/call/answer", {
    callMid: mid,
  }),
  route("end_call", "指定アカウントの通話を終了。", "POST", "/call/end", { sessionId: z.uuid() }),
  route(
    "list_notes",
    "グループのノート一覧。コンテンツ用ログインが必要な場合がある。",
    "GET",
    "/notes",
    { homeId: mid },
  ),
  route("get_note", "ノートの内容を取得。", "GET", "/notes/:postId", note),
  route("create_note", "ノートを作成。", "POST", "/notes", { homeId: mid, ...noteContent }),
  route("update_note", "ノートを編集。", "PATCH", "/notes/:postId", { ...note, ...noteContent }),
  route("delete_note", "ノートを削除。", "DELETE", "/notes/:postId", note, { query: ["homeId"] }),
  route("like_note", "ノートにいいね。", "POST", "/notes/:postId/like", {
    ...note,
    likeType: z.enum(["1001", "1002", "1003", "1004", "1005", "1006"]).optional(),
  }),
  route("unlike_note", "ノートのいいねを解除。", "DELETE", "/notes/:postId/like", note, {
    query: ["homeId"],
  }),
  route("get_note_like", "自身のノートいいねを確認。", "GET", "/notes/:postId/like", note),
  route("list_note_likes", "ノートのいいね一覧。", "GET", "/notes/:postId/likes", note),
  route("comment_note", "ノートにコメント。", "POST", "/notes/:postId/comments", {
    ...note,
    text: text.optional(),
    imageObjectId: id.optional(),
  }),
  route("share_note", "ノートを所属グループのトークへ共有。", "POST", "/notes/:postId/share", note),
  route("list_albums", "グループのアルバム一覧。cursorで続き。", "GET", "/albums", {
    chatId: mid,
    cursor: text.optional(),
    orderBy: text.optional(),
    include: text.optional(),
  }),
  route("create_album", "アルバムを作成。", "POST", "/albums", {
    chatId: mid,
    title: text,
    modifyDuplicateTitle: z.boolean().optional(),
  }),
  route("rename_album", "アルバムのタイトルを変更。", "PATCH", "/albums/:albumId", {
    ...album,
    title: text,
  }),
  route("delete_album", "アルバムを削除。", "DELETE", "/albums/:albumId", album, {
    query: ["chatId"],
  }),
  route("share_album", "アルバムをグループへ共有。", "POST", "/albums/:albumId/share", album),
  route(
    "list_album_photos",
    "アルバムの写真を取得。cursorで続き。",
    "GET",
    "/albums/:albumId/photos",
    {
      ...album,
      cursor: text.optional(),
      pageSize: count.optional(),
      orderBy: text.optional(),
      include: text.optional(),
    },
  ),
  route(
    "delete_album_photos",
    "アルバム内の指定写真を削除。",
    "DELETE",
    "/albums/:albumId/photos",
    { ...album, photoIds: ids },
  ),
  route("list_polls", "トークの投票一覧。", "GET", "/poll/list/:chatMid", chat),
  route("get_poll", "投票の内容と結果。", "GET", "/poll/:questionId/:chatMid", poll),
  route("create_poll", "投票を作成。", "POST", "/poll/create", {
    ...chat,
    title: text,
    multiple: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    closeDate: time.optional(),
    choiceList: z.array(z.strictObject({ text })).min(2).max(100),
  }),
  route("vote_poll", "投票に回答。", "POST", "/poll/:questionId/vote", { ...poll, choiceIds: ids }),
  route("close_poll", "投票を締め切る。", "GET", "/poll/:questionId/close/:chatMid", poll, {
    write: true,
  }),
  route("delete_poll", "投票を削除。", "GET", "/poll/:questionId/remove/:chatMid", poll, {
    write: true,
  }),
  route("announce_poll", "投票をアナウンス。", "POST", "/poll/:questionId/announce", poll),
  route("remind_poll", "投票のリマインダーを送信。", "POST", "/poll/:questionId/remind", poll),
  route("get_schedule", "日程調整の詳細。", "GET", "/schedule/events/:eventId/:chatMid", schedule),
  route(
    "create_schedule",
    "日程調整を作成。candidatesは既存LINE日程APIの日時値。",
    "POST",
    "/schedule/events",
    {
      ...chat,
      name: text,
      description: text.optional(),
      candidates: z.array(time).min(1).max(100),
      pictureId: time.optional(),
    },
  ),
  route("answer_schedule", "日程調整に回答。", "POST", "/schedule/events/:eventId/answer", {
    ...schedule,
    answers: z
      .array(z.strictObject({ candidate: time, status: text }))
      .min(1)
      .max(100),
    comment: text.optional(),
  }),
  route(
    "share_schedule",
    "日程調整を指定グループに共有。",
    "POST",
    "/schedule/events/:eventId/share",
    { ...schedule, groupEncIds: ids, comment: text.optional() },
  ),
  route(
    "list_schedule_groups",
    "日程調整の共有先グループ候補。",
    "GET",
    "/schedule/groups/:chatMid",
    chat,
  ),
  route(
    "get_schedule_group",
    "日程調整の共有先グループ識別子。",
    "GET",
    "/schedule/group/:chatMid",
    chat,
  ),
  route("list_schedule_friends", "日程調整の友人候補。", "GET", "/schedule/friends/:chatMid", chat),
  route("list_backups", "指定アカウントのバックアップ一覧。", "GET", "/backup/list"),
  route("list_backup_chats", "バックアップ対象トーク一覧。", "GET", "/backup/chats"),
  route("create_backup", "指定アカウントのバックアップを作成。", "POST", "/backup/create", {
    chatMids: mids.optional(),
    includeMedia: z.boolean().default(false),
  }),
  route("restore_backup", "指定アカウントのバックアップを復元。", "POST", "/backup/restore", {
    backupId: id,
    chatMids: mids.optional(),
    includeMedia: z.boolean().default(false),
  }),
  route("delete_backup", "指定アカウントのバックアップを削除。", "DELETE", "/backup/:backupId", {
    backupId: id,
  }),
  route("get_storage_usage", "指定アカウントのストレージ使用量。", "GET", "/backup/storage"),
  route("get_feature_locks", "指定アカウントの機能ロック状態。", "GET", "/feature-locks"),
  route(
    "release_group_creation_lock",
    "グループ作成禁止を明示的に解除。",
    "DELETE",
    "/feature-locks/create-group-ban",
  ),
  route("get_chat_locks", "操作保護中のトーク一覧。", "GET", "/chat-locks"),
  route("set_chat_lock", "指定トークの操作保護を設定・解除。", "PUT", "/chat-locks/:chatMid", {
    ...chat,
    locked: z.boolean(),
  }),
  route(
    "get_invite_rejection",
    "グループの招待拒否設定。",
    "GET",
    "/chats/:chatMid/invite-reject",
    chat,
  ),
  route(
    "set_invite_rejection",
    "グループの招待拒否設定を更新。",
    "PUT",
    "/chats/:chatMid/invite-reject",
    { ...chat, enabled: z.boolean(), targetMids: z.array(mid).max(1000) },
  ),
  route(
    "silent_unsend_message",
    "メッセージを静かに送信取消。LINE側対応条件に従う。",
    "POST",
    "/silent-unsend",
    { messageId: id },
  ),
  route(
    "restore_message",
    "保存されている取消前のメッセージをローカルへ復元。",
    "POST",
    "/restore",
    message,
    { query: ["chatMid"] },
  ),
  route(
    "mark_chats_read",
    "指定した複数トークを指定メッセージまで既読にする。",
    "POST",
    "/read-batch",
    {
      targets: z
        .array(z.strictObject({ chatMid: mid, lastMessageId: id }))
        .min(1)
        .max(100),
    },
  ),
  route("get_edit_notice", "トークの編集通知を取得。", "GET", "/edit-notice/:chatMid", chat),
  route(
    "check_combination_stickers",
    "組合せスタンプを作成可能か確認。",
    "POST",
    "/combination-stickers/can-create",
    { packageIds: ids },
    { write: false },
  ),
  route(
    "check_combination_package",
    "スタンプパッケージの組合せ可否。",
    "POST",
    "/combination-stickers/available",
    { packageId: id },
    { write: false },
  ),
  route(
    "create_combination_sticker",
    "組合せスタンプを作成。",
    "POST",
    "/combination-stickers",
    combination,
  ),
  route("send_combination_sticker", "組合せスタンプを送信。", "POST", "/send-combination-sticker", {
    ...chat,
    ...combination,
  }),
  route(
    "add_album_photos",
    "upload_album_mediaで得た写真をアルバムへ追加。",
    "POST",
    "/albums/:albumId/photos",
    {
      ...album,
      photos: z
        .array(
          z.strictObject({
            obsResourceId: z.strictObject({ oid: id, sid: id.optional(), svc: id.optional() }),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            shotTime: time.optional(),
            resourceType: text.optional(),
          }),
        )
        .min(1)
        .max(100),
    },
  ),
  route("preview_albums", "アルバムのプレビュー一覧。", "GET", "/albums/preview", {
    chatId: mid,
    pageSize: count.optional(),
    thumbnailCount: count.optional(),
    viewType: text.optional(),
  }),
  route("list_local_plugins", "指定アカウントで利用できるVylineプラグイン。", "GET", "/plugins"),
  route(
    "set_local_plugin",
    "指定アカウントの既存Vylineプラグインを有効・無効にする。",
    "POST",
    "/plugins/:pluginId/:action",
    { pluginId: id, action: z.enum(["enable", "disable"]) },
  ),
  route(
    "rebuild_chat_database",
    "指定アカウントのトークDBを退避して再構築。",
    "POST",
    "/chatdb/rebuild",
  ),
  route("index_account", "指定アカウントのキャッシュを整備。", "POST", "/index"),
  route(
    "warm_account_cache",
    "指定アカウントの友人プロフィールキャッシュを更新。",
    "POST",
    "/vyline/warm",
    { mids },
  ),
  route(
    "clear_asset_cache",
    "サーバー共通の再取得可能な画像キャッシュを削除。admin scopeが必要。",
    "DELETE",
    "/vyline/cache",
    {},
    { serverAdmin: true },
  ),
  route(
    "clear_saved_media",
    "指定アカウントの保存メディアを削除。",
    "DELETE",
    "/vyline/saved-media",
  ),
  route(
    "clear_saved_media_type",
    "指定アカウントの種類別保存メディアを削除。",
    "DELETE",
    "/vyline/saved-media/:type",
    { type: z.enum(["image", "video", "audio", "file"]) },
  ),
  route(
    "get_server_storage",
    "サーバー全体の使用量。admin scopeが必要。",
    "GET",
    "/vyline/storage",
    {},
    { serverAdmin: true },
  ),
  route(
    "clear_server_cdn_cache",
    "サーバー共通CDNキャッシュを削除。admin scopeが必要。",
    "DELETE",
    "/vyline/cache/cdn",
    {},
    { serverAdmin: true },
  ),
  route(
    "clear_server_icon_cache",
    "サーバー共通アイコンキャッシュを削除。admin scopeが必要。",
    "DELETE",
    "/vyline/cache/icons",
    {},
    { serverAdmin: true },
  ),
  route(
    "get_server_proxy",
    "サーバー共通プロキシ設定。admin scopeが必要。",
    "GET",
    "/proxy",
    {},
    { serverAdmin: true },
  ),
  route(
    "set_server_proxy",
    "サーバー共通プロキシを変更。admin scopeが必要。",
    "PUT",
    "/proxy",
    { enabled: z.boolean(), url: z.string().max(2048) },
    { serverAdmin: true },
  ),
  route(
    "reissue_channel_token",
    "指定アカウントのチャネルトークンを再発行。値は返さない。",
    "POST",
    "/credentials/channel/:channelId/reissue",
    { channelId: id },
  ),
  route("list_recordings", "指定アカウントの通話記録一覧。", "GET", "/recordings", {
    cursor: text.optional(),
  }),
  route("get_recording", "指定通話記録の状態。", "GET", "/recordings/:id", { id }),
  route("delete_recording", "指定通話記録を削除。", "DELETE", "/recordings/:id", { id }),
  route(
    "retry_recording_transfer",
    "通話記録の保存先への転送を再試行。",
    "POST",
    "/recordings/:id/retry",
    { id },
  ),
  route(
    "get_recording_settings",
    "指定アカウントの録音設定と保存先。",
    "GET",
    "/recordings/settings",
  ),
  route("update_recording_settings", "録音設定を更新。", "PUT", "/recordings/settings", {
    automatic: z.boolean(),
    kind: z.enum(["audio", "video"]),
    retentionDays: z.number().int().min(0).max(3650),
    targetId: id.nullable(),
    consentAccepted: z.boolean(),
  }),
  route(
    "add_recording_target",
    "録音の保存先を追加。ローカルパスはサーバーの許可ルート内のみ。",
    "POST",
    "/recordings/targets",
    {
      name: text,
      kind: z.enum(["local", "webdav"]),
      path: text,
      username: text.optional(),
      password: text.optional(),
      allowPrivateNetwork: z.boolean().optional(),
      allowInsecureHttp: z.boolean().optional(),
    },
  ),
  route(
    "test_recording_target",
    "録音保存先への接続を確認。",
    "POST",
    "/recordings/targets/:targetId/test",
    { targetId: id },
  ),
  route(
    "delete_recording_target",
    "指定アカウントの録音保存先を削除。",
    "DELETE",
    "/recordings/targets/:targetId",
    { targetId: id },
  ),
  route(
    "suggest_recording_paths",
    "サーバー許可ルート内の録音保存先候補。admin scopeが必要。",
    "GET",
    "/recordings/paths",
    { prefix: z.string().max(2048).optional() },
    { serverAdmin: true },
  ),
  route(
    "start_recording",
    "接続中通話の記録を開始。記録データはappend_recording_chunkまたはVyline画面から供給。",
    "POST",
    "/recordings/start",
    {
      sessionId: z.uuid(),
      title: text,
      kind: z.enum(["audio", "video"]),
      mimeType: z.enum(["audio/webm", "video/webm", "audio/mp4", "video/mp4"]),
      consentAccepted: z.literal(true),
    },
  ),
  route("finish_recording", "記録データの送信完了を通知。", "POST", "/recordings/:id/finish", {
    id,
    durationMs: time,
    interrupted: z.boolean().optional(),
  }),
  route(
    "get_message_delta",
    "指定メッセージ以降の新着を同期。",
    "GET",
    "/messages/:chatMid/delta",
    { ...chat, after: id, limit: z.number().int().min(1).max(50).default(25) },
  ),
  route("get_profile_cache", "指定アカウントのプロフィールキャッシュ。", "GET", "/vyline/cache"),
  route(
    "get_note_updates",
    "指定revision以降のノート更新。",
    "POST",
    "/notes/updates",
    { revision: time },
    { write: false, query: ["revision"] },
  ),
  route("warm_liff", "投票・日程・あみだくじのLINE認証を準備。", "POST", "/liff/warm", {
    ...chat,
    app: z.enum(["ladder", "schedule", "poll"]),
  }),
  route(
    "get_ladder_members",
    "あみだくじのメンバー候補。",
    "GET",
    "/ladder/members/:chatMid",
    chat,
  ),
  route("generate_ladder", "あみだくじを生成。", "POST", "/ladder/generate", {
    ...chat,
    memberIds: ids,
    options: z.array(text).min(1).max(100),
  }),
  route("get_ladder_result", "あみだくじの結果。", "GET", "/ladder/result/:chatMid/:hash", {
    ...chat,
    hash: id,
  }),
  route("send_ladder", "あみだくじをトークに送信。", "POST", "/ladder/message", {
    ...chat,
    hash: id,
  }),
  route(
    "start_media_batch",
    "画像・メディアの一括送信用アップロードを開始。",
    "POST",
    "/send-media-batch/start",
    { ...chat, itemCount: z.number().int().min(1).max(MEDIA_SEND_MAX_BATCH_ITEMS) },
  ),
  route(
    "complete_media_batch",
    "全アイテムのアップロード後、一括送信を確定。",
    "POST",
    "/send-media-batch/:uploadId/complete",
    { uploadId: id },
  ),
  route(
    "cancel_media_batch",
    "一括送信のアップロードを破棄。",
    "DELETE",
    "/send-media-batch/:uploadId",
    { uploadId: id },
  ),
  route(
    "list_ios_backups",
    "サーバーに存在するiOSバックアップ一覧。admin scopeが必要。",
    "GET",
    "/ios-backups",
    {},
    { serverAdmin: true },
  ),
  route(
    "restore_ios_backup",
    "iOSバックアップを指定アカウントへ復元。対応OS・ツールが必要。admin scopeが必要。",
    "POST",
    "/restore/ios-backup",
    { udid: id, password: text },
    { serverAdmin: true },
  ),
  route(
    "get_ios_restore_status",
    "iOSバックアップ復元の進捗。",
    "GET",
    "/restore/ios-backup/:sessionId",
    { sessionId: id },
  ),
  route(
    "start_android_backup_upload",
    "Androidバックアップの分割アップロードを開始。",
    "POST",
    "/restore/android-backup/chunked",
    { sourceName: text, includeMedia: z.boolean().default(false), expectedBytes: time },
  ),
  route(
    "complete_android_backup_upload",
    "Androidバックアップのアップロードを確定して復元。",
    "POST",
    "/restore/android-backup/chunked/:uploadId/complete",
    { uploadId: id },
  ),
  route(
    "cancel_android_backup_upload",
    "Androidバックアップのアップロードを破棄。",
    "DELETE",
    "/restore/android-backup/chunked/:uploadId",
    { uploadId: id },
  ),
  route(
    "get_android_restore_status",
    "Androidバックアップ復元の進捗。",
    "GET",
    "/restore/android-backup/:sessionId",
    { sessionId: id },
  ),
  route(
    "restore_desktop_credentials",
    "サーバーのLINE Desktopから既存の鍵を復元。対応環境とadmin scopeが必要。",
    "POST",
    "/restore/desktop",
    {},
    { serverAdmin: true },
  ),
  route("get_desktop_restore_status", "Desktop復元の状態。", "GET", "/restore/status"),
  route(
    "get_message_log",
    "指定アカウントのメッセージ診断ログ。鍵やトークンは除外。",
    "GET",
    "/log",
    { limit: count.default(50) },
  ),
  route(
    "export_credential_handoff",
    "指定アカウントの認証情報をパスフレーズ暗号化した引継ぎbundleへ書き出す。admin scopeが必要。",
    "POST",
    "/credentials/handoff/export",
    { passphrase: z.string().min(8).max(1024) },
    { serverAdmin: true },
  ),
  route(
    "import_credential_handoff",
    "暗号化引継ぎbundleを指定アカウントへ復元。admin scopeが必要。",
    "POST",
    "/credentials/handoff/import",
    {
      passphrase: z.string().min(8).max(1024),
      bundle: z.strictObject({
        schema: text,
        version: z.number().int(),
        accountId,
        createdAt: text,
        salt: text,
        iv: text,
        tag: text,
        ciphertext: z
          .string()
          .min(1)
          .max(10 * 1024 * 1024),
      }),
    },
    { serverAdmin: true },
  ),
];

export function routeRequest(tool: RouteTool, args: Record<string, unknown>): Request {
  const used = new Set<string>();
  const path = tool.path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    used.add(key);
    return encodeURIComponent(String(args[key]));
  });
  const url = new URL(path, "http://vyline.internal");
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (used.has(key) || value === undefined) continue;
    if (tool.method === "GET" || tool.query.includes(key)) url.searchParams.set(key, String(value));
    else body[key] = value;
  }
  return new Request(url, {
    method: tool.method,
    ...(tool.method !== "GET"
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}
