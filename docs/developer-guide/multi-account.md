# Multi Account Design（複数アカウント分離）

最終更新: 2026-08-27

## 現状（0.8.0-beta）

Vyline はログインセッションの `accountId` と、設定・引継ぎ・診断 API の LINE MID を用途ごとに使い分けます。設定を扱う API は MID を必須にし、別アカウントの設定を誤って読み書きしないようにしています。

| データ | パス | 分離 |
|---|---|---|
| アカウント設定 | `data/accounts/<safe-mid>/settings.json` | ✅ MID ごと。スキーマ version を持ち、原子的に書き込む |
| Setup 進捗 | `settings.json` 内の `setup` | ✅ MID ごと。途中再開・完了済み判定に使用 |
| 引継ぎ記録 | `data/accounts/<safe-mid>/handoff.json` | ✅ MID ごと。認証情報は含めない |
| 診断ログ | `data/logs/diagnostics-<safe-mid>.jsonl` | ✅ MID ごと。保存前にマスキング |
| セッション / トークン | `data/tokens.json` | ✅ accountId ごと。Windows は DPAPI(CurrentUser) で暗号化して保存 |
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

`safe-mid` はファイル名として安全な形式へ正規化した値です。パス結合は共有ユーティリティを通し、`..` などを含む外部入力をパスとして使いません。

## 設定のライフサイクル

1. ログイン直後、Vyline Setup が未完了なら 3 ステップ画面を表示する
2. 各ステップは `PATCH /api/settings/accounts/:mid/setup` で保存する
3. 完了時に `setup.completed` を記録し、次回は自動表示しない
4. 設定画面からはいつでも再実行・変更できる
5. アカウント切替時はチャット、既読、下書きなどの一時 UI 状態をクリアし、前アカウントの表示を残さない

設定 JSON は一時ファイルへの書き込み後に rename するため、途中終了しても完成済みファイルを壊しません。読み込み時は schema version に応じて既定値と統合します。

## 移行方針

既存の accountId サフィックス付きストレージは、互換性を壊さないため継続して読み取ります。`storage/accountDirs.ts` を使う領域は、新レイアウトを優先し、旧フラットファイルを見つけた場合に新レイアウトへコピーします。元ファイルは削除しません。

トークンや既存のチャット DB を一度に移動するマイグレーションは、データ消失リスクを避けるため未実施です。移行対象を追加する場合は、コピー → 検証 → 旧形式の読み取りフォールバック → 将来のメジャー版での削除、の順を守ります。

## セキュリティ上の注意

- 認証トークン、Cookie、E2EE 鍵、パスワード、秘密鍵は引継ぎ ZIP と診断ログに含めない
- Windows のトークン暗号化は現在の Windows ユーザーに結び付く。別ユーザー・別 PC へファイルだけをコピーしても復号できない
- アカウント削除・全データ削除は、既存ストレージを含むため明示的なバックアップ確認を伴う別操作として扱う
- Web／サブデバイスからの接続は、そのブラウザのランダムなインストール ID と有効セッションの両方を検証する
