# セルフホスティング（Docker 自宅サーバー）

最終更新: 2026-08-24

Vyline はバックエンド（BFF）とフロントエンド（React ビルド）を 1 つの Bun プロセスで配信できます。Docker で自宅サーバーに立てれば、**複数端末（PC・スマホ・タブレット）から同じ LINE セッションを Web ブラウザで使え**、チャット履歴・画像・トークンはサーバー側に永続化されます。端末を変えても履歴は消えません。

---

## 1. Docker で起動（ワンコマンド）

リポジトリ直下で:

```bash
docker compose up -d --build
```

ブラウザで `http://localhost:3001` を開くと Vyline が起動します。
**注意**: デフォルトではホストマシン（`127.0.0.1`）からのみアクセス可能です。同一LANのスマホ等から使う場合は、[サブデバイス接続ガイド](./subdevices.md) のQRペアリングを使用してください。`VYLINE_LAN_ACCESS=true` なしでLAN公開しないでください。

### 永続化されるデータ

Docker Compose の bind mount（`./data` → `/app/data`、`./storage` → `/app/storage`）に保存されます。

| データ                       | 場所                                |
| ---------------------------- | ----------------------------------- |
| セッション / トークン        | `/app/data/tokens.json`                 |
| E2EE 鍵 / storage            | `/app/data/storage-<account>.json`      |
| チャット履歴                 | `/app/data/chatdb-<account>.json`       |
| プロフィールキャッシュ       | `/app/data/vyline-cache-<account>.json` |
| スタンプ / sticon キャッシュ | `/app/data/cdn-cache/`                  |
| 送信済み・取得済みメディア   | `/app/storage/saved-media/`         |
| 操作ロック                   | `/app/data/feature-locks.json`          |

`docker compose down` してもデータは消えません。完全削除する場合は、停止後にホスト側の `./data` と `./storage` を確認してから削除します。

### バックアップ

ホスト側の bind mount を tar で退避:

```bash
tar czf vyline-backup-$(date +%Y%m%d).tar.gz data storage
```

---

## 2. 環境変数

| 変数                 | デフォルト                          | 説明                                                                   |
| -------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| `PORT`               | `3001`（Docker Compose では `3000`） | listen ポート                                                          |
| `VYLINE_HOST`        | `127.0.0.1`             | bind アドレス。Docker では `0.0.0.0`                                   |
| `VYLINE_LAN_ACCESS`  | `false`                 | `true` のときだけ同一LANからアクセス可能。未認証APIは拒否される           |
| `VYLINE_DATA_DIR`    | `backend/data/`         | トークン / 履歴などのデータ場所                                         |
| `VYLINE_STORAGE_DIR` | `backend/storage/`     | 永続ストレージ（保存メディア、プロフィール等）の場所                    |
| `VYLINE_CORS_ORIGIN` | `http://localhost:5173` | 許可するブラウザオリジン。**同一オリジンでアクセスする場合は設定不要** |
| `VYLINE_STATIC_DIR`  | `apps/desktop/dist/`    | 配信するフロントビルドの場所                                           |

同一オリジン（`http://IP:3001` を直接開く、またはリバースプロキシ経由）で使うなら `VYLINE_CORS_ORIGIN` は不要です。別オリジン（例: `https://vyline.example.com` の前段に別サーバー）から API を叩く場合のみ設定します。

---

## 3. ポートフォワード / リバースプロキシ

自宅ルーターで `3001` を外部公開するのは避けてください。**Cloudflare Access（後述）か、最低でもリバースプロキシ + Basic 認証**を挟むことを強く推奨します。

### Nginx 例

```nginx
server {
    listen 443 ssl;
    server_name vyline.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";  # WebSocket 対応
    }
}
```

---

## 4. Cloudflare Access で外部公開（推奨）

Cloudflare は自宅サーバーを守る認証レイヤーを無料で提供しています。LINE セッションは実質的にアカウントそのものなので、**必ず認証を入れましょう**。

### 手順（無料プラン）

1. **Cloudflare アカウント作成** → [dash.cloudflare.com](https://dash.cloudflare.com)
2. **ドメインを追加**（Cloudflare ネームサーバーに切り替え）。お持ちでない場合は `*.trycloudflare.com` の一時トンネルで試用可
3. **Zero Trust** を有効化（無料枠: 50 ユーザーまで）
   - Cloudflare dashboard → Zero Trust → Set up → プランは Free を選択
4. **Cloudflare Tunnel** を作成
   - Zero Trust → Networks → Tunnels → Create a tunnel → **Cloudflared** を選択
   - 公開ホスト名: `vyline.example.com` → Service: `http://localhost:3000`
   - 表示されるインストールコマンドを**自宅サーバー（Docker ホスト）**で実行:
     ```bash
     sudo cloudflared service install <トークン>
     ```
     （または docker-compose に cloudflared コンテナを追加しても可）
5. **Access Application** を設定
   - Zero Trust → Access → Applications → Add an application → **Self-hosted**
   - ドメイン: `vyline.example.com`
   - ポリシー: **Allow** — 許可するのは自分のメールアドレスのみ
   - 認証方式: One-time PIN（メール）が手軽。Google / GitHub 連携も可
6. **ブラウザでアクセス**: `https://vyline.example.com` → メール OTP で認証 → Vyline が開く

### 完成系

```
スマホ・PC ブラウザ
   │ https://vyline.example.com
   ▼
Cloudflare Access（OTP 認証）
   │ Cloudflare Tunnel (cloudflared)
   ▼
自宅サーバー :3000 (Vyline Docker)
   └─ ./data ディレクトリ（トークン・履歴・画像）
```

これで **端末を問わず 1 つの LINE セッション** を Web から使えます。スマホはホーム画面に追加してアプリのように使えます。

---

## 5. 複数端末の扱い

- **LINE 側の仕様**: LINE のログインセッション数には制限があります。Vyline は `IOSIPAD` 相当のセッションで動くため、公式アプリとの併用状況によっては古いセッションが失効する場合があります。
- Vyline は複数アカウント対応です。アカウントごとに `./data/tokens.json` に保存され、ログイン画面から切り替えできます。
- セッションが失効した場合は Vyline のログイン画面から再度 QR / Email ログインしてください（過去の履歴は `./data` に残っています）。

---

## 6. 注意点

- **自己責任**: LINE 非公式クライアントです。アカウント停止リスクがあり、メインアカウント利用は推奨しません。
- **アクセス保護**: 認証なしの外部公開は LINE アカウントを乗っ取られるのと同じです。必ず Cloudflare Access 等で保護してください。
- **E2EE 過去鍵**: 過去メッセージの復号には Desktop から抽出した鍵（`./data/desktop-e2ee-keys.json`）が必要です。バックアップに含めてください。
- **HTTPS**: Cloudflare Access を使えば自動で HTTPS になります。

---

## 参考

- [docs/development.md](./development.md) — 環境変数一覧
- [docs/distribution.md](./distribution.md) — 配布 / リリース
- [../Dockerfile](../Dockerfile) / [../docker-compose.yml](../docker-compose.yml) — 構成ファイル
