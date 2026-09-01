# カスタムクライアントの作り方

最終更新: 2026-08-24

Vyline のバックエンド API を使えば、公式フロントエンド以外の独自クライアント
（ミニビューア・通知専用クライアント・ダッシュボード・Bot など）を作れます。

## 0. 前提

- Vyline backend が起動している（`bun run dev` または `bun run server`）
- API 仕様は Swagger UI で確認できる:
  - BFF API: `GET http://127.0.0.1:3001/openapi.json`
  - Swagger UI: `http://127.0.0.1:3001/docs`

## 1. 認証

| API | 認証 | 用途 |
|---|---|---|
| BFF (`/line/...`) | ローカル実行では不要。リモート公開時は保護必須 | 公式フロントエンド・同一ホストのツール |
| Public (`/v1/...`) | Bearer トークン（`VYLINE_API_ADMIN_SECRET` で発行） | 外部クライアント・Bot |

トークン作成:

```bash
export VYLINE_API_ADMIN_SECRET=<secret>   # backend 側
curl -X POST http://localhost:3001/v1/tokens \
  -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" \
  -d '{"name":"my-client","accountIds":["main"]}'
# => { "token": "vyl_..." }
```

`accountIds` は必須です。発行されたトークンは allowlist に含めたアカウントだけを操作できます。

## 2. 最小クライアント（JavaScript）

```js
const BASE = "http://127.0.0.1:3001";
const TOKEN = "vyl_..."; // /v1 を使う場合

// チャット一覧（BFF）
const chats = await fetch(`${BASE}/line/main/chats`).then((r) => r.json());

// 新着ポーリング（2〜8 秒間隔を推奨。長ポールなので負荷は低い）
setInterval(async () => {
  const { messages } = await fetch(
    `${BASE}/line/main/messages/${chats.chats[0].mid}?limit=5&force=1`,
  ).then((r) => r.json());
  console.log(messages.slice(0, 3));
}, 8000);
```

Public API (/v1) を使う場合は `Authorization: Bearer vyl_...` ヘッダーを付与します。

## 3. よく使うエンドポイント

| 操作 | エンドポイント |
|---|---|
| プロフィール | `GET /line/:accountId/getProfile` |
| チャット一覧 | `GET /line/:accountId/getMessageBoxes` |
| メッセージ取得 | `GET /line/:accountId/getPreviousMessagesV2WithRequest/:chatMid?limit=30` |
| テキスト送信 | `POST /line/:accountId/sendMessage` `{chatMid, text}` |
| 画像送信(複数) | `POST /line/:accountId/send-media-batch` |
| スタンプ送信 | `POST /line/:accountId/send-sticker` |
| 既読 | `POST /line/:accountId/sendChatChecked` |
| 新着待機 | `GET /line/:accountId/fetchOperations` |

完全な一覧は `/openapi.json`、サンプルコードは
[examples/api](../../examples/api/) を参照してください。

## 4. 設計のヒント

- **ポーリングより長ポール**: `/fetchOperations` はサーバー側で最大 60 秒待つため、
  短いインターバルの再試行より効率的です
- **メディアは URL で受ける**: 画像は `GET /line/:a/media/:chatMid/:messageId`
  （キャッシュ付き）。base64 で受けないこと
- **アカウントスコープを明示**: すべてのエンドポイントは accountId ごとに分離。
  マルチアカウントでは切り替え時に state を初期化する
- **UI は Telegram 風に**: 公式フロントエンド（`apps/desktop`）が実装の参考になります
