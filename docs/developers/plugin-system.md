# Plugin System

最終更新: 2026-08-24

## 使い方（ユーザー向け）

1. `Vyline/backend/data/plugins/<プラグイン名>/` フォルダを作る
2. `manifest.json`（名前・ID・権限）と `index.ts`（推奨）または `index.js` を置く
3. バックエンドを再起動（または `--watch` なら自動検出）
4. 有効化:

```bash
curl -X POST http://127.0.0.1:3001/line/main/plugins/<pluginId>/enable
# 無効化
curl -X POST http://127.0.0.1:3001/line/main/plugins/<pluginId>/disable
# 一覧
curl http://127.0.0.1:3001/line/main/plugins
```

完全な動作サンプルは [examples/example-plugin](../../examples/example-plugin/) を
`data/plugins/` にコピーしてそのまま試せます。

## manifest.json

```json
{
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "0.1.0",
  "description": "説明",
  "permissions": ["messages:read"]
}
```

## index.ts

```ts
import { definePlugin } from "@vyline/plugin-sdk";

export default definePlugin({
  id: "example-plugin",
  name: "Example Plugin",
  version: "0.1.0",
  permissions: ["messages:read"],

  activate(ctx) {
    ctx.messages.on("message", (message) => {
      ctx.logger.info(`new message ${message.id}`);
    });
  },

  deactivate() {
    // 後片付け（ハンドラは自動解除）
  },
});
```

Bun が `.ts` を直接実行するためビルドは不要。npm パッケージも通常どおり使えます。

## 権限

宣言された権限のみコンテキストが公開されます（強制）。

| 権限 | 公開される機能 |
|---|---|
| `messages:read` | `ctx.messages.on("message", ...)` — 受信メッセージの購読 |
| `settings:read` / `settings:write` | `ctx.settings.get/set` — プラグイン設定の永続化（アカウント別） |

権限のない操作は例外ではなく警告ログ + フォールバック（既定値を返す）になります。

## 分離の保証

- `activate` / ハンドラの例外はすべて捕捉され、**Vyline 本体は落ちません**
- ハンドラ単位で隔離され、1 プラグインのクラッシュが他に影響しない
- 無効化されたプラグインのコードは読み込まれない（ランタイムコストゼロ）
- 設定は `data/plugin-settings/<accountId>.<pluginId>.json` にアカウント別に保存
- 有効/無効状態は `data/plugin-states.json` にアカウント別に保存

## ロードマップ

- `messages:send` / `notifications:send`（送信系コンテキスト）
- `media:read/write`、`storage:read/write`、`ui:extend`（フロントエンド拡張点）
- install / update / remove コマンド（現在はフォルダ配置がインストール相当）
- 権限ダイアログ（有効化時のユーザー確認 UI）
