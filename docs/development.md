# Development Workflow

最終更新: 2026-08-24

---

## セットアップ

```powershell
# Bun 1.4 以上 (推奨環境・engines で強制はしない)
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

# protocol stack 型定義
cd Vyline/packages/protocol && bun run stack:types

# Desktop 調査
bun run vyline:dump-desktop              # インストール一式 → source/desktop/
bun run vyline:dump-desktop -- --full    # Data/bin ミラー + exe 文字列
bun run vyline:find-native -- sendMessage --list-only --skip-setup
bun run vyline:delta
bun run vyline:focus-recovered -- sendMessage
```

---

## プロトコル機能を足すとき

1. [protocol/dictionary.md](./protocol/dictionary.md) で RPC 名を確認
2. `bun run vyline:find-native` で Desktop 検証
3. `protocol/src/domain/` に facade
4. `backend/src/service/lineService.ts` + `api/line.ts`
5. `dictionary/rpcMap.ts` + docs 更新

詳細: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 環境変数

| 変数                     | 用途                                                                  | デフォルト                         |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------- |
| `VYLINE_DEVICE`          | `IOSIPAD` / `ANDROIDSECONDARY` / `DESKTOPWIN` / `DESKTOPMAC`          | `IOSIPAD`                          |
| `VYLINE_DATA_DIR`        | backend データ（token, storage, chatdb, feature-locks, vyline-cache） | `backend/data/`                    |
| `VYLINE_CDN_CACHE_DIR`   | スタンプ / sticon CDN キャッシュ                                      | `backend/data/cdn-cache/`          |
| `VYLINE_MEDIA_STORAGE_DIR` | 送信済み・取得済みメディアの永続ストレージ                     | `backend/storage/saved-media/`     |
| `VYLINE_HOST`            | バックエンドの bind アドレス                                          | `127.0.0.1`（Docker は `0.0.0.0`） |
| `VYLINE_LAN_ACCESS`      | 同一LANのサブデバイス接続を有効化。未設定/false はlocalhostのみ             | `false`                            |
| `PORT`                   | バックエンドの listen ポート                                          | `3001`                             |
| `VYLINE_CORS_ORIGIN`     | CORS 許可オリジン（dev は Vite 5173）                                 | `http://localhost:5173`            |
| `VYLINE_STATIC_DIR`      | 本番で配信するフロントビルドの場所                                    | `apps/desktop/dist/`               |

> セルフホストの詳細は [selfhosting.md](./selfhosting.md) を参照。
> サブデバイスのQR接続は [サブデバイス接続ガイド](./subdevices.md) を参照。

`VYLINE_MEDIA_CACHE_DIR` も旧設定として読み込まれますが、新規環境では
`VYLINE_MEDIA_STORAGE_DIR` を使用してください。

---

## 新規参入

[onboarding.md](./onboarding.md) のチェックリストから始める。
