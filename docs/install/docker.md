# Dockerとブラウザで使い始める

Docker EngineまたはDocker Desktopと、Docker Composeを使います。
公開イメージはamd64とarm64に対応しています。
安定版のソース基準は **1.2.3** です。

## 起動する

```bash
git clone --branch v1.2.3 https://github.com/nezumi0627/vyline.git
cd vyline
docker compose pull
docker compose up -d
```

`http://localhost:3000` を開き、[ログインと初回設定](../start-here.md#ログインと初回設定)へ進みます。
Composeの公開ポートは **3000** です。ソース起動時のバックエンドの3001番とは異なります。
既定の `VYLINE_IMAGE` は `ghcr.io/nezumi0627/vyline:latest` を指します。
上のコマンドは1.2.3のCompose定義を使いますが、イメージはpullした時点のlatestです。
特定のイメージへ固定する場合は、公開されたタグまたはdigestを確認して `VYLINE_IMAGE` を指定してください。

## データを残す

履歴とログイン情報はホスト側の `./data/`、メディアは `./storage/` に保存します。
コンテナを再作成するときも、この2つのディレクトリを保持してください。
バックアップは[VylineBackup](../../Vyline/docs/guides/vyline-backup-restore.md)を使い、保存範囲を確認します。

## 別端末から接続する

初期状態では `127.0.0.1:3000` にのみ公開します。
LANやインターネットへ直接公開せず、[サブデバイスのペアリング](../subdevices.md)と[セルフホストの接続設定](../selfhosting.md)を確認してください。
ログイン情報や履歴を保管するサーバーの管理責任も確認します。

## 状態を確認する

```bash
docker compose ps
docker compose logs --tail=100
```

ログを外部へ共有する前に、秘密情報やメッセージ本文を含まないか確認します。

## 次に読む

[セルフホストの詳細](../selfhosting.md) · [アップデート](../user-guide/update.md) · [macOS](./macos.md) · [Windows](./windows.md) · [Linux](./linux.md)
