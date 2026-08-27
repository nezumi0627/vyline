# PHASES — フェーズ詳細

最終更新: 2026-08-27
進捗ボード: [STATUS.md](./STATUS.md)

各 Phase の目標・受け入れ条件・主要コードパスを定義する。受け入れ条件を満たしたら STATUS のチェックを更新する。

---

## Phase 0 — Kickoff

### 目標

エージェントと人間が同じ地図で動ける初期状態を作る。

### 受け入れ条件

- [x] `AGENTS.md` にスタック・セットアップ・哲学がある
- [x] `docs/tasks/` と `docs/analysis/` が存在する
- [x] 秘密情報の gitignore 方針が明記されている

### 関連パス

- `AGENTS.md`
- `README.md`
- `.gitignore`
- `docs/`

---

## Phase 1 — E2EE decrypt / send

### 目標

公式 Desktop が読める過去メッセージを Vyline でも復号し、E2EE で送信できるようにする。

### 受け入れ条件

- [x] Desktop 抽出の自己鍵を import し、履歴復号に使える（利用者側で鍵を用意する）
- [x] mid 既定鍵が **サーバ最新 keyId** と一致するよう整備し、送信失敗時は修復を試行する
- [x] 復号失敗時に空吹き出しではなく `E2EE_UNAVAILABLE` を表示
- [x] `E2EE_UPDATE_SENDER_KEY` 時に新規 sender 鍵登録 → 再送が動く
- [x] debug: `/debug/decrypt-test/:accountId/:chatMid` で成功率を確認できる

### 主要コードパス

| 役割              | パス                                                      |
| ----------------- | --------------------------------------------------------- |
| 鍵検証・修復      | `Vyline/packages/protocol/src/login/ensureE2EE.ts`        |
| Desktop 鍵 import | `Vyline/packages/protocol/src/login/importDesktopE2EE.ts` |
| 取得・復号・送信  | `Vyline/backend/src/service/lineService.ts`               |
| decrypt 試験      | `Vyline/backend/src/api/debug.ts`                         |
| UI ラベル         | `Vyline/apps/desktop/src/utils/format.ts`                 |
| 鍵ダンプ配置      | `Vyline/backend/data/desktop-e2ee-keys.json`（gitignore） |

### 事実メモ

- Desktop は `.edb` / メモリ keychain に **過去の全自己鍵** を持つ。Vyline も最新だけだとログイン前履歴が `BAD_DECRYPT` になる。
- linejs 復号は message `chunks` 内の sender / receiver keyId を参照する。
- 詳細: [e2ee-decrypt-journey.md](../analysis/e2ee-decrypt-journey.md)

---

## Phase 2 — Docs / AGENTS / tasks

### 目標

タスクボード・解析索引・エージェント向け注意事項を常設し、再起動コストを下げる。

### 受け入れ条件

- [x] `docs/tasks/STATUS.md` / `PHASES.md` がある
- [x] `docs/analysis/` に E2EE 旅程と Desktop 解析手法がある
- [x] `AGENTS.md` / `README.md` から docs へ辿れる
- [x] 報告は Official Account broadcast のみ、と明記

### 関連パス

- `docs/tasks/*`
- `docs/analysis/*`
- `AGENTS.md`
- `README.md`

---

## Phase 3 — Vyline lib + Desktop import + update-diff

### 目標

LINE Desktop の identity / バージョン /（可能な範囲で）E2EE 鍵を追従するライブラリと更新差分ツールを固める。

### 受け入れ条件

- [x] `@vyline/protocol` 経由で DESKTOPWIN identity を安定適用できる
- [x] インストールパス / `update_info` / 稼働中メモリから app version を取得できる
- [x] Desktop E2EE 鍵 dump → import の手順が docs と一致
- [x] Desktop 更新時にヘッダ・エンドポイント差分を検知できる update-diff がある（MVP）

### 主要コードパス

| 役割             | パス                                                    |
| ---------------- | ------------------------------------------------------- |
| パッケージ入口   | `Vyline/packages/protocol/src/index.ts`                 |
| Client ラッパ    | `Vyline/packages/protocol/src/client/VylineClient.ts`   |
| Identity         | `Vyline/packages/protocol/src/desktop/identity.ts`      |
| メモリ / PE 抽出 | `Vyline/packages/protocol/src/desktop/extract.ts`       |
| バージョン       | `Vyline/packages/protocol/src/desktop/version.ts`       |
| Transport patch  | `Vyline/packages/protocol/src/login/patchTransport.ts`  |
| Updater          | `Vyline/packages/protocol/src/updater/VylineUpdater.ts` |

### 関連

- [desktop-reverse-methods.md](../analysis/desktop-reverse-methods.md)
- [login-flow.md](../login-flow.md)

---

## Phase 4 — Telegram-like UI

### 目標

日常利用に耐えるチャット UI（スタンプ・絵文字・通話導線など）を揃える。

### 受け入れ条件

- [x] スタンプ送信 / 表示
- [x] 絵文字入力
- [x] 通話エントリポイント（実験的。通話品質は継続検証）
- [x] 既存 chat コンポーネントと矛盾しないデザインシステム
- [x] 未読先頭／既読末尾の初期位置と、仮想リスト計測後の安定したスクロール

### 主要コードパス（現状）

- `Vyline/apps/desktop/src/components/chat/*`
- `Vyline/apps/desktop/src/components/sidebar/*`
- `Vyline/apps/desktop/src/App.tsx`
- `tools/` — Vyline-Search 検索ツール（unpack / findNativeSymbol / focusRecoveredSource）

### 依存

Phase 1 のメッセージ送受信・復号表示が安定していること。

---

## Phase 5 — Quality / perf

### 目標

反復速度を落とさずに、型安全・テスト・ホットパス性能を底上げする。

### 受け入れ条件

- [x] `bun run typecheck` / `bun run lint` / renderer build が日常的に通る
- [x] メッセージ一覧・既読同期・仮想リストのホットパスを計測・改善
- [x] 個人情報をマスキングした診断ログを利用者が確認・出力・削除できる
- [ ] 実アカウントを用いる長時間・複数端末回帰テストを継続する

---

## Phase 6 — Beta 配布とアカウント安全性

### 目標

複数アカウントと複数端末で、設定・診断・セッションを安全に扱える Beta を配布可能にする。

### 受け入れ条件

- [x] Vyline Setup の進捗と MID ごとの設定を保存・復元できる
- [x] 設定のみを含む検証可能な引継ぎ ZIP を import/export できる
- [x] Windows セッションを DPAPI(CurrentUser) で保護できる
- [x] サブデバイスをブラウザ単位のランダムなインストール ID へ結び付けられる
- [x] Tailscale を優先する遠隔アクセス案内がある
- [ ] リリースタグと Windows 配布物の最終スモークテストを完了する

### 関連コマンド

```powershell
bun run typecheck
bun run lint
bun test
bun run build
```

---

## Phase 間の依存関係

```
Phase0 (docs kickoff)
   └─► Phase2 (tasks/analysis 整備) ── 並行可
   └─► Phase3 (Vyline / Desktop)
          └─► Phase1 (E2EE) ── 鍵・identity に依存
                 └─► Phase4 (UI)
   └─► Phase5 (quality) ── 随時並行、優先は後
```
