# Development Workflow

最終更新: 2026-08-26

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
| `VYLINE_LAN_ACCESS`      | LAN／Tailscaleからのサブデバイス接続を有効化。未設定/false はlocalhostのみ | `false`                            |
| `PORT`                   | バックエンドの listen ポート                                          | `3001`                             |
| `VYLINE_CORS_ORIGIN`     | CORS 許可オリジン（dev は Vite 5173）                                 | `http://localhost:5173`            |
| `VYLINE_STATIC_DIR`      | 本番で配信するフロントビルドの場所                                    | `apps/desktop/dist/`               |
| `VYLINE_LINE_ROOT`       | LINE Desktop インストールルート（`%LOCALAPPDATA%\LINE`）の上書き      | `%LOCALAPPDATA%\LINE`              |
| `VYLINE_DISABLE_WATCH`   | `1` で Desktop 更新監視（VylineUpdater watcher）を無効化              | 未設定（有効）                     |

> セルフホストの詳細は [selfhosting.md](./selfhosting.md) を参照。
> サブデバイスのQR接続は [サブデバイス接続ガイド](./subdevices.md) を参照。
> PCとスマホの遠隔接続は、ポート開放ではなくTailscaleを推奨します。Vyline起動後、ログに表示されたTailscale URLを使用してください。

`VYLINE_MEDIA_CACHE_DIR` も旧設定として読み込まれますが、新規環境では
`VYLINE_MEDIA_STORAGE_DIR` を使用してください。

---

## バックエンドログ解説 (VylineUpdater)

`bun run dev:backend` で定期的に出る `VylineUpdater` ログはエラーではなく正常動作。

```
[backend] INFO  [VylineUpdater] refreshed Desktop profile 26.4.2.3954 via scan
[backend] WARN  LINE Desktop updated — Vyline profile refreshed reason="ini-changed" appVersion="26.4.2.3954" xLineApplication="DESKTOPWIN\t26.4.2.3954\tWINDOWS\t10.0.26100-11NT"
```

### 何をしているか

Vyline は LINE サーバに送る `User-Agent` / `X-Line-Application` を実機の LINE Desktop と完全一致させる必要がある（不一致だと弾かれる）。`VylineUpdater` が起動時にインストール版 `LINE.exe` からプロファイル（`desktop-profile.json`）を確定し、以後はファイル監視で追従する。— `Vyline/packages/protocol/src/updater/VylineUpdater.ts:118` / `Vyline/backend/src/vyline/profileBridge.ts:28`

| ログ | 意味 |
| ---- | ---- |
| `refreshed Desktop profile 26.4.2.3954 via scan` | `LINE.exe` をスキャンして Desktop プロファイルを再生成した（`VylineUpdater.ts:208`）。`via scan` = PE スキャン、`via runtime` = 起動中 `LINE.exe` メモリダンプ |
| `LINE Desktop updated — Vyline profile refreshed` + `reason` | `watcher` が更新トリガーを検知して `refresh()` を呼んだ（`profileBridge.ts:57`）。`appVersion` が変わっていなければ再同期のみ |

### `reason` 一覧

`Vyline/packages/protocol/src/updater/watcher.ts:30,42,50,58`

| `reason` | 監視対象 | パス |
| -------- | -------- | ---- |
| `ini-changed` | `LINE.ini` の更新 | `%LOCALAPPDATA%\LINE\Data\LINE.ini` (`desktop/paths.ts:25`) |
| `bin-folder-changed` | `bin/` 配下の変更（バージョン追加/削除） | `%LOCALAPPDATA%\LINE\bin\` |
| `update-log-changed` | 更新ログの変更 | `%LOCALAPPDATA%\LINE\bin\update_log.txt` |

監視は `fsWatch` + `pollIntervalMs: 30_000` のポーリング併用、発火は `debounceMs: 2_000` でまとめられる（`watcher.ts:32,88`）。LINE 本体が起動中は `LINE.ini` が頻繁に書き換わるため、同じバージョンで `ini-changed` が連続して出るのは正常。`WARN` は「気づけるように」意図的に上げているだけで異常ではない。

### 止めたい場合

開発中にログが騒がしい場合は一時的に無効化できるが、Desktop が自動更新された時にヘッダがズレるため常用は非推奨。

```powershell
$env:VYLINE_DISABLE_WATCH = "1"
bun run dev:backend
```

---

## 新規参入

[onboarding.md](./onboarding.md) のチェックリストから始める。
