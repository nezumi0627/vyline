<!--@languages=ja,en-->
<!--@default=ja-->
[English](README.en.md)<!--ja-->
[日本語](README.md)<!--en-->

<h1 align="center">Vyline <sup>Beta</sup></h1><!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <strong>Vision Beyond Limits.</strong><br/><!--ja-->
  `vyl` から始める、拡張可能な LINE サードパーティクライアント<!--ja-->
</p><!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <img alt="version" src="https://img.shields.io/badge/version-0.8.0--beta-a78bfa?style=flat-square" /><!--ja-->
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" /><!--ja-->
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" /><!--ja-->
  <img alt="cli" src="https://img.shields.io/badge/cli-vyl-22c55e?style=flat-square" /><!--ja-->
  <img alt="backend" src="https://img.shields.io/badge/backend-Hono-e879f9?style=flat-square" /><!--ja-->
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-38bdf8?style=flat-square" /><!--ja-->
</p><!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <a href="#最短スタート">最短スタート</a> ・<!--ja-->
  <a href="#vyl-cli">vyl CLI</a> ・<!--ja-->
  <a href="#snapshot">Snapshot</a> ・<!--ja-->
  <a href="#開発">開発</a> ・<!--ja-->
  <a href="#ドキュメント">ドキュメント</a><!--ja-->
</p><!--ja-->
<!--ja-->
> [!CAUTION]<!--ja-->
> Vyline は **LINE 非公式・未承認**のサードパーティクライアントです。LINE 株式会社および LY Corporation とは関係ありません。利用規約への抵触やアカウント停止を含むリスクを理解したうえで、自己責任で使用してください。<!--ja-->
<!--ja-->
> [!NOTE]<!--ja-->
> 現在のバージョンは **Beta 0.8.0** です。Beta 版のため、仕様変更・不具合・データ損失が発生する可能性があります。重要なデータは `vyl snapshot` で定期的に保護してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## Vyline とは<!--ja-->
<!--ja-->
**Vyline** は、メッセージ送受信、Flex / Rich 表示、テーマ、公開 API、プラグイン、Snapshot を備えた Web / React ベースの LINE クライアントです。<!--ja-->
<!--ja-->
外部の中継サービスに依存せず、独自実装の **`@vyline/protocol`** を介して LINE サーバーと通信します。UI、バックエンド、プロトコル、CLI を分離しているため、セルフホスト、開発、プラグイン拡張、データ移行を段階的に扱えます。<!--ja-->
<!--ja-->
| 項目 | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| 入口 | `vyl` CLI / `bunx vyl` / `bun run vyl` |<!--ja-->
| 対象 | UI を自分好みに調整したいユーザー、開発者、セルフホスト利用者 |<!--ja-->
| 技術 | React + Vite / Hono on Bun / TypeScript / Thrift |<!--ja-->
| 状態 | Beta 0.8.0 |<!--ja-->
| ライセンス | MIT |<!--ja-->
<!--ja-->
## 最短スタート<!--ja-->
<!--ja-->
これから使う人は、手動で GitHub を丸ごと clone する前に **`vyl` の対話式セットアップ**を使う方針です。<!--ja-->
<!--ja-->
```bash<!--ja-->
bunx vyl init<!--ja-->
```<!--ja-->
<!--ja-->
まだ npm 公開前、またはリポジトリ内で作業する場合は次を使います。<!--ja-->
<!--ja-->
```bash<!--ja-->
bun install<!--ja-->
bun run vyl init<!--ja-->
```<!--ja-->
<!--ja-->
`vyl init` は、起動、診断、修復、プラグイン作成、Snapshot 作成、archive-first install を対話式に選べます。<!--ja-->
<!--ja-->
### インストール方法の選び方<!--ja-->
<!--ja-->
| 用途 | 推奨 | コマンド |<!--ja-->
| --- | --- | --- |<!--ja-->
| 初回利用・軽く試す | archive-first install | `bunx vyl install` |<!--ja-->
| 既存 checkout の修復 | doctor / fix | `bun run vyl:doctor` → `bun run vyl:fix` |<!--ja-->
| 開発 | shallow clone または通常 clone | `vyl install` の Developer mode、または `git clone --recurse-submodules` |<!--ja-->
| セルフホスト | Docker | `docker compose up -d --build` |<!--ja-->
| データ保護 | Snapshot | `bun run vyl snapshot create manual` |<!--ja-->
<!--ja-->
### 既存リポジトリでの開発起動<!--ja-->
<!--ja-->
```bash<!--ja-->
bun install<!--ja-->
bun run vyl:doctor<!--ja-->
bun run vyl:fix<!--ja-->
bun run vyl dev<!--ja-->
```<!--ja-->
<!--ja-->
従来のコマンドも残しています。必要に応じて `bun run dev`、`bun run typecheck`、`bun run lint`、`bun run build` を直接実行できます。<!--ja-->
<!--ja-->
## vyl CLI<!--ja-->
<!--ja-->
`vyl` は Vyline の入口です。インストール、診断、修復、起動、Snapshot、プラグイン雛形作成をまとめます。<!--ja-->
<!--ja-->
| コマンド | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| `vyl init` | 対話式セットアップ |<!--ja-->
| `vyl install` | archive-first / shallow clone を選べる導入 |<!--ja-->
| `vyl doctor` | Bun、Git、submodule、`.env`、data/storage を診断 |<!--ja-->
| `vyl fix` | `.env` 作成、data/storage 作成、submodule 更新、`bun install` |<!--ja-->
| `vyl dev` | バックエンドとフロントエンドを起動 |<!--ja-->
| `vyl start` | バックエンドサーバーを起動 |<!--ja-->
| `vyl plugin create <name>` | プラグイン雛形を作成 |<!--ja-->
| `vyl snapshot create/list/restore/schedule` | Snapshot の作成、一覧、復元、定期化 |<!--ja-->
<!--ja-->
リポジトリ内では `bun run vyl ...` または短縮 script を使えます。<!--ja-->
<!--ja-->
```bash<!--ja-->
bun run vyl init<!--ja-->
bun run vyl:doctor<!--ja-->
bun run vyl:fix<!--ja-->
bun run vyl:snapshot -- create manual<!--ja-->
```<!--ja-->
<!--ja-->
詳細は [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) を参照してください。<!--ja-->
<!--ja-->
## Snapshot<!--ja-->
<!--ja-->
Vyline では「バックアップ / リストア」を **Snapshot** と呼びます。`data/` にはセッション、鍵、設定、履歴などの重要情報が含まれるため、更新前や設定変更前に Snapshot を作成してください。<!--ja-->
<!--ja-->
```bash<!--ja-->
bun run vyl snapshot create before-update<!--ja-->
bun run vyl snapshot list<!--ja-->
bun run vyl snapshot restore snapshots/xxx.tar.gz --force<!--ja-->
bun run vyl snapshot schedule daily<!--ja-->
```<!--ja-->
<!--ja-->
Windows では `snapshot schedule` が `VylineSnapshot` タスクの登録を試みます。Windows 以外ではスケジュール設定ファイルを書き出し、cron / systemd timer に登録できるコマンドを表示します。<!--ja-->
<!--ja-->
## 主な機能<!--ja-->
<!--ja-->
| カテゴリ | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| ログイン | QR / Email ログイン、マルチアカウント、セッション復元 |<!--ja-->
| メッセージ | 送受信、返信、送信取り消し、既読制御、再送 |<!--ja-->
| メディア | 画像、動画、音声、LINE 絵文字、スタンプ |<!--ja-->
| Flex / Rich | 公式形式に準拠した描画、カルーセル操作 |<!--ja-->
| VyTheme | テーマ、文字サイズ、表示密度、プロフィール背景のカスタマイズ |<!--ja-->
| E2EE | Letter Sealing の復号・送信、LINE Desktop の鍵のインポート |<!--ja-->
| Snapshot | `data/` の作成、一覧、復元、定期作成 |<!--ja-->
| プラグイン | `vyl plugin create` による TypeScript 雛形生成 |<!--ja-->
| 開発者向け | Bearer トークン対応の公開 API、OpenAPI 3.1、JSONL 詳細ログ |<!--ja-->
<!--ja-->
## Docker / セルフホスト<!--ja-->
<!--ja-->
```bash<!--ja-->
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git<!--ja-->
cd Vyline<!--ja-->
docker compose up -d --build<!--ja-->
```<!--ja-->
<!--ja-->
起動後は `http://localhost:3000` へアクセスします。Docker 版はフロントエンドとバックエンドを同一オリジンで配信します。`./data/` はセッションや鍵を含むため削除しないでください。<!--ja-->
<!--ja-->
遠隔アクセスは Tailscale 推奨です。PC とスマホを同じ Tailscale アカウントに入れ、`http://100.x.y.z:3000` でアクセスします。<!--ja-->
<!--ja-->
## 公開 API<!--ja-->
<!--ja-->
セルフホストした Vyline は Bearer トークンを使って外部ツールや独自クライアントから操作できます。API は `/v1/` 配下で提供されます。<!--ja-->
<!--ja-->
| エンドポイント | 用途 |<!--ja-->
| --- | --- |<!--ja-->
| `/v1/*` | トークン認証された Vyline API |<!--ja-->
| `/openapi.json` | OpenAPI 3.1 の機械可読仕様 |<!--ja-->
| `/docs` | API ドキュメント UI |<!--ja-->
| `/swagger` | Swagger UI |<!--ja-->
<!--ja-->
```bash<!--ja-->
curl http://localhost:3001/v1/accounts/{accountId}/chats \\
  -H "Authorization: Bearer vyl_xxxx..."<!--ja-->
```<!--ja-->
<!--ja-->
> [!WARNING]<!--ja-->
> `VYLINE_API_ADMIN_SECRET`、発行済みトークン、セッション、暗号鍵をリポジトリやログへ含めないでください。<!--ja-->
<!--ja-->
## 開発<!--ja-->
<!--ja-->
開発者は `vyl` で整えてから通常の Bun workspace コマンドを使います。<!--ja-->
<!--ja-->
```bash<!--ja-->
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git<!--ja-->
cd Vyline<!--ja-->
bun install<!--ja-->
bun run vyl:doctor<!--ja-->
bun run vyl dev<!--ja-->
```<!--ja-->
<!--ja-->
| コマンド | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| `bun run vyl:doctor` | 開発環境を診断 |<!--ja-->
| `bun run vyl:fix` | よくあるセットアップ不備を修復 |<!--ja-->
| `bun run typecheck` | 全ワークスペースの型チェック |<!--ja-->
| `bun run lint` | Biome による lint |<!--ja-->
| `bun run build` | フロントエンドの本番ビルド |<!--ja-->
| `bun run docs:readme` | README を `README.src.md` から再生成 |<!--ja-->
<!--ja-->
プラグイン雛形は次で作成します。<!--ja-->
<!--ja-->
```bash<!--ja-->
bun run vyl plugin create my-plugin<!--ja-->
```<!--ja-->
<!--ja-->
## ドキュメント<!--ja-->
<!--ja-->
| ドキュメント | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) | `vyl` CLI、install、doctor、fix、Snapshot、plugin scaffold |<!--ja-->
| [Vyline/docs/guides/ios-backup-restore.md](Vyline/docs/guides/ios-backup-restore.md) | iOS バックアップからの取り込み手順 |<!--ja-->
| [AGENTS.md](AGENTS.md) | コーディングエージェント向けガイド |<!--ja-->
| [CHANGELOG.md](CHANGELOG.md) | 変更履歴 |<!--ja-->
<!--ja-->
## ロードマップ<!--ja-->
<!--ja-->
- `vyl` の npm / bunx 配布を安定化<!--ja-->
- Snapshot の保持世代、暗号化、検証機能<!--ja-->
- プラグイン権限スコープと Marketplace registry<!--ja-->
- テーマ SDK と `vyl theme create`<!--ja-->
- Docker / セルフホスト運用の軽量化<!--ja-->
- Control Center は本 PR では対象外<!--ja-->
<!--ja-->
## ライセンス<!--ja-->
<!--ja-->
Vyline は [MIT License](LICENSE) のもとで公開されています。<!--ja-->
<!--ja-->
Copyright © [nezumi0627](https://github.com/nezumi0627)<!--ja-->
<!--ja-->
[日本語](README.md)<!--en-->

<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. --><!--en-->
<!-- Language: en --><!--en-->
<!--en-->
[日本語](README.md)<!--en-->
<!--en-->
# Vyline<!--en-->
<!--en-->
<p align="center"><!--en-->
  <strong>Vision Beyond Limits.</strong><br/><!--en-->
  An extensible LINE third-party client that starts from `vyl`<!--en-->
</p><!--en-->
<!--en-->
> [!CAUTION]<!--en-->
> Vyline is an unofficial and unauthorised LINE third-party client. It is not affiliated with LINE Corporation or LY Corporation. Use it at your own risk after understanding the risks, including possible terms-of-service violations and account suspension.<!--en-->
<!--en-->
> [!NOTE]<!--en-->
> Vyline is currently Beta 0.8.0. Beta software may introduce breaking changes, bugs, or data loss. Protect important data with `vyl snapshot`.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## What is Vyline?<!--en-->
<!--en-->
**Vyline** is a Web/React-based LINE client with messaging, Flex/Rich rendering, themes, a public API, plugins, and Snapshot-based data protection.<!--en-->
<!--en-->
It communicates with LINE servers through the independently implemented **`@vyline/protocol`** package without relying on an external relay service. The UI, backend, protocol, and CLI are separated so installation, self-hosting, development, plugin work, and data migration can be handled step by step.<!--en-->
<!--en-->
| Item | Details |<!--en-->
| --- | --- |<!--en-->
| Entry point | `vyl` CLI / `bunx vyl` / `bun run vyl` |<!--en-->
| Audience | Custom UI users, developers, and self-hosters |<!--en-->
| Technology | React + Vite / Hono on Bun / TypeScript / Thrift |<!--en-->
| Status | Beta 0.8.0 |<!--en-->
| License | MIT |<!--en-->
<!--en-->
## Quick start<!--en-->
<!--en-->
New users should start with the interactive `vyl` flow instead of manually cloning the full repository first.<!--en-->
<!--en-->
```bash<!--en-->
bunx vyl init<!--en-->
```<!--en-->
<!--en-->
Before npm publishing, or when working inside this repository, use:<!--en-->
<!--en-->
```bash<!--en-->
bun install<!--en-->
bun run vyl init<!--en-->
```<!--en-->
<!--en-->
`vyl init` lets you choose startup, doctor, repair, plugin creation, Snapshot creation, and archive-first install interactively.<!--en-->
<!--en-->
### Installation paths<!--en-->
<!--en-->
| Goal | Recommended path | Command |<!--en-->
| --- | --- | --- |<!--en-->
| Try Vyline quickly | archive-first install | `bunx vyl install` |<!--en-->
| Repair an existing checkout | doctor / fix | `bun run vyl:doctor` → `bun run vyl:fix` |<!--en-->
| Development | shallow clone or normal clone | Developer mode in `vyl install`, or `git clone --recurse-submodules` |<!--en-->
| Self-hosting | Docker | `docker compose up -d --build` |<!--en-->
| Data protection | Snapshot | `bun run vyl snapshot create manual` |<!--en-->
<!--en-->
## vyl CLI<!--en-->
<!--en-->
`vyl` is the front door for Vyline. It groups install, diagnostics, repair, start, Snapshot, and plugin scaffolding.<!--en-->
<!--en-->
| Command | Description |<!--en-->
| --- | --- |<!--en-->
| `vyl init` | Interactive setup |<!--en-->
| `vyl install` | Choose archive-first or shallow clone install |<!--en-->
| `vyl doctor` | Check Bun, Git, submodules, `.env`, and data/storage |<!--en-->
| `vyl fix` | Create `.env`, create data/storage, update submodules, run `bun install` |<!--en-->
| `vyl dev` | Start backend and frontend |<!--en-->
| `vyl start` | Start the backend server |<!--en-->
| `vyl plugin create <name>` | Create a TypeScript plugin template |<!--en-->
| `vyl snapshot create/list/restore/schedule` | Create, list, restore, and schedule Snapshots |<!--en-->
<!--en-->
Inside the repository, run `bun run vyl ...` or one of the root helper scripts.<!--en-->
<!--en-->
```bash<!--en-->
bun run vyl init<!--en-->
bun run vyl:doctor<!--en-->
bun run vyl:fix<!--en-->
bun run vyl:snapshot -- create manual<!--en-->
```<!--en-->
<!--en-->
See [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) for details.<!--en-->
<!--en-->
## Snapshot<!--en-->
<!--en-->
Vyline rebrands backup/restore as **Snapshot**. The `data/` directory contains sessions, keys, settings, and history, so create a Snapshot before updates or major setting changes.<!--en-->
<!--en-->
```bash<!--en-->
bun run vyl snapshot create before-update<!--en-->
bun run vyl snapshot list<!--en-->
bun run vyl snapshot restore snapshots/xxx.tar.gz --force<!--en-->
bun run vyl snapshot schedule daily<!--en-->
```<!--en-->
<!--en-->
On Windows, `snapshot schedule` tries to register a `VylineSnapshot` scheduled task. On other platforms it writes a schedule config and prints a command for cron or a systemd timer.<!--en-->
<!--en-->
## Development<!--en-->
<!--en-->
```bash<!--en-->
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git<!--en-->
cd Vyline<!--en-->
bun install<!--en-->
bun run vyl:doctor<!--en-->
bun run vyl dev<!--en-->
```<!--en-->
<!--en-->
| Command | Description |<!--en-->
| --- | --- |<!--en-->
| `bun run vyl:doctor` | Check the development environment |<!--en-->
| `bun run vyl:fix` | Repair common setup issues |<!--en-->
| `bun run typecheck` | Type-check all workspaces |<!--en-->
| `bun run lint` | Run Biome |<!--en-->
| `bun run build` | Build the frontend |<!--en-->
| `bun run docs:readme` | Regenerate README files from `README.src.md` |<!--en-->
<!--en-->
Create a plugin scaffold with:<!--en-->
<!--en-->
```bash<!--en-->
bun run vyl plugin create my-plugin<!--en-->
```<!--en-->
<!--en-->
## Docker / self-hosting<!--en-->
<!--en-->
```bash<!--en-->
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git<!--en-->
cd Vyline<!--en-->
docker compose up -d --build<!--en-->
```<!--en-->
<!--en-->
Open `http://localhost:3000`. Do not delete `./data/`; it contains sessions and keys.<!--en-->
<!--en-->
## Public API<!--en-->
<!--en-->
Self-hosted Vyline exposes a Bearer-token API under `/v1/`. It also serves `/openapi.json`, `/docs`, and `/swagger`.<!--en-->
<!--en-->
```bash<!--en-->
curl http://localhost:3001/v1/accounts/{accountId}/chats \\
  -H "Authorization: Bearer vyl_xxxx..."<!--en-->
```<!--en-->
<!--en-->
Never commit `VYLINE_API_ADMIN_SECRET`, issued tokens, sessions, or encryption keys.<!--en-->
<!--en-->
## Documentation<!--en-->
<!--en-->
| Document | Description |<!--en-->
| --- | --- |<!--en-->
| [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) | `vyl` CLI, install, doctor, fix, Snapshot, plugin scaffold |<!--en-->
| [Vyline/docs/guides/ios-backup-restore.md](Vyline/docs/guides/ios-backup-restore.md) | Import flow from iOS backups |<!--en-->
| [AGENTS.md](AGENTS.md) | Coding-agent guide |<!--en-->
| [CHANGELOG.md](CHANGELOG.md) | Changelog |<!--en-->
<!--en-->
## Roadmap<!--en-->
<!--en-->
- Stabilise npm / bunx distribution for `vyl`<!--en-->
- Snapshot retention, encryption, and verification<!--en-->
- Plugin permission scopes and Marketplace registry<!--en-->
- Theme SDK and `vyl theme create`<!--en-->
- Lighter Docker / self-hosting operations<!--en-->
- Control Center is intentionally out of scope for this PR<!--en-->
<!--en-->
## License<!--en-->
<!--en-->
Vyline is released under the [MIT License](LICENSE).<!--en-->
<!--en-->
Copyright © [nezumi0627](https://github.com/nezumi0627)<!--en-->
