<!--@languages=ja,en-->
<!--@default=ja-->
[English](README.en.md)<!--ja-->
[日本語](README.md)<!--en-->

<h1 align="center">Vyline <sup>Beta</sup></h1><!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <strong>Vision Beyond Limits.</strong><br/><!--ja-->
  自前のプロトコルスタックで動作する、拡張可能な LINE サードパーティクライアント<!--ja-->
</p><!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <img alt="version" src="https://img.shields.io/badge/version-0.6.1--beta-a78bfa?style=flat-square" /><!--ja-->
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" /><!--ja-->
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" /><!--ja-->
  <img alt="backend" src="https://img.shields.io/badge/backend-Hono-e879f9?style=flat-square" /><!--ja-->
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-38bdf8?style=flat-square" /><!--ja-->
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-22c55e?style=flat-square" /><!--ja-->
</p><!--ja-->
<!--ja-->
<!--ja-->
<p align="center">このさんさんとした太陽の下、Vyline を選んでくださるユーザーに出会えたことに感謝します。</p><!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <a href="#vyline-とは">概要</a> ・<!--ja-->
  <a href="#主な機能">機能</a> ・<!--ja-->
  <a href="#インストール更新">インストール・更新</a> ・<!--ja-->
  <a href="#vyline-を支援する">支援・参加</a> ・<!--ja-->
  <a href="#公開-api">API</a> ・<!--ja-->
  <a href="#ドキュメント">ドキュメント</a> ・<!--ja-->
  <a href="#ロードマップ">ロードマップ</a><!--ja-->
</p><!--ja-->
<!--ja-->
> [!CAUTION]<!--ja-->
> Vyline は **LINE 非公式・未承認**のサードパーティクライアントです。LINE 株式会社および LY Corporation とは関係ありません。利用規約への抵触やアカウント停止を含むリスクを理解したうえで、自己責任で使用してください。<!--ja-->
<!--ja-->
> [!NOTE]<!--ja-->
> 2026年8月20日に Beta 0.5.0 として公開を開始しました。現在のバージョンは **Beta 0.6.0** です。Beta 版のため、仕様変更・不具合・データ損失が発生する可能性があります。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## Vyline とは<!--ja-->
<!--ja-->
**Vyline** は、メッセージの送受信、Flex / Rich 表示、テーマカスタマイズ、バックアップなどを備えた Web / React ベースの LINE クライアントです。<!--ja-->
<!--ja-->
外部の中継サービスに依存せず、独自実装のプロトコルパッケージ **`@vyline/protocol`** を介して LINE サーバーと通信します。UI、バックエンド、プロトコルを分離しているため、テーマ、公開 API、将来のプラグインやカスタムクライアントへ拡張できる構成です。<!--ja-->
<!--ja-->
| 項目 | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| 対象 | UI を自分好みに調整したいユーザー、開発者、セルフホスト利用者 |<!--ja-->
| 特徴 | 自前プロトコル、VyTheme、公開 API、ローカル優先のデータ管理 |<!--ja-->
| 技術 | React + Vite / Hono on Bun / TypeScript / Thrift |<!--ja-->
| 状態 | Beta 0.6.0 |<!--ja-->
| ライセンス | MIT |<!--ja-->
<!--ja-->
## 主な機能<!--ja-->
<!--ja-->
| カテゴリ | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| **ログイン** | QR / Email ログイン、マルチアカウント、セッション復元 |<!--ja-->
| **メッセージ** | 送受信、返信、送信取り消し、既読制御、再送 |<!--ja-->
| **メンション** | `@ALL` / `@名前`、LINE Desktop 準拠の `MENTION` metadata |<!--ja-->
| **メディア** | 画像、動画、音声、LINE 絵文字（sticon）、スタンプ。画像の自動圧縮と高画質送信に対応 |<!--ja-->
| **Flex / Rich** | 公式形式に準拠した描画、カルーセルのマウスドラッグ |<!--ja-->
| **リアクション** | 1クリックリアクション、公式バッジ、既読者一覧 |<!--ja-->
| **通話** | 音声 / ビデオ通話（実験的） |<!--ja-->
| **チャット管理** | ピン、非表示、ミュート、ブロック、MID コピー、グループ作成・招待 |<!--ja-->
| **VyTheme** | テーマ、文字サイズ、表示密度、プロフィール背景のカスタマイズ |<!--ja-->
| **E2EE** | Letter Sealing の復号・送信、LINE Desktop の鍵のインポート |<!--ja-->
| **プライバシー** | ストリーマーモード、PIN ロック |<!--ja-->
| **ベータ機能** | ブロック状態確認（機能ごとの追加同意が必要） |<!--ja-->
| **VylineBackup** | トーク履歴とメディアのスナップショット作成・復元・削除 |<!--ja-->
| **開発者向け** | Bearer トークン対応の公開 API、OpenAPI 3.1、JSONL 詳細ログ |<!--ja-->
| **その他** | Keepメモ、プロフィール背景、通話中バッジ、共通グループの高速表示、トークの TXT 保存 |<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## Vyline を支援する<!--ja-->
<!--ja-->
Vyline は個人開発のオープンソースプロジェクトです。支援は、開発環境、テスト、サーバー、ドキュメントの維持に活用します。<!--ja-->
<!--ja-->
### 支援方法<!--ja-->
<!--ja-->
| 方法 | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| **PayPay** | PayPay の「送る・受け取る」による支援 |<!--ja-->
| **Amazon ギフトカード（アマギフ）** | Amazon ギフトカードによる支援 |<!--ja-->
| **その他のギフトカード** | Apple Gift Card、Google Play、Steam など。事前に相談してください |<!--ja-->
| **開発・デザイン** | コード、ドキュメント、UI、アイコン、バナーなどでの貢献 |<!--ja-->
<!--ja-->
送付先や手順は、[nezumi0627 のGitHubプロフィール](https://github.com/nezumi0627) に掲載している連絡先から事前にお問い合わせください。支援方法は状況に応じて案内します。<!--ja-->
<!--ja-->
> [!IMPORTANT]<!--ja-->
> 支援は任意であり、機能実装、バグ修正、個別サポート、将来の提供を保証するものではありません。ギフトカード番号、PayPayの送付情報、セッション、トークン、暗号鍵を Issue、Pull Request、公開チャットへ投稿しないでください。送信後の返金や取り消しには対応できない場合があります。<!--ja-->
<!--ja-->
### メンテナー<!--ja-->
<!--ja-->
| メンテナー | 役割 |<!--ja-->
| --- | --- |<!--ja-->
| [nezumi0627](https://github.com/nezumi0627) | リード開発者 |<!--ja-->
| [YoseiUshida](https://github.com/youseiushida) | 定期メンテナー |<!--ja-->
<!--ja-->
### メンテナー・コントリビューター募集<!--ja-->
<!--ja-->
Vyline の継続的な開発を支えるメンテナーとコントリビューターを募集しています。<!--ja-->
<!--ja-->
- **メンテナー**: Issue の整理、PRレビュー、リリース、ドキュメントの保守<!--ja-->
- **開発**: バグ修正、API、プロトコル、UI、ストレージ、テスト<!--ja-->
- **デザイン**: VyTheme、アプリアイコン、テーマアイコン、バナー<!--ja-->
- **ドキュメント**: セットアップ、APIリファレンス、翻訳、トラブルシューティング<!--ja-->
<!--ja-->
参加方法は [コントリビューションガイド](docs/CONTRIBUTING.md) を確認し、まず Issue または Pull Request で提案してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## ご利用前の重要事項<!--ja-->
<!--ja-->
- **アカウントリスク**: LINE の利用規約に抵触し、アカウント停止などの措置を受ける可能性があります。<!--ja-->
- **同意ゲート**: ログイン後に利用規約と免責事項を表示します。同意が完了するまで、同期・通信・メッセージ表示を含むアプリ機能は開始されません。ゲートの回避や改変はサポート対象外です。<!--ja-->
- **利用目的**: 教育、学習、研究、個人利用を想定しています。不正アクセス、攻撃、迷惑行為、権利侵害への利用は禁止します。<!--ja-->
- **データの保存**: ログイン情報、セッション、暗号鍵、トーク履歴は、ユーザーが管理するローカル環境またはセルフホスト先に保存されます。通常動作に必要な通信を除き、Vyline 開発者が運営する外部サーバーへ送信しません。<!--ja-->
- **無保証**: 本ソフトウェアの使用により生じたアカウント停止、データ破損、損失、法的問題などについて、開発者およびコントリビューターは責任を負いません。<!--ja-->
- **解析ツール**: `tools/` 以下は [vyline-search](https://github.com/nezumi0627/vyline-search) を Git Submodule として参照します。教育・研究目的でのみ使用し、解析対象や解析結果を不適切に再配布しないでください。詳細は [docs/tools/DISCLAIMER.md](docs/tools/DISCLAIMER.md) を参照してください。<!--ja-->
- **ベータ機能**: 「ベータ機能」タブの機能は、全体の利用規約同意とは別に機能単位の説明・同意を表示します。同意ログとベータ機能の処理結果は端末内で扱い、メッセージ本文や確認結果を Vyline の外部サービスへ送信しません。LINE との通常の通信は発生します。これは法的助言ではありません。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## インストール・更新<!--ja-->
<!--ja-->
### 方法を選ぶ<!--ja-->
<!--ja-->
| 用途 | 推奨方法 | 説明 |<!--ja-->
| --- | --- | --- |<!--ja-->
| 開発・動作確認 | Bun + ソースコード | フロントエンドとバックエンドを個別に確認できます |<!--ja-->
| 自宅サーバー・複数端末 | Docker Compose | データをボリュームに保存して Web ブラウザから利用できます |<!--ja-->
| Windows の単体アプリ | Beta 対応 | GitHub Releases の `VylineSetup-<version>.exe` を使用します |<!--ja-->
| Linux の単体アプリ | Beta 対応 | GitHub Releases の `Vyline-linux-x64-<version>.tar.gz` を使用します |<!--ja-->
<!--ja-->
> [!NOTE]<!--ja-->
> Windows版・Linux版は GitHub Releases から導入できます。サーバー用途では Docker Compose を使用してください。<!--ja-->
<!--ja-->
### ソースコードからインストール（Bun）<!--ja-->
<!--ja-->
- [Git](https://git-scm.com/)<!--ja-->
- [Bun](https://bun.sh/)<!--ja-->
<!--ja-->
### 開発環境で起動<!--ja-->
<!--ja-->
```bash<!--ja-->
git clone https://github.com/nezumi0627/Vyline.git<!--ja-->
cd Vyline<!--ja-->
# 必要に応じて環境変数を設定（macOS / Linux / Git Bash）<!--ja-->
cp .env.example .env<!--ja-->
bun install<!--ja-->
bun run typecheck<!--ja-->
bun run dev<!--ja-->
```<!--ja-->
<!--ja-->
PowerShell の場合:<!--ja-->
<!--ja-->
```powershell<!--ja-->
Copy-Item .env.example .env<!--ja-->
```<!--ja-->
<!--ja-->
起動後、ブラウザで `http://localhost:5173` を開きます。バックエンドは `http://localhost:3001` で待ち受けます。<!--ja-->
<!--ja-->
`bun install` はワークスペース全体の依存関係をインストールします。`Vyline/backend` や `Vyline/apps/desktop` で個別に install する必要はありません。<!--ja-->
<!--ja-->
| コマンド | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| `bun run dev` | バックエンドとフロントエンドを同時に起動 |<!--ja-->
| `bun run dev:backend` | バックエンドのみ起動（`:3001`） |<!--ja-->
| `bun run dev:frontend` | フロントエンドのみ起動（`:5173`） |<!--ja-->
| `bun run typecheck` | 全ワークスペースの型チェック |<!--ja-->
| `bun run lint` | Biome による lint |<!--ja-->
| `bun run build` | フロントエンドの本番ビルド |<!--ja-->
<!--ja-->
導入の詳細は [オンボーディング](docs/onboarding.md) と [開発ガイド](docs/development.md) を参照してください。<!--ja-->
<!--ja-->
### Bun環境の更新<!--ja-->
<!--ja-->
ローカルで変更したファイルがある場合は、先にコミットまたは退避してください。<!--ja-->
<!--ja-->
```bash<!--ja-->
git status --short<!--ja-->
git pull --ff-only<!--ja-->
bun install<!--ja-->
bun run typecheck<!--ja-->
bun run dev<!--ja-->
```<!--ja-->
<!--ja-->
`git pull --ff-only` が失敗した場合は、ローカル変更を確認してから手動で merge または rebase してください。`git reset --hard` で変更を消す必要はありません。<!--ja-->
<!--ja-->
### Docker でインストール<!--ja-->
<!--ja-->
```bash<!--ja-->
git clone https://github.com/nezumi0627/Vyline.git<!--ja-->
cd Vyline<!--ja-->
docker compose up -d --build<!--ja-->
```<!--ja-->
<!--ja-->
起動後は `http://localhost:3000` へアクセスします。Docker版はフロントエンドとバックエンドを同一オリジンで配信します。<!--ja-->
<!--ja-->
### Docker環境の更新<!--ja-->
<!--ja-->
```bash<!--ja-->
docker compose pull<!--ja-->
docker compose up -d<!--ja-->
```<!--ja-->
<!--ja-->
ソースコードからイメージを作り直す場合は、`git pull --ff-only && docker compose up -d --build` を使用します。<!--ja-->
<!--ja-->
`docker compose up -d --build` が既存コンテナを再作成しても、ホスト側の `./data/` ディレクトリは維持されます。**`data/` にはセッションや鍵が含まれるため、削除しないでください。**<!--ja-->
<!--ja-->
トーク履歴、画像、セッションなどは `./data/` へ永続化され、同じ LINE セッションを複数の Web ブラウザから利用できます。<!--ja-->
<!--ja-->
### Linux単体版<!--ja-->
<!--ja-->
```bash<!--ja-->
tar -xzf Vyline-linux-x64-<version>.tar.gz<!--ja-->
cd Vyline-linux-x64-<version><!--ja-->
./install.sh<!--ja-->
~/.local/bin/vyline<!--ja-->
```<!--ja-->
<!--ja-->
設定方法と Cloudflare Access を利用した外部公開については、[セルフホストガイド](docs/selfhosting.md) を参照してください。<!--ja-->
<!--ja-->
### 既定のプロトコルプロファイル<!--ja-->
<!--ja-->
| 項目 | 既定値 | 備考 |<!--ja-->
| --- | --- | --- |<!--ja-->
| クライアント | `IOSIPAD 26.7.2` | `x-line-application` に使用 |<!--ja-->
| プロファイルOS | `iOS 18.0` | プロトコル上の識別値 |<!--ja-->
| デバイスモード | `IOSIPAD` | `VYLINE_DEVICE` で変更可能 |<!--ja-->
<!--ja-->
> [!IMPORTANT]<!--ja-->
> 上記は LINE サーバーへ送る**プロトコル識別値**であり、Vyline を実行するホストOSの要件ではありません。定義元は `packages/protocol/src/desktop/types.ts` の `DesktopProfile` です。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## アーキテクチャ<!--ja-->
<!--ja-->
```mermaid<!--ja-->
flowchart TB<!--ja-->
    FE["Frontend — React + Vite<br/>Vyline/apps/desktop<br/>Store / Mappers / Sync / VyTheme UI"]<!--ja-->
    BE["Backend — Hono on Bun<br/>Vyline/backend<br/>BFF Routes → lineService → clientManager"]<!--ja-->
    VP["Vyline Protocol<br/>Vyline/packages/protocol<br/>Domain / Dictionary / E2EE / Thrift Stack"]<!--ja-->
    LS["LINE Servers"]<!--ja-->
<!--ja-->
    FE -->|HTTP / WebSocket| BE<!--ja-->
    BE -->|Protocol API| VP<!--ja-->
    VP -->|Thrift / E2EE| LS<!--ja-->
<!--ja-->
    classDef frontend fill:#eff6ff,stroke:#3b82f6,color:#172554,stroke-width:2px;<!--ja-->
    classDef backend fill:#f5f3ff,stroke:#8b5cf6,color:#2e1065,stroke-width:2px;<!--ja-->
    classDef protocol fill:#ecfdf5,stroke:#10b981,color:#052e16,stroke-width:2px;<!--ja-->
    classDef external fill:#f8fafc,stroke:#64748b,color:#0f172a,stroke-width:2px;<!--ja-->
<!--ja-->
    class FE frontend;<!--ja-->
    class BE backend;<!--ja-->
    class VP protocol;<!--ja-->
    class LS external;<!--ja-->
```<!--ja-->
<!--ja-->
| パス | 役割 |<!--ja-->
| --- | --- |<!--ja-->
| `Vyline/apps/desktop` | React + Vite によるフロントエンド |<!--ja-->
| `Vyline/backend` | Hono ベースの BFF、認証、同期、API |<!--ja-->
| `Vyline/packages/protocol` | ドメインモデル、辞書、E2EE、Thrift 通信 |<!--ja-->
| `Vyline/packages/line-types` | vendored の Thrift 型定義 |<!--ja-->
<!--ja-->
詳細は [docs/architecture.md](docs/architecture.md) を参照してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## 公開 API<!--ja-->
<!--ja-->
セルフホストした Vyline は、Bearer トークンを使って外部ツールや独自クライアントから操作できます。API は `/v1/` 配下で提供されます。<!--ja-->
<!--ja-->
| エンドポイント | 用途 |<!--ja-->
| --- | --- |<!--ja-->
| `/v1/*` | トークン認証された Vyline API |<!--ja-->
| `/openapi.json` | OpenAPI 3.1 の機械可読仕様 |<!--ja-->
| `/docs` | API ドキュメント UI |<!--ja-->
| `/swagger` | Swagger UI |<!--ja-->
<!--ja-->
> [!TIP]<!--ja-->
> 利用可能なエンドポイントはバージョンによって異なる場合があります。実行中のサーバーが返す `/openapi.json` を正として扱ってください。<!--ja-->
<!--ja-->
### トークンの作成<!--ja-->
<!--ja-->
環境変数 `VYLINE_API_ADMIN_SECRET` を設定してから、管理シークレットでトークンを作成します。<!--ja-->
<!--ja-->
```bash<!--ja-->
curl -X POST http://localhost:3001/v1/tokens \<!--ja-->
  -H "Authorization: Bearer $VYLINE_API_ADMIN_SECRET" \<!--ja-->
  -H "Content-Type: application/json" \<!--ja-->
  -d '{"name":"my-bot"}'<!--ja-->
```<!--ja-->
<!--ja-->
### API の利用例<!--ja-->
<!--ja-->
```bash<!--ja-->
curl http://localhost:3001/v1/accounts/{accountId}/chats \<!--ja-->
  -H "Authorization: Bearer vyl_xxxx..."<!--ja-->
```<!--ja-->
<!--ja-->
> [!WARNING]<!--ja-->
> `VYLINE_API_ADMIN_SECRET`、発行済みトークン、セッション、暗号鍵をリポジトリやログへ含めないでください。<!--ja-->
<!--ja-->
API の設計と利用方法は [docs/api/openapi.md](docs/api/openapi.md) および [公開ドキュメント](https://zensical.org) を参照してください。<!--ja-->
<!--ja-->
## テーマ・プラグイン・カスタムクライアント<!--ja-->
<!--ja-->
Vyline は API ファーストの拡張可能なクライアントを目指しています。<!--ja-->
<!--ja-->
### VyTheme<!--ja-->
<!--ja-->
テーマ、文字サイズ、表示密度、プロフィール背景を変更できます。今後は CSS 変数、背景、各 UI 要素を対象としたカスタムセレクターを整備し、コードを直接変更せずに外観を調整できる仕組みを強化します。<!--ja-->
<!--ja-->
### プラグインシステム（計画中）<!--ja-->
<!--ja-->
JavaScript / TypeScript で機能を追加できるプラグインシステムを計画しています。<!--ja-->
<!--ja-->
- Manifest によるプラグイン情報と互換バージョンの宣言<!--ja-->
- API ごとの権限スコープと、インストール時の権限確認<!--ja-->
- 補完可能な型定義と安定した Open API<!--ja-->
- 起動、停止、更新、無効化を管理するライフサイクル<!--ja-->
- 互換性を壊す変更に対するバージョニング方針<!--ja-->
<!--ja-->
### カスタムクライアント<!--ja-->
<!--ja-->
公開 API と OpenAPI 仕様を利用し、Vyline バックエンド上に独自 UI、Bot、連携ツールを構築できる設計を進めています。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## E2EE / LINE Desktop の鍵<!--ja-->
<!--ja-->
過去の Letter Sealing メッセージを復号するには、公式 LINE Desktop から抽出した自己鍵一式が必要です。<!--ja-->
<!--ja-->
1. LINE Desktop を起動した状態で鍵を抽出します（[docs/analysis/](docs/analysis/)）。<!--ja-->
2. 鍵を `backend/data/desktop-e2ee-keys.json` に配置します。<!--ja-->
3. バックエンド起動時に鍵が自動でインポートされます。<!--ja-->
<!--ja-->
> [!CAUTION]<!--ja-->
> `desktop-e2ee-keys.json` は機密情報です。必ず `.gitignore` の対象にし、コミット、共有、ログ出力をしないでください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## v0.5.0 の破壊的変更<!--ja-->
<!--ja-->
v0.5.0 は v0.4.x と互換性がありません。アップグレード時に、既存の設定やキャッシュの一部を再作成する必要がある場合があります。<!--ja-->
<!--ja-->
| 変更 | 影響 |<!--ja-->
| --- | --- |<!--ja-->
| 受信エンジンを Push 長ポールから `fetchOps` 方式へ刷新 | イベントポーリングの挙動が変更されます |<!--ja-->
| 公開 API（`/v1/`）を新設 | `VYLINE_API_ADMIN_SECRET` を設定するとトークンを管理できます |<!--ja-->
| 通話、メンバー変更、アナウンスなどのイベントを追加 | 旧フロントエンドとは互換性がありません |<!--ja-->
<!--ja-->
```bash<!--ja-->
git pull<!--ja-->
bun install<!--ja-->
bun run dev<!--ja-->
```<!--ja-->
<!--ja-->
既存のログイン状態は維持されます。詳細な変更内容は [CHANGELOG.md](CHANGELOG.md) を参照してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## バージョニング<!--ja-->
<!--ja-->
Vyline はセマンティックバージョン（`X.Y.Z`、Beta 期間中は `X.Y.Z-beta`）を採用します。リリース時は Git タグ `v<version>`（例: `v0.6.0-beta`）を作成します。<!--ja-->
<!--ja-->
バージョンは次の **4 箇所を同一に** 保つ必要があります:<!--ja-->
<!--ja-->
| 場所 | フィールド |<!--ja-->
| --- | --- |<!--ja-->
| `package.json`（ルート） | `version` |<!--ja-->
| `Vyline/apps/desktop/package.json` | `version` |<!--ja-->
| `Vyline/apps/desktop/src/lib/store.ts` | `UPDATE_NOTES.version`（+ `title` / `items` はユーザー向け更新内容） |<!--ja-->
| `README.md` | バッジの `version-...` |<!--ja-->
<!--ja-->
手動更新の手間を避けるため、bump スクリプトで一括更新できます:<!--ja-->
<!--ja-->
```bash<!--ja-->
bun run bump -- 0.7.0        # 指定バージョンへ一括更新<!--ja-->
bun run bump -- patch         # 0.6.0-beta → 0.6.1-beta のように相対指定も可 (major / minor / patch)<!--ja-->
```<!--ja-->
<!--ja-->
スクリプトは上記のバージョン箇所と README バッジを自動で書き換えます。`UPDATE_NOTES.items` と CHANGELOG エントリはリリースごとに手動（または AI エージェント）で追記します。詳細は [AGENTS.md](AGENTS.md) の「バージョン管理」を参照してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## 解析ツールキット<!--ja-->
<!--ja-->
[vyline-search](https://github.com/nezumi0627/vyline-search) は、Desktop LINE の unpack、ネイティブシンボル検索、逆コンパイルを行う独立ツールキットです。文字列 xref を利用した `findNativeSymbol` と Ghidra decompile をワンコマンドで実行できます。<!--ja-->
<!--ja-->
> [!WARNING]<!--ja-->
> unpack やアップデートを実行する前に LINE Desktop を完全に終了してください。起動中は単一インスタンス制御によって Frida の注入が拒否され、`ProcessNotRespondingError` になる場合があります。<!--ja-->
<!--ja-->
```powershell<!--ja-->
bun run vyline:check                       # インストール版と最新版を比較<!--ja-->
bun run vyline:versions                    # インストール済みバージョンを一覧表示<!--ja-->
bun run vyline:unpack -- --version <ver>   # 指定バージョンを unpack<!--ja-->
bun run vyline:update                      # LINE Desktop を更新<!--ja-->
bun run vyline:find-native -- sendMessage  # ネイティブシンボルを検索<!--ja-->
```<!--ja-->
<!--ja-->
解析ツールは教育・研究目的でのみ使用してください。詳細な免責事項は [docs/tools/DISCLAIMER.md](docs/tools/DISCLAIMER.md) を参照してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## ドキュメント<!--ja-->
<!--ja-->
| ドキュメント | 内容 |<!--ja-->
| --- | --- |<!--ja-->
| [docs/README.md](docs/README.md) | ドキュメント索引 |<!--ja-->
| [docs/onboarding.md](docs/onboarding.md) | 初回セットアップ |<!--ja-->
| [docs/development.md](docs/development.md) | 開発環境とコマンド |<!--ja-->
| [docs/architecture.md](docs/architecture.md) | アーキテクチャ |<!--ja-->
| [docs/selfhosting.md](docs/selfhosting.md) | Docker と Cloudflare Access |<!--ja-->
| [docs/protocol/dictionary.md](docs/protocol/dictionary.md) | RPC 辞書 |<!--ja-->
| [docs/api/openapi.md](docs/api/openapi.md) | OpenAPI と公開 API |<!--ja-->
| [docs/developers/index.md](docs/developers/index.md) | **開発者向けガイド（読む順序つき）** |<!--ja-->
| [docs/developers/plugin-system.md](docs/developers/plugin-system.md) | プラグイン開発（サンプル付き） |<!--ja-->
| [docs/developers/for-ai.md](docs/developers/for-ai.md) | AI エージェント向け指示書 |<!--ja-->
| [examples/](examples/) | プラグイン・API サンプルコード |<!--ja-->
| [docs/user-guide/update.md](docs/user-guide/update.md) | アップデート方法（`bun run update`） |<!--ja-->
| [docs/user-guide/custom-client.md](docs/user-guide/custom-client.md) | カスタムクライアントの作り方 |<!--ja-->
| [docs/user-guide/themes.md](docs/user-guide/themes.md) | テーマの作り方（VyTheme） |<!--ja-->
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | コントリビューションガイド |<!--ja-->
| [AGENTS.md](AGENTS.md) | コーディングエージェント向けガイド |<!--ja-->
| [CHANGELOG.md](CHANGELOG.md) | 変更履歴 |<!--ja-->
<!--ja-->
公開ドキュメントと API リファレンス: **[zensical.org](https://zensical.org)**<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## ロードマップ<!--ja-->
<!--ja-->
- **API / Swagger**: `/v1/`、`/openapi.json`、`/docs`、`/swagger` の整備と安定化<!--ja-->
- **プラグインシステム**: JavaScript / TypeScript、権限スコープ、型付き Open API<!--ja-->
- **カスタムクライアント**: 独自フロントエンド、Bot、外部ツールとの連携<!--ja-->
- **マルチアカウント**: アカウント単位の認証・データ・メディア分離<!--ja-->
- **ストレージ管理**: キャッシュと保存済みメディアの分離、容量表示、バックアップ復元<!--ja-->
- **複数画像送信**: 個別の IMAGE メッセージとグルーピング表示<!--ja-->
- **サーバーモード**: Docker Compose とセルフホスト運用の改善<!--ja-->
- **軽量化**: メモリ、CPU、通信量を計測し、公式クライアント以下を目標に改善<!--ja-->
<!--ja-->
### Vyline Desktop — Coming Soon<!--ja-->
<!--ja-->
安定版の公開後、専用デスクトップアプリ **Vyline Desktop** をリリース予定です。<!--ja-->
<!--ja-->
- Windows / macOS / Linux 対応<!--ja-->
- ネイティブ通知とクイック返信<!--ja-->
- トレイアイコン常駐<!--ja-->
- ローカルデータの完全管理<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## コントリビューション<!--ja-->
<!--ja-->
バグ修正、機能改善、ドキュメント、デザインへの貢献を歓迎します。<!--ja-->
<!--ja-->
- [バグを報告する](.github/ISSUE_TEMPLATE/bug_report.md)<!--ja-->
- [機能を提案する](.github/ISSUE_TEMPLATE/feature_request.md)<!--ja-->
- [Pull Request を作成する](.github/pull_request_template.md)<!--ja-->
<!--ja-->
参加前に [コントリビューションガイド](docs/CONTRIBUTING.md) を確認してください。Pull Request に解析対象ソフトウェア、セッション、鍵、トークンなどの機密情報を含めないでください。<!--ja-->
<!--ja-->
### エージェント / Skill 方針<!--ja-->
<!--ja-->
開発では必要に応じて Ponytail、Caveman、agent-skills-standard、addyosmani agent-skills、Minimize-Cursor-Cost などの coding-agent 用 Skill を利用します。不要なコードと過剰設計を避け、レビュー品質を保つことが目的です。<!--ja-->
<!--ja-->
優先順位は次のとおりです。<!--ja-->
<!--ja-->
1. セキュリティ<!--ja-->
2. プライバシー<!--ja-->
3. データ保護<!--ja-->
4. 既存機能との互換性<!--ja-->
5. 実装量・トークン・コストの削減<!--ja-->
<!--ja-->
効率化よりも正確性と安全性を優先します。詳細は [AGENTS.md](AGENTS.md) を参照してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
## ライセンスと著作権<!--ja-->
<!--ja-->
Vyline は [MIT License](LICENSE) のもとで公開されています。<!--ja-->
<!--ja-->
Copyright © [nezumi0627](https://github.com/nezumi0627)<!--ja-->
<!--ja-->
改変や再配布を行う場合は、`LICENSE` に記載された著作権表示とライセンス表示を保持してください。<!--ja-->
<!--ja-->
---<!--ja-->
<!--ja-->
<p align="center"><!--ja-->
  <strong>Vision Beyond Limits.</strong><br/><!--ja-->
  Built with care by <a href="https://github.com/nezumi0627">nezumi0627</a> and contributors.<!--ja-->
</p><!--ja-->
<!--ja-->
[日本語](README.md)<!--en-->

<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. --><!--en-->
<!-- Language: en --><!--en-->
<!--en-->
[日本語](README.md)<!--en-->
<!--en-->
+# Vyline<!--en-->
<!--en-->
<p align="center"><!--en-->
  <strong>Vision Beyond Limits.</strong><br/><!--en-->
  An extensible LINE third-party client powered by its own protocol stack<!--en-->
</p><!--en-->
<!--en-->
> [!CAUTION]<!--en-->
> Vyline is an unofficial and unauthorised LINE third-party client. It is not affiliated with LINE Corporation or LY Corporation. Use it at your own risk after understanding the risks, including possible terms-of-service violations and account suspension.<!--en-->
<!--en-->
> [!NOTE]<!--en-->
> Vyline is currently Beta 0.7.0. Beta software may introduce breaking changes, bugs, or data loss.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## What is Vyline?<!--en-->
<!--en-->
**Vyline** is a Web/React-based LINE client with messaging, Flex/Rich rendering, theme customisation, backups, and more.<!--en-->
<!--en-->
It communicates with LINE servers through the independently implemented **@vyline/protocol** package without relying on an external relay service.<!--en-->
<!--en-->
| Item | Details |<!--en-->
| --- | --- |<!--en-->
| Audience | Custom UI users, developers, and self-hosters |<!--en-->
| Highlights | Own protocol stack, VyTheme, public API, local-first data |<!--en-->
| Technology | React + Vite / Hono on Bun / TypeScript / Thrift |<!--en-->
| Status | Beta 0.7.0 |<!--en-->
| License | MIT |<!--en-->
<!--en-->
## Features<!--en-->
<!--en-->
| Category | Details |<!--en-->
| --- | --- |<!--en-->
| Login | QR/email login, multiple accounts, and session restore |<!--en-->
| Messaging | Send/receive, replies, unsend, read controls, and resend |<!--en-->
| Mentions | @ALL / @name with LINE Desktop-compatible metadata |<!--en-->
| Media | Images, video, audio, LINE emoji, and stickers |<!--en-->
| Flex / Rich | Rendering compatible with official formats and carousel mouse dragging |<!--en-->
| Reactions | One-click reactions, official badges, and read-member lists |<!--en-->
| Chat management | Pin, hide, mute, block, MID copy, group creation, and invitations |<!--en-->
| VyTheme | Themes, font size, density, and profile background customisation |<!--en-->
| E2EE | Letter Sealing decrypt/send and LINE Desktop key import |<!--en-->
| Privacy | Streamer mode and PIN lock |<!--en-->
| Plugins | ZIP installation, permissions, and ES Module extensions |<!--en-->
| Search | Cross-chat search over local message history |<!--en-->
| VylineBackup | Snapshot, restore, and delete chat history and media |<!--en-->
| Developer tools | Bearer-token public API, OpenAPI 3.1, and JSONL diagnostics |<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Important notes before use<!--en-->
<!--en-->
- Account use may be restricted or suspended if it violates LINE terms.<!--en-->
- Terms and disclaimers must be accepted before sync, network communication, or message display starts.<!--en-->
- Intended use is education, learning, research, and personal use. Do not use Vyline for unauthorised access, attacks, harassment, or infringement.<!--en-->
- Login information, sessions, keys, and chat history stay in your local or self-hosted environment.<!--en-->
- The developers and contributors provide no warranty for account suspension, data loss, corruption, or legal issues.<!--en-->
- The tools submodule is for education and research only. See docs/tools/DISCLAIMER.md.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Installation and updates<!--en-->
<!--en-->
### Development setup with Bun<!--en-->
<!--en-->
    git clone https://github.com/nezumi0627/Vyline.git<!--en-->
    cd Vyline<!--en-->
    cp .env.example .env<!--en-->
    bun install<!--en-->
    bun run typecheck<!--en-->
    bun run dev<!--en-->
<!--en-->
Open http://localhost:5173 in your browser. The backend listens on http://localhost:3001.<!--en-->
<!--en-->
| Command | Description |<!--en-->
| --- | --- |<!--en-->
| bun run dev | Start backend and frontend together |<!--en-->
| bun run dev:backend | Start only the backend |<!--en-->
| bun run dev:frontend | Start only the frontend |<!--en-->
| bun run typecheck | Type-check all workspaces |<!--en-->
| bun run lint | Run Biome |<!--en-->
| bun run build | Build the frontend |<!--en-->
<!--en-->
See docs/onboarding.md and docs/development.md for details.<!--en-->
<!--en-->
### Docker<!--en-->
<!--en-->
    git clone https://github.com/nezumi0627/Vyline.git<!--en-->
    cd Vyline<!--en-->
    docker compose up -d --build<!--en-->
<!--en-->
Open http://localhost:3000. Data is persisted in ./data/; do not delete it because it contains sessions and keys.<!--en-->
<!--en-->
### Linux standalone build<!--en-->
<!--en-->
    tar -xzf Vyline-linux-x64-<version>.tar.gz<!--en-->
    cd Vyline-linux-x64-<version><!--en-->
    ./install.sh<!--en-->
    ~/.local/bin/vyline<!--en-->
<!--en-->
For self-hosting and Cloudflare Access, see docs/selfhosting.md.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Architecture<!--en-->
<!--en-->
    Frontend (React + Vite) -> Backend (Hono on Bun)<!--en-->
    Backend -> Vyline Protocol (Domain / Dictionary / E2EE / Thrift)<!--en-->
    Vyline Protocol -> LINE Servers<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Public API<!--en-->
<!--en-->
The public API is available under /v1/. OpenAPI is served at /openapi.json, with interactive documentation at /docs and /swagger.<!--en-->
<!--en-->
Set VYLINE_API_ADMIN_SECRET to create and manage Bearer tokens. See docs/api/openapi.md.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## E2EE and LINE Desktop keys<!--en-->
<!--en-->
To decrypt historical Letter Sealing messages, extract your own key set from the official LINE Desktop client and place it at backend/data/desktop-e2ee-keys.json. The backend imports it at startup.<!--en-->
<!--en-->
> [!CAUTION]<!--en-->
> This file contains sensitive information. Never commit, share, or log it.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Versioning<!--en-->
<!--en-->
Vyline follows semantic versioning (X.Y.Z, or X.Y.Z-beta during beta). Release tags use v<version>.<!--en-->
<!--en-->
Use the version bump script to update all version locations and regenerate the README variants:<!--en-->
<!--en-->
    bun run bump -- 0.7.0<!--en-->
    bun run docs:readme<!--en-->
    bun run docs:readme:check<!--en-->
<!--en-->
Edit README.src.md, not README.md or README.en.md. Japanese is the default README language; English is available as README.en.md.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Documentation<!--en-->
<!--en-->
| Document | Description |<!--en-->
| --- | --- |<!--en-->
| docs/README.md | Documentation index |<!--en-->
| docs/onboarding.md | First-time setup |<!--en-->
| docs/development.md | Development environment and commands |<!--en-->
| docs/architecture.md | Architecture |<!--en-->
| docs/selfhosting.md | Docker and Cloudflare Access |<!--en-->
| docs/api/openapi.md | OpenAPI and public API |<!--en-->
| docs/CONTRIBUTING.md | Contribution guide |<!--en-->
| AGENTS.md | Coding-agent instructions |<!--en-->
| CHANGELOG.md | Changelog |<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Roadmap<!--en-->
<!--en-->
- Stabilise /v1/, /openapi.json, /docs, and /swagger.<!--en-->
- JavaScript/TypeScript plugins with permission scopes and typed public APIs.<!--en-->
- Custom frontends, bots, and external integrations.<!--en-->
- Per-account authentication, data, and media isolation.<!--en-->
- Better storage management and backup restore.<!--en-->
- Multiple image sending and grouped display.<!--en-->
- Improved Docker Compose and self-hosting.<!--en-->
- Measure memory, CPU, and network usage.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## Contributing<!--en-->
<!--en-->
Bug fixes, features, documentation, and design contributions are welcome. See docs/CONTRIBUTING.md. Do not include sessions, keys, tokens, or analysis data in issues or pull requests.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
## License<!--en-->
<!--en-->
Vyline is released under the MIT License.<!--en-->
<!--en-->
Copyright © nezumi0627<!--en-->
<!--en-->
<p align="center"><!--en-->
  <strong>Vision Beyond Limits.</strong><br/><!--en-->
  Built with care by nezumi0627 and contributors.<!--en-->
</p><!--en-->
<!--en-->
