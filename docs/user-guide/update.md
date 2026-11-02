# Vyline のアップデート方法

最終更新: 2026-11-03

**安定版: 1.0.3** — [リリース一覧と各 OS の配布物](https://github.com/nezumi0627/vyline/releases/tag/v1.0.3)

## ソースから実行している場合

### 1 コマンドで更新

```bash
bun run update
```

内部で以下が順に実行されます:

1. `git submodule update --init --recursive` — vyline-api（プロトコルスタック）などサブモジュール取得
2. `git pull --ff-only` — 本体の最新化
3. `bun install` — 依存関係の更新
4. `bun run build` — フロントエンド再ビルド

実行後、backend / frontend を再起動してください（`bun run dev` の再起動、または
`bun run server` のプロセス再起動）。

> [!TIP]
> `git pull` で競合が出た場合はローカル変更がないか確認してください。
> 設定・データ（`Vyline/backend/data/`）は git 管理外なので更新で失われません。

ソースから安定版 1.0.3 を使う場合は、最初に `git checkout v1.0.3` でタグを選びます。タグ上では `bun run update` を使わず、次の安定版へ移るときに新しいタグへ切り替えてください。

## Docker の場合

```bash
export VYLINE_IMAGE=ghcr.io/nezumi0627/vyline:v1.0.3
docker compose pull
docker compose up -d
```

ソースコードから再ビルドする場合は `docker compose up -d --build` を使います。

## 更新前のバックアップ（推奨)

- アプリ内: 設定 > 詳細・復元 > **VylineBackup** でスナップショット作成
- または `Vyline/backend/data/` と `Vyline/backend/storage/` を Vyline 停止後にコピー

## 更新後の確認

更新後はアプリを開き、次を確認します:

- ログイン状態が維持されている（プロフィールが表示される）
- チャット一覧・メッセージ履歴が表示される
- 画像の送受信ができる

## うまくいかないとき

| 症状 | 対処 |
|---|---|
| `submodule` 関連エラー | `git submodule update --init --recursive --force` |
| 型エラーで build 失敗 | `rm -rf node_modules && bun install` 後に再試行 |
| 起動しない | `Vyline/backend/data/logs/backend-debug.log` を確認し Issue へ |

ロールバック:

```bash
git log --oneline -5          # 戻りたいコミットを探す
git checkout <commit>
git submodule update --init --recursive
bun install && bun run build
```
