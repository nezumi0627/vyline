# Setup・アカウント設定・引継ぎ・診断ログ

共通機能は `apps/desktop` 固有ではなく、backendと`@vyline/types`を正本にしてWeb/デスクトップから利用します。

## データ所有

- `packages/types`: 設定、Setup、引継ぎmanifest、診断コンテキストの共有契約
- `backend/src/api`: 入力検証とHTTPエラー変換
- `backend/src/service`: 設定、マスキング、引継ぎ、診断ログのユースケース
- `backend/src/storage`: MID単位のパス、原子書き込み、旧形式移行、バックアップ
- `apps/desktop`: Setup・設定・引継ぎ・診断ログの表示と確認操作

## 保存レイアウト

```text
VylineData/
├─ accounts/{safe-mid}/settings.json
├─ accounts/{safe-mid}/preferences.json
├─ accounts/{safe-mid}/handoff.json
├─ global/app-settings.json
└─ logs/diagnostics-{safe-mid}.jsonl
```

認証token、Cookie、パスワード、E2EE鍵、秘密鍵、トーク本文は設定・引継ぎ・共有ログから除外します。旧flat形式は新形式へコピーして移行し、移行失敗時は元データを削除しません。

## セキュリティ

外部入力はAPI境界で検証し、MIDを安全なパス要素へ変換します。診断情報は共有前にマスキングし、MIDは不可逆なSHA-256短縮値だけを使います。本文ログは設定型で常に無効です。

## 実装ステータス

実装済みのAPIは以下です。

- `POST /api/handoff/:mid/export`: manifest・ファイルSHA-256付きの実ZIPを生成
- `POST /api/handoff/:mid/import`: ZIP、manifest、対応version、各ファイルのハッシュを検証して適用
- `GET /api/diagnostics/:mid`: MID単位の診断ログ一覧
- `GET /api/diagnostics/:mid/export`: サニタイズ済みログを取得
- `DELETE /api/diagnostics/:mid`: 診断ログを削除

Windowsでは認証tokenをDPAPI(CurrentUser)で保護します。Desktop設定画面には引継ぎ、ログ一覧、ログ出力、ログ削除、GitHub Issue作成画面への導線を追加しています。Issue作成はGitHub APIへtokenを渡さず、サニタイズ済みログを本文にしたIssue作成URLを開きます。
