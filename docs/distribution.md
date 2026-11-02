# Vyline 配布・更新ガイド（Windows / Linux / Docker）

`v<version>` タグを push すると GitHub Actions が品質チェック後に Windows Setup.exe、Windows portable ZIP、Linux x64 tar.gz、GHCR Docker image を作成します。アプリの情報画面はGitHub Releasesを確認し、対応する公式配布物・SHA-256・更新内容を表示します。アプリ上で確認してダウンロードした後、WindowsはSetup.exe、Linuxは展開先の `install.sh` を利用者が実行して更新します。ダウンロード済みファイルをアプリが無確認で実行することはありません。

バージョン表示は `V<version>(<7桁のGit commit SHA>)` です。括弧内のSHAをGitHubコミット画面で確認できます。リリースタグはGitHub Actionsとの互換性を保ち `v<version>` を使います。

```bash
docker compose pull
docker compose up -d
```

Linux単体版は `Vyline-linux-x64-<version>.tar.gz` を展開し、`./install.sh` を実行します。インストールスクリプトは新しいパッケージをステージングしてから切り替え、失敗時は直前の実行ファイルを戻します。会話履歴などのデータは `${XDG_DATA_HOME:-~/.local/share}/Vyline/` に残ります。Windows単体版は `VylineSetup-<version>.exe` を実行します。同じAppIdとインストール先を維持し、ユーザーデータ領域を更新対象に含めません。いずれも Bun の事前インストールは不要です。

macOS用の公式インストーラーは現在のリリース成果物にありません。情報画面では対象成果物がないことを示し、リリースページへ案内します。

ローカルビルド:

```bash
bun run package:linux
```

Windowsでは Inno Setup 6 を導入して `bun run package:windows` を実行します。

データ保存先は Windows が `%APPDATA%\\Vyline\\`、Linux が `${XDG_DATA_HOME:-~/.local/share}/Vyline/`、Docker が Compose の `./data/` と `./storage/` です。tokens、セッション、E2EE鍵を配布物やDockerイメージに含めないでください。
