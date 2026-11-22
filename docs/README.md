# Vyline ドキュメント索引

最終更新: 2026-11-23

Vyline のドキュメントはすべてこの `docs/` にあります。入口は読む人ごとに分かれています。

- 使う人: [start-here.md](./start-here.md)
- 開発者: [developers/index.md](./developers/index.md)
- AI エージェント: [../AGENTS.md](../AGENTS.md)、続けて [developers/for-ai.md](./developers/for-ai.md)

どの文書が何の正本かは [DOCS_OWNERSHIP.md](./DOCS_OWNERSHIP.md)、書き方は [DOCS_FORMAT.md](./DOCS_FORMAT.md) にあります。公開サイトは <https://nezumi0627.github.io/vyline/> で、掲載するページは `Vyline/website/site-data.js` で選びます。

## 使う

| ドキュメント | 内容 |
| --- | --- |
| [start-here.md](./start-here.md) | 導入から最初の設定まで |
| [install/windows.md](./install/windows.md) / [linux.md](./install/linux.md) / [macos.md](./install/macos.md) | OS 別の導入 |
| [install/docker.md](./install/docker.md) | Docker でサーバーを立ててブラウザで使う |
| [install/cli.md](./install/cli.md) | Bun と `vyl` で起動する（全 OS 共通） |
| [features.md](./features.md) / [features.en.md](./features.en.md) | 機能の案内と制限 |
| [feature-capabilities.md](./feature-capabilities.md) | 機能ごとの実装・検証状況 |
| [user-guide/update.md](./user-guide/update.md) | アップデート |
| [user-guide/themes.md](./user-guide/themes.md) | テーマの作り方 |
| [user-guide/animation-modes.md](./user-guide/animation-modes.md) | アニメーションモード |
| [user-guide/safe-sending.md](./user-guide/safe-sending.md) | 送信結果が不明・拒否・制限のときの扱い |
| [user-guide/vyline-backup-restore.md](./user-guide/vyline-backup-restore.md) | VylineBackup の保存と復元 |
| [user-guide/ios-backup-restore.md](./user-guide/ios-backup-restore.md) | iOS の暗号化バックアップから履歴を取り込む |
| [user-guide/desktop-history-restore.md](./user-guide/desktop-history-restore.md) | Windows LINE Desktop の履歴を取り込む |
| [user-guide/error-handling.md](./user-guide/error-handling.md) / [English](./user-guide/error-handling.en.md) | エラー表示と復旧 |
| [user-guide/privacy-and-data.md](./user-guide/privacy-and-data.md) / [English](./user-guide/privacy-and-data.en.md) | データ保存、AI、サポートログの注意 |
| [user-guide/custom-client.md](./user-guide/custom-client.md) | カスタムクライアントの作り方 |
| [setup-account-handoff-debug.md](./setup-account-handoff-debug.md) | Setup、設定の引継ぎ、診断ログ |
| [subdevices.md](./subdevices.md) | サブデバイス接続 |
| [openchat-square.md](./openchat-square.md) / [English](./openchat-square.en.md) | OpenChat / Square（Beta） |
| [ai-agent-beta.md](./ai-agent-beta.md) | Agent I（Beta） |
| [i18n.md](./i18n.md) / [English](./i18n.en.md) | UI の多言語対応 |
| [history/releases.md](./history/releases.md) / [English](./history/releases.en.md) | リリース履歴と基準版 |
| [maintainers.md](./maintainers.md) / [English](./maintainers.en.md) | メンテナーと支援 |

## 運用する

| ドキュメント | 内容 |
| --- | --- |
| [selfhosting.md](./selfhosting.md) | セルフホストとデータ永続化 |
| [deployment/docker.md](./deployment/docker.md) | Docker Compose の環境変数と更新 |
| [deployment/container-builds.md](./deployment/container-builds.md) | コンテナイメージの CI |
| [distribution.md](./distribution.md) | 配布、アップデーター、リリース手順 |
| [versioning.md](./versioning.md) | プロダクトと workspace のバージョン |
| [security/threat-model.md](./security/threat-model.md) | 信頼境界と攻撃面 |
| [security/findings-2026-08-31.md](./security/findings-2026-08-31.md) | 2026-08-31 のセキュリティ監査結果 |

## API

| ドキュメント | 内容 |
| --- | --- |
| [api/openapi.md](./api/openapi.md) | OpenAPI / Swagger |
| [api/public-api.md](./api/public-api.md) | アカウント固定の API トークンと HTTPS 運用 |
| [api/mcp.md](./api/mcp.md) | 読み取り専用の MCP Server |
| [api/media-batch.md](./api/media-batch.md) | 複数メディアの一括送信 |
| [api-rpc-mapping.md](./api-rpc-mapping.md) | BFF API と LINE RPC の対応 |
| [plugin-api.md](./plugin-api.md) | ローカルプラグイン API（Beta） |
| [theme-api.md](./theme-api.md) | VyTheme API |

## 開発する

| ドキュメント | 内容 |
| --- | --- |
| [developers/index.md](./developers/index.md) | 開発者向けの読む順序 |
| [onboarding.md](./onboarding.md) | 初日のチェックリスト |
| [architecture.md](./architecture.md) | 層構造とデータフロー |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 機能追加の流れ（辞書 → Desktop → domain → BFF） |
| [development.md](./development.md) | 開発コマンドと環境変数 |
| [development-worktrees.md](./development-worktrees.md) | 1 task = 1 branch = 1 git worktree |
| [performance.md](./performance.md) | 起動時間・CPU・メモリの計測 |
| [login-flow.md](./login-flow.md) | QR / Email E2EE ログイン |
| [developers/multi-account.md](./developers/multi-account.md) | 複数アカウントのデータ分離 |
| [developers/plugin-system.md](./developers/plugin-system.md) | プラグインシステム |
| [developers/vyl-cli.md](./developers/vyl-cli.md) | `vyl` CLI |
| [developers/backend-cli.md](./developers/backend-cli.md) | GUI なしでアカウント・履歴・既読を操作する `bun run cli` |
| [protocol/dictionary.md](./protocol/dictionary.md) | RPC 辞書と Desktop 検証表 |
| [tools/vyline-search.md](./tools/vyline-search.md) | Desktop 解析ツール（[免責](./tools/DISCLAIMER.md)、[unpack](./tools/unpack.md)、[find-native](./tools/find-native-symbol.md)、[delta](./tools/desktop-delta.md)） |
| [templates/](./templates/) | 新規ドキュメントの雛形 |
| [../CHANGELOG.md](../CHANGELOG.md) | 変更履歴 |

パッケージごとの説明は各パッケージの README にあります: [protocol](../Vyline/packages/protocol/README.md)、[plugin](../Vyline/packages/plugin/README.md)、[themes](../Vyline/packages/themes/README.md)、[cli](../Vyline/packages/cli/README.md)、[Cloudflare 構成](../Vyline/cloudflare/README.md)。

## 記録（現在の仕様の正本ではない）

ここにある文書は、その時点での調査・計画・作業の記録です。現在の挙動の根拠にするときは、コードで確かめ直してください。

| 場所 | 内容 |
| --- | --- |
| [analysis/](./analysis/README.md) | 機能別の解析メモ |
| [design/](./design/) | 設計メモと監査 |
| [superpowers/](./superpowers/) | 実装計画（plans）と設計（specs） |
| [tasks/STATUS.md](./tasks/STATUS.md) / [PHASES.md](./tasks/PHASES.md) | 進捗ボードとフェーズの受け入れ条件 |
| [tasks/](./tasks/) | 個別の計画と残作業 |
| [sessions/](./sessions/) | 作業セッションの記録 |
| [reports/](./reports/README.md) | `bun run vyline:delta` の出力先 |
| [history/v0.5.0.md](./history/v0.5.0.md) | v0.5.0-beta からの移行メモ |
