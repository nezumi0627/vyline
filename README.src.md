<!--@languages=ja,en-->
<!--@default=ja-->
[English](README.en.md)

<p align="center">
  <img src="logo/assets/color/128.png" alt="Vyline logo" width="88" height="88" />
</p>

<h1 align="center">Vyline</h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  LINE向けの非公式クライアント。Web・Windows・macOS・Linuxで利用できます。
</p>

<p align="center">
  <a href="https://github.com/nezumi0627/vyline/releases/tag/v1.1.0"><img alt="安定版 1.1.0" src="https://img.shields.io/badge/version-1.1.0-eeeeee?style=flat-square&amp;labelColor=181818" /></a>
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-eeeeee?style=flat-square&amp;labelColor=181818" />
  <img alt="runtime Bun" src="https://img.shields.io/badge/runtime-Bun-000000?style=flat-square" />
  <img alt="frontend React" src="https://img.shields.io/badge/frontend-React-61DAFB?style=flat-square" />
  <img alt="backend Hono" src="https://img.shields.io/badge/backend-Hono-E36002?style=flat-square" />
  <img alt="language TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square" />
  <img alt="build Vite" src="https://img.shields.io/badge/build-Vite-646CFF?style=flat-square" />
  <img alt="database SQLite" src="https://img.shields.io/badge/database-SQLite-003B57?style=flat-square" />
</p>

<p align="center"><a href="https://nezumi0627.github.io/vyline/#start">導入ツアー</a> · <a href="docs/features.md">機能を知る</a> · <a href="https://nezumi0627.github.io/vyline/#docs">目的からドキュメントを探す</a> · <a href="links/">関連リポジトリ</a></p>

> [!CAUTION]
> VylineはLINE株式会社およびLY Corporationとは関係のない非公式クライアントです。利用規約やアカウント、データに関するリスクを理解したうえで使用してください。[プライバシーとデータ](docs/user-guide/privacy-and-data.md)

> [!NOTE]
> **v1.1.0を現在の安定版・開発の基準点とします。** macOSローカル配布、アプリ内アップデート案内、多言語UI設定、Desktop履歴復元を追加し、Linux配布の起動問題を修正しました。[リリース](https://github.com/nezumi0627/vyline/releases/tag/v1.1.0) · [変更履歴](CHANGELOG.md)

## Vylineについて

VylineはLINEのトークを送受信・管理するオープンソースクライアントです。フロントエンド、Backend、独自プロトコルを組み合わせ、ローカル利用とセルフホストに対応します。

## 主な機能

- **トーク**: DM・グループ、メッセージ、既読管理、検索、メンション、URLプレビュー
- **メディアと表示**: 画像・動画・音声・ファイル、スタンプ・絵文字、Flex/Rich、リアクション
- **プロフィールとグループ**: プロフィール、友だち・ブロック管理、グループ作成・設定
- **自分向けの調整**: VyTheme、文字サイズ、通知・プライバシー設定、ストリーマーモード
- **データとサポート**: VylineBackup、Snapshot、履歴取り込み、診断ログ、Agent Iサポート
- **運用と拡張**: 複数アカウント、サブデバイス、公開API、CLI、Dockerセルフホスト

詳細と制限は[機能ガイド](docs/features.md)、機能ごとの検証状況は[機能検証表](docs/feature-capabilities.md)を参照してください。実装の有無と実LINE環境での検証済みは区別しています。

## はじめる

**安定版は1.1.0です。** 環境に合った手順を選んでください。

| 環境 | 入手方法 | インストール手順 |
| --- | --- | --- |
| Windows x64 | [Setup.exe](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/VylineSetup-1.1.0.exe) / [ポータブルZIP](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-portable-1.1.0.zip)。Bun不要 | [Windows](docs/install/windows.md) |
| Linux x64 | [tar.gz](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-linux-x64-1.1.0.tar.gz)。Bun不要 | [Linux](docs/install/linux.md) |
| macOS | [Apple Silicon ZIP](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-macos-arm64-1.1.0.zip) / [Intel ZIP](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-macos-x64-1.1.0.zip) | [macOS](docs/install/macos.md) |
| Docker / Web | amd64 / arm64のサーバーで動かす | [Docker](docs/install/docker.md) |

コマンドから始めるなら、Windows・macOS・Linuxで共通の **Bun + vyl CLI** が使えます。[vylを登録して起動する](docs/install/cli.md)

導入後は[ログインと初回設定](docs/start-here.md#ログインと初回設定)へ。更新前は[アップデートガイド](docs/user-guide/update.md)を確認してください。
配布物の整合性は[SHA256SUMS.txt](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/SHA256SUMS.txt)で確認できます。

## 利用前の注意

VylineはLINEの公式アプリではありません。外部サーバー利用時は認証情報や履歴の保管先を確認してください。AI機能では、入力または明示的に選択した内容がYahooのAgent Iへ送信される場合があります。詳細と無効化方法は[プライバシーとデータ](docs/user-guide/privacy-and-data.md)をご覧ください。

## ドキュメント

| 知りたいこと | ドキュメント |
| --- | --- |
| できること | [機能ガイド](docs/features.md) |
| セットアップとFAQ | [使い始める](docs/start-here.md) |
| Windows・macOS・Linux・Docker配布 | [配布ガイド](docs/distribution.md) |
| Bunとvyl CLIを登録して起動する | [CLI導入ガイド](docs/install/cli.md) |
| API | [OpenAPI・公開API](docs/api/openapi.md) |
| 開発への参加 | [コントリビューション](docs/CONTRIBUTING.md) · [メンテナー募集](docs/maintainers.md) |
| v0.5.0など過去仕様 | [リリース履歴](docs/history/releases.md) |
| すべてのドキュメント | [ドキュメント索引](docs/README.md) |

## 開発に参加する

バグ報告、機能提案、コード・調査・翻訳の協力を歓迎します。[コントリビューションガイド](docs/CONTRIBUTING.md)をご覧ください。

## 謝辞

Vylineのロゴ・アイコンを制作してくださった [@yuz-mc](https://github.com/yuz-mc) さんに感謝します。[PR #294](https://github.com/nezumi0627/vyline/pull/294) のロゴ素材はCC BY 4.0で提供されています。アプリ用の各サイズ画像・Windows ICO・macOS ICNSは元のロゴから生成した派生形式です。著作権・ライセンス表記は [`logo/LICENCE`](logo/LICENCE) をご確認ください。

## ライセンス

ソフトウェア本体はMIT（[LICENSE](LICENSE)）、ロゴ・アイコン素材は別途CC BY 4.0（[`logo/LICENCE`](logo/LICENCE)）です。
