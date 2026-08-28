<!--@languages=ja,en-->
<!--@default=ja-->
[English](README.en.md)<!--ja-->
[日本語](README.md)<!--en-->
<!--ja-->
<h1 align="center">Vyline <sup>Beta</sup></h1><!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <strong>Vision Beyond Limits.</strong><br/><!--ja-->
  `vyl` から始める、拡張可能な LINE サードパーティクライアント<!--ja-->
</p><!--ja-->
<!--ja-->
> [!CAUTION]<!--ja-->
> Vyline は **LINE 非公式・未承認**のサードパーティクライアントです。LINE 株式会社および LY Corporation とは関係ありません。自己責任で使用してください。<!--ja-->
<!--ja-->
> [!NOTE]<!--ja-->
> 現在のバージョンは **Beta 0.8.0** です。重要なデータは `vyl snapshot` で定期的に保護してください。<!--ja-->
<!--ja-->
## 最短スタート<!--ja-->
<!--ja-->
新しい導線は **`vyl` CLI** です。手動で GitHub を丸ごと clone する前に、対話式セットアップを使う方針です。<!--ja-->
<!--ja-->
```bash<!--ja-->
bunx vyl init<!--ja-->
```<!--ja-->
<!--ja-->
npm / bunx 公開前、またはこのリポジトリ内で作業する場合は次を使います。<!--ja-->
<!--ja-->
```bash<!--ja-->
bun install<!--ja-->
bun run vyl init<!--ja-->
```<!--ja-->
<!--ja-->
`vyl init` から、起動、診断、修復、プラグイン作成、Snapshot 作成、archive-first install を選べます。<!--ja-->
<!--ja-->
## インストール方法<!--ja-->
<!--ja-->
| 用途 | 推奨 | コマンド |<!--ja-->
| --- | --- | --- |<!--ja-->
| 初回利用・軽く試す | archive-first install | `bunx vyl install` |<!--ja-->
| 既存 checkout の修復 | doctor / fix | `bun run vyl:doctor` → `bun run vyl:fix` |<!--ja-->
| 開発 | shallow clone または通常 clone | `vyl install` の Developer mode、または `git clone --recurse-submodules` |<!--ja-->
| セルフホスト | Docker | `docker compose up -d --build` |<!--ja-->
| データ保護 | Snapshot | `bun run vyl snapshot create manual` |<!--ja-->
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
リポジトリ内では次の短縮 script も使えます。<!--ja-->
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
## 開発<!--ja-->
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
## Docker / セルフホスト<!--ja-->
<!--ja-->
```bash<!--ja-->
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git<!--ja-->
cd Vyline<!--ja-->
docker compose up -d --build<!--ja-->
```<!--ja-->
<!--ja-->
起動後は `http://localhost:3000` へアクセスします。`./data/` はセッションや鍵を含むため削除しないでください。<!--ja-->
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
> Vyline is an unofficial and unauthorised LINE third-party client. It is not affiliated with LINE Corporation or LY Corporation. Use it at your own risk.<!--en-->
<!--en-->
> [!NOTE]<!--en-->
> Vyline is currently Beta 0.8.0. Protect important data with `vyl snapshot`.<!--en-->
<!--en-->
## Quick start<!--en-->
<!--en-->
The new entrypoint is the **`vyl` CLI**. New users should start with the interactive flow instead of manually cloning the full repository first.<!--en-->
<!--en-->
```bash<!--en-->
bunx vyl init<!--en-->
```<!--en-->
<!--en-->
Before npm / bunx publishing, or inside this repository, use:<!--en-->
<!--en-->
```bash<!--en-->
bun install<!--en-->
bun run vyl init<!--en-->
```<!--en-->
<!--en-->
`vyl init` lets you choose startup, doctor, repair, plugin creation, Snapshot creation, and archive-first install interactively.<!--en-->
<!--en-->
## Installation paths<!--en-->
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
Inside the repository, run:<!--en-->
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
