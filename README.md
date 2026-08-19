<h1 align="center">Vyline <sup>Beta</sup></h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  自前プロトコルで動く、LINE サードパーティクライアント（Web / React）
</p>

<p align="center"> このさんさんとした太陽の下、Vylineを選んでくださるユーザーに出会えたことに感謝します。 </p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.4.0--beta-a78bfa?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" />
  <img alt="stack" src="https://img.shields.io/badge/stack-Hono%20%2B%20React-0ea5e9?style=flat-square" />
  <img alt="state" src="https://img.shields.io/badge/state-beta-a78bfa?style=flat-square" />
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-22c55e?style=flat-square" />
</p>

> ⚠️ **現在Beta 版です。** LINE 非公式のサードパーティクライアントです

> アカウント停止のリスクがあるため、それを理解したうえで利用はすべて自己責任で。

> **2026/08/20 beta版 release 開始** — 本リポジトリは Vyline Beta 0.4.0 として公開されました。機能の安定性は保証されておらず、予期しない動作やアカウントリスクが含まれる可能性があります。

---

## 免責事項

- **非公式クライアント**: 本ソフトウェアは LINE 株式会社・LY Corporation とは**無関係・未承認**です。公式アプリとの互換性・動作を保証するものではありません。
- **アカウントリスク**: LINE の利用規約に違反する可能性があり、利用によりアカウント停止等のリスクがあります。**すべて自己責任**で利用してください。
- **教育・研究目的**: ソースコードの解析・改変・再配布は**教育・学習・研究目的**に限り許可されます。商用利用・第三者への攻撃・不正アクセス等の用途には使用しないでください。
- **解析ツール (vyline-search)**: Desktop LINE の unpack・デコンパイルを行うツールは `tools/` に同梱されています。**教育・実験目的のみ**で使用し、解析結果の再配布はしないでください。詳細: [docs/tools/DISCLAIMER.md](docs/tools/DISCLAIMER.md)
- **開発者の責任**: 本ソフトウェアの利用により生じた一切の問題（アカウント停止、データ破損、法的問題等）について、開発者・Vylineのメンバーは**一切の責任を負いません**。

## 著作権表示 / 出典表示

本ソフトウェアは [nezumi0627](https://github.com/nezumi0627) の手によって開発されています。

- **改変・再配布時**: 元の著作樍表示（`nezumi0627`）を必ず保持してください。文章・ブログ・SNS等で取り上げる場合も出典を明記してください（リンクは推奨・必須ではありません）。
- **ライセンス**: MIT License — 詳細は [LICENSE](LICENSE) を参照してください。

---

## What is Vyline?

**Vyline** は LINE にログインしてメッセージの送受信・Flex/Rich 表示・テーマカスタマイズを行うサードパーティクライアントです。

外部に依存せず、**自前のプロトコルスタック `@vyline/protocol`（Vyline）** で動作します。

|                |                                          |
| -------------- | ---------------------------------------- |
| **誰向け**     | UI を自分好みにしたい人・開発者          |
| **なにが違う** | テーマ管理 / メンション / ローカル最適化 |
| **ライセンス** | MIT                                      |
| **状態**       | Beta（開発中）                           |

---

## Key Features

- **ログイン** — QR / Email ログイン、マルチアカウント、セッション復元
- **メッセージ** — 送受信 / 返信 / 取り消し / 既読制御 / 再送
- **メンション** — `@ALL` / `@名前`（LINE Desktop 準拠の `MENTION` metadata）
- **LINE 絵文字（sticon）** — 文中挿入・送受信描画
- **メディア** — 画像・動画・音声送受信（画像はクライアント側で自動圧縮。「高画質で画像送信」で圧縮なしに変更可）
- **スタンプ** — 所持パック / プレミアム / アニメーション / くっつき
- **Flex / Rich** — 公式準拠の描画、カルーセルのマウスドラッグ
- **リアクション** — 1 クリック、公式バッジ、既読者一覧
- **通話** — 音声 / ビデオ通話（実験的）
- **チャット管理** — ピン / 非表示 / ミュート / ブロック / MID コピー / グループ作成・招待
- **VyTheme** — フルカスタマイズテーマ、文字サイズ、密度、プロフィール背景
- **E2EE（Letter Sealing）** — 暗号化メッセージの復号・送信、Desktop 鍵 import
- **プライバシー** — ストリーマーモード、PIN ロック
- **VylineBackup** — トーク履歴・メディアのスナップショット作成 / 復元 / 削除（設定 > VylineBackup）
- **チャット詳細ログ** — 送受信・アナウンスの JSONL 記録（設定 > 詳細・復元 > デバッグログ）
- **Keepメモ** — 自分自身のトーク（公式アイコンで表示、プロフィールは自動スキップ）
- **プロフィール背景** — 相手のプロフィール背景画像をトーク背景に表示（設定 > 表示）
- **通話状態** — グループの「通話中」バッジを 15 秒ポーリングで表示
- **共通グループ** — プロフィールから共通グループを高速表示（VylineCache 一括読み・RPC なし）
- **送信取り消し** — 可能時間超過（MESSAGE_NOT_DESTRUCTIBLE）は専用メッセージで通知
- **その他** — トーク保存（TXT エクスポート）/ 設定の初期化 / 更新チェック

---

## Version

バージョンは `store.ts` / `package.json` / `README.md` の 3 箇所を同一に揃えます。リリース時は `docs/distribution.md` のチェックリストを参照。beta は非公開テスト段階です。

---

## 推奨環境

Vyline は LINE のプロトコル実装に依存するため、以下の環境で正常に動作することを確認しています。

| 項目 | 推奨値 | 備考 |
| ---- | ------ | ---- |
| **LINE アプリ** | IOSIPAD 26.7.2 | `x-line-application` ヘッダー値。最新版を推奨 |
| **OS** | iOS 18.0 | Android / Windows 互換は未検証 |
| **デバイスモード** | IOSIPAD | `VYLINE_DEVICE` 環境変数で指定（省略時は IOSIPAD） |

> **参照元**: `packages/protocol/src/desktop/types.ts` で定義された DesktopProfile による。
> 実際のヘッダー値は `[backend] "x-line-application": "IOSIPAD\t26.7.2\tiOS\t18.0"` のように伝搬される。

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

### zensical.org

Vyline のドキュメントとチュートリアルを公開しています（今後順次充実予定）。
https://zensical.org

### セルフホスト（Docker）

自宅サーバーに立てて、複数端末の Web ブラウザから同じ LINE セッションを利用できます（履歴・画像はサーバー側に永続化）。

```bash
docker compose up -d --build   # http://localhost:3001
```

設定・Cloudflare Access での外部公開手順: [docs/selfhosting.md](docs/selfhosting.md)

---

## Architecture

```
┌─ Frontend (React + Vite) ── apps/desktop ──┐
│  store / mappers / sync / VyTheme UI     │
├─ Backend (Hono on Bun) ───── backend ─────┤
│  BFF routes → lineService → clientManager  │
├─ Vyline ──────────── packages/protocol ──┤
│  domain / dictionary / E2EE / Thrift stack │
└─ LINE Servers ────────────────────────────┘
```

| パス                         | 役割                     |
| ---------------------------- | ------------------------ |
| `Vyline/apps/desktop`        | React UI                 |
| `Vyline/backend`             | Hono BFF                 |
| `Vyline/packages/protocol`   | プロトコル本体（Vyline） |
| `Vyline/packages/line-types` | Thrift 型（vendored）    |

---

## 🔎 vyline-search（解析ツールキット）

Vyline の LINE 逆解析基盤は独立リポジトリとして公開しています:

**[github.com/nezumi0627/vyline-search](https://github.com/nezumi0627/vyline-search)**

Desktop LINE（Themida 保護）の **unpack / ネイティブシンボル検索 / 逆コンパイル** を行うツールキットです。教育・研究目的で、`findNativeSymbol` による文字列 xref 解析と Ghidra decompile をワンコマンドで実行できます。

---

## E2EE / Desktop 鍵

過去メッセージの復号には、公式 LINE Desktop から抽出した**自己鍵一式**が必要です。

1. LINE.exe 起動状態で鍵を抽出（[docs/analysis/](docs/analysis/)）
2. `Vyline/backend/data/desktop-e2ee-keys.json` に配置（**gitignore・コミット禁止**）
3. backend 起動時に自動 import

---

## Contributing

Issue / PR テンプレートは `.github/` に用意しています。

- 🐛 [Bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- ✨ [Feature request](.github/ISSUE_TEMPLATE/feature_request.md)
- 📝 [Pull request](.github/pull_request_template.md)

貢献フロー: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)

**注意:** このプロジェクトは LINE の規約・利用条件に抵触する可能性があります。PR には解析対象ソフトウェアの実体・鍵・トークンなどを含めないでください。

---

## Docs

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

---

## Recruitment

Vylineのbeta版リリースにあたり、以下を募集しています：

- **PR (Pull Request)**: バグ修正、機能改善、ドキュメントの更新など
- **アイコン**: アプリアイコンやテーマアイコンのデザイン
- **バナー**: SNSやブログでの Vyline プロモーション用バナー

興味がある方は [AGENTS.md](AGENTS.md) の手順に従ってプルリクエストをお送りください。

---

## Legal / Disclaimer

## Legal / Disclaimer

詳細: README 上部の **「免責事項」** および **「著作権表示 / 出典表示」** を参照してください。
以下は補足事項です。

- 各ユーザーが**自分自身の LINE アカウント**にログインして利用する前提です。自分のアカウントへのアクセスは不正アクセス罪に抵触しにくく、著作権法上の問題も生じにくい設計としています（利用者自身の見解・非専門家の判断による）
- **利用規約・免責の同意ゲート**: ログイン直後に利用規約・免責事項を表示し、**同意しない限りアプリは一切動作しません**（同期・通信・表示を含む）。同意せずに本ソフトウェアを利用した場合、および想定しない手段（画面スキップ・設定改変・その他いかなる手法）で本画面を経ずに利用した場合も、**利用した時点で本規約に同意したものとみなし、開発者・Vylineのメンバーは一切の責任を負いません**
- 教育・学習・個人利用の範囲でご利用ください
- 第三者への迷惑行為・不正利用・権利侵害は禁止です
- ログイン情報・セッション・暗号鍵・トーク履歴は端末内にのみ保存され、外部へ送信されません
- 外部サービス仕様変更により動作不能になる可能性があります

---

## License

MIT — see [LICENSE](LICENSE)

**著作権**: `nezumi0627` (https://github.com/nezumi0627)  
改変・再配布・記事・投稿等で出典表示をお願いします（詳細は [LICENSE](LICENSE) の「Attribution requirement」および README 上部「著作権表示 / 出典表示」参照）
