# Vyline iOS バックアップ履歴抽出 — 完全ガイド

最終更新: 2026-08-24

---

## 🎯 最終ゴール

**Vyline（自作 LINE サードパーティクライアント）で、iOS 版 LINE のトーク履歴を丸ごと取り出せるようにする。**

当初は「クラウドバックアップ（SBC）からの復元」を狙ったが、調査の結果 **iOS 版のトークバックアップ実体は iCloud 側**にあることが判明。複数ルートを並行検証し、最終的に **iOS ローカル暗号化バックアップ（iTunes / Apple Devices）からの直接抽出**で履歴取得に成功した。

---

## 📋 実施経緯（時系列サマリ）

| Phase | 路線 | 主な成果 |
|------|------|----------|
| A | SBC / E2EE 鍵バックアップ | EKB / LKBS4 実装完了、16鍵復元確認。だが LKBS4 が `NO_BACKUP` 返却 → iOS トークバックアップは iCloud 保存のため Desktop SBC から取得不可と確定 |
| B | **iOS ローカル暗号化バックアップ抽出（本編）** | **完全成功**：暗号化バックアップ解除 → 41 DB 復号 → 131 チャット × 30,111 件メッセージを JSONL 化 |
| 現在 | **TypeScript 移植済み、統合は未完了** | `@vyline/ios-backup` のコアと GUI/API クライアントは存在するが、バックエンド抽出サービスと BFF ルートは未実装 |

---

## 🔑 技術的知見（Line.sqlite 解釈キー）

| 項目 | 仕様 |
|------|------|
| `ZSENDER` NULL | **自分のメッセージ**（自分の mid は `ZUSER` に存在しないことで裏取り済み） |
| `ZTIMESTAMP` | **Unix ミリ秒**（Core Data 秒ではない） |
| `ZMESSAGETYPE` | 全 NULL → **`ZCONTENTTYPE` を使用**（0:text 18,271 / 7:4,583 / 17:2,076 …） |
| `ZCONTENTMETADATA` | **binary plist（bplist00）** |
| グループ名 | `UnifiedGroup.sqlite` の `ZUNIFIEDGROUP.ZID` を `lower()` して `chatMid` と突合 |
| Windows バックアップ保存先 | 2 系統：**Apple Devices（実機）/ 旧 iTunes** |

---

## 📦 現状の成果物（gitignore 保護下）

| 場所 | 内容 |
|------|------|
| `source/ios-backup/line/` | 復号抽出した 41 SQLite DB（~52.7 MB） |
| `source/ios-backup/dump/` | `<chatMid>.jsonl` ×131 + `index.json`（30,111 msg） |
| `C:\Users\ren11\Apple\MobileSync\Backup\00008140-000668921A82801C` | 元の iOS 暗号化バックアップ（Apple Devices 系） |

---

## 🧩 今後の実装計画（ユーザー確定要件）

### 1. 独立パッケージ化・サブモジュール化
- **パッケージ名**: `@vyline/ios-backup`
- **配置**: `Vyline/packages/ios-backup/` （Git Submodule として管理）
- **公開 API**:
  - `extractBackup(backupPath: string, password: string): Promise<ExtractedBackup>`
  - `parseLineDatabases(extracted: ExtractedBackup): Promise<ChatHistory>`
  - `restoreToVyline(history: ChatHistory, options: RestoreOptions): Promise<void>`

### 2. Vyline GUI 統合
- **タブ名**: `バックアップ` → `iTunesから履歴を復元（iOSのみ現在対応）`
- **フロー**: バックアップ選択 → パスワード入力 → 進捗表示 → 完了 → 自動 DB/E2EE 更新
- **メディア復元**: **Coming Soon** と明記（GUI・ドキュメント両方）

### 3. 外部スクリプト依存の完全排除（TypeScript 実装）
| 必要モジュール | 実装方針 | 行数目安 |
|---------------|----------|----------|
| RFC3394 AES-Key-Unwrap | `node:crypto` で自前実装 | ~40 行 |
| 鍵袋 TLV パーサ | 最小実装 | ~50 行 |
| bplist パーサ | 最小実装（`ZCONTENTMETADATA` だけ読めればOK） | ~60 行 |
| PBKDF2 / AES-CBC | `node:crypto` 直接利用 | 既存 |
| SQLite 読み込み | `bun:sqlite` 直接利用 | 既存 |
| **合計** | | **~300 行** |

### 4. 復元後の自動更新項目
| 対象 | 更新内容 |
|------|----------|
| `vylineCache` | プロフィール・グループ・メンバー情報の再構築 |
| E2EE 鍵ストア | グループ鍵・SenderKey の再導入（`ensureGroupE2EEKey` 経由） |
| メッセージログ | `messageLog.ts` への JSONL 取り込み |
| チャット一覧ストア | `store.ts` の `chats` / `messages` 再hydrate |

---

## 📱 ユーザー向け手順書（ドキュメント・GUI 共通掲載）

> ⚠️ **重要**: **必ずプライマリデバイス（メインの iPhone）で実行すること**。  
> サブデバイス（iPad、セカンダリ iPhone、LINE Desktop 等）では **トークのバックアップ作成ができません**。

---

### Step 1: iPhone 側（プライマリデバイスのみ）

1. **LINE アプリを開く**
2. **設定**（歯車アイコン）→ **トーク**
3. **トークのバックアップ** をタップ
4. **「今すぐバックアップ」** をタップ
5. プログレスバーが完了するまで待つ（数分〜数十分）

> 💡 このバックアップは **iCloud** に保存されます。PC 側で取り出すのは **ローカル暗号化バックアップ** です。

---

### Step 2: PC 側（Windows）

#### 2-1. ソフトウェア準備
- **Apple Devices** または **iTunes（Microsoft Store 版推奨）** をインストール
  - Apple Devices: `https://apps.microsoft.com/detail/9ng5wzg8w2d4`
  - iTunes: `https://apps.microsoft.com/detail/9PB2MZ1ZMB1S`
- 初回セットアップで iPhone を信頼・ペアリング

#### 2-2. 暗号化バックアップ作成
1. iPhone を USB ケーブルで PC に接続
2. Apple Devices / iTunes を起動 → デバイスアイコン選択
3. **「バックアップを暗号化」** にチェック ✅
   - **必須**: チェックしないとアプリ内データ（LINE の SQLite 等）が含まれません
4. パスワードを設定（**忘れないこと**。後で Vyline で入力します）
5. **「今すぐバックアップ」** をクリック
6. 完了まで待つ（初回は 10〜30 分程度）
7. **Apple Devices / iTunes を完全終了**（タスクマネージャでプロセスキル推奨）

> 📂 バックアップ保存先（参考）
> - Apple Devices: `%USERPROFILE%\Apple\MobileSync\Backup\`
> - iTunes (Store 版): `%USERPROFILE%\Apple\MobileSync\Backup\`
> - iTunes (Win32 版): `%APPDATA%\Apple Computer\MobileSync\Backup\`

---

### Step 3: Vyline 側

1. Vyline を起動
2. **設定 → バックアップ** タブへ移動
3. **「iTunesから履歴を復元（iOSのみ現在対応）」** を選択
4. バックアップフォルダを自動検出 or 手動選択
5. **暗号化パスワード** を入力
6. **「復元開始」** → 進捗バー表示（DB 抽出 → 解析 → 取り込み）
7. 完了ダイアログ表示 → **自動で DB/E2EE 更新が走る**
8. チャット一覧に履歴が反映されることを確認

> 🎬 **メディア（画像・動画・音声・ファイル・スタンプ）の復元は Coming Soon**  
> 現在はテキスト・メタデータのみ復元されます。

---

## 🏗️ 実装タスク分解

### Phase 1: `@vyline/ios-backup` パッケージ
- [x] `packages/ios-backup/` の `package.json`、`tsconfig.json`、`src/` を作成
- [x] `src/keybag.ts` — 鍵袋 TLV パーサ + RFC3394 unwrap
- [x] `src/manifest.ts` — Manifest.db 復号（AES-CBC iv=0）
- [x] `src/bplist.ts` — 最小 bplist パーサ（ZCONTENTMETADATA 用）
- [x] `src/extract.ts` — Manifest からの DB 抽出
- [x] `src/parse.ts` — Line.sqlite / UnifiedGroup.sqlite 解析
- [x] `src/index.ts` — 公開 API エクスポート
- [ ] 実バックアップを使った自動テスト
- [ ] Git Submodule 化（現状は本リポジトリ内の通常パッケージ）

### Phase 2: Vyline Backend 統合
- [ ] `backend/src/tools/iosLineExtract.ts` — CLI エントリ（現状は不存在）
- [ ] `backend/src/service/iosBackupService.ts` — サービス層（現状は不存在）
- [ ] `backend/src/api/line.ts` — iOS バックアップ BFF ルート（現状は不存在）
- [ ] 進捗 WebSocket / SSE 通知（フロント表示用）

### Phase 3: Vyline Frontend 統合
- [x] `apps/desktop/src/components/IosBackupWizard.tsx` — ウィザード UI
- [x] `apps/desktop/src/api/client.ts` — iOS バックアップ API クライアント定義
- [ ] `apps/desktop/src/components/settings-sections.tsx` — 設定画面への接続確認
- [ ] 進捗バー・ログ表示・エラーハンドリング
- [ ] **「メディアの復元は Coming Soon」** バッジ・ツールチップ配置
- [ ] 完了後の自動リフレッシュ（`hydrateLineData` / `pollMessagesDelta` 再実行）

### Phase 4: ドキュメント整備
- [x] `Vyline/docs/guides/ios-backup-restore.md` — ユーザー向け手順書
- [x] `docs/analysis/ios-backup-history-extraction.md` — 技術解説
- [x] `docs/README.md` と `docs/analysis/README.md` の索引更新
- [ ] `CHANGELOG.md` エントリ追加

---

## 🔒 制約・注意事項

| 項目 | ルール |
|------|--------|
| Git | `main` 直 push 禁止。必ず feature ブランチ → PR → レビュー → マージ |
| 秘密情報 | バックアップパスワード・PIN・トークン・鍵は **コミット禁止**（`source/` も gitignore 済み） |
| LINE 送信 | 自動送信・テスト送信 **禁止**（受信・表示系のみ） |
| PowerShell | TypeScript ファイルへの置換・書き込み **禁止**（Edit ツール使用） |
| パスワード試行 | 提供値のみ使用。推測・総当たり **禁止** |
| メディア | 現フェーズでは **スキップ**（Coming Soon 明記） |

---

## 📁 関連ファイル一覧（実装参照用）

### A. 既存実装（PR 対象候補・protocol 側）
```
Vyline/packages/protocol/src/sbc/mod.ts
Vyline/packages/protocol/src/sbc/msgpack.ts
Vyline/packages/protocol/src/sbc/crosscheck.ts
Vyline/packages/protocol/src/sbc/certs/*.pem
Vyline/packages/protocol/stack/base/service/e2eekeybackup/
Vyline/packages/protocol/stack/_dist/base/service/e2eelifetimekeybackup/
Vyline/packages/protocol/src/tools/dumpDesktopHistory.ts
Vyline/packages/protocol/src/tools/decryptDesktopEdb.ts
Vyline/backend/src/tools/sbcBackupExtract.ts
Vyline/backend/src/tools/lkbsProbe.ts
docs/analysis/sbc-key-restore.md
docs/analysis/edb-decrypt.md
```

### B. 現行 Python ツール（参考・後で削除）
```
%TEMP%\ios_line_extract.py
%TEMP%\ios_line_dump.py
%TEMP%\iosb-venv\iOSbackup.py
```

### C. 新規作成対象
```
Vyline/packages/ios-backup/                    # 本リポジトリ内のパッケージ
Vyline/backend/src/tools/iosLineExtract.ts     # 未実装
Vyline/backend/src/service/iosBackupService.ts # 未実装
Vyline/backend/src/api/line.ts                 # iOS ルート未実装
Vyline/apps/desktop/src/components/settings-sections.tsx
Vyline/apps/desktop/src/components/IosBackupWizard.tsx
Vyline/apps/desktop/src/api/client.ts
Vyline/docs/guides/ios-backup-restore.md
docs/analysis/ios-backup-history-extraction.md
```

---

## ✅ 受け入れ条件（Definition of Done）

1. `@vyline/ios-backup` が `bun test` で全パス
2. 実機バックアップで 41 DB 抽出 → 30,111 msg パース → JSONL 出力が現行 Python 版と一致
3. Vyline GUI から「iTunesから履歴を復元」ウィザードが完走し、チャット一覧に履歴が表示される
4. 復元後、自動で `vylineCache` / E2EE 鍵 / メッセージログ / ストアが更新される
5. 「メディアの復元は Coming Soon」が GUI とドキュメントに明記されている
6. ユーザー向け手順書が `Vyline/docs/guides/ios-backup-restore.md` にある
7. バックエンド抽出サービスと BFF ルートが実装されるまで、GUI の復元操作は未提供として扱う

---

## 📝 次のアクション

1. バックエンド抽出 CLI とサービスを実装する
2. `line.ts` に BFF ルートを追加する
3. GUI の API 呼び出しを実機バックアップで検証する
4. 動作確認 → PR 作成 → マージ

---

> このドキュメントは `docs/analysis/ios-backup-history-extraction.md` として保存されます。  
> 索引 `docs/analysis/README.md` にもリンクを追加予定です。
