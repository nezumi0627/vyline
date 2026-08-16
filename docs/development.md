# Development Workflow

最終更新: 2026-07-29

---

## セットアップ

```powershell
# Bun (未インストール時)
# https://bun.sh

git clone <repo>
cd vyline
bun install
bun run typecheck
```

backend / frontend の個別 install は workspace 経由で `bun install` 一回で足りる。

---

## 開発サーバー

```powershell
bun run dev              # backend :3001 + frontend :5173
bun run dev:backend
bun run dev:frontend
```

---

## よく使うコマンド

```powershell
bun run typecheck
bun run lint
bun test

# nezuline stack 型定義
cd Vyline/packages/nezuline && bun run stack:types

# Desktop 調査
bun run nezu:dump-desktop              # インストール一式 → source/desktop/
bun run nezu:dump-desktop -- --full    # Data/bin ミラー + exe 文字列
bun run nezu:find-native -- sendMessage --list-only --skip-setup
bun run nezu:delta
bun run nezu:focus-recovered -- sendMessage
```

---

## プロトコル機能を足すとき

1. [protocol/dictionary.md](./protocol/dictionary.md) で RPC 名を確認
2. `bun run nezu:find-native` で Desktop 検証
3. `nezuline/src/domain/` に facade
4. `backend/src/service/lineService.ts` + `api/line.ts`
5. `dictionary/rpcMap.ts` + docs 更新

詳細: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 環境変数

| 変数 | 用途 |
|---|---|
| `VYLINE_DEVICE` | `ANDROIDSECONDARY` / `DESKTOPWIN` 等 |
| `VYLINE_DATA_DIR` | backend データ（token, storage） |

---

## 新規参入

[onboarding.md](./onboarding.md) のチェックリストから始める。
