# Setup・アカウント設定・引継ぎ・診断ログ

共通機能は `apps/desktop` 固有ではなく、backend と `@vyline/types` を正本にして Web / Desktop の UI から利用します。0.8.0-beta では Desktop UI に Vyline Setup、引継ぎ、診断ログの導線があります。初回 Setup は LINE ログイン後に開始し、端末内の VylineBackup、設定引継ぎ ZIP、歓迎画面、利用環境の詳細設定を順に案内します。

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
├─ accounts/{safe-mid}/handoff.json
├─ global/app-settings.json
└─ logs/diagnostics-{safe-mid}.jsonl
```

現時点で `settings.json`、`handoff.json`、診断ログがこのレイアウトを使います。既存のチャット DB やトークンは互換性のため旧 accountId サフィックス形式も残します。認証token、Cookie、パスワード、E2EE鍵、秘密鍵、トーク本文は設定・引継ぎ・共有ログから除外します。旧flat形式は新形式へコピーして移行し、移行失敗時は元データを削除しません。

## セキュリティ

外部入力はAPI境界で検証し、MIDを安全なパス要素へ変換します。診断情報は共有前にマスキングし、MIDは不可逆なSHA-256短縮値だけを使います。本文ログは設定型で常に無効です。

## 実装ステータス

実装済みの API は以下です。すべて内部 BFF API で、入力 MID は `u` + 32 桁の 16 進数に検証します。

- `GET /api/settings/accounts/:mid`: 設定の取得
- `PUT /api/settings/accounts/:mid`: 設定の保存
- `PATCH /api/settings/accounts/:mid/setup`: Setup の進捗と設定の保存
- `POST /api/handoff/:mid/export`: manifest・ファイルSHA-256付きの実ZIPを生成
- `POST /api/handoff/:mid/inspect`: ZIPを適用せず、提供元・対象アカウント・対象ファイルを確認
- `POST /api/handoff/:mid/import`: ZIP、manifest、対応version、各ファイルのハッシュを検証して適用
- `GET /api/diagnostics/:mid`: MID単位の診断ログ一覧
- `GET /api/diagnostics/:mid/export`: サニタイズ済みログを取得
- `DELETE /api/diagnostics/:mid`: 診断ログを削除

引継ぎ ZIP は `settings.json` のみを含みます。適用前に manifest、SHA-256、作成元、対象アカウント一致、対象ファイルを検証します。import は `overwrite` / `merge` / `cancel` を選べ、上書き前の設定を退避して検証失敗時に復元します。Windowsでは認証tokenをDPAPI(CurrentUser)で保護します。Desktop設定画面には引継ぎ、VylineBackup の作成・一覧・復元、ログ一覧、ログ出力、ログ削除、GitHub Issue作成画面への導線を追加しています。Issue作成はGitHub APIへtokenを渡さず、サニタイズ済みログを本文にしたIssue作成URLを開きます。
