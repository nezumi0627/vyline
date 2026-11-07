# Docker デプロイ

最終更新: 2026-11-03

## ビルドと起動

```bash
export VYLINE_IMAGE=ghcr.io/nezumi0627/vyline:v1.2.3
docker compose pull
docker compose up -d
```

- 安定版 1.2.3 は `ghcr.io/nezumi0627/vyline:v1.2.3` です。アプリは `http://localhost:3000` で起動します（フロントエンド同梱）。
- Compose の既定値ではホストの `127.0.0.1:3000` にだけ公開され、他の端末からは接続できません。
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
| `VYLINE_BIND_ADDRESS` | `127.0.0.1` | Compose がホスト側で公開するアドレス |
| `VYLINE_LAN_ACCESS` | `false` | `true` の場合、LAN API をペアリング済みサブデバイスに制限 |
| `VYLINE_DATA_DIR` | `/app/data` | 永続データ |
| `VYLINE_STORAGE_DIR` | `/app/storage` | 保存メディアなどの永続ストレージ |
| `VYLINE_CORS_ORIGIN` | `http://localhost:5173` | CORS 許可オリジン |
| `VYLINE_API_ADMIN_SECRET` | 未設定 | 公開 API (/v1) の管理トークン発行用 |

## 注意

- 初回ログイン（QR / メール）はブラウザから行う。
  セッションは `data/tokens.json` に保存されるため、ボリュームの永続化が必須。
- E2EE 鍵など機密データを含むため `data/` を公開リポジトリやイメージに含めないこと。
- LAN / Tailscale から使う場合は `VYLINE_BIND_ADDRESS=0.0.0.0` と `VYLINE_LAN_ACCESS=true` を併用し、ファイアウォールで接続元を制限します。初回接続端末はPC側からQRペアリングしてください。

LAN公開の設定と注意点は [セルフホストガイド](../selfhosting.md) と [サブデバイス接続](../subdevices.md) を参照してください。
