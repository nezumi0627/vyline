# Vyline ドキュメント

## 使い始める

- [CLI](cli.md) — GUIを起動しないアカウント・履歴・既読操作
- [MCP Server](mcp.md) — ローカルMCPクライアントから読み取り専用で接続
- [Public API](public-api.md) — アカウント固定のAPIトークンとHTTPS運用
- [iOSバックアップ復元](guides/ios-backup-restore.md) — Apple Devices / iTunes の暗号化バックアップ
- [アニメーション設定](animation-modes.md) — モーションの表示モード

## 運用・開発

- [安全な送信](safe-sending.md) — 結果不明、拒否、送信制限時の扱い
- [Cloudflare構成](../cloudflare/README.md) — 個人利用向けコンテナ構成
- [Protocol package](../packages/protocol/README.md) — LINEプロトコル、E2EE、RPCの構造
- [Plugin package](../packages/plugin/README.md) — プラグインSDKと例
- [Theme package](../packages/themes/README.md) — VyThemeプリセット
- [Storage and offline quality plan](superpowers/plans/2026-10-28-storage-and-offline-quality.md)
- [CLI and history performance plan](superpowers/plans/2026-10-29-cli-history-docs.md)

ルートの起動・開発コマンドはリポジトリ直下の `package.json` を正本とします。コマンド例はリポジトリルートから実行します。
