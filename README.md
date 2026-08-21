<div align="center">

# Vyline <sup>Beta</sup>

### Vision Beyond Limits.

**独自プロトコルスタックで動作する、モダンでセルフホスト可能な LINE サードパーティクライアント。**

Web / React · Bun · Hono · `@vyline/protocol`

<p>
  <img alt="version" src="https://img.shields.io/badge/version-0.5.1--beta-a78bfa?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" />
  <img alt="stack" src="https://img.shields.io/badge/stack-Hono%20%2B%20React-0ea5e9?style=flat-square" />
  <img alt="state" src="https://img.shields.io/badge/state-beta-a78bfa?style=flat-square" />
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-22c55e?style=flat-square" />
</p>

[クイックスタート](#クイックスタート) · [機能](#機能) · [アーキテクチャ](#アーキテクチャ) · [ドキュメント](#ドキュメント) · [コントリビューション](#コントリビューション)

</div>

> [!WARNING]
> **現在 Beta 版です。** Vyline は LINE 非公式のサードパーティクライアントであり、LY Corporation とは無関係・未承認です。アカウント、互換性、データ損失などのリスクが含まれる可能性があります。利用は自己責任で行ってください。

---

## Why Vyline?

Vyline は、LINE をより自由に、自分の環境に合わせて使いたい人のために開発されています。

外部の中継サービスやゲートウェイに依存するのではなく、独自のプロトコルスタック `@vyline/protocol` を使用して LINE と通信します。

メッセージング、メディア、テーマ、E2EE、バックアップ、セルフホスト、外部連携 API までをひとつのプロジェクトに統合しています。

* **独自プロトコルスタック** — 外部のサードパーティゲートウェイに依存しません
* **高度なUIカスタマイズ** — VyTheme、文字サイズ、表示密度、プロフィール背景
* **強力なメッセージ機能** — メンション、リアクション、既読制御、再送、チャット管理
* **豊富なメディア対応** — 画像、動画、音声、絵文字、スタンプ、Flex / Rich 表示
* **ローカル中心のデータ管理** — セッション、鍵、履歴、バックアップを自分の環境で管理
* **セルフホスト対応** — 複数ブラウザから同じ Vyline セッションを利用可能
* **拡張可能** — `/v1/` API、OpenAPI 3.1、Protocol Package、解析ツール

---

## 機能

| カテゴリ             | 主な機能                                               |
| ---------------- | -------------------------------------------------- |
| **ログイン**         | QR / Email ログイン、マルチアカウント、セッション復元                   |
| **メッセージ**        | 送受信 / 返信 / 送信取消 / 既読制御 / 再送                        |
| **メンション**        | `@ALL` / `@名前`、LINE Desktop 互換の `MENTION` metadata |
| **メディア**         | 画像 / 動画 / 音声 / LINE 絵文字 / スタンプ / 高画質画像送信           |
| **Flex / Rich**  | Rich Message 表示、ドラッグ操作対応カルーセル                      |
| **リアクション**       | ワンクリックリアクション、公式風バッジ、既読者一覧                          |
| **通話**           | 音声 / ビデオ通話（実験的）                                    |
| **チャット管理**       | ピン / 非表示 / ミュート / ブロック / MID コピー / グループ作成・招待       |
| **VyTheme**      | テーマ、文字サイズ、表示密度、プロフィール背景のカスタマイズ                     |
| **E2EE**         | Letter Sealing の復号 / 送信、Desktop 鍵 import           |
| **プライバシー**       | ストリーマーモード、PIN ロック                                  |
| **VylineBackup** | トーク履歴・メディアのスナップショット作成 / 復元 / 削除                    |
| **Power Tools**  | JSONL ログ / Keepメモ / TXT エクスポート / 共通グループ高速表示        |

---

## クイックスタート

### 必要環境

* [Bun](https://bun.sh/)
* モダンブラウザ

### ローカルで起動

```bash
bun install
bun run dev
```

起動後、以下をブラウザで開きます。

```text
http://localhost:5173
```

Backend は `:3001`、Frontend は `:5173` で起動します。

<details>
<summary><strong>その他のコマンド</strong></summary>

```bash
bun run dev:backend
bun run dev:frontend
bun run typecheck
bun run lint
bun run build
```

</details>

詳しいセットアップ方法は [docs/onboarding.md](docs/onboarding.md) と [docs/development.md](docs/development.md) を参照してください。

---

## セルフホスト

Vyline は自分のサーバー上にデプロイできます。

複数端末のブラウザから同じ LINE セッションを利用しながら、トーク履歴やメディアを自分の管理するサーバーへ永続化できます。

```bash
docker compose up -d --build
```

起動後:

```text
http://localhost:3001
```

Docker、Cloudflare Access、外部公開については [docs/selfhosting.md](docs/selfhosting.md) を参照してください。

---

## アーキテクチャ

```text
┌─ Frontend (React + Vite) ── apps/desktop ──┐
│  store / mappers / sync / VyTheme UI       │
├─ Backend (Hono on Bun) ───── backend ──────┤
│  BFF routes → lineService → clientManager  │
├─ Vyline ──────────── packages/protocol ────┤
│  domain / dictionary / E2EE / Thrift stack │
└─ LINE Servers ──────────────────────────────┘
```

| パス                    | 役割                  |
| --------------------- | ------------------- |
| `apps/desktop`        | React UI            |
| `backend`             | Hono BFF            |
| `packages/protocol`   | Vyline 独自プロトコル実装    |
| `packages/line-types` | Vendored Thrift 型定義 |

Frontend / Backend / Protocol を分離した構成になっており、それぞれを独立して開発・拡張できる設計です。

---

## E2EE / Desktop 鍵

過去のメッセージを復号する場合、公式 LINE Desktop から取得した自分自身の鍵情報が必要になる場合があります。

1. [docs/analysis/](docs/analysis/) のツールを使用して必要な鍵を取得
2. `backend/data/desktop-e2ee-keys.json` に配置
3. Backend 起動時に自動的に import

> [!IMPORTANT]
> 鍵、セッション、トークン、ログイン情報、個人情報などを Git にコミットしないでください。

---

## API

Vyline はセルフホスト環境や外部アプリケーションとの連携に利用できる `/v1/` API を提供しています。

OpenAPI 3.1 仕様は以下から取得できます。

```text
GET /openapi.json
```

公開ドキュメント:

[zensical.org](https://zensical.org)

---

## 解析ツールキット

オプションの [`vyline-search`](https://github.com/nezumi0627/vyline-search) Submodule には、Desktop LINE の研究・解析を補助するツールが含まれています。

主な用途:

* unpack
* native symbol 検索
* string xref
* Ghidra decompile 補助
* インストール済み LINE バージョン確認

```powershell
bun run vyline:check
bun run vyline:versions
bun run vyline:unpack -- --version <ver>
bun run vyline:update
bun run vyline:find-native -- sendMessage
```

> [!CAUTION]
> 解析ツールは、法的に許可された範囲・教育・研究目的で使用してください。
>
> プロプライエタリなバイナリ、抽出した認証情報、秘密鍵、トークン、個人データなどを再配布しないでください。

`vyline:unpack` / `vyline:update` を実行する場合は、LINE Desktop を完全に終了してください。

詳細は [docs/tools/DISCLAIMER.md](docs/tools/DISCLAIMER.md) を参照してください。

---

## ドキュメント

README は Vyline の**表紙・概要**として簡潔に保ち、詳細な技術情報は `docs/` に分離しています。

* [ドキュメント一覧](docs/README.md)
* [オンボーディング](docs/onboarding.md)
* [開発ガイド](docs/development.md)
* [アーキテクチャ](docs/architecture.md)
* [セルフホスト](docs/selfhosting.md)
* [RPC Dictionary](docs/protocol/dictionary.md)
* [コントリビューションガイド](docs/CONTRIBUTING.md)
* [Agent Guide](AGENTS.md)
* [Changelog](CHANGELOG.md)

---

## メンテナー

Vyline は現在、以下のメンバーによって開発・メンテナンスされています。

### [nezumi0627](https://github.com/nezumi0627)

**Creator / Lead Maintainer**

Vyline の設計・開発およびプロジェクト全体のメンテナンスを担当。

### [YoseiUshida](https://github.com/youseiushida)

**Maintainer**

バグ修正、定期メンテナンス、品質改善など、Vyline の継続的なメンテナンスを担当。

コミュニティからのコントリビューションも歓迎しています。

特に以下の協力を募集しています。

* バグ修正
* 機能改善
* ドキュメント改善
* UI / UX 改善
* アプリアイコン
* プロモーション用バナー
* 継続的なメンテナンス

---

## コントリビューション

Vyline への Issue / Pull Request を歓迎しています。

* [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md)
* [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md)
* [Pull Request Template](.github/pull_request_template.md)

Pull Request を送る前に [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) を確認してください。

Issue / PR には以下を含めないでください。

* セッション情報
* アカウント情報
* 秘密鍵
* API Token
* 認証情報
* 個人情報
* プロプライエタリなソフトウェア本体

---

## Vyline Desktop

> **Coming Soon** 🚀

Vyline が安定版に到達した後、専用デスクトップアプリ **Vyline Desktop** のリリースを予定しています。

予定しているプラットフォーム:

**Windows · macOS · Linux**

予定機能:

* ネイティブ通知
* トレイアイコン
* バックグラウンド常駐
* ローカルデータ管理
* Vyline Web / Protocol との統合

---

## ⚠️ 重要事項

Vyline は LINE 非公式のサードパーティクライアントです。

LINE 株式会社および LY Corporation とは**無関係・未承認**です。

Vyline の使用によって、LINE の仕様変更による互換性問題やアカウントに関するリスクが発生する可能性があります。

利用者はこれらのリスクを理解したうえで、自身の責任で Vyline を利用してください。

また、以下の機密情報は利用者自身の管理下に置き、GitHub 等へ公開しないでください。

* ログイン情報
* セッション
* 暗号鍵
* トーク履歴
* Token
* その他の個人情報

解析ツールを含む詳細な免責事項については、各ドキュメントおよびライセンスを参照してください。

---

## License

MIT — [LICENSE](LICENSE)

Copyright © [nezumi0627](https://github.com/nezumi0627)

---

<div align="center">

**Vision Beyond Limits.**

Made with care by the Vyline contributors.

</div>
