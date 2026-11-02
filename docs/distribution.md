# Vyline 配布ガイド（Windows / Linux / Docker）

安定版は **1.0.3** です。初回導入はOS別ガイドへ進んでください。
[Windows](./install/windows.md) / [Linux](./install/linux.md) / [macOS](./install/macos.md) / [Docker](./install/docker.md)
このページでは配布の仕組みとローカルビルドを扱います。

`v<version>` タグを push すると GitHub Actions が品質チェック後に Windows Setup.exe、Windows portable ZIP、Linux x64 tar.gz、SHA-256チェックサム、GHCR Docker imageを作成します。Dockerはlinux/amd64とlinux/arm64を各ネイティブRunnerで並列ビルドし、単一のマルチアーキテクチャmanifestとして公開します。

GitHub Releaseの `SHA256SUMS.txt` でWindows Setup.exe、Windows portable ZIP、Linux x64 tar.gzの完全性を確認できます。Docker manifestはリリース処理内で両platformを検証します。

```bash
docker compose pull
docker compose up -d
```

Linux単体版は `Vyline-linux-x64-<version>.tar.gz` を展開し、`./install.sh` を実行します。Windowsでは `VylineSetup-<version>.exe` でインストールするか、`Vyline-portable-<version>.zip` を展開して `Vyline.exe` を実行します。いずれも Bun の事前インストールは不要です。

ローカルビルド:

```bash
bun run package:linux
```

Windowsでは Inno Setup 6 を導入して `bun run package:windows` を実行します。

データ保存先は Windows が `%APPDATA%\\Vyline\\`、Linux が `${XDG_DATA_HOME:-~/.local/share}/Vyline/`、Docker が Compose の `./data/` と `./storage/` です。tokens、セッション、E2EE鍵を配布物やDockerイメージに含めないでください。
