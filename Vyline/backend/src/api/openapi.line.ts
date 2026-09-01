/**
 * api/openapi.line.ts — BFF (/line) 内部 API の OpenAPI 3.1 仕様
 *
 * Swagger UI は GET /docs および /swagger で提供される。
 * 公開 REST API (/v1) の仕様は openapi.yaml を参照（/openapi/v1.yaml で提供）。
 *
 * operationId は可能な限り LINE プロトコルの関数名（RPC_DICTIONARY の
 * canonicalName、linejs 相当）を尊重する。LINE に対応 RPC が無いものは
 * Vyline 拡張として camelCase で定義する。
 */

// ── 共通フラグメント ────────────────────────────────────────

const acc = {
  name: "accountId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Vyline アカウント ID（例: main）",
} as const;

const chatMid = {
  name: "chatMid",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "チャット MID (u.../c.../r...)",
} as const;

const pathParam = (name: string, description: string) =>
  ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
    description,
  }) as const;

const queryParam = (name: string, description: string, required = false) =>
  ({
    name,
    in: "query",
    required,
    schema: { type: "string" },
    description,
  }) as const;

const ok = {
  type: "object",
  properties: { ok: { type: "boolean" } },
} as const;

const error = {
  type: "object",
  properties: { ok: { type: "boolean", enum: [false] }, error: { type: "string" } },
} as const;

const jsonRes = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});

const okRes = () => ({
  description: "結果",
  content: { "application/json": { schema: ok } },
});

const body = (required: string[], properties: Record<string, unknown>, description?: string) => ({
  required: true,
  description,
  content: {
    "application/json": {
      schema: { type: "object", required, properties },
    },
  },
});

// ── 操作テーブル ────────────────────────────────────────────
// [routePath, method, tag, spec]
// operationId は LINE 関数名準拠（Vyline 拡張は description に明記）

type Method = "get" | "post" | "put" | "patch" | "delete";
interface OpSpec {
  /** operationId — LINE 関数名（canonicalName）準拠 */
  op: string;
  summary: string;
  description?: string;
  tags: string[];
  params?: readonly object[];
  requestBody?: Record<string, unknown>;
  responses?: Record<string, unknown>;
}

const routes: Array<[string, Method, OpSpec]> = [
  // ── session ─────────────────────────────────────────────
  [
    "/healthz",
    "get",
    { op: "healthz", summary: "ヘルスチェック", tags: ["session"], responses: { "200": okRes() } },
  ],
  [
    "/auth/accounts",
    "get",
    {
      op: "listAccounts",
      summary: "登録済みアカウント一覧",
      tags: ["session"],
      responses: { "200": jsonRes("アカウント配列") },
    },
  ],
  [
    "/line/{accountId}/getProfile",
    "get",
    {
      op: "getProfile",
      summary: "自分のプロフィール取得",
      description: "LINE: TalkService.getProfile",
      tags: ["session"],
      params: [acc],
      responses: {
        "200": jsonRes("プロフィール"),
        "401": { description: "未ログイン", content: { "application/json": { schema: error } } },
      },
    },
  ],
  [
    "/line/{accountId}/updateProfileAttributes",
    "patch",
    {
      op: "updateProfileAttributes",
      summary: "プロフィール属性更新",
      description: "LINE: TalkService.updateProfileAttributes",
      tags: ["session"],
      params: [acc],
      requestBody: body([], {
        displayName: { type: "string" },
        statusMessage: { type: "string" },
        phoneticName: { type: "string" },
        musicProfile: { type: "string" },
      }),
      responses: { "200": jsonRes("プロフィール") },
    },
  ],
  [
    "/line/{accountId}/profile/image",
    "post",
    {
      op: "updateProfileImage",
      summary: "プロフィール画像更新",
      description: "LINE: updateProfileAttributes + OBS uploadMediaByE2EE",
      tags: ["session"],
      params: [acc],
      requestBody: body(["dataBase64"], { dataBase64: { type: "string" } }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/profile/background",
    "post",
    {
      op: "updateProfileBackground",
      summary: "プロフィール背景画像更新",
      tags: ["session"],
      params: [acc],
      requestBody: body(["dataBase64"], { dataBase64: { type: "string" } }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/bootstrap",
    "get",
    {
      op: "bootstrap",
      summary: "起動時一括 hydrate（チャット + 直近メッセージ）",
      description: "Vyline 拡張。getAllChatMids + getPreviousMessagesV2WithRequest の複合",
      tags: ["chats"],
      params: [acc],
      responses: { "200": jsonRes("BootstrapPayload") },
    },
  ],
  [
    "/line/{accountId}/fetchOperations",
    "get",
    {
      op: "fetchOperations",
      summary: "イベントポーリング（Talk Push バッファから取得）",
      description: "Vyline 拡張。LINE long-polling (fetchOperations) 相当の差分取得",
      tags: ["session"],
      params: [acc],
      responses: { "200": jsonRes("イベント配列") },
    },
  ],

  // ── chats ───────────────────────────────────────────────
  [
    "/line/{accountId}/getMessageBoxes",
    "get",
    {
      op: "getMessageBoxes",
      summary: "チャット一覧取得",
      description: "LINE: TalkService.getMessageBoxes",
      tags: ["chats"],
      params: [acc],
      responses: { "200": jsonRes("Chat 配列") },
    },
  ],
  [
    "/line/{accountId}/chat-locks",
    "get",
    {
      op: "getChatLocks",
      summary: "送信保護対象チャット一覧を取得",
      description: "Vyline 拡張。誤送信防止用のローカル設定",
      tags: ["chats"],
      params: [acc],
      responses: { "200": jsonRes("{ ok, chatMids }") },
    },
  ],
  [
    "/line/{accountId}/chat-locks/{chatMid}",
    "put",
    {
      op: "setChatLock",
      summary: "チャットの送信保護状態を更新",
      description: "Vyline 拡張。locked は必須 boolean",
      tags: ["chats"],
      params: [acc, chatMid],
      requestBody: body(["locked"], { locked: { type: "boolean" } }),
      responses: {
        "200": jsonRes("{ ok, locked, chatMids }"),
        "400": {
          description: "locked が boolean ではない",
          content: { "application/json": { schema: error } },
        },
      },
    },
  ],
  [
    "/line/{accountId}/chatdb/rebuild",
    "post",
    {
      op: "rebuildChatDatabase",
      summary: "ローカルチャット DB を再構築",
      description: "Vyline 拡張。復元・同期混在後の時系列と最新チャット要約を正規化する",
      tags: ["chats"],
      params: [acc],
      responses: { "200": jsonRes("再構築結果") },
    },
  ],
  [
    "/line/{accountId}/createChat",
    "post",
    {
      op: "createChat",
      summary: "グループ作成",
      description: "LINE: createChatV2",
      tags: ["chats"],
      params: [acc],
      requestBody: body(
        ["name", "memberMids"],
        {
          name: { type: "string" },
          memberMids: { type: "array", items: { type: "string" } },
          forbidUnbanOption: { type: "boolean" },
        },
        "forbidUnbanOption はグループ作成禁止解除オプション（自己責任）",
      ),
      responses: { "200": jsonRes("作成結果") },
    },
  ],
  [
    "/line/{accountId}/getChatMembers/{chatMid}",
    "get",
    {
      op: "getChatMembers",
      summary: "チャットメンバー一覧取得",
      tags: ["chats"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("メンバー配列") },
    },
  ],
  [
    "/line/{accountId}/inviteIntoChat/{chatMid}",
    "post",
    {
      op: "inviteIntoChat",
      summary: "グループ招待",
      description: "LINE: inviteIntoChat / inviteIntoGroup",
      tags: ["chats"],
      params: [acc, chatMid],
      requestBody: body(["memberMids"], {
        memberMids: { type: "array", items: { type: "string" } },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/chats/{chatMid}",
    "patch",
    {
      op: "updateChat",
      summary: "チャット名を更新",
      description: "LINE: TalkService.updateChat (NAME)",
      tags: ["chats"],
      params: [acc, chatMid],
      requestBody: body(["name"], { name: { type: "string", minLength: 1 } }),
      responses: {
        "200": okRes(),
        "400": { description: "name が空", content: { "application/json": { schema: error } } },
      },
    },
  ],
  [
    "/line/{accountId}/chats/{chatMid}/leave",
    "post",
    {
      op: "leaveChat",
      summary: "グループ退室",
      description: "LINE: leaveGroup / leaveRoom",
      tags: ["chats"],
      params: [acc, chatMid],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/chats/{chatMid}/picture",
    "post",
    {
      op: "updateChatPicture",
      summary: "グループ画像更新",
      description: "LINE: updateChat (PICTURE_STATUS) + OBS アップロード",
      tags: ["chats"],
      params: [acc, chatMid],
      requestBody: body([], { dataBase64: { type: "string" } }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/export/{chatMid}",
    "get",
    {
      op: "exportChat",
      summary: "チャットエクスポート",
      description: "Vyline 拡張",
      tags: ["chats"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("エクスポートデータ") },
    },
  ],

  // ── messages ────────────────────────────────────────────
  [
    "/line/{accountId}/getPreviousMessagesV2WithRequest/{chatMid}",
    "get",
    {
      op: "getPreviousMessagesV2WithRequest",
      summary: "メッセージ履歴取得（local-first + サーバ同期）",
      description: "LINE: TalkService.getPreviousMessagesV2WithRequest",
      tags: ["messages"],
      params: [
        acc,
        chatMid,
        { name: "limit", in: "query", schema: { type: "integer", default: 30, maximum: 100 } },
        { name: "force", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "local", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "beforeMessageId", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Message 配列（降順）",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  messages: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Message" },
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
  [
    "/line/{accountId}/getMessageDelta/{chatMid}",
    "get",
    {
      op: "getMessageDelta",
      summary: "メッセージ差分同期",
      description: "Vyline 拡張。visibility change 時の手動差分同期用",
      tags: ["messages"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("差分") },
    },
  ],
  [
    "/line/{accountId}/getMessageHistory/{chatMid}/{messageId}",
    "get",
    {
      op: "getMessageHistory",
      summary: "単一メッセージの詳細履歴",
      description: "Vyline 拡張",
      tags: ["messages"],
      params: [acc, chatMid, pathParam("messageId", "メッセージ ID")],
      responses: { "200": jsonRes("履歴") },
    },
  ],
  [
    "/line/{accountId}/sendMessage",
    "post",
    {
      op: "sendMessage",
      summary: "テキスト送信",
      description: "LINE: TalkService.sendMessage（メンションは contentMetadata.MENTION）",
      tags: ["messages"],
      params: [acc],
      requestBody: body(["chatMid", "text"], {
        chatMid: { type: "string" },
        text: { type: "string" },
        relatedMessageId: { type: "string" },
        mute: { type: "boolean" },
      }),
      responses: { "200": jsonRes("送信結果") },
    },
  ],
  [
    "/line/{accountId}/edit",
    "post",
    {
      op: "editMessage",
      summary: "メッセージ編集",
      description: "Vyline 拡張",
      tags: ["messages"],
      params: [acc],
      requestBody: body(["chatMid", "messageId", "text"], {
        chatMid: { type: "string" },
        messageId: { type: "string" },
        text: { type: "string" },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/getEditNotice/{chatMid}",
    "get",
    {
      op: "getEditNotice",
      summary: "編集通知取得",
      description: "Vyline 拡張",
      tags: ["messages"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("編集通知") },
    },
  ],
  [
    "/line/{accountId}/unsendMessage",
    "post",
    {
      op: "unsendMessage",
      summary: "メッセージ送信取り消し",
      description: "LINE: TalkService.unsendMessage",
      tags: ["messages"],
      params: [acc],
      requestBody: body(["messageId"], { messageId: { type: "string" } }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/sendChatChecked",
    "post",
    {
      op: "sendChatChecked",
      summary: "既読送信",
      description: "LINE: TalkService.sendChatChecked",
      tags: ["messages"],
      params: [acc],
      requestBody: body(["chatMid", "messageId"], {
        chatMid: { type: "string" },
        messageId: { type: "string" },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/read-batch",
    "post",
    {
      op: "markChatsReadBatch",
      summary: "複数チャットを一括既読",
      description: "Vyline 拡張。chatMid と lastMessageId が揃った target のみ処理する",
      tags: ["messages"],
      params: [acc],
      requestBody: body(["targets"], {
        targets: {
          type: "array",
          items: {
            type: "object",
            required: ["chatMid", "lastMessageId"],
            properties: {
              chatMid: { type: "string" },
              lastMessageId: { type: "string" },
            },
          },
        },
      }),
      responses: {
        "200": jsonRes("{ ok, count }"),
        "400": {
          description: "有効な targets がない",
          content: { "application/json": { schema: error } },
        },
      },
    },
  ],
  [
    "/line/{accountId}/read-all",
    "post",
    {
      op: "markAllChatsRead",
      summary: "全チャットまたは指定チャットを一括既読",
      description: "Vyline 拡張。body は省略可能",
      tags: ["messages"],
      params: [acc],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { chatMids: { type: "array", items: { type: "string" } } },
            },
          },
        },
      },
      responses: { "200": jsonRes("{ ok, count }") },
    },
  ],
  [
    "/line/{accountId}/getMessageReadRange/{chatMid}",
    "get",
    {
      op: "getMessageReadRange",
      summary: "既読情報取得",
      description: "LINE: TalkService.getMessageReadRange",
      tags: ["messages"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("既読範囲") },
    },
  ],
  [
    "/line/{accountId}/messages/{messageId}/react",
    "post",
    {
      op: "reactToMessage",
      summary: "リアクション送信",
      description: "Vyline 拡張。UNDO で取り消し",
      tags: ["messages"],
      params: [acc],
      requestBody: body(["reaction"], {
        reaction: {
          type: "string",
          enum: ["NICE", "LOVE", "FUN", "AMAZING", "SAD", "OMG", "UNDO"],
        },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/index",
    "post",
    {
      op: "reindexMessages",
      summary: "メッセージ索引再構築",
      description: "Vyline 拡張",
      tags: ["messages"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],

  // ── media ───────────────────────────────────────────────
  [
    "/line/{accountId}/media/{chatMid}/{messageId}",
    "get",
    {
      op: "downloadMediaByE2EE",
      summary: "メディア取得（キャッシュ → OBS → RPC フォールバック）",
      description: "LINE OBS: downloadMediaByE2EE",
      tags: ["media"],
      params: [
        acc,
        chatMid,
        pathParam("messageId", "メッセージ ID"),
        {
          name: "preview",
          in: "query",
          description:
            "1: 表示用プレビュー（既定）、0: 原本。保存済み原本があればオフライン互換のため再利用する。",
          schema: { type: "string", enum: ["0", "1"] },
        },
        {
          name: "Range",
          in: "header",
          required: false,
          description: "単一 byte range（例: bytes=0-1048575）",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "バイナリ",
          content: { "*/*": { schema: { type: "string", format: "binary" } } },
        },
        "206": {
          description: "Range 部分レスポンス",
          content: { "*/*": { schema: { type: "string", format: "binary" } } },
        },
        "401": { description: "未ログイン" },
        "416": { description: "Range が不正または範囲外" },
        "422": { description: "取得不能（期限切れ等）" },
      },
    },
  ],
  [
    "/line/{accountId}/send-media",
    "post",
    {
      op: "sendMedia",
      summary: "単体メディア送信",
      description: "LINE OBS: uploadMediaByE2EE / uploadObjectForService",
      tags: ["media"],
      params: [
        acc,
        {
          name: "X-Vyline-Chat-Mid",
          in: "header",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "X-Vyline-Media-Filename",
          in: "header",
          description: "encodeURIComponent済みファイル名",
          schema: { type: "string" },
        },
        {
          name: "X-Vyline-Media-Type",
          in: "header",
          schema: { type: "string", enum: ["image", "video", "audio", "file", "gif"] },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
        },
      },
      responses: {
        "200": okRes(),
        "400": { description: "メタデータまたはbody不備" },
        "413": { description: "11,250,000 bytes超過" },
      },
    },
  ],
  [
    "/line/{accountId}/send-media-batch/start",
    "post",
    {
      op: "startMediaBatchUpload",
      summary: "複数メディア送信のdisk-backed uploadを開始",
      tags: ["media"],
      params: [acc],
      requestBody: body(["chatMid", "itemCount"], {
        chatMid: { type: "string" },
        itemCount: { type: "integer", minimum: 1, maximum: 64 },
      }),
      responses: {
        "200": jsonRes("uploadIdと単品上限"),
        "400": { description: "chatMid/itemCount不備" },
      },
    },
  ],
  [
    "/line/{accountId}/send-media-batch/{uploadId}/items/{index}",
    "post",
    {
      op: "uploadMediaBatchItem",
      summary: "一括送信アイテムをbinary upload",
      tags: ["media"],
      params: [
        acc,
        pathParam("uploadId", "upload session ID"),
        pathParam("index", "0-based item index"),
        {
          name: "X-Vyline-Media-Filename",
          in: "header",
          schema: { type: "string" },
        },
        {
          name: "X-Vyline-Media-Type",
          in: "header",
          schema: { type: "string", enum: ["image", "video", "audio", "file", "gif"] },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
        },
      },
      responses: {
        "200": jsonRes("disk staging完了"),
        "400": { description: "index/body不備" },
        "413": { description: "11,250,000 bytes超過" },
      },
    },
  ],
  [
    "/line/{accountId}/send-media-batch/{uploadId}/complete",
    "post",
    {
      op: "completeMediaBatchUpload",
      summary: "staged mediaを関連メッセージとして順次送信",
      description:
        "plainではOBS reqseq、E2EEでは2件目以降をSUBORDINATE関連メッセージとして送信する。",
      tags: ["media"],
      params: [acc, pathParam("uploadId", "upload session ID")],
      responses: { "200": jsonRes("送信件数"), "400": { description: "upload未完了" } },
    },
  ],
  [
    "/line/{accountId}/send-media-batch/{uploadId}",
    "delete",
    {
      op: "cancelMediaBatchUpload",
      summary: "一括送信のstagingを破棄",
      tags: ["media"],
      params: [acc, pathParam("uploadId", "upload session ID")],
      responses: { "200": okRes(), "409": { description: "送信処理中" } },
    },
  ],

  // ── stickers ────────────────────────────────────────────
  [
    "/line/{accountId}/stickers",
    "get",
    {
      op: "getOwnedStickers",
      summary: "所持スタンプ一覧",
      tags: ["stickers"],
      params: [acc],
      responses: { "200": jsonRes("スタンプパック配列") },
    },
  ],
  [
    "/line/{accountId}/send-sticker",
    "post",
    {
      op: "sendSticker",
      summary: "スタンプ送信",
      description: "LINE: sendMessage (contentType STICKER)",
      tags: ["stickers"],
      params: [acc],
      requestBody: body(["chatMid"], {
        chatMid: { type: "string" },
        packageId: { type: "string" },
        stickerId: { type: "string" },
      }),
      responses: { "200": jsonRes("結果") },
    },
  ],
  [
    "/line/{accountId}/send-emoji",
    "post",
    {
      op: "sendEmoji",
      summary: "LINE 絵文字送信",
      description: "LINE: sendMessage (contentType EMOJI / productIds)",
      tags: ["stickers"],
      params: [acc],
      requestBody: body(["chatMid"], {
        chatMid: { type: "string" },
        emoji: { type: "object", description: "productId / emojiId 等" },
        relatedMessageId: { type: "string" },
      }),
      responses: { "200": jsonRes("結果") },
    },
  ],
  [
    "/line/{accountId}/canCreateCombinationSticker",
    "post",
    {
      op: "canCreateCombinationSticker",
      summary: "コンビネーションスタンプ作成可否",
      tags: ["stickers"],
      params: [acc],
      responses: { "200": jsonRes("可否") },
    },
  ],
  [
    "/line/{accountId}/isStickerAvailableForCombinationSticker",
    "post",
    {
      op: "isStickerAvailableForCombinationSticker",
      summary: "利用可能スタンプ一覧",
      tags: ["stickers"],
      params: [acc],
      responses: { "200": jsonRes("スタンプ配列") },
    },
  ],
  [
    "/line/{accountId}/createCombinationSticker",
    "post",
    {
      op: "createCombinationSticker",
      summary: "コンビネーションスタンプ作成",
      tags: ["stickers"],
      params: [acc],
      requestBody: body(["items"], { items: { type: "array", items: { type: "object" } } }),
      responses: { "200": jsonRes("作成結果") },
    },
  ],
  [
    "/line/{accountId}/send-combination-sticker",
    "post",
    {
      op: "sendCombinationSticker",
      summary: "コンビネーションスタンプ送信",
      tags: ["stickers"],
      params: [acc],
      requestBody: body(["chatMid", "items"], {
        chatMid: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              packageId: { type: "string" },
              stickerId: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              size: { type: "number" },
            },
          },
        },
      }),
      responses: { "200": jsonRes("結果") },
    },
  ],

  // ── contacts ────────────────────────────────────────────
  [
    "/line/{accountId}/getContact/{targetMid}",
    "get",
    {
      op: "getContact",
      summary: "連絡先プロフィール取得",
      description: "LINE: getContactsV3（u*）/ getChat（c*/r*）",
      tags: ["contacts"],
      params: [acc, pathParam("targetMid", "対象ユーザー / チャット MID")],
      responses: { "200": jsonRes("連絡先情報") },
    },
  ],
  [
    "/line/{accountId}/updateContactSetting/{mid}",
    "patch",
    {
      op: "updateContactSetting",
      summary: "連絡先の表示名 override を更新",
      description:
        "LINE: TalkService.updateContactSetting。未指定は null として override を解除する",
      tags: ["contacts"],
      params: [acc, pathParam("mid", "対象 MID")],
      requestBody: body([], {
        displayNameOverride: { type: ["string", "null"] },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/getCommonGroupIds/{targetMid}",
    "get",
    {
      op: "getCommonGroupIds",
      summary: "共通グループ一覧取得",
      description: "LINE: getCommonGroupIds",
      tags: ["contacts"],
      params: [acc, pathParam("targetMid", "対象ユーザー MID")],
      responses: { "200": jsonRes("グループ配列") },
    },
  ],
  [
    "/line/{accountId}/blockContact/{mid}",
    "post",
    {
      op: "blockContact",
      summary: "ブロック",
      description: "LINE: blockContact",
      tags: ["contacts"],
      params: [acc, pathParam("mid", "対象 MID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/unblockContact/{mid}",
    "delete",
    {
      op: "unblockContact",
      summary: "ブロック解除",
      description: "LINE: unblockContact",
      tags: ["contacts"],
      params: [acc, pathParam("mid", "対象 MID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/getBlockedContactIds",
    "get",
    {
      op: "getBlockedContactIds",
      summary: "ブロックリスト取得",
      description: "キャッシュ + background キュー付き（504 回避）",
      tags: ["contacts"],
      params: [acc],
      responses: { "200": jsonRes("ブロック済み配列") },
    },
  ],
  [
    "/line/{accountId}/block-verification",
    "post",
    {
      op: "verifyFriendBlockStatus",
      summary: "友だちのブロック状態確認（Beta）",
      description:
        "現在の非公式友だちとLINEのブロックリストを突合する。メッセージ/スタンプ送信による確認は行わない。body.mid指定時は1人のみ、未指定時は全員（2分間隔）。",
      tags: ["contacts"],
      params: [acc],
      requestBody: {
        required: false,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: { "200": jsonRes("ブロック状態配列") },
    },
  ],

  // ── notes ───────────────────────────────────────────────
  [
    "/line/{accountId}/notes",
    "get",
    {
      op: "getNotes",
      summary: "ノート一覧取得",
      tags: ["notes"],
      params: [acc, queryParam("homeId", "対象グループ / ホーム ID", true)],
      responses: { "200": jsonRes("ノート配列") },
    },
  ],
  [
    "/line/{accountId}/notes/updates",
    "post",
    {
      op: "getGroupHomeUpdates",
      summary: "ノート・アルバム更新差分取得",
      description: "iOS 実機の grouphome/isnew API。revision 以降に更新されたホームを返す。",
      tags: ["notes", "albums"],
      params: [acc, queryParam("revision", "前回取得した revision", true)],
      responses: { "200": jsonRes("更新差分") },
    },
  ],
  [
    "/line/{accountId}/notes",
    "post",
    {
      op: "createNote",
      summary: "ノート投稿",
      tags: ["notes"],
      params: [acc],
      requestBody: body(["homeId"], {
        homeId: { type: "string", description: "投稿先ホーム MID" },
        text: { type: "string" },
        sharedPostId: { type: "string" },
        stickerIds: { type: "array", items: { type: "string" } },
        stickerPackageIds: { type: "array", items: { type: "string" } },
        mediaObjectIds: { type: "array", items: { type: "string" } },
        mediaObjectTypes: { type: "array", items: { type: "string", enum: ["PHOTO", "VIDEO"] } },
        contents: { type: "object" },
        postInfo: { type: "object" },
      }),
      responses: { "200": jsonRes("作成結果") },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}",
    "get",
    {
      op: "getNoteDetail",
      summary: "ノート詳細取得",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID"), queryParam("homeId", "対象ホーム ID", true)],
      responses: { "200": jsonRes("ノート") },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}",
    "patch",
    {
      op: "updateNote",
      summary: "ノート更新",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID"), queryParam("homeId", "対象ホーム ID", true)],
      requestBody: body(["homeId"], {
        homeId: { type: "string" },
        text: { type: "string" },
        sharedPostId: { type: "string" },
        stickerIds: { type: "array", items: { type: "string" } },
        stickerPackageIds: { type: "array", items: { type: "string" } },
        mediaObjectIds: { type: "array", items: { type: "string" } },
        mediaObjectTypes: { type: "array", items: { type: "string", enum: ["PHOTO", "VIDEO"] } },
      }),
      responses: { "200": jsonRes("更新結果") },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}",
    "delete",
    {
      op: "deleteNote",
      summary: "ノート削除",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}/like",
    "post",
    {
      op: "likeNote",
      summary: "ノートにリアクション",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID")],
      requestBody: body(["homeId"], {
        homeId: { type: "string" },
        likeType: { type: "string", enum: ["1001", "1002", "1003", "1004", "1005", "1006"] },
      }),
      responses: { "200": jsonRes("リアクション結果") },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}/like",
    "delete",
    {
      op: "unlikeNote",
      summary: "ノートのリアクション解除",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID"), queryParam("homeId", "対象ホーム ID", true)],
      responses: { "200": jsonRes("解除結果") },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}/like",
    "get",
    {
      op: "getNoteLike",
      summary: "自分のノートリアクション取得",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID"), queryParam("homeId", "対象ホーム ID", true)],
      responses: { "200": jsonRes("リアクション") },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}/likes",
    "get",
    {
      op: "listNoteLikes",
      summary: "ノートのリアクション一覧取得",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID"), queryParam("homeId", "対象ホーム ID", true)],
      responses: { "200": jsonRes("リアクション一覧") },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}/comments",
    "post",
    {
      op: "commentNote",
      summary: "ノートへコメント",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID")],
      requestBody: body(["homeId"], {
        homeId: { type: "string" },
        text: { type: "string" },
        imageObjectId: { type: "string" },
      }),
      responses: { "200": jsonRes("コメント作成結果") },
    },
  ],
  [
    "/line/{accountId}/notes/media/{type}",
    "post",
    {
      op: "uploadNoteMedia",
      summary: "ノート用画像・動画アップロード",
      tags: ["notes"],
      params: [acc, pathParam("type", "image または video")],
      requestBody: {
        required: true,
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      },
      responses: { "200": jsonRes("OBS object ID") },
    },
  ],
  [
    "/line/{accountId}/notes/comment-image",
    "post",
    {
      op: "uploadNoteCommentImage",
      summary: "ノートコメント用画像アップロード",
      tags: ["notes"],
      params: [acc],
      requestBody: {
        required: true,
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      },
      responses: { "200": jsonRes("OBS object ID") },
    },
  ],

  // ── albums ──────────────────────────────────────────────
  [
    "/line/{accountId}/albums",
    "get",
    {
      op: "listAlbums",
      summary: "アルバム一覧取得",
      tags: ["albums"],
      params: [
        acc,
        queryParam("chatId", "対象チャット ID", true),
        queryParam("cursor", "ページング cursor"),
        queryParam("orderBy", "並び順"),
        queryParam("include", "追加取得フィールド"),
      ],
      responses: { "200": jsonRes("アルバム一覧") },
    },
  ],
  [
    "/line/{accountId}/albums/preview",
    "get",
    {
      op: "previewAlbums",
      summary: "アルバムプレビュー取得",
      tags: ["albums"],
      params: [
        acc,
        queryParam("chatId", "対象チャット ID", true),
        queryParam("pageSize", "取得件数"),
        queryParam("thumbnailCount", "サムネイル数"),
        queryParam("viewType", "表示種別"),
      ],
      responses: { "200": jsonRes("アルバムプレビュー") },
    },
  ],
  [
    "/line/{accountId}/albums",
    "post",
    {
      op: "createAlbum",
      summary: "アルバム作成",
      tags: ["albums"],
      params: [acc],
      requestBody: body(["chatId", "title"], {
        chatId: { type: "string" },
        title: { type: "string" },
        modifyDuplicateTitle: { type: "boolean" },
      }),
      responses: { "200": jsonRes("作成結果") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}",
    "patch",
    {
      op: "updateAlbum",
      summary: "アルバム名変更",
      tags: ["albums"],
      params: [acc, pathParam("albumId", "アルバム ID")],
      requestBody: body(["chatId", "title"], {
        chatId: { type: "string" },
        title: { type: "string" },
      }),
      responses: { "200": jsonRes("更新結果") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}",
    "delete",
    {
      op: "deleteAlbum",
      summary: "アルバム削除",
      tags: ["albums"],
      params: [
        acc,
        pathParam("albumId", "アルバム ID"),
        queryParam("chatId", "対象チャット ID", true),
      ],
      responses: { "200": jsonRes("削除結果") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}/share",
    "post",
    {
      op: "shareAlbum",
      summary: "アルバムをチャットへ共有",
      tags: ["albums"],
      params: [acc, pathParam("albumId", "アルバム ID")],
      requestBody: body(["chatId"], { chatId: { type: "string" } }),
      responses: { "200": jsonRes("共有結果") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}/media",
    "post",
    {
      op: "uploadAlbumMedia",
      summary: "アルバム用画像・動画アップロード",
      tags: ["albums"],
      params: [
        acc,
        pathParam("albumId", "アルバム ID"),
        queryParam("chatId", "対象チャット ID", true),
      ],
      requestBody: {
        required: true,
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      },
      responses: { "200": jsonRes("OBS object ID") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}/photos",
    "post",
    {
      op: "addAlbumPhotos",
      summary: "アルバムへ写真・動画追加",
      tags: ["albums"],
      params: [acc, pathParam("albumId", "アルバム ID")],
      requestBody: body(["chatId", "photos"], {
        chatId: { type: "string" },
        photos: { type: "array", items: { type: "object" } },
      }),
      responses: { "200": jsonRes("追加結果") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}/photos",
    "delete",
    {
      op: "deleteAlbumPhotos",
      summary: "アルバム内写真・動画削除",
      tags: ["albums"],
      params: [acc, pathParam("albumId", "アルバム ID")],
      requestBody: body(["chatId", "photoIds"], {
        chatId: { type: "string" },
        photoIds: { type: "array", items: { type: "string" } },
      }),
      responses: { "200": jsonRes("削除結果") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}/photos",
    "get",
    {
      op: "listAlbumPhotos",
      summary: "アルバム内写真・動画一覧",
      tags: ["albums"],
      params: [
        acc,
        pathParam("albumId", "アルバム ID"),
        queryParam("chatId", "対象チャット ID", true),
        queryParam("cursor", "ページング cursor"),
        queryParam("pageSize", "取得件数"),
        queryParam("orderBy", "並び順"),
        queryParam("include", "追加取得フィールド"),
        queryParam("filterType", "メディア種別フィルタ"),
        queryParam("targetUser", "投稿者フィルタ"),
      ],
      responses: { "200": jsonRes("写真・動画一覧") },
    },
  ],
  [
    "/line/{accountId}/albums/{albumId}/media/{oid}",
    "get",
    {
      op: "downloadAlbumMedia",
      summary: "アルバム原寸メディア取得",
      tags: ["albums"],
      params: [
        acc,
        pathParam("albumId", "アルバム ID"),
        pathParam("oid", "メディア object ID"),
        queryParam("chatId", "対象チャット ID", true),
        queryParam("mediaType", "image または video"),
      ],
      responses: { "200": { description: "原寸メディア" } },
    },
  ],
  [
    "/line/{accountId}/notes/{postId}/share",
    "post",
    {
      op: "shareNote",
      summary: "ノート共有",
      tags: ["notes"],
      params: [acc, pathParam("postId", "ノート ID")],
      requestBody: body(["homeId"], { homeId: { type: "string" } }),
      responses: { "200": jsonRes("共有結果") },
    },
  ],

  // ── polls ───────────────────────────────────────────────
  [
    "/line/{accountId}/poll/create",
    "post",
    {
      op: "createPoll",
      summary: "アンケート作成",
      tags: ["polls"],
      params: [acc],
      requestBody: body(["chatMid", "title", "options"], {
        chatMid: { type: "string" },
        title: { type: "string" },
        options: { type: "array", items: { type: "string" } },
        multiple: { type: "boolean" },
        anonymous: { type: "boolean" },
      }),
      responses: { "200": jsonRes("作成結果") },
    },
  ],
  [
    "/line/{accountId}/poll/{questionId}/vote",
    "post",
    {
      op: "votePoll",
      summary: "アンケート投票",
      description: "LINE: votePoll",
      tags: ["polls"],
      params: [acc, pathParam("questionId", "質問 ID")],
      requestBody: body(["optionIndexes"], {
        optionIndexes: { type: "array", items: { type: "integer" } },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/poll/{questionId}/{chatMid}",
    "get",
    {
      op: "getPoll",
      summary: "アンケート取得",
      description: "LINE: getPollDetail",
      tags: ["polls"],
      params: [acc, pathParam("questionId", "質問 ID"), chatMid],
      responses: { "200": jsonRes("アンケート") },
    },
  ],
  [
    "/line/{accountId}/poll/list/{chatMid}",
    "get",
    {
      op: "getPollList",
      summary: "アンケート一覧取得",
      tags: ["polls"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("アンケート配列") },
    },
  ],
  [
    "/line/{accountId}/poll/{questionId}/close/{chatMid}",
    "get",
    {
      op: "closePoll",
      summary: "アンケート締め切り",
      tags: ["polls"],
      params: [acc, pathParam("questionId", "質問 ID"), chatMid],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/poll/{questionId}/remove/{chatMid}",
    "get",
    {
      op: "removePoll",
      summary: "アンケート削除",
      tags: ["polls"],
      params: [acc, pathParam("questionId", "質問 ID"), chatMid],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/poll/{questionId}/announce",
    "post",
    {
      op: "announcePoll",
      summary: "アンケート告知",
      tags: ["polls"],
      params: [acc, pathParam("questionId", "質問 ID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/poll/{questionId}/remind",
    "post",
    {
      op: "remindPoll",
      summary: "アンケートリマインド",
      tags: ["polls"],
      params: [acc, pathParam("questionId", "質問 ID")],
      responses: { "200": okRes() },
    },
  ],

  // ── schedule ────────────────────────────────────────────
  [
    "/line/{accountId}/schedule/events",
    "post",
    {
      op: "createScheduleEvent",
      summary: "予定作成",
      tags: ["schedule"],
      params: [acc],
      requestBody: body(["chatMid"], { chatMid: { type: "string" } }),
      responses: { "200": jsonRes("作成結果") },
    },
  ],
  [
    "/line/{accountId}/schedule/events/{eventId}/answer",
    "post",
    {
      op: "answerScheduleEvent",
      summary: "予定出欠回答",
      tags: ["schedule"],
      params: [acc, pathParam("eventId", "予定 ID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/schedule/events/{eventId}/share",
    "post",
    {
      op: "shareScheduleEvent",
      summary: "予定共有",
      tags: ["schedule"],
      params: [acc, pathParam("eventId", "予定 ID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/schedule/events/{eventId}/{chatMid}",
    "get",
    {
      op: "getScheduleEvent",
      summary: "予定取得",
      tags: ["schedule"],
      params: [acc, pathParam("eventId", "予定 ID"), chatMid],
      responses: { "200": jsonRes("予定") },
    },
  ],
  [
    "/line/{accountId}/schedule/groups/{chatMid}",
    "get",
    {
      op: "getGroupScheduleEvents",
      summary: "グループ予定一覧",
      tags: ["schedule"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("予定配列") },
    },
  ],
  [
    "/line/{accountId}/schedule/group/{chatMid}",
    "get",
    {
      op: "getScheduleGroup",
      summary: "特定グループの予定共有情報を取得",
      description: "Vyline LIFF 拡張。共有先決定用の encId を直接取得する",
      tags: ["schedule"],
      params: [acc, chatMid],
      responses: {
        "200": jsonRes("グループ予定共有情報"),
        "502": { description: "LIFF 側エラー", content: { "application/json": { schema: error } } },
      },
    },
  ],
  [
    "/line/{accountId}/schedule/friends/{chatMid}",
    "get",
    {
      op: "getFriendScheduleEvents",
      summary: "友だち予定一覧",
      tags: ["schedule"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("予定配列") },
    },
  ],

  // ── announcements ───────────────────────────────────────
  [
    "/line/{accountId}/getChatRoomAnnouncements/{chatMid}",
    "get",
    {
      op: "getChatRoomAnnouncements",
      summary: "アナウンス一覧取得",
      description: "LINE: getChatRoomAnnouncements",
      tags: ["announcements"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("アナウンス配列") },
    },
  ],
  [
    "/line/{accountId}/createChatRoomAnnouncement",
    "post",
    {
      op: "createChatRoomAnnouncement",
      summary: "アナウンス作成",
      description: "LINE: createChatRoomAnnouncement",
      tags: ["announcements"],
      params: [acc],
      requestBody: body(["chatMid", "text"], {
        chatMid: { type: "string" },
        text: { type: "string" },
        messageId: { type: "string" },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/removeChatRoomAnnouncement/{chatMid}/{seq}",
    "delete",
    {
      op: "removeChatRoomAnnouncement",
      summary: "アナウンス削除",
      description: "LINE: removeChatRoomAnnouncement",
      tags: ["announcements"],
      params: [acc, chatMid, pathParam("seq", "アナウンス連番")],
      responses: { "200": okRes() },
    },
  ],

  // ── calls ───────────────────────────────────────────────
  [
    "/line/{accountId}/call/start",
    "post",
    {
      op: "acquireCallRoute",
      summary: "通話開始（ルート確保）",
      description: "LINE: acquireCallRoute (/V4)",
      tags: ["calls"],
      params: [acc],
      requestBody: body([], { chatMid: { type: "string" }, mediaType: { type: "string" } }),
      responses: { "200": jsonRes("通話情報") },
    },
  ],
  [
    "/line/{accountId}/call",
    "post",
    {
      op: "acquireCallRouteLegacy",
      summary: "通話ルート確保（互換 API）",
      description: "direct は to、group は kind=group と chatMid を指定する",
      tags: ["calls"],
      params: [acc],
      requestBody: body([], {
        to: { type: "string" },
        chatMid: { type: "string" },
        callType: { type: "string", enum: ["AUDIO", "VIDEO"], default: "AUDIO" },
        kind: { type: "string", enum: ["direct", "group"] },
      }),
      responses: {
        "200": jsonRes("{ ok, route }"),
        "400": {
          description: "to または chatMid が不足",
          content: { "application/json": { schema: error } },
        },
      },
    },
  ],
  [
    "/line/{accountId}/call/end",
    "post",
    {
      op: "endCall",
      summary: "通話終了",
      tags: ["calls"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/call/status",
    "get",
    {
      op: "getCallStatus",
      summary: "通話ステータス取得",
      description: "Vyline 拡張",
      tags: ["calls"],
      params: [acc],
      responses: { "200": jsonRes("ステータス") },
    },
  ],
  [
    "/line/{accountId}/call/active",
    "get",
    {
      op: "getActiveCall",
      summary: "アクティブ通話取得",
      description: "Vyline 拡張",
      tags: ["calls"],
      params: [acc],
      responses: { "200": jsonRes("通話") },
    },
  ],
  [
    "/line/{accountId}/call/group-status",
    "get",
    {
      op: "getGroupCallStatus",
      summary: "グループ通話ステータス取得",
      tags: ["calls"],
      params: [acc],
      responses: { "200": jsonRes("ステータス") },
    },
  ],
  [
    "/line/{accountId}/call/ws",
    "get",
    {
      op: "connectCallWebSocket",
      summary: "通話 PCM ブリッジ WebSocket",
      description: "Vyline 拡張。Swagger UI からは接続不可（WebSocket 専用）",
      tags: ["calls"],
      params: [acc],
      responses: { "101": { description: "WebSocket upgrade" } },
    },
  ],

  // ── backup / storage ────────────────────────────────────
  [
    "/line/{accountId}/backup/chats",
    "get",
    {
      op: "listBackupChats",
      summary: "バックアップ対象チャット選択用リスト",
      tags: ["backup"],
      params: [acc],
      responses: { "200": jsonRes("チャット配列") },
    },
  ],
  [
    "/line/{accountId}/backup/create",
    "post",
    {
      op: "createBackup",
      summary: "バックアップスナップショット作成",
      tags: ["backup"],
      params: [acc],
      requestBody: body([], {
        includeMedia: { type: "boolean" },
        chatMids: { type: "array", items: { type: "string" } },
      }),
      responses: { "200": jsonRes("作成結果") },
    },
  ],
  [
    "/line/{accountId}/backup/list",
    "get",
    {
      op: "listBackups",
      summary: "バックアップ一覧",
      tags: ["backup"],
      params: [acc],
      responses: { "200": jsonRes("バックアップ配列") },
    },
  ],
  [
    "/line/{accountId}/backup/restore",
    "post",
    {
      op: "restoreBackup",
      summary: "バックアップ復元",
      tags: ["backup"],
      params: [acc],
      requestBody: body([], {
        backupId: { type: "string" },
        mode: { type: "string", enum: ["all", "selected"] },
        includeMedia: { type: "boolean" },
        chatMids: { type: "array", items: { type: "string" } },
      }),
      responses: { "200": jsonRes("復元結果") },
    },
  ],
  [
    "/line/{accountId}/backup/{backupId}",
    "delete",
    {
      op: "deleteBackup",
      summary: "バックアップ削除",
      tags: ["backup"],
      params: [acc, pathParam("backupId", "バックアップ ID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/credentials/handoff/export",
    "post",
    {
      op: "exportCredentialHandoff",
      summary: "認証情報を暗号化引き継ぎファイルとして書き出す",
      description: "通常の VylineBackup とは分離。パスフレーズは保存しない。",
      tags: ["credentials"],
      params: [acc],
      requestBody: body(["passphrase"], { passphrase: { type: "string", minLength: 8 } }),
      responses: { "200": jsonRes("暗号化 credential handoff bundle") },
    },
  ],
  [
    "/line/{accountId}/credentials/handoff/import",
    "post",
    {
      op: "importCredentialHandoff",
      summary: "暗号化認証情報を指定アカウントへ復元",
      tags: ["credentials"],
      params: [acc],
      requestBody: body(["passphrase", "bundle"], {
        passphrase: { type: "string", minLength: 8 },
        bundle: { type: "object" },
      }),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/credentials/channel/{channelId}/reissue",
    "post",
    {
      op: "reissueChannelToken",
      summary: "チャネルトークンを明示的に再発行",
      description: "新しいトークン値そのものは API 応答へ返さない。",
      tags: ["credentials"],
      params: [acc, pathParam("channelId", "LINE Channel ID")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/vyline/cache",
    "get",
    {
      op: "getStorageUsage",
      summary: "プロフィールキャッシュ",
      tags: ["storage"],
      params: [acc],
      responses: { "200": jsonRes("使用量サマリ") },
    },
  ],
  [
    "/line/{accountId}/vyline/cache",
    "delete",
    {
      op: "clearCache",
      summary: "再取得可能なキャッシュを削除",
      tags: ["storage"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/vyline/cache/cdn",
    "delete",
    {
      op: "clearCdnCache",
      summary: "CDN キャッシュ削除",
      tags: ["storage"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/vyline/cache/icons",
    "delete",
    {
      op: "clearIconCache",
      summary: "アイコンキャッシュ削除",
      tags: ["storage"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/vyline/warm",
    "post",
    {
      op: "warmCache",
      summary: "キャッシュウォーム",
      tags: ["storage"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/vyline/storage",
    "get",
    {
      op: "getVylineStorageInfo",
      summary: "Vyline ストレージ情報",
      tags: ["storage"],
      params: [acc],
      responses: { "200": jsonRes("ストレージ情報") },
    },
  ],
  [
    "/line/{accountId}/vyline/saved-media",
    "delete",
    {
      op: "clearSavedMedia",
      summary: "保存メディア全削除",
      tags: ["storage"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/vyline/saved-media/{type}",
    "delete",
    {
      op: "clearSavedMediaByType",
      summary: "種別指定で保存メディア削除",
      tags: ["storage"],
      params: [acc, pathParam("type", "mediaType (image/video/audio/file)")],
      responses: { "200": okRes() },
    },
  ],

  // ── misc (Vyline 拡張) ──────────────────────────────────
  [
    "/line/{accountId}/log",
    "get",
    {
      op: "getDebugLog",
      summary: "チャット詳細ログ閲覧",
      tags: ["misc"],
      params: [acc],
      responses: { "200": jsonRes("JSONL ログ") },
    },
  ],
  [
    "/line/{accountId}/feature-locks",
    "get",
    {
      op: "getFeatureLocks",
      summary: "機能ロック状態取得",
      tags: ["misc"],
      params: [acc],
      responses: { "200": jsonRes("ロック状態") },
    },
  ],
  [
    "/line/{accountId}/feature-locks/create-group-ban",
    "delete",
    {
      op: "releaseCreateGroupBan",
      summary: "グループ作成禁止解除",
      description: "自己責任オプション",
      tags: ["misc"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/setNotificationsEnabled",
    "post",
    {
      op: "setNotificationsEnabled",
      summary: "通知設定更新",
      tags: ["misc"],
      params: [acc],
      requestBody: body([], {}),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/plugins",
    "get",
    {
      op: "listPlugins",
      summary: "プラグイン一覧",
      tags: ["misc"],
      params: [acc],
      responses: { "200": jsonRes("プラグイン配列") },
    },
  ],
  [
    "/line/{accountId}/plugins/{pluginId}/{action}",
    "post",
    {
      op: "controlPlugin",
      summary: "プラグイン操作（enable/disable/uninstall）",
      tags: ["misc"],
      params: [acc, pathParam("pluginId", "プラグイン ID"), pathParam("action", "操作")],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/proxy",
    "get",
    {
      op: "getProxySettings",
      summary: "プロキシ設定取得",
      tags: ["misc"],
      params: [acc],
      responses: { "200": jsonRes("設定") },
    },
  ],
  [
    "/line/{accountId}/proxy",
    "put",
    {
      op: "setProxySettings",
      summary: "プロキシ設定更新",
      tags: ["misc"],
      params: [acc],
      requestBody: body([], {}),
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/liff/warm",
    "post",
    {
      op: "warmLiff",
      summary: "LIFF ウォームアップ",
      tags: ["misc"],
      params: [acc],
      responses: { "200": okRes() },
    },
  ],
  [
    "/line/{accountId}/restore",
    "post",
    {
      op: "restoreSession",
      summary: "セッション復元",
      tags: ["misc"],
      params: [acc],
      responses: { "200": jsonRes("復元結果") },
    },
  ],
  [
    "/line/{accountId}/restore/desktop",
    "post",
    {
      op: "restoreFromDesktop",
      summary: "LINE Desktop からの鍵 import / 復元",
      tags: ["misc"],
      params: [acc],
      responses: { "200": jsonRes("復元結果") },
    },
  ],
  [
    "/line/{accountId}/restore/status",
    "get",
    {
      op: "getRestoreStatus",
      summary: "復元ステータス取得",
      tags: ["misc"],
      params: [acc],
      responses: { "200": jsonRes("ステータス") },
    },
  ],
  [
    "/line/{accountId}/ladder/members/{chatMid}",
    "get",
    {
      op: "getLadderMembers",
      summary: "階段（人数確認）メンバー取得",
      tags: ["misc"],
      params: [acc, chatMid],
      responses: { "200": jsonRes("メンバー配列") },
    },
  ],
  [
    "/line/{accountId}/ladder/generate",
    "post",
    {
      op: "generateLadder",
      summary: "階段生成",
      tags: ["misc"],
      params: [acc],
      requestBody: body(["chatMid"], { chatMid: { type: "string" } }),
      responses: { "200": jsonRes("ハッシュ") },
    },
  ],
  [
    "/line/{accountId}/ladder/result/{chatMid}/{hash}",
    "get",
    {
      op: "getLadderResult",
      summary: "階段結果取得",
      tags: ["misc"],
      params: [acc, chatMid, pathParam("hash", "生成ハッシュ")],
      responses: { "200": jsonRes("結果画像") },
    },
  ],
  [
    "/line/{accountId}/ladder/message",
    "post",
    {
      op: "sendLadderMessage",
      summary: "階段メッセージ送信",
      tags: ["misc"],
      params: [acc],
      requestBody: body(["chatMid"], { chatMid: { type: "string" }, hash: { type: "string" } }),
      responses: { "200": okRes() },
    },
  ],
];

// paths を組み立て（同一路径の複数 method に対応）
function buildPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [route, method, spec] of routes) {
    const item = (paths[route] ??= {});
    item[method] = {
      tags: spec.tags,
      operationId: spec.op,
      summary: spec.summary,
      ...(spec.description ? { description: spec.description } : {}),
      ...(spec.params?.length ? { parameters: spec.params } : {}),
      ...(spec.requestBody ? { requestBody: spec.requestBody } : {}),
      ...(spec.responses ?? { "200": jsonRes("結果") }),
    };
  }
  return paths;
}

export const lineOpenApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Vyline BFF API",
    version: "0.6.0",
    license: { name: "MIT" },
    description:
      "Vyline フロントエンドが利用する内部 BFF API。セッション Cookie / ローカル実行を前提とし、" +
      "外部公開は想定していない。安定した公開 API は /v1 (openapi.yaml) を使用すること。\n\n" +
      "operationId は LINE プロトコルの関数名（sendMessage / unsendMessage / sendChatChecked など、" +
      "RPC_DICTIONARY canonicalName 準拠）を尊重している。",
  },
  servers: [{ url: "{baseUrl}", variables: { baseUrl: { default: "http://127.0.0.1:3001" } } }],
  security: [],
  tags: [
    { name: "session", description: "セッション・プロフィール・ヘルスチェック" },
    { name: "chats", description: "チャット一覧・グループ管理・起動時 hydrate" },
    { name: "messages", description: "メッセージ取得・送信・既読・編集・リアクション" },
    { name: "media", description: "メディア送受信（複数一括含む）" },
    { name: "stickers", description: "スタンプ・絵文字・コンビネーションスタンプ" },
    { name: "contacts", description: "連絡先・ブロック" },
    { name: "notes", description: "ノート" },
    { name: "albums", description: "アルバム" },
    { name: "polls", description: "アンケート" },
    { name: "schedule", description: "予定" },
    { name: "announcements", description: "アナウンス" },
    { name: "calls", description: "通話" },
    { name: "backup", description: "VylineBackup の作成・復元" },
    { name: "credentials", description: "認証情報の安全な引き継ぎ・再発行" },
    { name: "storage", description: "キャッシュ・ストレージ管理" },
    { name: "misc", description: "その他（プラグイン・プロキシ・復元など Vyline 拡張）" },
  ],
  paths: buildPaths(),
  components: {
    schemas: {
      Message: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          text: { type: ["string", "null"] },
          contentType: { type: "string" },
          createdTime: { type: "integer", format: "int64" },
          isMyMessage: { type: "boolean" },
          relatedMessageId: { type: ["string", "null"] },
          messageRelationType: { type: ["string", "null"] },
          relatedMessageServiceCode: { type: ["string", "null"] },
          contentMetadata: { type: ["object", "null"] },
          readCount: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;
