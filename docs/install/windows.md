# Windowsで使い始める

安定版 **1.0.3** の手順です。
Windows x64向けのSetupとポータブルZIPを公開しています。
Bunの事前インストールは不要です。

## インストーラーで導入する

1. [VylineSetup-1.0.3.exe](https://github.com/nezumi0627/vyline/releases/download/v1.0.3/VylineSetup-1.0.3.exe)をダウンロードします。
2. ファイルを開き、インストーラーの案内に従います。
3. スタートメニューからVylineを起動します。
4. ブラウザが開いたら、[ログインと初回設定](../start-here.md#ログインと初回設定)へ進みます。

配布元は[Project VylineのRelease](https://github.com/nezumi0627/vyline/releases/tag/v1.0.3)です。
SHA-256は[SHA256SUMS.txt](https://github.com/nezumi0627/vyline/releases/download/v1.0.3/SHA256SUMS.txt)と照合できます。

```powershell
Get-FileHash .\VylineSetup-1.0.3.exe -Algorithm SHA256
```

## インストールせず使う

1. [Vyline-portable-1.0.3.zip](https://github.com/nezumi0627/vyline/releases/download/v1.0.3/Vyline-portable-1.0.3.zip)をダウンロードします。
2. ZIPをフォルダへ展開します。
3. 展開先の `Vyline.exe` を実行します。ZIPの中から直接実行しないでください。

ポータブル版でも利用データは `%APPDATA%\Vyline\` に保存します。
アプリのフォルダを移動するだけでは、別PCへログイン状態や履歴は移りません。
移行前に[バックアップと復元](../../Vyline/docs/guides/vyline-backup-restore.md)を確認してください。

## 起動しないとき

ブラウザが自動で開かない場合は、Vylineを起動したまま `http://127.0.0.1:18765` を開きます。
起動自体に失敗した場合は `%APPDATA%\Vyline\data\logs\` のログを確認します。
共有する前に[診断と秘密情報の扱い](../setup-account-handoff-debug.md)を確認してください。

## 次に読む

[使い始める](../start-here.md) · [更新する](../user-guide/update.md) · [Linux](./linux.md) · [macOS](./macos.md) · [Docker](./docker.md)
