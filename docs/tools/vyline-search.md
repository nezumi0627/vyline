# vyline-search — 解析ツールキット

[github.com/nezumi0627/vyline-search](https://github.com/nezumi0627/vyline-search) は、LINE Desktop の解析を支援するツールキットです。  
このリポジトリ内の `Vyline/tools/` ディレクトリにツール本体が同梱されており、`package.json` の `nezu:*` スクリプトから実行できます。

> **教育・実験目的のみ。** 対象は自分の環境・自分のインストールに限定し、解析結果の再配布はしないでください。  
> 詳細: [DISCLAIMER.md](./DISCLAIMER.md)

## ツール一覧

| コマンド | スクリプト | 説明 |
|----------|-----------|------|
| `bun run nezu:unpack` | `Vyline/tools/unpackLine.ts` | Themida 保護された `LINE.exe` を unpack |
| `bun run nezu:find-native` | `Vyline/tools/findNativeSymbol.ts` | 文字列・関数名からネイティブシンボルを自動特定し decompile |
| `bun run nezu:focus-recovered` | `Vyline/tools/focusRecoveredSource.ts` | 大量 decompile 済みソースをキーワード別に分類 |
| `bun run nezu:delta` | `Vyline/packages/protocol/src/tools/reportDesktopDelta.ts` | Desktop LINE 更新 vs キャッシュプロファイルの差分レポート |
| `bun run nezu:extract-e2ee` | `Vyline/packages/protocol/src/tools/extractDesktopE2EEKeys.ts` | Desktop LINE プロセスから E2EE 鍵を抽出 |
| `bun run nezu:decrypt-edb` | `Vyline/packages/protocol/src/tools/decryptDesktopEdb.ts` | ローカル EDB データベースの復号 |

## ワークフロー

```
1. bun run nezu:unpack      → data/unpacked_LINE.exe
2. bun run nezu:find-native -- <symbol>   → シンボル検索 + decompile
3. bun run nezu:focus-recovered           → 結果を分類整理
4. bun run nezu:delta                     → Desktop 更新差分レポート
```

### 1. Unpack (`unpackLine.ts`)

Themida 保護を動的除去し、解析可能な PE を生成します。

```powershell
bun run nezu:unpack                          # 自動検出
bun run nezu:unpack -- --exe "path/LINE.exe" # パス指定
bun run nezu:unpack -- --timeout 180        # タイムアウト延長
```

- **前提**: Windows x64、Desktop LINE インストール済み
- **出力**: `data/unpacked_LINE.exe` + `data/unpack-meta.json`
- **注意**: 自動的に unlicense をダウンロード・実行するため、**信頼できる環境（VM推奨)** で実施

### 2. Find Native Symbol (`findNativeSymbol.ts`)

文字列や関数名を入力するだけで、関連するネイティブコードを自動特定し decompile します。

```powershell
bun run nezu:find-native -- sendMessage
bun run nezu:find-native -- "sync" --list-only     # リストのみ
bun run nezu:find-native -- --max-functions 10     # 関数数制限
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
bun run nezu:focus-recovered                              # デフォルト解析
bun run nezu:focus-recovered -- --manifest-only            # マニフェストのみ
bun run nezu:focus-recovered -- --source-dir path\to\src  # パス指定
bun run nezu:focus-recovered -- --group storage=Storage|Index  # グループ指定
```

- **入力**: `data/recovered/src/native/LINE.exe`（既定）
- **出力**: `data/out/focused/`

> **注意**: 各ツールの詳細な使い方は各ドキュメントを参照してください。
> - [unpack.md](./unpack.md)
> - [find-native-symbol.md](./find-native-symbol.md)
> - [focus-recovered-source.md](./focus-recovered-source.md)

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
bun run nezu:delta
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
