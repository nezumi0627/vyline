# Vyline のアップデート方法

最終更新: 2026-08-24

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

## Docker の場合

```bash
docker compose pull        # GHCR の最新 Vyline イメージを取得
docker compose up -d
```

ソースコードから再ビルドする場合は `docker compose up -d --build` を使います。

## 更新前のバックアップ（推奨)

- アプリ内: 設定 > 詳細・復元 > **VylineBackup** でスナップショット作成
- または `Vyline/backend/data/` ディレクトリを丸ごとコピー

## 更新後の確認

```bash
bun run test:api   # backend 起動中なら全エンドポイントを検証
```

アプリの動作確認ポイント:

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
