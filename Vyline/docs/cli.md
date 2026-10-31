# Vyline CLI

CLIはGUIを起動せず、保存済みアカウントの情報をJSONで表示します。メッセージ送信はCLIから行いません。

```powershell
# 保存済みアカウント
bun run cli -- accounts

# 自分のプロフィール、連絡先プロフィール、チャット一覧
bun run cli -- profile --account <accountId>
bun run cli -- contact --account <accountId> --mid <userMid>
bun run cli -- chats --account <accountId>

# ローカルSQLiteから履歴を取得（ネットワーク不要）
bun run cli -- history --account <accountId> --chat <chatMid> --limit 50
bun run cli -- history --account <accountId> --chat <chatMid> --before <messageId> --limit 50

# 指定チャットをLINEから同期して取得
bun run cli -- history --account <accountId> --chat <chatMid> --limit 50 --refresh

# 直近100件の自分の送信メッセージの既読状態を取得
bun run cli -- receipts --account <accountId> --chat <chatMid> --limit 100

# チャットを既読にする（サーバーへ状態変更を送る）
bun run cli -- read --account <accountId> --chat <chatMid>
bun run cli -- read --account <accountId> --chat <chatMid> --last <messageId>
```

アカウントが1件だけなら `--account` は省略できます。複数ある場合は必須です。`--before` は同じチャットのローカル履歴に存在するメッセージIDを指定します。`--refresh` は対象アカウントだけを復元し、バックグラウンド監視や全アカウント同期を起動しません。

CLI単体のヘルプ:

```powershell
bun run cli -- --help
```
