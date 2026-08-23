# セッションまとめ — SBC クラウドバックアップ復元 → 履歴取り出し → CI 修复

作成日: 2026-08-24 / 対象: Vyline プロジェクト（packages/protocol = vyline-api）

---

## ゴール

**「LINE のクラウドバックアップ（SBC）から E2EE 鍵を復元し、トーク履歴を Vyline で取り出せるようにする」機能を実装し、PR として提出、CI を緑にしてマージまで持っていくこと。**

| # | 目標 | 状態 |
|---|------|------|
| 1 | SBC (/EKBS4) PIN 復元の実装 | ✅ 実装・実機検証済み |
| 2 | 実機での鍵復元（PIN → 16 鍵） | ✅ 成功 |
| 3 | iOS トーク履歴バックアップの場所特定 | ✅ iCloud 行きと確定（第三者参照不可） |
| 4 | Desktop 引き継ぎの強化 | ✅ PR 化 |
| 5 | PR #4 (vyline-api) / PR #75 (vyline) 提出 | ✅ 作成済み |
| 6 | PR #4 の CI を緑にする | 🔄 修正 3 件対応済み・最終ラン確認待ち |
| 7 | マージ（#4 → #75 の順・submodule pointer のため固定） | ⏳ ユーザー操作待ち |
| 8 | 片付け（ブランチ削除・main pull） | ⏳ |

---

## これまでの流れ

### 1. SBC クラウドバックアップ復元の実装

- `/EKBS4` restore + `/LKBS4` (E2EELifetimeKeyBackupService) を `@vyline/protocol` に実装
- 復号フロー: `RestoreClaim.createFromPin(mid, pin, certPem)` → `restoreE2EEKeyBackup(/EKBS4)` → `claim.Restore(recoveryKey, blobPayload)` → `BackupKeys{e2eeKeys[]}`
- 実機検証: PIN 入力で **E2EE 鍵 16 本の復元に成功**（keyId 4906343〜5953546, version=1）。`Vyline/data/sbc-extract/` に保存（gitignore 済み）

### 2. iOS トーク履歴バックアップの調査（HAR 解析）

- ユーザー提供の HAR（iOS バックアップ操作中, 79 エントリ）を解析
- `/LKBS4` `/EKBS4` `/KBCS` の呼び出しゼロ、`gateway.icloud.com` CONNECT 25+ 回
- → **iOS のトーク履歴バックアップは iCloud 保存であり第三者クライアントからは参照不可**と確定
- 当アカウントの LKBS4 は `NO_BACKUP`（`lkbsProbe` CLI で確認）
- 記録: `docs/analysis/sbc-key-restore.md`

### 3. Desktop 引き継ぎの強化（既存方式を変えずに PR 化）

- `importDesktopE2EE.ts`: 正規化 / dedupe / SBC 復元鍵ダンプ読込 / マージ関数群（`mergeDesktopE2EEKeyDumps`, `derivePubKey`, `withOptionalMeta`）
- `restoreDesktop.ts`: `resolveSbcKeysDirs()` + `loadMergedKeyDump()` で desktop dump と SBC ダンプを統合して既存 storage-import 方式のまま import
- CLI: `sbcBackupExtract.ts`（抽出）/ `lkbsProbe.ts`（LKBS4 診断）
- テスト: `importDesktopE2EE.test.ts` 8 tests pass
- 鍵カバレッジ: desktop dump 23 本 ⊇ SBC 16 本。BFF messages API で `ok:true count:50` の復号確認済み
- **PR #4**: <https://github.com/nezumi0627/vyline-api/pull/4>
- **PR #75**: <https://github.com/nezumi0627/vyline/pull/75>（submodule pointer 更新含む → **必ず #4 を先にマージ**）

### 4. PR #4 の CI 修复（直近の作業）

ユーザー指示「こっちが落ちてるので直して」→ 原因を 3 つ特定し、すべて対処済み。

| # | 問題 | 原因 | 対処 | コミット / 操作 |
|---|------|------|------|------------------|
| 1 | Lint 失敗（run 32655843431, 11s） | `importDesktopE2EE.ts` の biome format 差分 | `bunx biome check --write` で整形 | 92e732d push → Lint 通過確認 |
| 2 | Build 失敗（run 32656408532） | CI が親 monorepo **main** から line-types を取得するため LKBS4 型が存在せず TS2724/TS2694（protocol 先マージ制約との循環依存） | ci.yml に **Resolve sibling monorepo ref** ステップ追加（親リポジトリに同名ブランチがあればそれを使い、無ければ main にフォールバック） | d4fac1a push・ローカル `bun run build` OK |
| 3 | required checks が永遠 pending | ruleset protect-main (id 21197617) が存在しないコンテキスト名 `Build/Lint/TypeScript` を要求していた | REST API PUT で実際のジョブ名 `Typecheck / Lint / Build` 1 件に置換 | リポジトリ設定変更・完了 |

**現状**: d4fac1a push 後の新規 CI ランが `gh run list` にまだ出現しておらず（旧失敗 2 件のみ表示）、結果確認が次のアクション。

---

## 残タスク

1. 【最優先】d4fac1a 由来の新規 CI ランを再ポーリングし全ステップ緑を確認
   - 特に `Build (stack .d.ts)` 成功と `Resolve sibling monorepo ref` のログ `sibling monorepo ref: feature/sbc-key-backup-desktop-import` を確認
2. 新ランが出現しない場合: runs API で起動有無を調査、workflow パースエラーなら ci.yml 修正して再 push
3. 全緑を確認したらユーザーへ報告 → **PR #4 → PR #75 の順でマージ**してもらう
4. マージ後の片付け: 作業ブランチ削除・main pull
5. 低優先（docs 記録済み）:
   - SBC 復元鍵（48 バイト・base64 64 文字）エンコード形式の解明（DER/PKCS8/hex いずれでも非互換＝公式独自形式）
   - password(v3) claim の AAD 構造検証

---

## 制約・運用ルール

- `main` 直 push 禁止・必ずブランチを切って PR
- 秘密情報（desktop-e2ee-keys.json / token / `data/` 配下）はコミット禁止・PR やチャットに貼らない
- エージェントによる LINE 送信は禁止（送信テストは「うがうがうー」「ねずBOT」のみ）
- 誤 PIN ロックアウト（max 10 回）のため推測試行禁止
- Windows シェル: sleep は `ping -n N 127.0.0.1 >nul`（`timeout /t` は使用不可）、長い出力は `%TEMP%` へリダイレクト

---

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `Vyline/packages/protocol/src/login/importDesktopE2EE.ts` | 鍵正規化・dedupe・SBC ダンプマージ（biome 整形済み） |
| `Vyline/backend/src/service/restoreDesktop.ts` | SBC + desktop 鍵の統合 import |
| `Vyline/backend/src/tools/sbcBackupExtract.ts` / `lkbsProbe.ts` | SBC 抽出・LKBS4 診断 CLI |
| `Vyline/packages/protocol/.github/workflows/ci.yml` | CI（sibling ref 解決ステップ追加済み） |
| `docs/analysis/sbc-key-restore.md` | 実機検証・HAR 解析の記録（174 行） |
