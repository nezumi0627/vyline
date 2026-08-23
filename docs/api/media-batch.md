# Media Batch API（複数メディア一括送信）

最終更新: 2026-08-24

## エンドポイント

```
POST /line/{accountId}/send-media-batch
```

OpenAPI 仕様: `GET /openapi.json`（Swagger UI: `GET /docs`）

## Request

```json
{
  "chatMid": "c1efe9d6cf1848350bc91848a8a29963e",
  "items": [
    { "dataBase64": "<base64>", "mimeType": "image/png", "filename": "a.png", "mediaType": "image" },
    { "dataBase64": "<base64>", "mimeType": "image/png", "filename": "b.png", "mediaType": "image" }
  ]
}
```

| field | 型 | 必須 | 備考 |
|---|---|---|---|
| chatMid | string | ✓ | 送信先 (u.../c.../r...) |
| items | array | ✓ | 1 件以上 |
| items[].dataBase64 | string | ✓ | 最大 ~12MB |
| items[].mimeType | string |  | 既定 `image/png` |
| items[].filename | string |  | 既定 `screenshot.png` 等 |
| items[].mediaType | string |  | image/video/audio/file/gif（mimeType から推論可） |

## Response

```json
{ "ok": true, "count": 2 }
```

`count` は送信できたアイテム数。エラー時は `4xx` と `{ ok: false, error }`。

## 送信経路の内部動作

1. **E2EE 可能な相手/グループ** → `uploadMediaByE2EE`（OBS アップロード + `sendMessage` with chunks）。
   失敗時は sender key 再生成 / グループ鍵再作成して 1 回リトライ。
2. **plain 経路**（flow=1 チャット・BOT・E2EE 非対応）→ **OBS `/r/talk/m/reqseq` に連番 reqseq でアップロードし、LINE サーバ側がメッセージを生成する**（公式アプリと同じ経路）。
   thrift `sendMessage` を併用するとサーバ履歴に載らないため使用しないこと。
3. plain 経路のアップロード応答 `x-obs-oid` は生成メッセージ ID と一致するため、
   送信バイトをサーバー側の永続メディアストレージに保存し、自クライアントの再表示に使う。

## グルーピング表示

- 公式クライアントのアルバム（`contentMetadata.GID/GSEQ/GTOTAL`）の再現は未達。
  現状の UI は `sender + chatId + 30 秒窓` で連続 IMAGE をグルーピングするフォールバック実装。
- `relatedMessageId` / `messageRelationType` は E2EE 経路の `sendMessage` では付与されるが、
  reqseq 経路ではサーバ生成のため存在しない。詳細は
  `docs/analysis/multi-image-send-handoff.md` を参照。

## テスト

```bash
bun run test:media -- --chat c1efe9d6cf1848350bc91848a8a29963e --n 3
```

送信先は AGENTS.md の許可されたテスト先のみ。
