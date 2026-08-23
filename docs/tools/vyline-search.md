# vyline-search — 解析ツールキット

最終更新: 2026-08-24

[github.com/nezumi0627/vyline-search](https://github.com/nezumi0627/vyline-search) は、LINE Desktop の解析を支援するツールキットです。  
このリポジトリ内の `Vyline/tools/` ディレクトリにツール本体が同梱されており、`package.json` の `vyline:*` スクリプトから実行できます。

> **教育・実験目的のみ。** 対象は自分の環境・自分のインストールに限定し、解析結果の再配布はしないでください。  
> 詳細: [DISCLAIMER.md](./DISCLAIMER.md)

## ツール一覧

| コマンド                         | スクリプト                                                     | 説明                                                       |
| -------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `bun run vyline:check`           | `Vyline/tools/src/checkVersion.ts`                             | インストール版 / 実行中版 / 最新版の比較                   |
| `bun run vyline:latest`          | `Vyline/tools/src/cli.ts latest`                               | Desktop 最新版バージョンの取得                             |
| `bun run vyline:update`          | `Vyline/tools/src/updateLine.ts`                               | LINE Desktop を最新版へ更新（`--unpack` で unpack も実施） |
| `bun run vyline:versions`        | `Vyline/tools/src/versions.ts`                                 | インストール済みバージョン一覧                            |
| `bun run vyline:unpack`          | `Vyline/tools/src/unpackLine.ts`                               | Themida 保護された `LINE.exe` を unpack                    |
| `bun run vyline:find-native`     | `Vyline/tools/src/findNativeSymbol.ts`                         | 文字列・関数名からネイティブシンボルを自動特定し decompile |
| `bun run vyline:focus-recovered` | `Vyline/tools/src/focusRecoveredSource.ts`                     | 大量 decompile 済みソースをキーワード別に分類              |
| `bun run vyline:delta`           | `Vyline/packages/protocol/src/tools/reportDesktopDelta.ts`     | Desktop LINE 更新 vs キャッシュプロファイルの差分レポート  |
| `bun run vyline:extract-e2ee`    | `Vyline/packages/protocol/src/tools/extractDesktopE2EEKeys.ts` | Desktop LINE プロセスから E2EE 鍵を抽出                    |
| `bun run vyline:decrypt-edb`     | `Vyline/packages/protocol/src/tools/decryptDesktopEdb.ts`      | ローカル EDB データベースの復号                            |

> ツール本体は `Vyline/tools/` に同梱（src: [Vyline-Search](https://github.com/nezumi0627/vyline-search)）。
> `VYLINE_SEARCH_DATA` でデータルートを切り替え可（既定 `tools/data/`）。

## ワークフロー

```
0. bun run vyline:update -- --unpack   → LINE を最新化 + unpack まで一括
1. bun run vyline:check                → バージョン確認（現在 vs 最新）
2. bun run vyline:unpack               → data/unpacked_LINE.exe
3. bun run vyline:find-native -- <symbol>   → シンボル検索 + decompile
4. bun run vyline:focus-recovered      → 結果を分類整理
5. bun run vyline:delta                → Desktop 更新差分レポート
```

### 0. バージョン確認 / 更新 (`check` / `latest` / `update` / `versions`)

```powershell
bun run vyline:check                  # 現在 / 最新の比較
bun run vyline:check -- --json        # JSON 出力
bun run vyline:latest                 # 最新版だけ出力（例: 26.4.2.3955）
bun run vyline:versions               # インストール済みバージョン一覧
bun run vyline:check -- --version 26.4.2.3954   # 指定バージョンで比較
bun run vyline:update -- --dry-run    # 更新対象の確認のみ
bun run vyline:update                 # 最新版をダウンロードしてインストール
bun run vyline:update -- --unpack     # 更新後に unpack まで実施
```

- **インストール済みバージョン選択**: `vyline:unpack -- --version <ver>` /
  `vyline:check -- --version <ver>` で、インストール済みの任意バージョン（過去版含む）を
  明示的に指定できます。未インストールのバージョンを指定すると、利用可能な一覧を表示します。
- **更新対象の決定**: `update_info.json`（`https://desktop.line-scdn.net/win/v2/real/update_info.json`）から
  target / os / systemType が現在のインストールに一致するエントリを解決する
- **配信 URL**: `{baseUrl}/{version}/LINE.zip` + `{shared.baseUrl}/{sharedVersion}/lib.zip`
- **展開先**: `%LOCALAPPDATA%\LINE\bin\<version>\` + `bin/shared\<sharedVersion>\`
- **LINE.ini** の `last_updated_version` を更新（次回起動で新バージョンが使われる）
- **注意**: 更新は LINE 停止後に行うのが安全（稼働中は次回起動時に反映）

### 1. Unpack (`unpackLine.ts`)

Themida 保護を動的除去し、解析可能な PE を生成します。

```powershell
bun run vyline:unpack                          # 自動検出
bun run vyline:unpack -- --exe "path/LINE.exe" # パス指定
bun run vyline:unpack -- --version 26.4.2.3954 # インストール済みバージョンを指定
bun run vyline:unpack -- --timeout 180        # タイムアウト延長
```

- **前提**: Windows x64、Desktop LINE インストール済み
- **出力**: `data/unpacked_LINE.exe` + `data/unpack-meta.json`
- **注意**: 自動的に unlicense をダウンロード・実行するため、**信頼できる環境（VM推奨)** で実施
- **注意**: **LINE を終了してから実行**（稼働中は Frida 注入が拒否される）

### 2. Find Native Symbol (`findNativeSymbol.ts`)

文字列や関数名を入力するだけで、関連するネイティブコードを自動特定し decompile します。

```powershell
bun run vyline:find-native -- sendMessage
bun run vyline:find-native -- "sync" --list-only     # リストのみ
bun run vyline:find-native -- --max-functions 10     # 関数数制限
```

- **入力**: 検索キーワード（文字列 / 関数名）
- **出力**: `data/out/native-search/<slug>/` に `README.md`, `strings.json`, `xrefs.json`, `functions/`
- 使用可能な検索モード:
  - `string`: 文字列 xref 解析
  - `function`: 関数名 xref 解析
  - `regex`: 正規表現検索

### 3. Focus Recovered (`focusRecoveredSource.ts`)

既に大量に存在する decompile 済みソースをキーワード別に分類・再配置します。

```powershell
bun run vyline:focus-recovered                              # デフォルト解析
bun run vyline:focus-recovered -- --manifest-only            # マニフェストのみ
bun run vyline:focus-recovered -- --source-dir path\to\src  # パス指定
bun run vyline:focus-recovered -- --group storage=Storage|Index  # グループ指定
```

- **入力**: `data/recovered/src/native/LINE.exe`（既定）
- **出力**: `data/out/focused/`

> **注意**: 各ツールの詳細な使い方は各ドキュメントを参照してください。
>
> - [unpack.md](./unpack.md)
> - [find-native-symbol.md](./find-native-symbol.md)

## データディレクトリ構造

```
data/
├── unpacked_LINE.exe               # unpack 済みバイナリ
├── unpack-meta.json                # unpack メタ情報
├── recovered/
│   └── src/native/LINE.exe/        # Ghidra decompile 済みソース
│       └── ...                     # （gitignore 対象）
├── out/
│   ├── native-search/              # findNativeSymbol 出力
│   │   └── <slug>/                 #   README.md, strings.json, xrefs.json, functions/
│   └── focused/                    # focusRecoveredSource 出力
│       └── <group>/                #   キーワード別分類
└── line_decompiled/               # 外部解析データ（gitignore）
    └── ...
```

## Desktop 更新差分 (`reportDesktopDelta.ts`)

インストール済み LINE Desktop のバージョンと、キャッシュされたプロファイルの差分をレポートします。

```powershell
bun run vyline:delta
```

- **出力**: `docs/reports/desktop-delta-YYYYMMDD.md` + `.json`
- **用途**: 新しい LINE バージョンでの RPC 変更箇所の調査

## 関連リソース

- **メインプロジェクト**: [github.com/nezumi0627/Vyline](https://github.com/nezumi0627/Vyline)
- **解析ツールキット**: [github.com/nezumi0627/vyline-search](https://github.com/nezumi0627/vyline-search)
- **Thrift 型定義**: `Vyline/packages/line-types/line_types.ts`
- **Desktop プロファイル**: `Vyline/packages/protocol/src/desktop/`

## 免責事項

本ツールは **教育・学習・セキュリティ研究・相互運用性の理解**を目的とする実験用です。  
詳細は [DISCLAIMER.md](./DISCLAIMER.md) を参照してください。
