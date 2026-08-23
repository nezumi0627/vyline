# iOS バックアップから LINE 履歴を復元する

最終更新: 2026-08-24

---

## 概要

Vyline では、**iPhone（プライマリデバイス）で作成した暗号化バックアップ**からトーク履歴を取り込めます。

> ⚠️ **実装状況**: 現在は抽出パッケージ、ウィザード UI、API クライアントまでが実装済みです。
> バックエンドの抽出サービスと BFF ルートが未実装のため、Vyline GUI からの復元はまだ利用できません。
> 以下の手順は、対応完了後に使用する準備手順です。

> ⚠️ **重要**: **必ずプライマリデバイス（メインの iPhone）で操作してください。**  
> サブデバイス（iPad、セカンダリ iPhone、LINE Desktop 等）では **トークのバックアップ作成ができません**。

> 🎬 **メディア（画像・動画・音声・ファイル・スタンプ）の復元は Coming Soon**  
> 現在はテキスト・メタデータのみ復元されます。

---

## 事前準備

- **iPhone（プライマリデバイス）**
- **USB ケーブル**（iPhone と PC を接続する用）
- **PC（Windows）**：iTunes または Apple Devices アプリがインストール済み
- **バックアップ時の暗号化パスワード**（忘れると復元不可）

### PC 側のソフトウェア

| ソフト | 入手先 |
|--------|--------|
| **Apple Devices**（推奨） | [Microsoft Store](https://apps.microsoft.com/detail/9ng5wzg8w2d4) |
| **iTunes（Microsoft Store 版）** | [Microsoft Store](https://apps.microsoft.com/detail/9PB2MZ1ZMB1S) |

> **注意**: 旧来の Win32 版 iTunes（Apple サイトからダウンロードするもの）も動作しますが、バックアップ保存先が `%APPDATA%\Apple Computer\MobileSync\Backup` になるため、Apple Devices / Store 版 iTunes（`%USERPROFILE%\Apple\MobileSync\Backup`）と異なります。どちらを使うかで保存先が変わる点に注意してください。

---

## 手順

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
- Apple Devices または iTunes（Microsoft Store 版推奨）をインストール
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

### Step 3: Vyline 側（バックエンド実装後）

1. Vyline を起動
2. **設定 → 詳細・復元** タブへ移動
3. **「iTunesから履歴を復元（iOSのみ現在対応）」** ボタンをクリック
4. ウィザードが開くので手順に従う：
   - **デバイス選択**: 検出されたバックアップから選択（暗号化済みのみ表示）
   - **パスワード入力**: Step 2-2 で設定した暗号化パスワード
   - **復元実行**: 進捗バー表示（DB 抽出 → 解析 → 取り込み）
5. 完了ダイアログ表示 → DB/E2EE 更新を自動実行する
6. チャット一覧に履歴が反映されることを確認

---

## よくある質問

### Q. 「暗号化済み」じゃないとダメ？
**はい**。暗号化なしのバックアップには LINE の SQLite ファイルが含まれません。必ず「バックアップを暗号化」にチェックして作成してください。

### Q. パスワードを忘れた
復元できません。iTunes/Apple Devices でパスワードを変更してから再度バックアップを作成してください。

### Q. サブデバイス（iPad など）でバックアップ作成できる？
**できません**。LINE の仕様で「トークのバックアップ」はプライマリデバイス（メインの iPhone）でのみ実行可能です。

### Q. メディア（画像・動画など）も復元される？
**Coming Soon** です。現在はテキストメッセージとメタデータ（スタンプ情報、送信者、時刻等）のみ復元されます。

### Q. 以前の端末のバックアップがあるが使える？
そのバックアップが **暗号化されており、パスワードが分かっていれば** 使えます。UDID（デバイス識別子）が異なる場合は手動で選択してください。

### Q. 復元に失敗する
- パスワードが正しいか確認
- バックアップが暗号化済みか確認（暗号化なしは不可）
- Apple Devices / iTunes が完全に終了しているか確認（ロックされてると読めない）
- Vyline のログ（設定 → デバッグログ）を確認

---

## 技術的な補足

- **対象データ**: `Line.sqlite`（メッセージ・チャット・ユーザー）と `UnifiedGroup.sqlite`（グループ名）
- **抽出先**: `source/ios-backup/line/`（生 DB）、`source/ios-backup/dump/`（JSONL 化済み）
- **E2EE**: 復元後、グループ鍵等は自動で再取得・再導入されます（`ensureGroupE2EEKey` 経由）
- **メディア**: 現状はスキップ。将来的に `contentMetadata` 内の参照キーと実体 blob の突合で実装予定

---

## 関連ドキュメント

- [技術解説と履歴取り出しの全経緯](../../../docs/analysis/ios-backup-history-extraction.md)
