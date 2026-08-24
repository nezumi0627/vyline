# Docker デプロイ

最終更新: 2026-08-24

## ビルドと起動

```bash
docker compose pull
docker compose up -d
```

- アプリは `http://localhost:3000` で起動する（フロントエンド同梱）。
- 永続データは `./data` と `./storage`（トークン・チャット DB・保存メディア等）。

## 更新

```bash
git pull
docker compose up -d --build
```

更新前に `data/` のバックアップを推奨（VylineBackup またはディレクトリコピー）。

## 環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `PORT` | `3000` | リッスンポート |
| `VYLINE_HOST` | `0.0.0.0` | バインドアドレス |
| `VYLINE_DATA_DIR` | `/app/data` | 永続データ |
| `VYLINE_STORAGE_DIR` | `/app/storage` | 保存メディアなどの永続ストレージ |
| `VYLINE_CORS_ORIGIN` | `http://localhost:5173` | CORS 許可オリジン |
| `VYLINE_API_ADMIN_SECRET` | 未設定 | 公開 API (/v1) の管理トークン発行用 |

## 注意

- 初回ログイン（QR / メール）はブラウザから行う。
  セッションは `data/tokens.json` に保存されるため、ボリュームの永続化が必須。
- E2EE 鍵など機密データを含むため `data/` を公開リポジトリやイメージに含めないこと。

## ロードマップ

README の Server Mode 要件（/metrics、プラグインディレクトリ、systemd 等）は順次対応。
