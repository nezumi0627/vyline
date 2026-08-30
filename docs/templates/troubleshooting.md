# <問題名> トラブルシューティング

最終更新: YYYY-MM-DD

## 概要

どの症状を扱う文書か、対象環境は何かを書きます。

## 症状

- 表示されるエラー:
- 発生する画面 / コマンド:
- いつから発生したか:

## まず確認すること

```bash
bun run vyl:doctor
```

必要に応じて次も確認します。

```bash
bun run typecheck
bun run lint
```

## 原因候補

| 原因 | 確認方法 | 対処 |
| --- | --- | --- |
| 例: `.env` がない | `ls .env` | `bun run vyl:fix` |

## 修復手順

1. 安全な確認手順を書く
2. データを変更する場合は Snapshot を作成する
3. 修復コマンドを書く

```bash
bun run vyl snapshot create before-fix
```

## 解決確認

- 期待される表示
- 確認するログ
- 再発時に集める情報

## 関連ドキュメント

- [vyl CLI](../../Vyline/docs/vyl-cli.md)
- [開発ガイド](../development.md)
