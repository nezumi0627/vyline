<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: ja -->

[English](README.en.md)

<h1 align="center">Vyline</h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  LINE向けの非公式クライアント。Web・Windows・Linuxで利用できます。
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.3-a78bfa?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
</p>

> [!CAUTION]
> VylineはLINE株式会社およびLY Corporationとは関係のない非公式クライアントです。利用規約やアカウント、データに関するリスクを理解したうえで使用してください。[プライバシーとデータ](docs/user-guide/privacy-and-data.md)

> [!NOTE]
> **v1.0.3を現在の安定版・開発の基準点とします。** Dockerのamd64/arm64配布をネイティブ並列ビルドに変更し、リリース検証と配布物チェックサムを強化しました。[リリース](https://github.com/nezumi0627/vyline/releases/tag/v1.0.3) · [変更履歴](CHANGELOG.md)

## Vylineについて

VylineはLINEのトークを送受信・管理するオープンソースクライアントです。フロントエンド、Backend、独自プロトコルを組み合わせ、ローカル利用とセルフホストに対応します。

## 主な機能

- **トーク**: DM・グループ、メッセージ、既読管理、検索、メンション、URLプレビュー
- **メディアと表示**: 画像・動画・音声・ファイル、スタンプ・絵文字、Flex/Rich、リアクション
- **プロフィールとグループ**: プロフィール、友だち・ブロック管理、グループ作成・設定
- **自分向けの調整**: NezuTheme、文字サイズ、通知・プライバシー設定、ストリーマーモード
- **データとサポート**: VylineBackup、Snapshot、履歴取り込み、診断ログ、Agent Iサポート
- **運用と拡張**: 複数アカウント、サブデバイス、公開API、CLI、Dockerセルフホスト

詳細と制限は[機能ガイド](docs/features.md)、機能ごとの検証状況は[機能検証表](docs/feature-capabilities.md)を参照してください。実装の有無と実LINE環境での検証済みは区別しています。

## はじめる

- **Windows**: [v1.0.3 Setupまたはポータブル版](https://github.com/nezumi0627/vyline/releases/tag/v1.0.3)をダウンロードします。
- **Linux**: 同じReleaseからLinux x64版を入手できます。Dockerはlinux/amd64・linux/arm64に対応します。
- **Web・セルフホスト**: [セルフホストガイド](docs/selfhosting.md)を参照してください。
- **macOS**: 専用インストーラーはありません。ソースから起動するか、サーバーを立ててブラウザから利用してください。
- **更新**: [アップデートガイド](docs/user-guide/update.md)

## 利用前の注意

VylineはLINEの公式アプリではありません。外部サーバー利用時は認証情報や履歴の保管先を確認してください。AI機能では、入力または明示的に選択した内容がYahooのAgent Iへ送信される場合があります。詳細と無効化方法は[プライバシーとデータ](docs/user-guide/privacy-and-data.md)をご覧ください。

## ドキュメント

| 知りたいこと | ドキュメント |
| --- | --- |
| できること | [機能ガイド](docs/features.md) |
| セットアップとFAQ | [使い始める](docs/start-here.md) |
| Windows・Linux・Docker配布 | [配布ガイド](docs/distribution.md) |
| API | [OpenAPI・公開API](docs/api/openapi.md) |
| 開発への参加 | [コントリビューション](docs/CONTRIBUTING.md) · [メンテナー募集](docs/maintainers.md) |
| v0.5.0など過去仕様 | [リリース履歴](docs/history/releases.md) |
| すべてのドキュメント | [ドキュメント索引](docs/README.md) |

## 開発に参加する

バグ報告、機能提案、コード・調査・翻訳の協力を歓迎します。[コントリビューションガイド](docs/CONTRIBUTING.md)をご覧ください。

## ライセンス

MIT。[LICENSE](LICENSE)
