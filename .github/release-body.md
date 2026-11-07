## ダウンロード / Downloads

| ファイル / File | 対象 / Platform |
| --- | --- |
| `VylineSetup-<version>.exe` | Windows x64 インストーラー / Windows x64 installer |
| `Vyline-portable-<version>.zip` | Windows x64 ポータブル版 / Windows x64 portable |
| `Vyline-linux-x64-<version>.tar.gz` | Linux / Ubuntu x64 |
| `Vyline-macos-arm64-<version>.zip` | macOS Apple Silicon (arm64) |
| `Vyline-macos-x64-<version>.zip` | macOS Intel (x64) |
| `SHA256SUMS.txt` | 配布ファイルのSHA-256確認用 / SHA-256 checksums for downloads |

macOS版はad-hoc署名されていますが、Developer ID署名・公証は行っていません。初回起動時にGatekeeperの確認が出る場合があります。配布元とチェックサムを確認してください。
The macOS app has an ad-hoc code signature for integrity verification, but it is not signed with a Developer ID or notarized. Gatekeeper may ask for confirmation on first launch. Verify the source and checksum.

チェックサム確認:
- Linux: `sha256sum -c SHA256SUMS.txt`
- macOS: `shasum -a 256 -c SHA256SUMS.txt`
- Windows PowerShell: `Get-FileHash <file> -Algorithm SHA256` の結果を `SHA256SUMS.txt` と照合

Docker image: `ghcr.io/nezumi0627/vyline:<version>` / `ghcr.io/nezumi0627/vyline:latest`

## 変更内容 / Changes

この下に、前回リリース以降にマージされたPRをGitHubが `#番号 PRタイトル` の形式で自動掲載します。PRタイトルは変更内容が伝わる短い文にしてください。
GitHub automatically lists PRs merged since the previous release below, with their `#number` and title. Keep PR titles short and descriptive.
