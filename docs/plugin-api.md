# Vyline プラグイン API（Beta）

最終更新: 2026-11-03

> **アーカイブ — 現行版では利用できません。** バックエンドにはプラグインの実行基盤が残っていますが、現行版からプラグイン管理 API とユーザー向け設定画面は公開されていません。このページの API、手順、実行例を現行版で使えるものとして扱わないでください。現行機能の案内は[機能ガイド](./features.md)を参照してください。

## できること

- Bun による TypeScript / JavaScript ES Module の動的ロード（再ビルド不要）
- アカウント単位の有効／無効、バックエンド再起動後の自動復元
- 受信メッセージの購読（`messages:read` が必要）
- アカウント単位の JSON 設定保存（`settings:read` / `settings:write` が必要）
- activate、deactivate、メッセージハンドラの例外隔離。本体プロセスを落とさない

プラグインは **信頼できるローカルコードだけ** を実行します。署名検証、URL インストール、マーケットプレイス、ブラウザ UI 拡張は未対応です。

## 最短の試し方

PowerShell で、同梱サンプルを data ディレクトリへコピーします。

```powershell
Copy-Item -Recurse Vyline\packages\plugin\examples\message-logger Vyline\backend\data\plugins\message-logger
```

Vyline を起動後、**設定 → プラグイン** を開いて `Message Logger` を有効にします。受信メッセージの本文を外部送信せず、backend のローカルログへイベントを記録します。

設定保存を試す場合は `settings-demo` をコピーします。

```powershell
Copy-Item -Recurse Vyline\packages\plugin\examples\settings-demo Vyline\backend\data\plugins\settings-demo
```

## manifest とエントリ

各プラグインフォルダには `manifest.json` と `index.ts` または `index.js` を置きます。`main` を指定した場合はそのファイルを実行します。

```json
{
  "id": "message-logger",
  "name": "Message Logger",
  "version": "0.1.0",
  "description": "受信イベントをローカルログへ記録します",
  "permissions": ["messages:read"]
}
```

SDK の型と完全なサンプルは [Vyline/packages/plugin](../Vyline/packages/plugin/README.md) を参照してください。

## 権限

| 権限 | 現在の公開内容 |
| --- | --- |
| `messages:read` | `ctx.messages.on("message", ...)` による受信メッセージの購読 |
| `settings:read` | `ctx.settings.get` によるアカウント別設定の読み込み |
| `settings:write` | `ctx.settings.set` によるアカウント別設定の保存 |

SDK に型として存在しても、`messages:send`、`media:*`、`storage:*`、`network:request`、`ui:extend`、`notifications:send` はまだ context に公開しません。権限外の操作は警告と安全な既定値で拒否します。

## 関連

- 利用者・開発者向け詳細: [developers/plugin-system.md](developers/plugin-system.md)
- テーマ拡張: [theme-api.md](theme-api.md)
