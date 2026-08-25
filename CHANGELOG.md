# Changelog

## [0.6.1-beta] — 2026-08-24 — 重大な型チェック再帰バグ修正

### 修正

- **重大修正** — `typecheck` 実行時に Bun の Windows shim が同じ typecheck コマンドを再帰起動し、Bun プロセスが大量増殖する問題を修正
- protocol / backend / desktop / ios-backup の TypeScript 起動を Bun shim から Node に変更し、再帰起動経路を排除

## [0.5.1-beta] — 2026-08-21 — メッセージ編集UI + プッシュ通知切替 + PIN/パスワードデュアルモード

### 新機能

- **メッセージ編集 UI**: 編集メニュー（コンテキストメニュー）、編集ダイアログ、編集済みバッジ表示、編集前テキストの表示切替
  - 編集時は楽観的にローカルメッセージを更新し、API失敗時に自動ロールバック
  - LYPプレミアム会員以外の編集は `NOT_PREMIUM` エラー、編集可能時間経過は `TOO_OLD` エラーとしてユーザーに通知
- **ミュート送信（NOTIFICATION_DISABLED）**: 送信時に通知を抑制するトグルボタンを追加
- **モバイルプッシュ通知切替**: セカンダリデバイスからのLINEプッシュ通知の有効/無効を設定画面で切替可能
  - `setNotificationsEnabled` (TalkService_setNotificationsEnabled, type=USER) を実装
  - fetchOpsポーリングによりイベント確認済みとみなされるため、明示的に呼ぶ必要がある
- **パスコードロックのデュアルモード**: PIN（数字4〜8桁）に加えてパスワード（自由な文字列）を選択可能
  - ロック画面はモード切替：PINはテンキー＋固定長ドット、パスワードはテキスト入力
  - 設定画面でモード切替とパスコード再設定が可能

### 改善

- 編集メッセージの前後テキストを保持し、編集前の表示を切り替え可能 (`showOriginal`)
- Toggleコンポーネントに `disabled` プロパティを追加
- `updateSetting("pin", ...)` 時に `privacyStore.pinHash` を同期するよう修正
- `privacyStore` の `setPin` / `unlock` が数字のみに制限していた問題を撤廃

---

## [0.5.0-beta] — 2026-08-20 — fetchOps 刷新 + 公開 API

### 破壊的変更

- 受信エンジンを Legy H2 Push から **fetchOps（TalkService sync RPC）方式**に刷新。全操作タイプ（メッセージ・通話・メンバー変更・既読・リアクション・アナウンス等）をリビジョンカーソルで確実に捕捉する。v0.4.x のフロントエンドとは互換しません。
- `VYLINE_TALK_LISTEN=0` の動作が変わります（旧: push起動抑制 → 新: fetchOpsループ抑制）

### 新機能

- **公開 REST API (`/v1/`)**: Bearer token 認証によるチャット一覧・メッセージ取得・送信・イベントポーリングを外部から操作可能に。`VYLINE_API_ADMIN_SECRET` 環境変数でトークン管理
- **OpenAPI 3.1 仕様** を `/openapi.json` で公開。[zensical.org](https://zensical.org) でも参照可
- **通話・メンバー変更イベント** をイベントバッファに追加（call:incoming, call:end, call:cancel, membership, chat:update, announce）
- **Vyline Desktop** カミングスーン告知

### 改善

- fetchOps 方式によりネットワーク障害からの自動回復が向上
- リビジョンカーソルによりイベントの取りこぼしを防止
- 環境変数 `VYLINE_OPS_POLL_MS` / `VYLINE_OPS_IDLE_MS` で受信間隔を調整可能

---

## [0.6.0-beta] — 2026-08-23 — Backup & ログ & セルフホスト

### 新機能

- **VylineBackup** — トーク履歴・メディアのスナップショットをサーバーに保存（`data/backups/`）。設定 > VylineBackup から作成・復元・削除。復元は「すべて / チャット選択」「メディア含む / テキストのみ」を選択可能（バックアップは [selfhosting.md](docs/selfhosting.md) の `data/` ボリュームに永続化）
- **チャット詳細ログ** — チャット内容・アナウンス（CHATEVENT）をタイミング付き JSONL で記録（`data/logs/message-log-<account>.jsonl`）。画像・動画・音声・ファイル・スタンプのメディア情報も記録。設定 > 詳細・復元 > デバッグログで閲覧
- **セルフホスト対応（Docker）** — バックエンドが本番フロントビルドを同一オリジンで配信。`docker compose up -d --build` のワンコマンドで自宅サーバーに Vyline を構築可能（[docs/selfhosting.md](docs/selfhosting.md)）
- **メディアのサーバー側キャッシュ** — 画像・動画を `data/media-cache/` に永続化。端末を変えても過去の画像が残る
- **環境変数の拡充** — `VYLINE_HOST` / `VYLINE_CORS_ORIGIN` / `VYLINE_STATIC_DIR` / `VYLINE_MEDIA_CACHE_DIR` / `VYLINE_CDN_CACHE_DIR`。Docker ボリュームで全データを永続化
- **アンケート / あみだくじ / イベント作成の自動化** — 作成後に Flex メッセージを自動送信（投票・結果共有・スケジュール共有ボタン付き）
- **ブロック表示** — ブロック済み連絡先をチャット一覧に赤丸バッジで表示
- **複数画像の同時送信** — 複数画像を選択して個別の IMAGE メッセージとして送信し、チャット内でグルーピング表示。コンボスタンプ（複数スタンプ連投）にも対応
- **FILE メッセージ描画** — ファイル添付メッセージの表示に対応（未知の content type は安全にガード）
- **Keepメモ** — 自分自身のトーク（`mid === myMid`）を `isSelf` フラグで判定し「Keepメモ」と表示。公式アイコン（IconMemo）を使用し、プロフィール詳細の自動取得・共通グループ・ブロック操作をスキップ
- **プロフィール背景の表示** — 相手のプロフィール背景（VOOM home API から取得）をトーク背景に表示。プロフィール描画時にチャットの `backgroundUrl` もストアへ伝搬
- **グループ通話状態** — グループヘッダーに「通話中」バッジを 15 秒ポーリングで表示（`GET /call/group-status`）
- **共通グループの高速化** — プロフィール・メンバー描画時に VylineCache 一括読みで共通グループを取得（RPC なし）
- **リアクションキャッシュ** — リアクション取得をキャッシュしてメッセージ一覧の再描画を高速化
- **送信取り消しエラー表示** — 可能時間超過（`MESSAGE_NOT_DESTRUCTIBLE` / message too old）を専用通知「取り消し失敗(送信取り消し可能な時間を過ぎています)」で表示
- **利用規約・免責同意ゲート** — ログイン直後に ToS 同意画面を表示し、同意しない限り同期・通信・表示を含めアプリは一切動作しない。skip 等の想定外手法も同意とみなす（localStorage `vyline:tos-consent-v1`）
- **Nezu→Vy リブランディング** — パッケージ名 `@vyline/nezuline` → `@vyline/protocol`、`NezuClient`/`NezuUpdater`/`NezuCache`/`NezuStorage` → `Vyline*`。旧 `nezu-*` データ・`nezuline` ディレクトリからの自動移行
- **予定機能を docs に記載** — プラグイン API・オープンチャット（実装未確定）を [docs/tasks/STATUS.md](docs/tasks/STATUS.md) / [docs/plugin-api.md](docs/plugin-api.md) に整理

### 改善

- **既読高速化ウォーターマーク** — 相手の最終既読地点をローカルキャッシュし、それ以前の自分のメッセージを全て既読フラグ付け。毎回の既読 API 取得を 30s TTL キャッシュで避けて高速化。既読地点は `getMessageReadRange`（10s タイムアウト）で取得し、キャッシュが有効期限切れまたは read イベント時に再取得
- **deltaAfterId 最適化** — `fetchMessagesSince` / `pollMessagesDelta` で `afterMessageId` が既知の場合、`getMessageBoxes` RPC（最大 5s）を省略し合成カーソルで最新を取得。リアクション表示高速化
- **受信ポーリング高速化** — `useVylineSync.ts` でイベントポーリング間隔を 4s/12s/60s から **2s/8s/60s** へ変更。ポーリングタイマーを分離し、slow delta 完了を待たずに即座に次の poll をスケジュール
- **高画質画像送信** — 表示タブの「高画質で画像送信」トグルで圧縮せず元画質のまま送信可能

### 修正

- アンケート作成・投票の `206` エラー（LINE 公式 LIFF API の要求ヘッダ不足）を修正
- スケジュール共有でグループ名照合に失敗する問題を `groups/{chatMid}` API 直接取得に変更
- ブロックリストをキャッシュ + background キュー + 8s タイムアウトで取得し、504 を回避
- `useVirtualList` の実測高さ変更時にオフセットを再計算するよう修正

### その他

- **ブロック操作の UI 統合** — サイドバー・プロフィール・設定からブロック/ブロック解除を実行可能。ブロック中の友だちへの送信を UI および API レベルで防止
- 既定のデバイスモードを IOSIPAD に統一（プロトコル実装と整合）

## [0.4.0-beta] — 2026-08-17 — Mention & Media

### 新機能

- **メンション** — `@ALL` / `@名前` の送受信。LINE Desktop 準拠の `contentMetadata.MENTION`（`MENTIONEES`）形式で送信し、受信・表示で該当部分をハイライト + アイコン表示。入力中は `@` でメンバー候補ピッカーを表示（最大 20 件）
- **Flex カルーセルのマウスドラッグ** — 横に続く Flex メッセージを掴んでスクロールできるように
- **画像送信の改善** — クライアント側で長辺 2048px・JPEG 圧縮して送信。送信中はローカルプレビューを表示
- **設定の初期化** — 詳細・復元タブに「設定を初期化」を追加（ログイン状態・トーク履歴は保持）

### 修正

- **LINE 絵文字（sticon）の描画** — チャット一覧・返信引用でプレースホルダ文字（`￼`）がそのまま表示される問題を修正し、「絵文字」と表示
- **Flex テキストのクリップ** — `wrap` 指定の Flex テキストが `overflow:hidden` で途切れる問題を修正
- **画像送信のタイムアウト** — E2EE 鍵整備をキャッシュ化し、メディア送信のタイムアウトを 90s に延長。グループ鍵不在時の `NOT_FOUND` 判定を修正
- **自送信 E2EE 画像が表示されない** — `contentMetadata.keyMaterial` が平文である場合に envelope 復号をスキップして直接復号。履歴 RPC を飛ばす高速パスで 0.2s 表示

## [0.3.1] — 2026-08-16

### Context & Compose

- チャット一覧の右クリックメニュー修正（ピン / 非表示 / ブロック / MID コピー）
- LINE 絵文字の文中挿入（REPLACE metadata 対応）
- 文字サイズ・コンパクト表示の適用修正
- プロフィールの名前 / ステメ二重表示を解消
- リアクション: 古いメッセージのエラーを分かりやすく表示
- ブロック状態の確認とブロック API の安定化
- 友だちニックネーム変更を Talk RPC 優先キューへ
- E2EE auth fail ログの連打抑止
- 情報タブに OpenCode Go リンクを追加

---

この形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に基づいています。バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。
