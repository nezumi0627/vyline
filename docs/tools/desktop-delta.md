# desktop-delta — Desktop LINE 更新差分調査

最終更新: 2026-08-24

`bun run vyline:delta` は、インストール済み LINE Desktop の最新バージョンと、キャッシュされたプロファイルの差分をレポートします。

- **スクリプト**: `Vyline/packages/protocol/src/tools/reportDesktopDelta.ts`
- **出力**: `docs/reports/desktop-delta-YYYYMMDD.md` と `.json`

```powershell
bun run vyline:delta
```

## 出力フォーマット

Markdown レポートの構造:

```
## Summary
- installedVersion: 26.x.x
- cachedVersion:    25.x.x
- updateFrom:       <date>

## Added / Removed / Changed RPC entries
<diff table>

## Changed strings
<diff>
```

JSON レポート (`desktop-delta-YYYYMMDD.json`):

```json
{
  "installedVersion": "26.7.2",
  "cachedVersion": "26.6.1",
  "installedAt": "2026-XX-XX",
  "updateFrom": "...",
  "entries": { "added": [], "removed": [], "changed": [] },
  "strings": { "added": [], "removed": [], "changed": [] }
}
```

## 使い方

1. LINE Desktop を最新版に更新
2. `bun run vyline:delta` を実行
3. `docs/reports/` 以下の差分レポートを確認
4. 不要な RPC または変更された API を `rpcMap.ts` に反映

> **注意**: 解析結果（バイナリダンプなど）は含めず、差分レポートのみをコミット対象にします。
> 詳細: [vyline-search.md](./vyline-search.md)
