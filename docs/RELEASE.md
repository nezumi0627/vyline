# Release — バージョン管理とリリース手順

## バージョンは 4 箇所を同一に揃える（必須）

| 場所 | フィールド |
| --- | --- |
| ルート `package.json` | `version` |
| `Vyline/apps/desktop/package.json` | `version` |
| `Vyline/apps/desktop/src/lib/store.ts` | `UPDATE_NOTES.version` |
| `README.md` | バッジの `version-...` |

確認コマンド:

```bash
node -p "require('./package.json').version"
node -p "require('./Vyline/apps/desktop/package.json').version"
grep -n 'version:' Vyline/apps/desktop/src/lib/store.ts
grep -n 'version-' README.md
```

## 規則

- 形式はセマンティックバージョン（`X.Y.Z` または `X.Y.Z-beta`）
- `beta` は非公開テスト段階を示す。public リリース前に外す
- `CHANGELOG.md` に同バージョンのエントリを追加する
- `UPDATE_NOTES.items` に変更内容を箇条書きで書く（ユーザーが起動時に見る内容）

## リリース時

[distribution.md](distribution.md) のリリースチェックリストに従う。

## 関連

- [../CHANGELOG.md](../CHANGELOG.md)
- [distribution.md](distribution.md)
