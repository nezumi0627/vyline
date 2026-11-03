# Vyline 配布・更新ガイド（Windows / macOS / Linux / Docker）

安定版は **1.1.0** です。初回導入はOS別ガイドへ進んでください。
[Windows](./install/windows.md) / [Linux](./install/linux.md) / [macOS](./install/macos.md) / [Docker](./install/docker.md)
このページでは配布の仕組みとローカルビルドを扱います。

`v<version>` タグを push すると GitHub Actions が品質チェック後に Windows Setup.exe、Windows portable ZIP、macOS（Apple Silicon / Intel）ZIP、Linux x64 tar.gz、SHA-256チェックサム、GHCR Docker imageを作成します。Dockerはlinux/amd64とlinux/arm64を各ネイティブRunnerでビルドし、単一のマルチアーキテクチャmanifestとして公開します。

アプリの情報画面はGitHub Releasesを確認し、対応する公式配布物・SHA-256・更新内容を表示します。確認後に利用者がファイルをダウンロードし、WindowsはSetup.exe、Linuxは展開先の `install.sh` を手動で実行して更新します。ダウンロードしたファイルをアプリが無確認で実行することはありません。

バージョン表示は `V<version>(<7桁のGit commit SHA>)` です。括弧内のSHAからGitHubコミットを確認できます。リリースタグはGitHub Actionsとの互換性を保ち `v<version>` を使います。

GitHub Releaseの `SHA256SUMS.txt` でWindows Setup.exe、Windows portable ZIP、macOS ZIP、Linux x64 tar.gzの完全性を確認できます。Docker manifestはリリース処理内で両platformを検証します。

```bash
docker compose pull
docker compose up -d
```

## OS別の利用方法

- **Windows**: `VylineSetup-<version>.exe` でインストールするか、`Vyline-portable-<version>.zip` を展開して `Vyline.exe` を実行します。同じAppIdとインストール先を維持し、ユーザーデータ領域を更新対象に含めません。
- **macOS**: CPUに合わせて `Vyline-macos-arm64-<version>.zip`（Apple Silicon）または `Vyline-macos-x64-<version>.zip`（Intel）を取得し、展開した `Vyline.app` を「アプリケーション」へ移動します。アプリはそのMac内でBackendを起動し、ブラウザで `127.0.0.1` のVylineを開きます。初回起動時に未署名アプリの警告が出た場合は、FinderでアプリをControlクリックして「開く」を選び、表示される確認に進みます。
- **Linux / Ubuntu x64**: `Vyline-linux-x64-<version>.tar.gz` を展開し、`./install.sh` を実行します。インストールスクリプトは新しいパッケージをステージングしてから切り替え、失敗時は直前の実行ファイルを戻します。

各OSの単体版はそのPC内でBackendを起動します。データはそのPCに保存され、Bunの事前インストールは不要です。macOS版は現時点でApple Developer IDによる署名・公証を行っていません。Gatekeeperの警告が出る場合は、配布元とSHA-256チェックサムを確認してから初回起動してください。

## ローカルビルド

```bash
bun run package:linux
```

Windowsでは Inno Setup 6 を導入して `bun run package:windows` を実行します。macOSでは対象CPU上で `bun run package:mac` を実行します。

データ保存先は Windows が `%APPDATA%\\Vyline\\`、macOS が `~/Library/Application Support/Vyline/`、Linux が `${XDG_DATA_HOME:-~/.local/share}/Vyline/`、Docker が Compose の `./data/` と `./storage/` です。tokens、セッション、E2EE鍵を配布物やDockerイメージに含めないでください。
