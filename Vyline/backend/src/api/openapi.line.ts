/**
 * api/openapi.line.ts — BFF (/line) 内部 API の OpenAPI 3.1 仕様
 *
 * Swagger UI は GET /docs および /swagger で提供される。
 * 公開 REST API (/v1) の仕様は openapi.yaml を参照（/openapi/v1.yaml で提供）。
 */

const accountParam = {
  name: "accountId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Vyline アカウント ID（例: main）",
} as const;

const chatParam = {
  name: "chatMid",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "チャット MID (u.../c.../r...)",
} as const;

const ok = {
  type: "object",
  properties: { ok: { type: "boolean" } },
} as const;

const error = {
  type: "object",
  properties: { ok: { type: "boolean", enum: [false] }, error: { type: "string" } },
} as const;

export const lineOpenApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Vyline BFF API",
    version: "0.6.0",
    description:
      "Vyline フロントエンドが利用する内部 BFF API。セッション Cookie / ローカル実行を前提とし、" +
      "外部公開は想定していない。安定した公開 API は /v1 (openapi.yaml) を使用すること。",
  },
  servers: [{ url: "{baseUrl}", variables: { baseUrl: { default: "http://127.0.0.1:3001" } } }],
  tags: [
    { name: "session" },
    { name: "chats" },
    { name: "messages" },
    { name: "media" },
    { name: "stickers" },
    { name: "backup" },
    { name: "storage" },
  ],
  paths: {
    "/healthz": {
      get: {
        tags: ["session"],
        summary: "ヘルスチェック",
        responses: {
          "200": { description: "ready", content: { "application/json": { schema: ok } } },
        },
      },
    },
    "/auth/accounts": {
      get: {
        tags: ["session"],
        summary: "登録済みアカウント一覧",
        responses: {
          "200": {
            description: "アカウント配列",
            content: {
              "application/json": { schema: { type: "array", items: { type: "object" } } },
            },
          },
        },
      },
    },
    "/line/{accountId}/profile": {
      get: {
        tags: ["session"],
        summary: "自分のプロフィール",
        parameters: [accountParam],
        responses: {
          "200": {
            description: "プロフィール",
            content: {
              "application/json": {
                schema: { type: "object", properties: { profile: { type: "object" } } },
              },
            },
          },
          "401": { description: "未ログイン", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/line/{accountId}/bootstrap": {
      get: {
        tags: ["chats"],
        summary: "起動時一括 hydrate（チャット + 直近メッセージ）",
        parameters: [accountParam],
        responses: {
          "200": {
            description: "BootstrapPayload",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/chats": {
      get: {
        tags: ["chats"],
        summary: "チャット一覧",
        parameters: [accountParam],
        responses: {
          "200": {
            description: "Chat 配列",
            content: {
              "application/json": { schema: { type: "array", items: { type: "object" } } },
            },
          },
        },
      },
    },
    "/line/{accountId}/messages/{chatMid}": {
      get: {
        tags: ["messages"],
        summary: "メッセージ取得（local-first + サーバ同期）",
        parameters: [
          accountParam,
          chatParam,
          { name: "limit", in: "query", schema: { type: "integer", default: 30, maximum: 100 } },
          {
            name: "force",
            in: "query",
            schema: { type: "string", enum: ["0", "1"] },
            description: "1 でサーバ強制取得",
          },
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
                    messages: { type: "array", items: { $ref: "#/components/schemas/Message" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/line/{accountId}/send": {
      post: {
        tags: ["messages"],
        summary: "テキスト送信",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["chatMid", "text"],
                properties: {
                  chatMid: { type: "string" },
                  text: { type: "string" },
                  relatedMessageId: { type: "string" },
                  mute: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "送信結果",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/send-media-batch": {
      post: {
        tags: ["media"],
        summary: "複数メディアの一括送信",
        description:
          "各アイテムは個別の IMAGE メッセージとして送信される。" +
          "plain 経路では OBS /r/talk/m/reqseq 連番アップロードにより LINE サーバ側がメッセージを生成する。" +
          "UI は同一送信者の連続 IMAGE を時間窓でグルーピング表示する。",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MediaBatchRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "送信完了",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    count: { type: "integer", description: "送信できたアイテム数" },
                  },
                },
              },
            },
          },
          "400": {
            description: "chatMid/items 不備",
            content: { "application/json": { schema: error } },
          },
          "413": {
            description: "ファイル超過",
            content: { "application/json": { schema: error } },
          },
        },
      },
    },
    "/line/{accountId}/send-media": {
      post: {
        tags: ["media"],
        summary: "単体メディア送信",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["chatMid", "dataBase64"],
                properties: {
                  chatMid: { type: "string" },
                  dataBase64: { type: "string", description: "最大 ~12MB base64" },
                  mimeType: { type: "string" },
                  filename: { type: "string" },
                  mediaType: { type: "string", enum: ["image", "video", "audio", "file", "gif"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "送信結果", content: { "application/json": { schema: ok } } },
        },
      },
    },
    "/line/{accountId}/media/{chatMid}/{messageId}": {
      get: {
        tags: ["media"],
        summary: "メディア取得（キャッシュ → OBS → RPC フォールバック）",
        parameters: [
          accountParam,
          chatParam,
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "preview",
            in: "query",
            schema: { type: "string", enum: ["0", "1"], default: "1" },
          },
        ],
        responses: {
          "200": {
            description: "バイナリ",
            content: { "*/*": { schema: { type: "string", format: "binary" } } },
          },
          "401": { description: "未ログイン" },
          "422": { description: "取得不能（期限切れ等）" },
        },
      },
    },
    "/line/{accountId}/unsend": {
      post: {
        tags: ["messages"],
        summary: "メッセージ送信取り消し",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["messageId"],
                properties: { messageId: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "結果", content: { "application/json": { schema: ok } } },
        },
      },
    },
    "/line/{accountId}/read": {
      post: {
        tags: ["messages"],
        summary: "既読送信",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["chatMid", "messageId"],
                properties: { chatMid: { type: "string" }, messageId: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "結果", content: { "application/json": { schema: ok } } },
        },
      },
    },
    "/line/{accountId}/read-receipts/{chatMid}": {
      get: {
        tags: ["messages"],
        summary: "既読情報取得",
        parameters: [accountParam, chatParam],
        responses: {
          "200": {
            description: "既読範囲",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/stickers": {
      get: {
        tags: ["stickers"],
        summary: "所持スタンプ一覧",
        parameters: [accountParam],
        responses: {
          "200": {
            description: "スタンプパック配列",
            content: {
              "application/json": { schema: { type: "array", items: { type: "object" } } },
            },
          },
        },
      },
    },
    "/line/{accountId}/send-sticker": {
      post: {
        tags: ["stickers"],
        summary: "スタンプ送信",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["chatMid"],
                properties: {
                  chatMid: { type: "string" },
                  packageId: { type: "string" },
                  stickerId: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "結果",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/combination-stickers/can-create": {
      post: {
        tags: ["stickers"],
        summary: "コンビネーションスタンプ作成可否",
        parameters: [accountParam],
        responses: {
          "200": {
            description: "可否",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/send-combination-sticker": {
      post: {
        tags: ["stickers"],
        summary: "コンビネーションスタンプ送信",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["chatMid", "items"],
                properties: {
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
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "結果",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/vyline/cache": {
      get: {
        tags: ["storage"],
        summary: "ストレージ / キャッシュ使用量",
        parameters: [accountParam],
        responses: {
          "200": {
            description: "使用量サマリ",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/vyline/warm": {
      post: {
        tags: ["storage"],
        summary: "キャッシュウォーム",
        parameters: [accountParam],
        responses: {
          "200": { description: "結果", content: { "application/json": { schema: ok } } },
        },
      },
    },
    "/line/{accountId}/backup": {
      get: {
        tags: ["backup"],
        summary: "バックアップ一覧 / チャット選択用リスト",
        parameters: [accountParam],
        responses: {
          "200": {
            description: "バックアップ情報",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/line/{accountId}/restore": {
      post: {
        tags: ["backup"],
        summary: "バックアップ復元",
        parameters: [accountParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": {
            description: "結果",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      MediaBatchItem: {
        type: "object",
        required: ["dataBase64"],
        properties: {
          dataBase64: {
            type: "string",
            description: "base64 エンコードされたバイナリ（最大 ~12MB）",
          },
          mimeType: { type: "string", example: "image/png" },
          filename: { type: "string" },
          mediaType: { type: "string", enum: ["image", "video", "audio", "file", "gif"] },
        },
      },
      MediaBatchRequest: {
        type: "object",
        required: ["chatMid", "items"],
        properties: {
          chatMid: { type: "string" },
          items: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/MediaBatchItem" },
          },
        },
      },
      Message: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          text: { type: "string", nullable: true },
          contentType: { type: "string" },
          createdTime: { type: "integer", format: "int64" },
          isMyMessage: { type: "boolean" },
          relatedMessageId: { type: "string", nullable: true },
          messageRelationType: { type: "string", nullable: true },
          relatedMessageServiceCode: { type: "string", nullable: true },
          contentMetadata: { type: "object", nullable: true },
          readCount: { type: "integer", nullable: true },
        },
      },
    },
  },
} as const;
