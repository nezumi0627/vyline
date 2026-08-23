# Multi Account Design（複数アカウント分離）

最終更新: 2026-08-24

## 現状（実装済み）

Vyline は `accountId` をキーにデータを分離している。実体はフラットなサフィックス方式。

| データ | パス | 分離 |
|---|---|---|
| セッション / トークン | `data/tokens.json` (`{ [accountId]: ... }`) | ✅ key 単位 |
| チャット / メッセージ DB | `data/chatdb-{accountId}.json` | ✅ ファイル単位 |
| プロフィール等キャッシュ | `data/vyline-cache-{accountId}.json` | ✅ |
| 既読レンジ | `data/vyline-readRanges-{accountId}.json` | ✅ |
| 保存メディア | `storage/saved-media/{type}/...`（accountId + chatMid + messageId をハッシュ化） | ✅ キー単位 |
| メッセージ詳細ログ | `data/logs/message-log-{accountId}.jsonl` | ✅ |
| バックアップ | `data/backups/` (スナップショットに accountId を記録) | ✅ メタで分離 |
| プラグイン有効状態 | `data/plugin-states.json` (`{ [accountId]: ... }`) | ✅ key 単位 |

バックエンドの全ストレージ API は第一引数に `accountId` を受け、
クライアント管理 (`clientManager`) もアカウントごとに client / ops loop / token watcher を持つ。
ログアウト時はタイマー・ループを確実に停止する（perf ブランチで修正済み）。

## 未達成（計画）

README の目標に対し、以下が未実装。**移行は既存データのマイグレーションを伴うため
段階的に行う**。

### 1. アカウントレジストリ

```txt
data/accounts.json
{
  "activeAccountId": "main",
  "accounts": [
    { "accountId": "main", "displayName": "Main", "createdAt": "...", "lastUsedAt": "..." }
  ]
}
```

- raw MID は永続化しない（表示名はローカル付名のみ）
- ログへ raw MID を出さない

### 2. ディレクトリ分離

```txt
data/accounts/<safe-account-id>/
  session/ storage/ cache/ media/ db/ logs/ backup/
```

- `<safe-account-id>` は MID をそのまま使わず hash / sanitized id を使用
- 移行時は既存 `*-main.json` 等を取り込み、旧ファイルは読み取り互換のため一定期間残す

### 3. アカウント切替の完全性

現状もクライアント単位で分離されているが、以下を明示テストする必要がある:

- 切替中に前アカウントの UI state / メディア URL が残らないこと
- 切替中の送信が誤って前アカウントで実行されないこと
- バックアップ復元が別アカウントに混ざらないこと

### 4. 公開 API の account スコープ

公開 REST API (/v1) はすでに `/accounts/{accountId}/...` 形式。
プラグイン API も同様に account スコープ付き（plugin-foundation で実装済み）。

## マイグレーション方針（将来）

1. accounts.json 導入（既存 accountId をそのまま登録・挙動変更なし）
2. 新規データの書き込み先を `accounts/<id>/` へ（読み込みは旧パスフォールバック）
3. 起動時に旧フラットファイルを移行する one-shot migration コマンド
4. フォールバック削除（破壊的変更・メジャーアップデートで実施）
