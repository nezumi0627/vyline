# Vyline 配布ガイド（Windows / macOS / Linux / Docker）

`v<version>` タグを push すると GitHub Actions が品質チェック後に Windows Setup.exe、macOS（Apple Silicon / Intel）ZIP、Linux x64 tar.gz、GHCR Docker image を作成します。

```bash
docker compose pull
docker compose up -d
```

各OSの単体版はそのPC内でバックエンドを起動し、ブラウザで `127.0.0.1` のVylineを開きます。データはそのPCに保存されます。Bunの事前インストールは不要です。

- **Windows**: `VylineSetup-<version>.exe` を実行します。
- **macOS**: CPUに合わせて `Vyline-macos-arm64-<version>.zip`（Apple Silicon）または `Vyline-macos-x64-<version>.zip`（Intel）を取得し、展開した `Vyline.app` を「アプリケーション」へ移動します。初回起動時に未署名アプリの警告が出た場合は、FinderでアプリをControlクリックして「開く」を選び、表示される確認に進みます。
- **Linux / Ubuntu x64**: `Vyline-linux-x64-<version>.tar.gz` を展開し、`./install.sh` を実行します。

macOS版は現時点でApple Developer IDによる署名・公証を行っていません。Gatekeeperの警告が出る場合は、配布元とSHA-256チェックサムを確認してから初回起動してください。

ローカルビルド:

```bash
bun run package:linux
```

Windowsでは Inno Setup 6 を導入して `bun run package:windows` を実行します。macOSでは対象CPU上で `bun run package:mac` を実行します。

データ保存先は Windows が `%APPDATA%\\Vyline\\`、macOS が `~/Library/Application Support/Vyline/`、Linux が `${XDG_DATA_HOME:-~/.local/share}/Vyline/`、Docker が Compose の `./data/` と `./storage/` です。tokens、セッション、E2EE鍵を配布物やDockerイメージに含めないでください。
