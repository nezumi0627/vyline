# Plugin System（基盤）

最終更新: 2026-08-22

## 現状

**基盤のみ実装**。プラグインコードの実行は未対応（`runtimePending: true`）。

実装済み:

- `@vyline/plugin-sdk`: `definePlugin` / `VylinePlugin` / 権限・コンテキストの型定義
- backend plugin manager: マニフェスト検出 + アカウント単位の有効/無効状態の永続化
- BFF API:
  - `GET /line/{accountId}/plugins`
  - `POST /line/{accountId}/plugins/{pluginId}/enable`
  - `POST /line/{accountId}/plugins/{pluginId}/disable`

未対応（ロードマップ）:

1. プラグインコードの実行ランタイム（activate / deactivate / イベント配信）
2. 権限の強制（permissions 宣言の検証とアクセス制御）
3. エラー分離（クラッシュしたプラグインが本体に影響しない機構）
4. install / update / remove のライフサイクル管理
5. UI 拡張ポイント（ui:extend）

## ディレクトリ構成

```txt
<VYLINE_PLUGIN_DIR>/            既定: Vyline/backend/data/plugins/
  my-plugin/
    manifest.json               必須: id / name / version / permissions
    index.ts                    実行ランタイム対応後に読み込まれる
```

manifest.json 例:

```json
{
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "0.1.0",
  "description": "Example Vyline plugin",
  "permissions": ["messages:read", "notifications:send"]
}
```

有効/無効の状態は `<VYLINE_DATA_DIR>/plugin-states.json` に
`{ accountId: { pluginId: enabled } }` 形式で保存される（アカウントスコープ分離）。

## セキュリティ原則

- プラグインは raw token / session / cookie / 秘密鍵 / 無制限な filesystem へ
  アクセスできない（SDK の型にその面を露出させない）
- プラグイン API は必ずアカウントスコープで呼ばれる
- 無効化されたプラグインのコードは読み込まれない（ランタイムコストほぼゼロ）
