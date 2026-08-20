# unpack — Themida LINE.exe → unpacked_LINE.exe

[ergrelet/unlicense](https://github.com/ergrelet/unlicense) を使って、Desktop LINE の Themida 保護を動的に unpack し、`data/unpacked_LINE.exe` に配置します。

> **教育・実験目的のみ。** 対象を実際に起動・計装します。自分の環境・自分のインストールに限定し、dump の再配布はしないでください。  
> 詳細: [DISCLAIMER.md](./DISCLAIMER.md)

## 前提

- Windows x64
- Desktop LINE がインストール済み（`%LOCALAPPDATA%\LINE\bin\<ver>\LINE.exe`）
- **可能なら LINE を終了してから実行**（稼働中だと競合しやすい）
- unlicense は対象を **実際に起動** する（信頼できる環境 / VM 推奨）

## 使い方

```powershell
# インストール済み LINE.exe を自動検出して unpack
bun run unpack

# timeout を延ばす（既定 120s）
bun run unpack -- --timeout 180

# パス明示
bun run unpack -- --exe "C:\Users\...\LINE\bin\26.3.0.3916\LINE.exe"

# CLI 経由
bun run search -- unpack
```

成功後:

```powershell
bun run find -- sendMessage --list-only
```

## オプション

| オプション | 既定 | 説明 |
|---|---|---|
| `--exe <path>` | 自動検出 | 対象 LINE.exe |
| `--out <path>` | `data/unpacked_LINE.exe` | 出力 |
| `--timeout <sec>` | 120 | OEP 到達待ち |
| `--skip-download` | off | unlicense 自動取得をスキップ |
| `--keep-work` | off | `data/unpack-work/` を残す |
| `--verbose` | off | unlicense 詳細ログ |

## 動作概要

1. `%LOCALAPPDATA%\LINE`（または `NEZU_LINE_ROOT`）から最新 `LINE.exe` を解決
2. 無ければ [unlicense Releases](https://github.com/ergrelet/unlicense/releases) の x64 zip を `data/re-tools/unlicense/` へ取得（`curl` 優先）
3. **インストールディレクトリを cwd にして** `unlicense.exe LINE.exe` を実行  
   （exe 単体コピーだと Qt/DLL 不足で Frida inject が失敗する）
4. 生成された `unpacked_LINE.exe` を `data/unpacked_LINE.exe` へコピーし、インストール先の dump は削除
5. `data/unpack-meta.json` にメタ情報を保存

## 制限

- dump は **静的解析用**。多くの場合そのまま起動できる exe にはならない
- Themida の **仮想化コード (VM)** は解除されない
- OEP に届かない / Frida 拒否時は `--timeout` 延長、LINE 完全終了、管理者実行を試す
- 初回は unlicense 取得に数十秒かかることがある

## 関連

- [find-native-symbol.md](./find-native-symbol.md) — unpack 後のシンボル検索
- 上流: https://github.com/ergrelet/unlicense
