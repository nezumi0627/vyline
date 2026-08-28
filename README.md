<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: ja -->

[English](README.en.md)

<h1 align="center">Vyline <sup>Beta</sup></h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  `vyl` から始める、拡張可能な LINE サードパーティクライアント
</p>

> [!CAUTION]
> Vyline は **LINE 非公式・未承認**のサードパーティクライアントです。LINE 株式会社および LY Corporation とは関係ありません。自己責任で使用してください。

> [!NOTE]
> 現在のバージョンは **Beta 0.8.0** です。重要なデータは `vyl snapshot` で定期的に保護してください。

## 最短スタート

新しい導線は **`vyl` CLI** です。手動で GitHub を丸ごと clone する前に、対話式セットアップを使う方針です。

```bash
bunx vyl init
```

npm / bunx 公開前、またはこのリポジトリ内で作業する場合は次を使います。

```bash
bun install
bun run vyl init
```

`vyl init` から、起動、診断、修復、プラグイン作成、Snapshot 作成、archive-first install を選べます。

## インストール方法

| 用途 | 推奨 | コマンド |
| --- | --- | --- |
| 初回利用・軽く試す | archive-first install | `bunx vyl install` |
| 既存 checkout の修復 | doctor / fix | `bun run vyl:doctor` → `bun run vyl:fix` |
| 開発 | shallow clone または通常 clone | `vyl install` の Developer mode、または `git clone --recurse-submodules` |
| セルフホスト | Docker | `docker compose up -d --build` |
| データ保護 | Snapshot | `bun run vyl snapshot create manual` |

## vyl CLI

`vyl` は Vyline の入口です。インストール、診断、修復、起動、Snapshot、プラグイン雛形作成をまとめます。

| コマンド | 内容 |
| --- | --- |
| `vyl init` | 対話式セットアップ |
| `vyl install` | archive-first / shallow clone を選べる導入 |
| `vyl doctor` | Bun、Git、submodule、`.env`、data/storage を診断 |
| `vyl fix` | `.env` 作成、data/storage 作成、submodule 更新、`bun install` |
| `vyl dev` | バックエンドとフロントエンドを起動 |
| `vyl start` | バックエンドサーバーを起動 |
| `vyl plugin create <name>` | プラグイン雛形を作成 |
| `vyl snapshot create/list/restore/schedule` | Snapshot の作成、一覧、復元、定期化 |

リポジトリ内では次の短縮 script も使えます。

```bash
bun run vyl init
bun run vyl:doctor
bun run vyl:fix
bun run vyl:snapshot -- create manual
```

詳細は [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) を参照してください。

## Snapshot

Vyline では「バックアップ / リストア」を **Snapshot** と呼びます。`data/` にはセッション、鍵、設定、履歴などの重要情報が含まれるため、更新前や設定変更前に Snapshot を作成してください。

```bash
bun run vyl snapshot create before-update
bun run vyl snapshot list
bun run vyl snapshot restore snapshots/xxx.tar.gz --force
bun run vyl snapshot schedule daily
```

Windows では `snapshot schedule` が `VylineSnapshot` タスクの登録を試みます。Windows 以外ではスケジュール設定ファイルを書き出し、cron / systemd timer に登録できるコマンドを表示します。

## 開発

```bash
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git
cd Vyline
bun install
bun run vyl:doctor
bun run vyl dev
```

| コマンド | 内容 |
| --- | --- |
| `bun run vyl:doctor` | 開発環境を診断 |
| `bun run vyl:fix` | よくあるセットアップ不備を修復 |
| `bun run typecheck` | 全ワークスペースの型チェック |
| `bun run lint` | Biome による lint |
| `bun run build` | フロントエンドの本番ビルド |
| `bun run docs:readme` | README を `README.src.md` から再生成 |

プラグイン雛形は次で作成します。

```bash
bun run vyl plugin create my-plugin
```

## Docker / セルフホスト

```bash
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git
cd Vyline
docker compose up -d --build
```

起動後は `http://localhost:3000` へアクセスします。`./data/` はセッションや鍵を含むため削除しないでください。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) | `vyl` CLI、install、doctor、fix、Snapshot、plugin scaffold |
| [Vyline/docs/guides/ios-backup-restore.md](Vyline/docs/guides/ios-backup-restore.md) | iOS バックアップからの取り込み手順 |
| [AGENTS.md](AGENTS.md) | コーディングエージェント向けガイド |
| [CHANGELOG.md](CHANGELOG.md) | 変更履歴 |

## ロードマップ

- `vyl` の npm / bunx 配布を安定化
- Snapshot の保持世代、暗号化、検証機能
- プラグイン権限スコープと Marketplace registry
- テーマ SDK と `vyl theme create`
- Docker / セルフホスト運用の軽量化
- Control Center は本 PR では対象外

## ライセンス

Vyline は [MIT License](LICENSE) のもとで公開されています。

Copyright © [nezumi0627](https://github.com/nezumi0627)
