# OpenAPI / Swagger

最終更新: 2026-08-22

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

Swagger UI は CDN からスクリプトを読み込むため、オフライン環境では `openapi.json` /
`openapi.yaml` を直接確認すること。

## 変更フロー

BFF のエンドポイントを追加・変更した場合は
`Vyline/backend/src/api/openapi.line.ts` を必ず更新する。
型チェックは `bun run typecheck` に含まれる（spec は TypeScript オブジェクトのため）。

公開 REST API (/v1) を変更した場合はルート直下の `openapi.yaml` を手動で更新する。
