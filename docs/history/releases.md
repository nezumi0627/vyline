# リリース履歴と基準版

最終更新: 2026-11-05

現在の安定版・今後の開発基準は**v1.2.0**です。今後の修正や機能追加は、この安定版を起点にしたmainの変更として管理します。公開済みタグは上書きせず、新しいリリースは新しいバージョンで配布します。

## v1.2.0 — OpenChat対応とチャット機能の改善

OpenChat（Square）ベータのオプトイン基盤とスタンプ送信・既読・リアクション操作、PWA、Stable/Beta更新チャンネルを追加しました。未読・既読同期、チャット一覧プレビュー、プロフィール移動、アカウント切替などを改善しました。[CHANGELOG](../../CHANGELOG.md) · [GitHub Release](https://github.com/nezumi0627/vyline/releases/tag/v1.2.0)

## v1.1.0 — macOS配布・履歴復元・多言語対応

macOS向けローカルアプリ、アプリ内アップデート案内、多言語UI設定、Desktop SQLite/WAL履歴復元を追加しました。Linux配布物の起動問題、Docker保存先、アカウント別下書きとE2EEプレビューの再試行を修正しました。[CHANGELOG](../../CHANGELOG.md) · [GitHub Release](https://github.com/nezumi0627/vyline/releases/tag/v1.1.0)

## v1.0.3 — 配布と検証の改善

Dockerのamd64/arm64イメージをネイティブRunnerで並列ビルドし、統合後のplatform検証を追加しました。Windowsポータブル版を含む配布アーカイブにSHA-256チェックサムを付与しています。[GitHub Release](https://github.com/nezumi0627/vyline/releases/tag/v1.0.3)

## v1.0.2 — 設定・診断ログの修正

診断ログの有効化とアカウント切替時の状態表示を修正しました。Beta機能と設定カテゴリを整理し、未公開のプラグイン導線をアプリから除去しています。[CHANGELOG](../../CHANGELOG.md) · [GitHub Release](https://github.com/nezumi0627/vyline/releases/tag/v1.0.2)

## v1.0.1 — Windows配布版の起動修正

v1.0.0のWindows Setupで、配布Backendがpino-pretty transportを解決できず無言で終了する問題を修正しました。起動ログを保存し、必要なprotocol fallback profileを配布物に含めています。[CHANGELOG](../../CHANGELOG.md) · [GitHub Release](https://github.com/nezumi0627/vyline/releases/tag/v1.0.1)

## v1.0.0 — 安定版の開始

v0.8.0-beta以降の機能・品質改善を整理し、以後の開発の安定した基準点として公開しました。主な変更はメッセージ・既読DB、検索と表示、設定・バックアップ、プロフィール・グループ管理、サポート、配布経路の改善です。

## v0.5.0-beta — 受信方式と公開APIの変更

v0.5.0-betaはv0.4.xと互換性がない移行点でした。現在の利用者が通常参照する必要はありません。旧版向けの注意は[旧版移行メモ](./v0.5.0.md)に分離しています。

## 詳細な履歴

リリースごとの追加・変更・修正は[CHANGELOG](../../CHANGELOG.md)を参照してください。
