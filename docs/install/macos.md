# macOSで使い始める

安定版 **1.0.3** にmacOS専用の `.dmg` や `.pkg` はありません。
ソースからMac上で起動するか、自分で管理するサーバーへブラウザから接続します。

## Mac上でソースから起動する

Gitと **Bun 1.4.0以降** を準備してください。

```bash
git clone --recurse-submodules --branch v1.0.3 https://github.com/nezumi0627/vyline.git
cd vyline
bun install
bun run vyl register
vyl dev
```

`vyl register` はこのチェックアウトを既定の起動先として登録します。以後はどのフォルダからも `vyl dev` で起動できます。ターミナルを起動したまま `http://localhost:5173` を開きます。
フロントエンドは5173番、バックエンドは3001番で動きます。
終了するときはターミナルで `Ctrl+C` を押します。
これは開発サーバーで動かす方法です。常時稼働の設定は[セルフホストガイド](../selfhosting.md)を確認してください。

## サーバーへブラウザで接続する

Mac上の[Docker](./docker.md)、または自分で管理するWindows/LinuxサーバーでVylineを起動できます。
別端末からの利用は[サブデバイス接続](../subdevices.md)に従ってペアリングしてください。
LINEの認証情報や履歴はサーバー側に保存されるため、管理者と保存場所を確認して使います。

## 起動できないとき

`bun --version` と `git --version` を確認します。
サブモジュールが空なら、リポジトリ直下で `git submodule update --init --recursive` を実行します。
他のOS用の実行ファイルをmacOS用として実行しないでください。

## 次に読む

[ログインと初回設定](../start-here.md#ログインと初回設定) · [Docker](./docker.md) · [Windows](./windows.md) · [Linux](./linux.md)
