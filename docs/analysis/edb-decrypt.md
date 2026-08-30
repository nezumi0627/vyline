# LINE Desktop .edb 解析 — 全履歴 dump

最終更新: 2026-08-24

## 目的

LINE Desktop がローカルに保持する全トーク履歴（`%LOCALAPPDATA%\LINE\Data\db\*.edb`）を
dump できるようにする。

## 結論（2026-08-23 時点）

**鍵導出・アルゴリズム解明なしで、メモリ上の復号済みページを捕捉して dump することに成功した。**

- `Vyline/packages/protocol/src/tools/dumpDesktopHistory.ts`
- 使い方:

```powershell
# LINE を終了してから実行（Frida spawn するため）
bun --cwd Vyline/packages/protocol run src/tools/dumpDesktopHistory.ts --seconds 300 --navigate
# 出力: Vyline/backend/data/edb-export/history-dump/desktop-history.jsonl
```

- `--navigate`: LINE の UI をカーソルキーで自動巡回して各チャットを開かせる
- **制限**: Desktop 自身が読み込んだ（＝画面に表示した）ページしか捕捉できない。
  完全な過去履歴を得るにはアプリ内でチャットを開いてスクロールする必要がある

## 技術メモ

### 暗号化の実態

| 項目 | 内容 |
| --- | --- |
| 形式 | wxSQLite3 風（page1 先頭 16B のみランダム、16–23 は平文ヘッダ、pageSize 4096） |
| 実装 | LINE 独自改造。Kang et al. 論文の MD5×51 + RC4×20 + MD5×51 導出は **不一致** |
| CNG | 不使用（bcrypt フックで呼び出しなし） |
| AES | ソフトウェア実装。T テーブルはあるが DB codec とは別物（アクセス監視で否定） |
| I/O | NtReadFile（mmap なし）。読み込みバッファを **インプレース復号** する |

### 動的解析のポイント

1. **子プロセスゲーティング必須**: `LINE.exe` は `LineLauncher.exe` → `LINE.exe` と
   再起動するため、spawn 直後のプロセスにフックしても無駄。
   `session.enableChildGating()` + `device.childAdded` で孫まで計装する
2. **NtCreateFile でハンドル→.edb 対応を記録** → NtReadFile onLeave でバッファ特定
3. 復号は read 完了後すぐ同期的に走るため、`setTimeout(40ms)` でバッファを再読みすると
   平文ページが得られる（SQLite ページキャッシュバッファなので寿命が長い）
4. page1 判別: 暗号文先頭 `cf8055c5…`、平文は `SQLite format 3\0` + `10 00 02 02 00 40 20 20`

### スキーマ（主要テーブル）

```sql
CREATE TABLE _message(
  _from TEXT, _to TEXT, _toType INTEGER, _id TEXT,
  _createdTime INTEGER, _deliveredTime INTEGER, _text TEXT,
  _location TEXT, _hasContent INTEGER, _contentType INTEGER,
  _contentMetadata TEXT, _contentPreview TEXT, _sessionId INTEGER,
  _chunks TEXT, _relatedMessageId TEXT, ... ,
  PRIMARY KEY ( _id ) )
CREATE TABLE _chat(_id TEXT, _midType INTEGER, _lastMessage TEXT, ...)
```

- メッセージ本体は **JSON blob** として格納されている
  （`{"from":"u...","to":"c...","id":"...", "createdTime":..., "text":"...", ...}`）

### 失敗ログ（再試行時の注意）

- 論文ベース鍵総当たり: メモリから 32-hex 候補 5000+ × variants × quirk → 厳密検証全滅
- AES 鍵スケジュール検索: メモリダンプ 332MB に完全スケジュールなし（AES-NI/オンザフライ？）
- MemoryAccessMonitor: T テーブル・暗号文バッファともに access を 1 件も報告せず（信頼不可）
- bcrypt / NtReadFile 単体フック: LINE は再起動するため spawn 直後の計装では捉えられない

## 未解決

- [ ] ディスク上の .edb 単体での復号（鍵/アルゴリズムの解明）
- [ ] FTS インデックスを使った強制的全文読み込みトリガ
- [ ] Vyline RPC 経由の全件バックフィールとの統合（サーバ側履歴は Desktop 鍵 import で復号可）

## アーカイブ: 2026-08-23 のオフライン復号試行（全滅 → 保留）

以降のアプローチは **いったん封印**。現行方針は line-sbc（クラウドバックアップ鍵復元）の
TS 移植（`Vyline/packages/protocol/src/sbc/`）。再開時はこの節の資産を使う。

### 対象バージョン

- LINE Desktop **3957**（旧 3954 から更新、imageBase `0x7ff77cb80000`）
- 展開済み: `tools/data/unpacked_LINE.exe`（81.5MB、`bun run vyline:unpack`）

### 静的解析で得た RVA（3957）

| RVA | 役割 |
| --- | --- |
| `0x37d9478` | 64B padding（`derive` 系から参照、refs: `0x17daa25` / `0x2668090`） |
| `0x17DA9C0` | derive 入口（padding 参照命令の近傍） |
| `0x17da8e0` / `0x17da6a0` / `0x17da7f0` | derive wrapper 群 |
| `0x17dae50` | 別 derive 系関数 |
| `0x1834xxx` / `0x187exxx` / `0x1b22074` | caller 群 |

- フック自体は成功するが **passphrase 引数は未捕捉**（hex 読取が `(err)`、dump 0 件）
- 3954 用ツール: `%TEMP%\opencode\frida-final-pass.ts` / `final-brute.ts`（RVA 更新で再利用可）

### メモリ走査 → 総当たり（決定的に失敗）

- `memscan.ps1`（PowerShell + C# ReadProcessMemory、~7 秒/280MB）で稼働中 pid の
  全プロセス空間から 32-hex 文字列候補を抽出 → **93,314 候補**
- `apsw-sqlite3mc 3.53.4.0` で全候補 × `PRAGMA cipher='aes128cbc'` × `key`/`hexkey` 両モード
  ＋ 24 PRAGMA 変種（legacy/page_size/kdf_iter）を厳密検証 → **0 件一致**（0.7ms/attempt）
- 上位候補は長い hex 文字列（セッショントークン等）の部分窓だった
- 検証スクリプト: `%TEMP%\opencode\{sweep-all.py, test-variants.py, verify-cands.py}`
- DB コピー: `%TEMP%\opencode\dbtest\target.db(+wal)`

### 教訓

- 鍵はメモリに 32-hex 文字列として存在しない（生バイト or 導出直前の素材の可能性）
- wxSQLite3 互換導出（論文 MD5×51/52）は LINE 改造版とは不一致のまま
- 再開するなら: derive 入口 `0x17DA9C0` の引数トレース（Frida `onEnter` でレジスタ/スタック
  ダンプ）か、NtReadFile インプレース復号バッファからの生鍵捕捉（既存 dump ツール路線）
