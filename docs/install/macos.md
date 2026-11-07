# macOSで使い始める

安定版 **1.2.3** ではmacOS向けのローカルアプリを配布しています。Apple Siliconはarm64、Intel Macはx64のZIPを選びます。

## アプリをダウンロードする

- [Apple Silicon（arm64）](https://github.com/nezumi0627/vyline/releases/download/v1.2.3/Vyline-macos-arm64-1.2.3.zip)
- [Intel（x64）](https://github.com/nezumi0627/vyline/releases/download/v1.2.3/Vyline-macos-x64-1.2.3.zip)

ZIPを展開し、`Vyline.app` を「アプリケーション」へ移動して起動します。配布版はad-hoc署名されていますが、Developer ID署名・公証は行っていないため、初回起動時にGatekeeperの確認が出る場合があります。配布元とSHA-256を確認してから画面の案内に従ってください。

## ソースから起動する

開発する場合はGitと **Bun 1.4.0以降** を準備してください。

```bash
git clone --recurse-submodules --branch v1.2.3 https://github.com/nezumi0627/vyline.git
cd vyline
bun install
bun run vyl register
vyl dev
```

`vyl register` はこのチェックアウトを既定の起動先として登録します。開発サーバー起動後は `http://localhost:5173` を開きます。

## 自分のサーバーへ接続する

Mac上の[Docker](./docker.md)、または自分で管理するWindows/LinuxサーバーでVylineを起動し、ブラウザから接続できます。LINEの認証情報と履歴はサーバー側に保存されるため、管理者と保存場所を確認してください。

## 次に読む

[ログインと初回設定](../start-here.md#ログインと初回設定) · [更新する](../user-guide/update.md) · [Windows](./windows.md) · [Linux](./linux.md) · [Docker](./docker.md)
