# Linuxで使い始める

安定版 **1.1.0** の単体配布版は **x64** 向けです。
Bunの事前インストールは不要です。
arm64では[Docker](./docker.md)またはソースから起動してください。
OS標準のコマンドではなく `vyl` で起動する場合は、[Bun + vylの手順](./cli.md)に進んでください。

## ダウンロードして起動する

1. [Vyline-linux-x64-1.1.0.tar.gz](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-linux-x64-1.1.0.tar.gz)を保存します。
2. 保存したディレクトリで、次を実行します。

```bash
tar -xzf Vyline-linux-x64-1.1.0.tar.gz
cd Vyline-linux-x64-1.1.0
./install.sh
~/.local/bin/vyline
```

インストーラーはユーザーの `~/.local/opt/vyline` に配置し、`~/.local/bin/vyline` とアプリケーションメニューの項目を作ります。
`~/.local/bin` がPATHに含まれていれば、次回から `vyline` で起動できます。

## 配布物の整合性を確認する

[SHA256SUMS.txt](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/SHA256SUMS.txt)を同じディレクトリに保存します。

```bash
sha256sum Vyline-linux-x64-1.1.0.tar.gz
```

出力をSHA256SUMS.txtの同名ファイルの値と照合してください。

## ブラウザが開かないとき

デスクトップ環境では `xdg-open` を使ってブラウザを開きます。
自動で開かない場合は、Vylineを起動したまま `http://127.0.0.1:18765` を開いてください。
ディスプレイのないサーバー用途には[Docker](./docker.md)が適しています。

データの保存先は `${XDG_DATA_HOME:-~/.local/share}/Vyline/` です。
更新前は[バックアップ](../../Vyline/docs/guides/vyline-backup-restore.md)を作成します。

## 次に読む

[ログインと初回設定](../start-here.md#ログインと初回設定) · [更新する](../user-guide/update.md) · [Windows](./windows.md) · [macOS](./macos.md) · [Docker](./docker.md)
