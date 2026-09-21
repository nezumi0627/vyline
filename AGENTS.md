# AGENTS.md — Vyline エージェント向けガイド

最終更新: 2026-08-30

このファイルは AI エージェントが Vyline プロジェクトを理解しタスクを実行するための包括的なガイドです。

---

## プロジェクト概要

**Vyline** は LINE のサードパーティクライアントです。Bun + Hono + React で構築され、自前の LINE プロトコルスタック (`@vyline/protocol`) を持ちます。

- **目標**: LINE にログインし、メッセージの送受信・Flex/Rich 表示・テーマカスタマイズを行う
- **ライセンス**: MIT
- **ステータス**: Phase 0-3 完了。Beta 向けの UI・品質・配布準備とオープンチャット統合を継続中
- **外部依存**: `@evex/linejs` なし。Thrift 型は `@vyline/line-types`（vendored）

---

## 最初に読む順番

この repository は README、docs、submodule、workspace が多い。迷った場合は次の順番で読む。

1. `AGENTS.md`（このファイル）
2. `docs/README.md`
3. `docs/onboarding.md`
4. `docs/architecture.md`
5. 対象機能に一番近い docs
6. 実コード

README はユーザー向け入口。実装判断の正本にしない。

### AI が手間取りやすい点

- `Vyline/packages/protocol`、`Vyline/packages/plugin`、`Vyline/packages/themes`、`tools` は submodule/workspace の境界が見えにくい。まず `bun run vyl:doctor` で状態を確認する。
- docs整理では既存docsをテンプレートへ機械的に当て直さない。新規docsや大改修だけ `docs/templates/` を使い、既存docsは必要箇所だけ直す。
- README の正本は日本語が `README.src.md`、英語が `README.en.src.md`。`README.md` / `README.en.md` は生成物なので、原則として直接編集しない。README変更は両方の source に同じ内容を反映し、`bun run docs:readme` で生成して差分を確認する。
- README は元の構成を守る。新導線を入れる場合も、該当セクションへの追記に留める。
- 日本語と英語の README は情報量を揃える。機能、注意事項、パートナー、References、導入手順などを片方だけに追加しない。生成後は `README.md` と `README.en.md` の見出し・主要項目に欠落がないか確認する。
- `vyl doctor` / `vyl init` は軽い入口にする。npm publish、Docker build、Trivy container scan、full security scan は通常CLIに入れない。
- 重い処理は GitHub Actions の manual workflow、release workflow、schedule に寄せる。PRでは軽量チェックを優先する。

---

## 参照元・検索ツール

### 検索ツール: RPC_DICTIONARY

**`Vyline/packages/protocol/src/dictionary/rpcMap.ts`** — LINE.js 名 → Desktop 証拠 → Vyline 実装の対応表。

```ts
// 機能の実装場所を調べる:
// 1. rpcMap.ts で linejsName を検索
// 2. desktopEvidence で Desktop 内の実体を確認
// 3. stackApi → domainApi → backendApi の順に追跡
```

### 参考: @evex/linejs

`@evex/linejs` のメソッド名・構造パターンを参考にしていますが、依存はしていません。
RPC_DICTIONARY の `linejsName` フィールドが linejs との対応を示します。

### Desktop 解析ツール (Vyline-Search)

- `bun run vyline:check` — インストール版 / 実行中版 / 最新版の比較 (`--json`)
- `bun run vyline:latest` — Desktop 最新版バージョンの取得
- `bun run vyline:update [-- --unpack]` — LINE Desktop を最新版へ更新 (必要なら unpack も一括)
- `bun run vyline:versions` — インストール済みバージョン一覧 (`--json` 可)
- `bun run vyline:unpack` — Themida 保護された LINE.exe の unpack（LINE 稼働中は Frida 注入拒否されるため停止して実行）。`--version <ver>` でインストール済み過去版を明示選択可
- `bun run vyline:find-native -- <name>` — Desktop LINE.exe 内シンボル検索 (unpack → string scan → Ghidra)
- `bun run vyline:focus-recovered` — 逆コンパイル結果のキーワード分類
- `tools/` — スタンドアロンツール (Git Submodule として [vyline-search](https://github.com/nezumi0627/vyline-search) リポジトリをリンク)
- `Vyline/packages/plugin` — plugin-sdk + examples ([vyline-plugin](https://github.com/nezumi0627/vyline-plugin) を Submodule リンク)
- `Vyline/packages/themes` — VyTheme プリセット ([vyline-theme](https://github.com/nezumi0627/vyline-theme) を Submodule リンク)
- `source/desktop/` — 解析データ (gitignore)
- `docs/tools/` — ツール使用ガイド

---

## 現在のステータス

詳細ボード: **[docs/tasks/STATUS.md](docs/tasks/STATUS.md)** / 受け入れ条件: **[docs/tasks/PHASES.md](docs/tasks/PHASES.md)**

| Phase | 内容                                  | 状態        |
| ----- | ------------------------------------- | ----------- |
| 0     | Kickoff（docs）                       | done        |
| 1     | E2EE decrypt / send                   | done        |
| 2     | Docs / AGENTS / tasks                 | done        |
| 3     | Vyline + Desktop import + update-diff | done        |
| 4     | Telegram-like UI                      | in progress |
| 5     | Quality / perf                        | in progress |
| 6     | Beta 公開準備                         | in progress |

### 最近の主な変更 (2026-08-27)

- **Vyline Setup / アカウント設定**: 初回 3 ステップ設定、MID ごとの設定スキーマ、原子的 JSON 保存、進捗の復元を追加
- **引継ぎ / 診断**: 設定のみを含む SHA-256 検証 ZIP の import/export、サニタイズ済み診断ログの確認・出力・削除、GitHub Issue 作成導線を追加
- **セッション保護**: Windows のトークンを DPAPI(CurrentUser) で保護。サブデバイスをブラウザごとのランダムなインストール ID に結び付け、端末固有情報を保存しない
- **同期と表示**: 既読反映・未読位置・仮想リストのスクロールを安定化。アカウント切替時に前アカウントの UI 状態を残さない
- **遠隔利用**: LAN 公開を既定で無効にし、Tailscale の検出と URL 表示を追加

### 最近の主な変更 (2026-08-18)

- **リブランディング**: `@vyline/nezuline` → `@vyline/protocol`、`Nezu*` → `Vyline*`。旧 `nezu-*.json` / `nezuline` データディレクトリからの自動移行
- **VylineBackup**: 設定 > VylineBackup からトーク履歴・メディアのスナップショットを作成/復元/削除（`data/backups/`）。復元は「すべて / チャット選択」「メディア含む / テキストのみ」を選択可
- **チャット詳細ログ**: 送受信・アナウンス（CHATEVENT）をタイミング付き JSONL で記録（`data/logs/`）。画像・動画・音声・ファイル・スタンプのメディア情報も記録。設定 > 詳細・復元 > デバッグログで閲覧
- **高画質送信**: 表示タブに「高画質で画像送信」トグル（圧縮せず元画質で送信）
- **useVirtualList**: 実測高さ変更時にオフセットを再計算するよう修正
- **ブロックリスト**: キャッシュ + background キュー + 8s タイムアウトで 504 回避

### 最近の主な変更 (2026-08-17)

- **メンション**: `@ALL` / `@名前` 送受信（`contentMetadata.MENTION` の `MENTIONEES` 形式、Desktop 準拠）。入力時 `@` で候補ピッカー、表示はハイライト + アイコン
- **LINE 絵文字**: チャット一覧・返信引用で `￼` プレースホルダが表示される問題を修正
- **Flex**: カルーセルのマウスドラッグ、wrap テキストのクリップ修正
- **画像送信**: クライアント側で 2048px JPEG 圧縮。E2EE 鍵整備のキャッシュ化 + メディア送信 90s タイムアウト。`isMissingGroupKeyError` の判定追加
- **画像表示**: 自送信 E2EE メディアを `contentMetadata.keyMaterial` で直接復号する高速パス（履歴 RPC を飛ばす）
- **設定**: 詳細・復元に「設定を初期化」（ログイン状態・履歴は保持）

### 過去の変更 (2026-07-31)

- プロフィール/メンバー表示: API タイムアウト追加、MID短縮表示、空配列上書き防止、キャッシュ汚染防止
- グループ作成: 禁止解除オプション追加 (自己責任)
- チャット同期: 手動同期ボタン追加、visibility change 時自動差分同期
- E2EE/メディア: グループ鍵不在時 E2EE スキップ、重複呼び出し抑止、USER chat 誤呼び出し防止
- スタンプ表示: プロキシURL判別修正
- 招待: u* MID 検証・フィルタリング
- スタンプ/絵文字: 複数レスポンス形式対応

解析メモ索引: **[docs/analysis/README.md](docs/analysis/README.md)**  
新規参入: **[docs/onboarding.md](docs/onboarding.md)** / 索引: **[docs/README.md](docs/README.md)**

---

## Skill 方針（必須）

大規模タスク（監査・リファクタ・API設計・plugin実装・docs整理）の前に、以下の skill を確認し使用する。

| Skill | 用途 |
|---|---|
| `ponytail` / `ponytail-*` | YAGNI・最小実装・再利用優先（既定の思考モード） |
| `caveman` / `caveman-compress` | 報告の圧縮のみ（コード/OpenAPI/YAML/docs本文には適用しない） |
| `agent-skills-standard` 系 | 必要なときだけ必要な skill を階層ロード（一括読込禁止） |
| `api-and-interface-design` など addyosmani/agent-skills 系 | 本番級レビュー・perf・API 設計（必要時のみ） |
| `minimize-cursor-cost` (~/.agents/skills) | 再読込禁止・並列ツール呼び出し・無駄検証禁止 |

優先順位: ユーザー指示 > セキュリティ > プライバシー > データ保護 > 既存機能互換 > 実リポジトリ挙動 > テスト結果 > Ponytail > 各skill推奨 > トークン削減。

大型タスク開始時は最初の報告に Skill Bootstrap 表を含めること。
## 開発哲学 (最重要)

**最大反復速度 (Maximum Iteration Speed)** を最優先とする。

- 編集 → 即反映 → 即検証 のサイクルを最短にする
- compile 待ちを排除する (Go / Java は使わない)
- AI 生成コードが即検証できる構成にする
- overengineering 禁止・unnecessary abstraction 禁止
- fast iteration first、modular architecture

---

## 技術スタック

| レイヤー          | 技術                                           | 理由                                       |
| ----------------- | ---------------------------------------------- | ------------------------------------------ |
| Runtime           | **Bun**                                        | 超高速起動・TypeScript 直接実行・Node 互換 |
| Backend Framework | **Hono**                                       | 軽量・高速・構造がシンプル                 |
| LINE Backend      | **@vyline/protocol** (stack + Desktop patches) | 自前プロトコル・外部 linejs 依存なし       |
| Frontend          | **React + Vite**                               | HMR 最速クラス                             |
| 言語              | **TypeScript**                                 | AI 生成との相性最高                        |
| State 管理        | **Zustand**                                    | 軽量・高速                                 |
| UI                | **Tailwind + shadcn/ui**                       | 高速 UI 構築                               |
| Mobile            | **Capacitor** (後で追加)                       | iOS / iPad 対応                            |
| Plugin            | **ES Modules**                                 | 動的ロード可能                             |
| Theme             | **CSS Variables**                              | 完全テーマ化                               |
| Storage           | **SQLite / JSON**                              | 軽量                                       |
| Logging           | **pino**                                       | 高速                                       |

### 避けるもの

- Go rebuild cycles
- Java / Kotlin Gradle 待ち
- 重い codegen
- Wails / Electron (compile-heavy)

---

## アーキテクチャ (最新)

```
┌─ Frontend (React + Vite) ─────────────────────────────┐
│  apps/desktop/src/                                      │
│  ├── lib/store.ts        Zustand persist ストア (正本)   │
│  ├── lib/mappers.ts      LINE API型 → UI型              │
│  ├── api/client.ts       backend BFF HTTP client        │
│  ├── hooks/useVylineSync.ts  同期・ポーリング            │
│  └── components/         UI コンポーネント               │
├─ Backend (Hono on Bun) ────────────────────────────────┤
│  backend/src/                                           │
│  ├── api/line.ts         BFF routes (入出力のみ)         │
│  ├── service/lineService.ts  ビジネスロジック (正本)     │
│  ├── line/clientManager.ts   セッション管理              │
│  └── storage/            VylineCache, featureLocks, CDN   │
├─ Vyline Protocol ────────────────────────────────────┤
│  packages/protocol/                                     │
│  ├── src/domain/         VylineSession facade           │
│  ├── src/dictionary/     RPC_DICTIONARY (検索ツール)     │
│  ├── src/login/          E2EE, 鍵管理, Desktop patches  │
│  └── stack/              Thrift RPC (/S4, /api/v3p/rs)  │
└─ LINE Servers ─────────────────────────────────────────┘
```

### 主要ファイル一覧

| ファイル                                     | 役割                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `backend/src/service/lineService.ts`         | 全ビジネスロジック。メッセージ送受信、E2EE、メディア、スタンプ、プロフィール |
| `apps/desktop/src/lib/store.ts`              | Zustand ストア。`hydrateLineData`, `pollIncoming`, `pollMessagesDelta`       |
| `apps/desktop/src/lib/mappers.ts`            | `mapChat`, `mapMessage`, `mapMember`, `looksLikeMid`                         |
| `apps/desktop/src/api/client.ts`             | backend HTTP client                                                          |
| `packages/protocol/src/dictionary/rpcMap.ts` | RPC_DICTIONARY (検索ツール)                                                  |
| `packages/protocol/stack/base/e2ee/mod.ts`   | E2EE 復号エンジン                                                            |
| `backend/src/storage/vylineCache.ts`         | プロフィール/グループキャッシュ                                              |
| `backend/src/storage/featureLocks.ts`        | 操作ロック管理                                                               |
| `backend/src/storage/messageLog.ts`          | チャット詳細ログ（JSONL、`data/logs/`）                                      |
| `backend/src/service/backupService.ts`       | VylineBackup スナップショット作成/復元（`data/backups/`）                    |

### 重要定数

| 定数                            | デフォルト | 場所           |
| ------------------------------- | ---------- | -------------- |
| `CONTACT_RPC_TIMEOUT_MS`        | 8_000      | lineService.ts |
| `CONTACT_BATCH_CHUNK`           | 4          | lineService.ts |
| `CONTACT_INDIVIDUAL_TIMEOUT_MS` | 2_500      | lineService.ts |
| `MY_PROFILE_RPC_TIMEOUT_MS`     | 10_000     | lineService.ts |
| `DELTA_POLL_MIN_MS`             | 45_000     | store.ts       |
| `MAX_MESSAGES_PER_CHAT`         | 120        | store.ts       |

### 共通パターン

**E2EE グループ鍵の重複抑制:**

```ts
// groupKeyWarm / groupKeyWarmFailed / groupKeyWarmInflight で三重抑制
const groupKeyWarmInflight = new Map<string, Promise<void>>();
// ensureGroupE2EEKey 内: inflight があればそれを返す
```

**メディアダウンロードのフォールバック:**

```
groupKeyMissing? → E2EE skip → OBS plain
E2EE decrypt → fail → OBS plain → fail
  → (gk && e2eeFailed) → clear keys → retry
```

**メンバー名解決とキャッシュ汚染防止:**

```
fetchChatMemberMids → fetchContactsBatch → individual fallback
→ 全失敗時はMIDのまま → vylinePutGroup で skip (allUnresolved)
→ vylineGroupNeedsRefresh がMIDキャッシュを検出して再取得
```

---

## 開発コマンド

```powershell
# 開発サーバー (backend :3001 + frontend :5173)
bun run dev

# 単体起動
bun run dev:backend   # backend のみ
bun run dev:frontend  # frontend のみ

# 型チェック/lint/テスト
bun run typecheck
bun run lint
bun test

# Vyline 特化
cd Vyline/packages/protocol
bun run delta          # Desktop 差分調査
bun run stack:types    # Thrift 型ビルド
bun run vyline:find-native -- <name>  # Desktop シンボル検索
bun run vyline:check   # Desktop バージョン確認（root 直下でも可）
bun run vyline:versions  # インストール済みバージョン一覧（root 直下でも可）
bun run vyline:update  # Desktop を最新版へ更新（root 直下でも可）
```

## バージョン管理（重要）

バージョンは **4 箇所を同一に揃える必須**：

| 場所                                   | フィールド             |
| -------------------------------------- | ---------------------- |
| `Vyline/apps/desktop/src/lib/store.ts` | `UPDATE_NOTES.version` |
| ルート `package.json`                  | `version`              |
| `Vyline/apps/desktop/package.json`     | `version`              |
| `README.md`                            | バッジの `version-...` |

- バージョン形式: セマンティックバージョン（`X.Y.Z` または `X.Y.Z-beta`）
- beta は非公開テスト段階。public リリース前に外す
- リリース時は Git タグ **`v<version>`**（例: `v0.6.0-beta`）を作成する。タグ = 4 箇所のバージョン + CHANGELOG エントリが揃ったコミットを指す
- 破壊的変更 → major、機能追加 → minor、修正のみ → patch。Beta 期間中は `-beta` 接尾辞を維持

### 自動 bump（AI・人間共通の手順）

```powershell
bun run bump -- 0.7.0        # 指定バージョンへ一括更新（4 箇所 + UPDATE_NOTES.title のバージョン部分）
bun run bump -- minor        # 相対指定も可 (major / minor / patch)
bun run bump -- 0.7.0 --tag  # git tag v0.7.0 まで自動作成
```

スクリプト (`scripts/bump-version.ts`) が機械的な置換を行う。エージェントがバージョンを上げるときは手動編集ではなくこのスクリプトを使い、残りを仕上げる:

1. `UPDATE_NOTES.items` を今回の変更内容に書き換え（ユーザーが起動時に確認する内容・古い内容は削除）
2. `CHANGELOG.md` に同バージョンのエントリを追加（Unreleased を統合）
3. README 冒頭 NOTE の「現在のバージョン」と「状態」行を目視確認
4. リリース時は `docs/distribution.md` のリリースチェックリストに従う

---

## 秘密情報

- `desktop-e2ee-keys.json` / tokens / session / `Vyline/backend/data/` は **gitignore・コミット禁止**
- PR・チャット・docs に鍵・トークン実値を貼らない

## Pull Request ルール（AI・人間共通）

**機能・改善・バグ修正などの変更を PR で出す場合は、必ず新しいブランチを切ってから PR を開き、承認後にマージする。**

### 推奨: 1 task = 1 branch = 1 git worktree

複数のAIエージェント・人間・IDEが並行してVylineを触る場合、repository全体のコピーではなく **タスクごとに独立した Git worktree** を使う。

- 標準作業領域: `E:\projects\Vyline-worktrees\<task-name>`
- `.codex-worktrees` のような特定エージェント専用名は新規利用しない
- 本体 `E:\projects\Vyline` を複数タスクの共有編集場所にしない
- 他worktreeのdirty差分・未追跡ファイルは触らない
- 作業完了後はPRをmergeしてから `git worktree remove` で片付ける
- 詳細手順: `docs/development-worktrees.md`

- `main` は Branch Protection Rules により保護されており、直接 push はブロックされる（`Cannot update this protected ref.`）
- フローは次のとおり:

```
1. origin/main から作業branch + worktreeを作る
   git fetch origin
   git worktree add -b feature/<名前> E:\projects\Vyline-worktrees\<名前> origin/main
2. worktree内で変更をコミットしてbranchにpush
   git push -u origin feature/<名前>
3. GitHub で PR を作成（base: main ← head: feature/<名前>）
4. レビュー・承認後にマージし、worktreeを削除する
```

- 小さな修正（1 コミットのドキュメント更新など）でも、main への直接 push はせずブランチ経由にする
- PR の説明には変更内容とテスト確認結果を書く
- マージ後に作業ブランチは削除し、main を pull して最新に保つ

## 報告プロトコル

- 連絡先への無断メッセージ送信禁止
- エージェントは明示的指示がない限り LINE 送信ツールを使わない

## テスト環境（必須）

**送信テストは次の 2 箇所のみ。** 実グループ・実友だちには送信しないこと（過去にテスト送信で問題が起きた）。

- グループ **「うがうがうー」**: `c1efe9d6cf1848350bc91848a8a29963e`
- **ねずBOT**（公式アカウント・自分所有）: `u81c530b68cc2efdd36911d214bd5f084`

メンション・画像・スタンプなど送信系の確認は必ず上記で行う。受信のみの表示確認（出前館の Flex など）は制限なし。

---

## ドキュメント索引

| ドキュメント                                                                                    | 内容                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [docs/README.md](docs/README.md)                                                                | 全体索引                                 |
| [docs/onboarding.md](docs/onboarding.md)                                                        | 初日チェックリスト                       |
| [docs/architecture.md](docs/architecture.md)                                                    | 層構造・データフロー                     |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)                                                    | 機能追加フロー (辞書→Desktop→domain→BFF) |
| [docs/development.md](docs/development.md)                                                      | 開発コマンド・環境変数                   |
| [docs/protocol/dictionary.md](docs/protocol/dictionary.md)                                      | RPC 辞書・Desktop 検証表                 |
| [docs/tools/find-native-symbol.md](docs/tools/find-native-symbol.md)                            | Desktop 内シンボル検索                   |
| [packages/protocol/src/dictionary/rpcMap.ts](Vyline/packages/protocol/src/dictionary/rpcMap.ts) | RPC_DICTIONARY (検索ツール)              |
| [packages/protocol/README.md](Vyline/packages/protocol/README.md)                               | Vyline パッケージ                        |
| [docs/analysis/README.md](docs/analysis/README.md)                                              | 機能別解析メモ索引                       |

## 編集哲学

- **最大反復速度優先**: 編集→即反映→即検証。overengineering 禁止
- **編集範囲**: `Vyline/` 以下のみ
- **BFF 層**: HTTP 入出力のみ → `service/lineService.ts` に委譲
- **コード正本**: `backend/src/service/lineService.ts` と `apps/desktop/src/lib/store.ts`
- **新機能追加**: CONTRIBUTING.md のフローに従う (辞書→Desktop→domain→BFF)
