<h1 align="center">Vyline <sup>Beta</sup></h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  自前プロトコルで動く、LINE サードパーティクライアント（Web / React）
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.5.1--beta-a78bfa?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" />
  <img alt="stack" src="https://img.shields.io/badge/stack-Hono%20%2B%20React-0ea5e9?style=flat-square" />
  <img alt="state" src="https://img.shields.io/badge/state-beta-a78bfa?style=flat-square" />
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-22c55e?style=flat-square" />
</p>

<p align="center">
  このさんさんとした太陽の下、Vyline を選んでくださるユーザーに出会えたことに感謝します。
</p>

> **2026/08/20 beta 版 release 開始** — 本リポジトリは Vyline Beta 0.5.0 として公開されました。機能の安定性は保証されておらず、予期しない動作やアカウントリスクが含まれる可能性があります。

---

## ⚠️ ご利用前に必ずお読みください

Vyline は LINE 非公式のサードパーティクライアントであり、LINE 株式会社・LY Corporation とは**無関係・未承認**です。

- **アカウントリスク**: LINE 利用規約に違反する可能性があり、アカウント停止等のリスクを伴います。**利用はすべて自己責任**です。
- **同意ゲート**: ログイン直後に利用規約・免責事項を表示し、**同意しない限りアプリは一切動作しません**（同期・通信・表示を含む）。同意せず、または画面をスキップする等の手段で利用した場合も、**その時点で本規約に同意したものとみなされ**、開発者・Vyline のメンバーは一切の責任を負いません。
- **目的の範囲**: 教育・学習・個人利用の範囲でご利用ください。第三者への攻撃・不正アクセス・迷惑行為・権利侵害は禁止です。
- **データの扱い**: ログイン情報・セッション・暗号鍵・トーク履歴は端末内にのみ保存され、外部へ送信されません。
- **解析ツール**: `tools/` 以下の解析ツールは [vyline-search](https://github.com/nezumi0627/vyline-search) リポジトリを Git Submodule としてリンクしたものです。Desktop LINE の unpack・逆コンパイルを行います。**教育・実験目的のみ**で使用し、解析結果を再配布しないでください。詳細: [docs/tools/DISCLAIMER.md](docs/tools/DISCLAIMER.md)
- **開発者の免責**: 本ソフトウェアの利用により生じた一切の問題（アカウント停止、データ破損、法的問題等）について、開発者・Vyline のメンバーは責任を負いません。

### 著作権表示

本ソフトウェアは [nezumi0627](https://github.com/nezumi0627) によって開発されています。改変・再配布・解説記事等では、必ず著作権表示（`nezumi0627`）を保持してください。ライセンス詳細は [LICENSE](LICENSE)（MIT）を参照してください。

---

## Vyline とは

**Vyline** は LINE にログインしてメッセージの送受信・Flex/Rich 表示・テーマカスタマイズを行うサードパーティクライアントです。外部サービスに依存せず、**自前のプロトコルスタック `@vyline/protocol`** で動作します。

| 項目       | 内容                                     |
| ---------- | ---------------------------------------- |
| 誰向け     | UI を自分好みにしたい人・開発者          |
| なにが違う | テーマ管理 / メンション / ローカル最適化 |
| ライセンス | MIT                                      |
| 状態       | Beta 0.5.0                               |

### 主な機能

| カテゴリ         | 内容                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| **ログイン**     | QR / Email ログイン、マルチアカウント、セッション復元                                                                 |
| **メッセージ**   | 送受信 / 返信 / 取り消し / 既読制御 / 再送                                                                            |
| **メンション**   | `@ALL` / `@名前`（LINE Desktop 準拠の `MENTION` metadata）                                                            |
| **メディア**     | 画像・動画・音声（画像は自動圧縮、設定で高画質送信も可） / LINE 絵文字(sticon) / スタンプ全種                         |
| **Flex / Rich**  | 公式準拠の描画、カルーセルのマウスドラッグ                                                                            |
| **リアクション** | 1クリック、公式バッジ、既読者一覧                                                                                     |
| **通話**         | 音声 / ビデオ通話（実験的）                                                                                           |
| **チャット管理** | ピン / 非表示 / ミュート / ブロック / MID コピー / グループ作成・招待                                                 |
| **VyTheme**      | フルカスタマイズテーマ、文字サイズ、密度、プロフィール背景                                                            |
| **E2EE**         | Letter Sealing の復号・送信、Desktop 鍵 import                                                                        |
| **プライバシー** | ストリーマーモード、PIN ロック                                                                                        |
| **VylineBackup** | トーク履歴・メディアのスナップショット作成 / 復元 / 削除                                                              |
| **その他**       | チャット詳細ログ(JSONL) / Keepメモ / 相手プロフィール背景表示 / 通話中バッジ / 共通グループ高速表示 / トーク保存(TXT) |

---

## ⚠️ 破壊的変更 (v0.5.0)

v0.5.0 は v0.4.x と**互換性がありません**。以下の変更により、既存の設定・キャッシュの一部リセットが必要な場合があります。

| 変更                                                   | 影響                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| 受信エンジンを Push 長ポール → fetchOps 方式に刷新     | イベントポーリングの挙動が変わります                                        |
| 公開 API (`/v1/`) を新設                               | 環境変数 `VYLINE_API_ADMIN_SECRET` を設定するとトークン管理が可能になります |
| イベント種別の拡張（通話・メンバー変更・アナウンス等） | フロントエンドの旧バージョンとは互換しません                                |

**アップグレード手順**: `git pull && bun install && bun run dev` のみで動作します。既存のログイン状態は維持されます。

---

## Quick Start

```bash
bun install
bun run dev          # backend :3001 + frontend :5173
```

ブラウザで `http://localhost:5173` を開きます。

| コマンド               | 内容                           |
| ---------------------- | ------------------------------ |
| `bun run dev:backend`  | backend のみ（:3001）          |
| `bun run dev:frontend` | frontend のみ（:5173）         |
| `bun run typecheck`    | 型チェック（全ワークスペース） |
| `bun run lint`         | Biome lint                     |
| `bun run build`        | frontend 本番ビルド            |

詳細: [docs/onboarding.md](docs/onboarding.md) · [docs/development.md](docs/development.md) · [AGENTS.md](AGENTS.md)

### セルフホスト（Docker）

自宅サーバーに立てて、複数端末の Web ブラウザから同じ LINE セッションを利用できます（履歴・画像はサーバー側に永続化）。

```bash
docker compose up -d --build   # http://localhost:3001
```

設定・Cloudflare Access での外部公開手順: [docs/selfhosting.md](docs/selfhosting.md)

### 推奨環境

| 項目               | 推奨値         | 備考                                               |
| ------------------ | -------------- | -------------------------------------------------- |
| **LINE アプリ**    | IOSIPAD 26.7.2 | `x-line-application` ヘッダー値。最新版を推奨      |
| **OS**             | iOS 18.0       | Android / Windows 互換は未検証                     |
| **デバイスモード** | IOSIPAD        | `VYLINE_DEVICE` 環境変数で指定（省略時は IOSIPAD） |

> 定義元: `packages/protocol/src/desktop/types.ts` の DesktopProfile。実際のヘッダー値は `"x-line-application": "IOSIPAD\t26.7.2\tiOS\t18.0"` のように伝搬されます。

---

## Architecture

```
┌─ Frontend (React + Vite) ── apps/desktop ──┐
│  store / mappers / sync / VyTheme UI       │
├─ Backend (Hono on Bun) ───── backend ──────┤
│  BFF routes → lineService → clientManager  │
├─ Vyline ──────────── packages/protocol ────┤
│  domain / dictionary / E2EE / Thrift stack │
└─ LINE Servers ──────────────────────────────┘
```

| パス                  | 役割                     |
| --------------------- | ------------------------ |
| `apps/desktop`        | React UI                 |
| `backend`             | Hono BFF                 |
| `packages/protocol`   | プロトコル本体（Vyline） |
| `packages/line-types` | Thrift 型（vendored）    |

### E2EE / Desktop 鍵

過去メッセージの復号には、公式 LINE Desktop から抽出した自己鍵一式が必要です。

1. LINE.exe 起動状態で鍵を抽出（[docs/analysis/](docs/analysis/)）
2. `backend/data/desktop-e2ee-keys.json` に配置（**gitignore・コミット禁止**）
3. backend 起動時に自動 import

### 公開 API (`/v1/`)

セルフホスト時に Bearer トークンで Vyline を外部から操作できます。

```bash
# トークン作成（VYLINE_API_ADMIN_SECRET を設定後）
curl -X POST http://localhost:3001/v1/tokens \
  -H "Authorization: Bearer $VYLINE_API_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-bot"}'

# チャット一覧取得
curl http://localhost:3001/v1/accounts/{accountId}/chats \
  -H "Authorization: Bearer vyl_xxxx..."
```

API 仕様（OpenAPI 3.1）: `GET /openapi.json` または [zensical.org](https://zensical.org)

### 解析ツールキット（vyline-search）

Desktop LINE（Themida 保護）の unpack / ネイティブシンボル検索 / 逆コンパイルを行う独立ツールキットです。教育・研究目的で `findNativeSymbol` による文字列 xref 解析と Ghidra decompile をワンコマンドで実行できます。

> [!WARNING]
> **注意**: LINE デスクトップクライアントが起動中の状態では、解析ツール（unpack 等）が正常に動作しません（単一インスタンス制御により frida の注入が拒否されプロセスが強制終了するため）。必ず LINE アプリを完全に終了させてから実行してください。

**[github.com/nezumi0627/vyline-search](https://github.com/nezumi0627/vyline-search)**

```powershell
bun run vyline:check                  # インストール版 / 最新版の比較
bun run vyline:versions               # インストール済みバージョン一覧
bun run vyline:unpack -- --version <ver>   # インストール済みバージョンを選択して unpack
bun run vyline:update                 # LINE Desktop を最新版へ更新
bun run vyline:find-native -- sendMessage  # ネイティブシンボル検索
```

> **注意**: `vyline:unpack` / `vyline:update` は **LINE を終了してから実行**してください。
> 稼働中は Frida 注入が拒否され `ProcessNotRespondingError` になります。

---

## ドキュメント

| リンク                                                     | 内容                                   |
| ---------------------------------------------------------- | -------------------------------------- |
| [docs/README.md](docs/README.md)                           | ドキュメント索引                       |
| [docs/onboarding.md](docs/onboarding.md)                   | 初日チェックリスト                     |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)               | 貢献フロー                             |
| [docs/architecture.md](docs/architecture.md)               | 層構造                                 |
| [docs/development.md](docs/development.md)                 | 開発コマンド                           |
| [docs/selfhosting.md](docs/selfhosting.md)                 | Docker セルフホスト・Cloudflare Access |
| [docs/protocol/dictionary.md](docs/protocol/dictionary.md) | RPC 辞書                               |
| [AGENTS.md](AGENTS.md)                                     | エージェント向けガイド                 |
| [CHANGELOG.md](CHANGELOG.md)                               | 変更履歴                               |
| [zensical.org](https://zensical.org)                       | 公開ドキュメント・API リファレンス     |
| [/openapi.json](/openapi.json)                             | OpenAPI 3.1 仕様（ローカル）           |

公開ドキュメント・チュートリアル: **[zensical.org](https://zensical.org)**

---

## 貢献 / 募集

- 🐛 [Bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- ✨ [Feature request](.github/ISSUE_TEMPLATE/feature_request.md)
- 📝 [Pull request](.github/pull_request_template.md)

貢献フローは [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) を参照してください。PR には解析対象ソフトウェアの実体・鍵・トークンなどを含めないでください。

現在、以下を募集しています:

- **PR**: バグ修正、機能改善、ドキュメントの更新
- **アイコン**: アプリアイコン・テーマアイコンのデザイン
- **バナー**: SNS・ブログでのプロモーション用バナー
- **定期的なメンテナー**: 個人開発のため、継続的に助けていただける方を募集中

興味がある方は [AGENTS.md](AGENTS.md) の手順に従ってプルリクエストをお送りください。

---

## Vyline Desktop

> **Coming Soon** 🚀

Vyline が安定版に到達した後、専用のデスクトップアプリ **Vyline Desktop** をリリース予定です。

- 🖥️ Windows / macOS / Linux ネイティブアプリ
- 🔔 プッシュ通知
- 🗂️ トレイアイコン常駐
- 🔒 ローカルデータ完全管理

Vyline の安定版リリースをお待ちください。

---

## ロードマップ

Vyline は API ファーストな拡張可能アーキテクチャを目指します（詳細は [AGENTS.md](AGENTS.md)）。

- **API / Swagger**: `GET /docs`・`/swagger`・`/openapi.json` で API 仕様を公開（[docs/api](docs/api/openapi.md)）
- **プラグインシステム**: JavaScript / TypeScript 補完・権限スコープ付き（計画中）
- **カスタムクライアント**: バックエンド API を使った独自クライアント開発を想定
- **マルチアカウント**: アカウント単位のデータ分離
- **複数画像一括送信**: 個別 IMAGE メッセージ + グルーピング表示（実装済み）
- **Docker / サーバーモード**: `bun run server`・Docker Compose 配布
- **軽量性**: メモリ・CPU・通信量は公式クライアント以下を目標に、計測ベースで改善

---

## エージェント / Skill 方針

開発には coding-agent 用 skill セット（Ponytail / Caveman / agent-skills-standard /
addyosmani agent-skills / Minimize-Cursor-Cost）を利用する場合があります。
不要なコード・過剰設計を避け、レビュー品質を上げるためです。

ただし セキュリティ > プライバシー > データ保護 > 既存機能互換 > トークン削減 の順で、
正確性と安全性が常に優先されます。詳細は [AGENTS.md](AGENTS.md) を参照してください。

---

## Support Vyline

Vyline は個人開発の独立プロジェクトです。小さな支援が開発・テスト・ドキュメント整備に役立ちます。

| 金額 | Tier | 内容 |
| ---: | --- | --- |
| ~500円 | 応援 | 開発・保守費に |
| 500円~ | サポーター | 希望者はサポート一覧に掲載 |
| 1,000円~ | スペシャルサポーター | docs / リリースノートに感謝掲載（希望者） |
| 3,000円~ | メジャーサポーター | メジャーサポーターとして掲載（希望者） |

※ 支援は機能実装・バグ修正・個別対応等を保証するものではありません。
掲載は許可いただいた場合のみ。支払い方法の詳細は今後このセクションに追記します。

---

## License

MIT — see [LICENSE](LICENSE)

**著作権**: [`nezumi0627`](https://github.com/nezumi0627)
改変・再配布・記事・投稿等では出典表示をお願いします（詳細は [LICENSE](LICENSE) の Attribution requirement を参照）。
