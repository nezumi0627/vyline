# OpenAPI / Swagger

最終更新: 2026-08-24

Vyline バックエンドは 2 種類の API を持つ。

| API | prefix | 認証 | 仕様 |
|---|---|---|---|
| 公開 REST API | `/v1` (`/api/v1`) | Bearer トークン | `openapi.yaml` |
| BFF（フロントエンド内部 API） | `/line` `/auth` `/debug` `/cdn` | ローカルセッション | `backend/src/api/openapi.line.ts` |

## ルート

```txt
GET /docs            Swagger UI（両方の仕様を切り替え表示）
GET /swagger         同上（エイリアス）
GET /openapi.json    BFF API の OpenAPI 3.1 JSON
GET /openapi.yaml    公開 REST API の YAML
GET /openapi/v1.yaml /openapi.yaml へのリダイレクト
```

## GitHub Pages

- **Swagger UI**: **https://nezumi0627.github.io/vyline-api/**
  （`nezumi0627/vyline-api` リポジトリが毎日 03:00 UTC + 手動実行で本リポジトリの main から生成）
- **ランディングページ**: https://nezumi0627.github.io/vyline/（`pages.yml` + `scripts/build-landing.ts`）

生成: `bun scripts/build-api-docs.ts <outdir>`（BFF spec を TS から JSON 化 + ルート `openapi.yaml` をコピー）

Swagger UI は CDN からスクリプトを読み込むため、オフライン環境では `openapi.json` /
`openapi.yaml` を直接確認すること。

## 変更フロー

BFF のエンドポイントを追加・変更した場合は
`Vyline/backend/src/api/openapi.line.ts` を必ず更新する。
型チェックは `bun run typecheck` に含まれる（spec は TypeScript オブジェクトのため）。

公開 REST API (/v1) を変更した場合はルート直下の `openapi.yaml` を手動で更新する。

## operationId 命名規約

**LINE プロトコルの関数名を尊重する。**

- 対応する LINE RPC がある場合 → canonicalName を使用
  （例: `sendMessage`, `unsendMessage`, `sendChatChecked`, `getMessageReadRange`,
  `getPreviousMessagesV2WithRequest`, `getProfile`, `getMessageBoxes`, `createChat`,
  `inviteIntoChat`, `blockContact` — RPC_DICTIONARY 参照）
- LINE に対応 RPC が無い場合（Vyline 拡張）→ camelCase、description に「Vyline 拡張」と明記
