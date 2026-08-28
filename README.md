<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: ja -->

[English](README.en.md)

<h1 align="center">Vyline <sup>Beta</sup></h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  `vyl` から始める、拡張可能な LINE サードパーティクライアント
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.8.0--beta-a78bfa?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" />
  <img alt="cli" src="https://img.shields.io/badge/cli-vyl-22c55e?style=flat-square" />
  <img alt="backend" src="https://img.shields.io/badge/backend-Hono-e879f9?style=flat-square" />
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-38bdf8?style=flat-square" />
</p>

<p align="center">
  <a href="#最短スタート">最短スタート</a> ・
  <a href="#vyl-cli">vyl CLI</a> ・
  <a href="#snapshot">Snapshot</a> ・
  <a href="#開発">開発</a> ・
  <a href="#ドキュメント">ドキュメント</a>
</p>

> [!CAUTION]
> Vyline は **LINE 非公式・未承認**のサードパーティクライアントです。LINE 株式会社および LY Corporation とは関係ありません。利用規約への抵触やアカウント停止を含むリスクを理解したうえで、自己責任で使用してください。

> [!NOTE]
> 現在のバージョンは **Beta 0.8.0** です。Beta 版のため、仕様変更・不具合・データ損失が発生する可能性があります。重要なデータは `vyl snapshot` で定期的に保護してください。

---

## Vyline とは

**Vyline** は、メッセージ送受信、Flex / Rich 表示、テーマ、公開 API、プラグイン、Snapshot を備えた Web / React ベースの LINE クライアントです。

外部の中継サービスに依存せず、独自実装の **`@vyline/protocol`** を介して LINE サーバーと通信します。UI、バックエンド、プロトコル、CLI を分離しているため、セルフホスト、開発、プラグイン拡張、データ移行を段階的に扱えます。

| 項目 | 内容 |
| --- | --- |
| 入口 | `vyl` CLI / `bunx vyl` / `bun run vyl` |
| 対象 | UI を自分好みに調整したいユーザー、開発者、セルフホスト利用者 |
| 技術 | React + Vite / Hono on Bun / TypeScript / Thrift |
| 状態 | Beta 0.8.0 |
| ライセンス | MIT |

## 最短スタート

これから使う人は、手動で GitHub を丸ごと clone する前に **`vyl` の対話式セットアップ**を使う方針です。

```bash
bunx vyl init
```

まだ npm 公開前、またはリポジトリ内で作業する場合は次を使います。

```bash
bun install
bun run vyl init
```

`vyl init` は、起動、診断、修復、プラグイン作成、Snapshot 作成、archive-first install を対話式に選べます。

### インストール方法の選び方

| 用途 | 推奨 | コマンド |
| --- | --- | --- |
| 初回利用・軽く試す | archive-first install | `bunx vyl install` |
| 既存 checkout の修復 | doctor / fix | `bun run vyl:doctor` → `bun run vyl:fix` |
| 開発 | shallow clone または通常 clone | `vyl install` の Developer mode、または `git clone --recurse-submodules` |
| セルフホスト | Docker | `docker compose up -d --build` |
| データ保護 | Snapshot | `bun run vyl snapshot create manual` |

### 既存リポジトリでの開発起動

```bash
bun install
bun run vyl:doctor
bun run vyl:fix
bun run vyl dev
```

従来のコマンドも残しています。必要に応じて `bun run dev`、`bun run typecheck`、`bun run lint`、`bun run build` を直接実行できます。

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

リポジトリ内では `bun run vyl ...` または短縮 script を使えます。

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

## 主な機能

| カテゴリ | 内容 |
| --- | --- |
| ログイン | QR / Email ログイン、マルチアカウント、セッション復元 |
| メッセージ | 送受信、返信、送信取り消し、既読制御、再送 |
| メディア | 画像、動画、音声、LINE 絵文字、スタンプ |
| Flex / Rich | 公式形式に準拠した描画、カルーセル操作 |
| VyTheme | テーマ、文字サイズ、表示密度、プロフィール背景のカスタマイズ |
| E2EE | Letter Sealing の復号・送信、LINE Desktop の鍵のインポート |
| Snapshot | `data/` の作成、一覧、復元、定期作成 |
| プラグイン | `vyl plugin create` による TypeScript 雛形生成 |
| 開発者向け | Bearer トークン対応の公開 API、OpenAPI 3.1、JSONL 詳細ログ |

## Docker / セルフホスト

```bash
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git
cd Vyline
docker compose up -d --build
```

起動後は `http://localhost:3000` へアクセスします。Docker 版はフロントエンドとバックエンドを同一オリジンで配信します。`./data/` はセッションや鍵を含むため削除しないでください。

遠隔アクセスは Tailscale 推奨です。PC とスマホを同じ Tailscale アカウントに入れ、`http://100.x.y.z:3000` でアクセスします。

## 公開 API

セルフホストした Vyline は Bearer トークンを使って外部ツールや独自クライアントから操作できます。API は `/v1/` 配下で提供されます。

| エンドポイント | 用途 |
| --- | --- |
| `/v1/*` | トークン認証された Vyline API |
| `/openapi.json` | OpenAPI 3.1 の機械可読仕様 |
| `/docs` | API ドキュメント UI |
| `/swagger` | Swagger UI |

```bash
curl http://localhost:3001/v1/accounts/{accountId}/chats \
  -H "Authorization: Bearer vyl_xxxx..."
```

> [!WARNING]
> `VYLINE_API_ADMIN_SECRET`、発行済みトークン、セッション、暗号鍵をリポジトリやログへ含めないでください。

## 開発

開発者は `vyl` で整えてから通常の Bun workspace コマンドを使います。

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
