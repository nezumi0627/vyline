# LINE Desktop 解析手法（再利用ガイド）

最終更新: 2026-08-24
対象: Windows 版 LINE Desktop（`LINE.exe`）  
目的: **手法の記録**。成果物の秘密値は書かない。

---

## 安全ルール（必読）

- `desktop-e2ee-keys.json` / token / session / mid 実値は **絶対にコミットしない**
- `.gitignore` 済みパスを尊重する（`Vyline/backend/data/`、`**/desktop-e2ee-keys.json` 等）
- 解析結果をチャットや PR に貼るときは **赤act** する
- 連絡先へのメッセージ送信はしない（報告は Official Account broadcast のみ）

---

## 1. 稼働中メモリからの抽出（優先）

LINE.exe は Themida 等で保護されており、**PE 静的スキャンは弱い**。  
identity 文字列・（E2EE 鍵抽出時は）keychain 相当は **プロセス実行中のメモリ** を優先する。

### Identity 向け（実装済み）

`Vyline/packages/protocol/src/desktop/extract.ts` の `dumpRuntimeIdentity`:

- PowerShell + `ReadProcessMemory` / `VirtualQueryEx`
- プロセス名 `LINE` を検索
- ASCII ニードル例: `DESKTOPWIN.`, `DESKTOP:WINDOWS:`, `X-Line-Application:`, `User-Agent: DESKTOP`
- ヒットから `parseRuntimeApplicationHeader` / `parseRuntimeUserAgent` で identity 構築

管理者権限なしの `QUERY_INFO | VM_READ` を試行。失敗時は PE スキャンや synthetic にフォールバック。

### E2EE 自己鍵向け

- Desktop はメモリ上の keychain に **複数世代の自己鍵** を保持する。
- 抽出結果は次の形で保存する（パス固定）:

```
Vyline/backend/data/desktop-e2ee-keys.json
```

- 必須フィールド: `keys[].keyId`, `privKey` (base64), `pubKey` (base64)
- 任意: `mid`, `extractedAt`, `e2eeVersion`
- Vyline 起動時 / `ensureValidE2EEIdentity` が自動 import

**注意:** 鍵ダンプ用スキャナの詳細バイナリシグネチャは環境依存のため、ここでは「稼働中メモリ → JSON」という手順だけを固定する。実装は protocol / research 側の現行スクリプトに従う。

---

## 2. PE / バイナリ文字列スキャン

### ASCII

バッファを走査し、printable (`0x20`–`0x7e`) が連続する区間を文字列として採取。  
フィルタ例:

- `DESKTOPWIN`
- `DESKTOP:WINDOWS`
- `X-Line-Application` / `x-line-application`
- `User-Agent: DESKTOP`
- `legy-jp.line-apps.com`

実装参照: `extractAsciiStrings` / `pickDesktopSamples` / `scanPeFile`（`extract.ts`）。

### UTF-16LE

Windows バイナリ・メモリではヘッダが UTF-16 で残ることがある。  
`D\0E\0S\0K\0T\0O\0P\0W\0I\0N\0` のようなパターンも同様にスキャンする（必要なら独自に追加）。

### ヘッダ形式（確定）

区切りは **TAB (`0x09`)**。ドット表示は誤読しやすい。

```
x-line-application: DESKTOPWIN\t{appVer}\tWINDOWS\t{sysVer}-{ntSuffix}
user-agent: DESKTOP:WINDOWS:{sysVer}-{ntSuffix}({appVer})
```

例（バージョンは環境依存）:

```
DESKTOPWIN\t26.3.0.3916\tWINDOWS\t10.0.26100-11NT
```

コード: `Vyline/packages/protocol/src/desktop/identity.ts`

---

## 3. アプリバージョンの取得

優先順の目安:

1. **稼働中メモリ**の `DESKTOPWIN` / UA 文字列（最もランタイムに近い）
2. **インストールパス**配下のバイナリ名・フォルダ（例: `%LOCALAPPDATA%\LINE`）
3. **`update_info`** 等の更新メタデータ（存在すれば）

コード: `Vyline/packages/protocol/src/desktop/version.ts` / `paths.ts`  
Updater: `Vyline/packages/protocol/src/updater/VylineUpdater.ts`（更新検知・差分メモ）

---

## 4. `.edb` と wxSQLite3

- Desktop のローカル DB は **`.edb`** として存在し、**wxSQLite3 系で at-rest 暗号化**されている。
- ディスク上の `.edb` をそのまま SQLite クライアントで開いても鍵は取れない想定。
- 現状の現実解: **稼働中プロセスのメモリ**から keychain / identity を取る。
- `.edb` 解読は未確立 — 成功したら本ドキュメントに追記する。

### 実装中の復号ツール（2026-07-29）

論文: Kang et al., _Electronics_ 2024, 13(7), 1325（wxSQLite3 + LINE Desktop）。

- パスフレーズ: ログイン後にサーバから来る **32 文字 hex**（アカウント固有）
- 鍵派生: wxSQLite3 AES-128-CBC + LINE 改変 Algorithm 3
- 実装:
  - `Vyline/packages/protocol/src/desktop/wxSqlite3.ts`
  - `bun run --cwd Vyline/packages/protocol decrypt-edb`（`LINE.exe` 稼働中にメモリから候補スキャン）
- 現状: `LINE.exe` 未起動だと候補 0。起動中に再実行して検証する。
- `.edb` ヘッダ offsets 16–23 が平文メタ（本環境では `1000…` = pageSize 4096）で wxSQLite3 判定済み。

---

## 5. 成果物の置き場

| 成果物               | パス                                         | git            |
| -------------------- | -------------------------------------------- | -------------- |
| E2EE 自己鍵 dump     | `Vyline/backend/data/desktop-e2ee-keys.json` | **禁止**       |
| その他 data          | `Vyline/backend/data/`                       | **禁止**       |
| 解析メモ（秘密なし） | `docs/analysis/`                             | 可             |
| research 生データ    | `/research/`                                 | gitignore 済み |

`.gitignore` 関連エントリ例:

- `Vyline/backend/data/`
- `**/desktop-e2ee-keys.json`
- `**/desktop-e2ee-dump.txt`
- `**/tokens.json`

---

## 6. チェックリスト（毎回）

1. LINE Desktop を対象アカウントで起動する
2. identity が取れるか（debug / protocol extract）を確認する
3. E2EE 鍵 dump を `desktop-e2ee-keys.json` に書く
4. `git status` で data ファイルが **出ていない**ことを確認する
5. Vyline で `ensureValidE2EEIdentity` / decrypt-test を回す
6. 不要な生ダンプはローカル削除または data 配下に閉じる

---

## 参照

- [e2ee-decrypt-journey.md](./e2ee-decrypt-journey.md)
- [../login-flow.md](../login-flow.md)
- `Vyline/packages/protocol/src/desktop/*`
