# Changelog

Vyline の変更履歴。バージョンは `Vyline/apps/desktop/src/lib/store.ts` の `UPDATE_NOTES.version` を正本とする。

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
