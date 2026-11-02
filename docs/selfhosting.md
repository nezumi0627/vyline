# セルフホスティング（Docker 自宅サーバー）

最終更新: 2026-11-03

Vyline はバックエンド（BFF）とフロントエンド（React ビルド）を 1 つの Bun プロセスで配信できます。Docker で自宅サーバーに立てれば、**複数端末（PC・スマホ・タブレット）から同じ LINE セッションを Web ブラウザで使え**、チャット履歴・画像・トークンはサーバー側に永続化されます。端末を変えても履歴は消えません。

---

## 1. Docker で起動（ワンコマンド）

リポジトリ直下で:

```bash
docker compose up -d --build
```

ブラウザで `http://localhost:3000` を開くとVylineが起動します（Compose配布時）。
初回導入の手順は[Docker導入ガイド](./install/docker.md)にまとめています。
**注意**: デフォルトではホストマシン（`127.0.0.1`）からのみアクセス可能です。同一LANのスマホ等から使う場合は、[サブデバイス接続ガイド](./subdevices.md) のQRペアリングを使用してください。`VYLINE_LAN_ACCESS=true` なしでLAN公開しないでください。

### 永続化されるデータ

Docker Compose の bind mount（`./data` → `/app/data`、`./storage` → `/app/storage`）に保存されます。

| データ                       | 場所                                |
| ---------------------------- | ----------------------------------- |
| セッション / トークン        | `/app/data/tokens.json`                 |
| E2EE 鍵 / storage            | `/app/data/storage-<account>.json`      |
| チャット履歴                 | `/app/data/accounts/<safe-id>/chatdb.sqlite`（旧 JSON は移行後も保持） |
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
| `VYLINE_CHAT_CACHE_ACCOUNTS` | `1` | メモリに常駐させるアカウント履歴キャッシュ数（SQLiteの保存量は制限しない） |
| `VYLINE_STORAGE_DIR` | `backend/storage/`     | 永続ストレージ（保存メディア、プロフィール等）の場所                    |
| `VYLINE_CORS_ORIGIN` | `http://localhost:5173` | 許可するブラウザオリジン。**同一オリジンでアクセスする場合は設定不要** |
| `VYLINE_STATIC_DIR`  | `apps/desktop/dist/`    | 配信するフロントビルドの場所                                           |

同一オリジン（`http://IP:3001` を直接開く、またはリバースプロキシ経由）で使うなら `VYLINE_CORS_ORIGIN` は不要です。別オリジン（例: `https://vyline.example.com` の前段に別サーバー）から API を叩く場合のみ設定します。

---

## 3. 遠隔アクセス — Tailscale

外出先から使う場合は、インターネットへ直接ポートを公開せず、Tailscale などのプライベートネットワークを使います。LANモードではサブデバイス認証が必須です。Docker Compose の既定 bind は `127.0.0.1` のため、遠隔端末から使う場合だけ bind を変更し、ファイアウォールで信頼するインターフェースに制限してください。

### 手順

1. PC と接続する端末に [Tailscale](https://tailscale.com/download) をインストールし、同じ tailnet に参加させる
2. ソース起動では `VYLINE_LAN_ACCESS=true bun run server` を使う。Docker Compose では `VYLINE_BIND_ADDRESS=0.0.0.0` と `VYLINE_LAN_ACCESS=true` を設定して起動する
3. Tailscale の IP で Vyline を開き、PC側の設定 → サブデバイスから QR を表示して端末をペアリングする

`0.0.0.0` は全ネットワークインターフェースで待ち受けます。OS・ルーターのファイアウォールで不要な接続を遮断し、未認証端末を使わせないでください。`VYLINE_LAN_ACCESS=true` のとき、遠隔 API はペアリング済みサブデバイスに限定されます。

Vyline バックエンドは起動時および 30 秒ごとに Tailscale IP を検出し、候補 URL をログに出力します。Docker ではホスト側の bind とファイアウォール設定が別途必要です。

```
Tailscale detected — Vyline accessible via Tailscale {"tailscaleIp":"100.x.y.z","url":"http://100.x.y.z:3000"}
```

URL がログに出ても、待受 bind・ファイアウォール・サブデバイスの登録が済んでいなければ接続できません。

> Tailscale は WireGuard ベースのメッシュ VPN で、外部公開やリバースプロキシより簡単かつ安全です。家族や自分専用の閉じたネットワークとして使えます。

## 3b. ポートフォワード / リバースプロキシ

自宅ルーターで `3001` を外部公開するのは避けてください。**Tailscale（推奨）か Cloudflare Access（後述）か、最低でもリバースプロキシ + Basic 認証**を挟むことを強く推奨します。

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

## 4. Cloudflare Access で外部公開する場合

Cloudflare Access を使う場合も、Vyline のサブデバイス認証を有効にし、Cloudflare Access と二段階で保護してください。LINE セッションはアカウントと会話データへアクセスできるため、認証なしで公開しないでください。

### 手順（無料プラン）

1. **Cloudflare アカウント作成** → [dash.cloudflare.com](https://dash.cloudflare.com)
2. **ドメインを追加**（Cloudflare ネームサーバーに切り替え）。お持ちでない場合は `*.trycloudflare.com` の一時トンネルで試用可
3. **Zero Trust** を有効化（無料枠: 50 ユーザーまで）
   - Cloudflare dashboard → Zero Trust → Set up → プランは Free を選択
4. **Cloudflare Tunnel** を作成
   - Zero Trust → Networks → Tunnels → Create a tunnel → **Cloudflared** を選択
   - 公開ホスト名: `vyline.example.com` → Service: ホスト上で動く場合は `http://localhost:3000`。Cloudflare Tunnel をコンテナで動かす場合は同じ Docker ネットワーク内の Vyline サービス名を指定
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

接続後は、初めて使うブラウザをPC側のサブデバイス設定からQRで登録します。スマホはホーム画面に追加して使えます。

---

## 5. 複数端末の扱い

- **LINE 側の仕様**: LINE のログインセッション数には制限があります。Vyline は `IOSIPAD` 相当のセッションで動くため、公式アプリとの併用状況によっては古いセッションが失効する場合があります。
- Vyline は複数アカウント対応です。アカウントごとに `./data/tokens.json` に保存され、ログイン画面から切り替えできます。
- セッションが失効した場合は Vyline のログイン画面から再度 QR / Email ログインしてください（過去の履歴は `./data` に残っています）。

---

## 6. 注意点

- **自己責任**: LINE 非公式クライアントです。アカウント停止リスクがあり、メインアカウント利用は推奨しません。
- **アクセス保護**: 認証なしの外部公開は LINE アカウントを乗っ取られるのと同じです。必ず Cloudflare Access 等で保護してください。
- **E2EE 過去鍵**: Desktop から抽出した E2EE 鍵を使う構成では、`VYLINE_DATA_DIR` 配下の `desktop-e2ee-keys.json` も保護対象です。鍵・トークンを公開場所や共有バックアップへ置かないでください。
- **HTTPS**: Cloudflare Access を使えば自動で HTTPS になります。

---

## 参考

- [docs/development.md](./development.md) — 環境変数一覧
- [docs/distribution.md](./distribution.md) — 配布 / リリース
- [../Dockerfile](../Dockerfile) / [../docker-compose.yml](../docker-compose.yml) — 構成ファイル
