# iOS バックアップから LINE 履歴を取り込む

最終更新: 2026-08-29

---

## 概要

Vyline では、**iPhone（プライマリデバイス）で作成した暗号化バックアップ**からトーク履歴を取り込めるようにする計画です。

> ⚠️ **実装状況**: 現在は抽出パッケージ、ウィザード UI、API クライアントまでが実装済みです。
> バックエンドの抽出サービスと BFF ルートが未実装のため、Vyline GUI からの取り込みはまだ利用できません。
> 以下の手順は、対応完了後に使用する準備手順です。

> ⚠️ **重要**: **必ずプライマリデバイス（メインの iPhone）で操作してください。**  
> サブデバイス（iPad、セカンダリ iPhone、LINE Desktop 等）では **トークのバックアップ作成ができません**。

> 🎬 **メディア（画像・動画・音声・ファイル・スタンプ）の取り込みは Coming Soon**  
> 現在はテキスト・メタデータのみ対象です。

---

## まず Vyline 側の Snapshot を作成

履歴取り込みや復元系の操作をする前に、現在の Vyline データを **Snapshot** として保存してください。

```bash
bun run vyl snapshot create before-ios-import
bun run vyl snapshot list
```

問題が起きた場合は、現在の `data/` を退避しながら復元できます。

```bash
bun run vyl snapshot restore snapshots/xxx.tar.gz --force
```

定期的に保護する場合は次を使います。

```bash
bun run vyl snapshot schedule daily
```

> 💡 Vyline では従来の「バックアップ / リストア」を **Snapshot** と呼びます。`data/` にはセッション、鍵、設定、履歴が含まれるため、取り込み前の Snapshot を推奨します。

---

## 事前準備

- **iPhone（プライマリデバイス）**
- **USB ケーブル**（iPhone と PC を接続する用）
- **PC（Windows）**：iTunes または Apple Devices アプリがインストール済み
- **バックアップ時の暗号化パスワード**（忘れると取り込み不可）
- **Vyline CLI**：既存 checkout では `bun run vyl:doctor` で環境確認

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

まず環境を確認します。

```bash
bun run vyl:doctor
```

GUI 対応後は、次の流れで取り込みます。

1. Vyline を起動
2. **設定 → 詳細・復元** タブへ移動
3. **「iTunesから履歴を取り込む（iOSのみ現在対応）」** ボタンをクリック
4. ウィザードが開くので手順に従う：
   - **デバイス選択**: 検出されたバックアップから選択（暗号化済みのみ表示）
   - **パスワード入力**: Step 2-2 で設定した暗号化パスワード
   - **取り込み実行**: 進捗バー表示（DB 抽出 → 解析 → 取り込み）
5. 完了ダイアログ表示 → DB/E2EE 更新を自動実行する
6. チャット一覧に履歴が反映されることを確認

---

## よくある質問

### Q. 「暗号化済み」じゃないとダメ？

**はい**。暗号化なしのバックアップには LINE の SQLite ファイルが含まれません。必ず「バックアップを暗号化」にチェックして作成してください。

### Q. パスワードを忘れた

取り込みできません。iTunes/Apple Devices でパスワードを変更してから再度バックアップを作成してください。

### Q. サブデバイス（iPad など）でバックアップ作成できる？

**できません**。LINE の仕様で「トークのバックアップ」はプライマリデバイス（メインの iPhone）でのみ実行可能です。

### Q. メディア（画像・動画など）も取り込まれる？

**Coming Soon** です。現在はテキストメッセージとメタデータ（スタンプ情報、送信者、時刻等）のみ対象です。

### Q. 以前の端末のバックアップがあるが使える？

そのバックアップが **暗号化されており、パスワードが分かっていれば** 使えます。UDID（デバイス識別子）が異なる場合は手動で選択してください。

### Q. 取り込みに失敗する

- 先に `bun run vyl snapshot create before-ios-import` を実行しているか確認
- パスワードが正しいか確認
- バックアップが暗号化済みか確認（暗号化なしは不可）
- Apple Devices / iTunes が完全に終了しているか確認（ロックされていると読めない）
- `bun run vyl:doctor` で Vyline 環境を確認
- Vyline のログ（設定 → デバッグログ）を確認

---

## 技術的な補足

- **対象データ**: `Line.sqlite`（メッセージ・チャット・ユーザー）と `UnifiedGroup.sqlite`（グループ名）
- **抽出先**: `source/ios-backup/line/`（生 DB）、`source/ios-backup/dump/`（JSONL 化済み）
- **E2EE**: 取り込み後、グループ鍵等は自動で再取得・再導入されます（`ensureGroupE2EEKey` 経由）
- **メディア**: 現状はスキップ。将来的に `contentMetadata` 内の参照キーと実体 blob の突合で実装予定

---

## 関連ドキュメント

- [vyl CLI と Snapshot](../vyl-cli.md)
- [技術解説と履歴取り出しの全経緯](../../../docs/analysis/ios-backup-history-extraction.md)
