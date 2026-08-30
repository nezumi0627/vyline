<!--@languages=ja,en-->
<!--@default=ja-->
[English](README.en.md)<!--ja-->
[日本語](README.md)<!--en-->

# Vyline — tqmane fork

LINE 非公式サードパーティクライアント Vyline の tqmane fork です。<!--ja-->
This is the tqmane fork of Vyline, an unofficial third-party LINE client.<!--en-->

> [!CAUTION]
> 非公式・未承認クライアントです。アカウント停止やデータ損失を含むリスクを理解したうえで利用してください。<!--ja-->
> This is an unofficial, unapproved client. Use it only if you understand the account and data-loss risks.<!--en-->

## Quickstart

### Portainer

1. **Stacks → Add stack → Web editor** を開き、[`docker-compose.portainer.yml`](docker-compose.portainer.yml) を貼り付けます。<!--ja-->
1. Open **Stacks → Add stack → Web editor** and paste [`docker-compose.portainer.yml`](docker-compose.portainer.yml).<!--en-->
2. Deploy します。既定イメージは `ghcr.io/tqmane/vyline:latest` です。<!--ja-->
2. Deploy it. The default image is `ghcr.io/tqmane/vyline:latest`.<!--en-->
3. 更新時は **Pull latest image → Update the stack**。ホスト側ビルドは不要です。<!--ja-->
3. To update, use **Pull latest image → Update the stack**. No host-side build is required.<!--en-->

`latest` は `linux/amd64` と `linux/arm64` の multi-arch manifest です。通常の Linux PC/サーバー、64-bit Raspberry Pi、arm64 Android Docker 環境で同じタグを使えます。<!--ja-->
`latest` is a multi-architecture manifest for `linux/amd64` and `linux/arm64`, so the same tag works on ordinary Linux PCs/servers, 64-bit Raspberry Pi systems, and arm64 Android Docker hosts.<!--en-->

### Docker Compose

```bash
mkdir -p vyline && cd vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d
```

ブラウザで `http://<server-ip>:3000` を開きます。<!--ja-->
Open `http://<server-ip>:3000` in a browser.<!--en-->

既定では `./data` と `./storage` を永続化します。更新時にこの2つを削除しないでください。<!--ja-->
By default, persistent state lives in `./data` and `./storage`. Do not delete these directories during updates.<!--en-->

LAN公開を止めたい場合は `VYLINE_BIND_ADDRESS=127.0.0.1`、ポート変更は `VYLINE_PORT`、保存先変更は `VYLINE_DATA_PATH` / `VYLINE_STORAGE_PATH` を設定します。<!--ja-->
Use `VYLINE_BIND_ADDRESS=127.0.0.1` for localhost-only access. `VYLINE_PORT`, `VYLINE_DATA_PATH`, and `VYLINE_STORAGE_PATH` change the port and persistent paths.<!--en-->

## tqmane fork の主な差分<!--ja-->
## Main tqmane-fork changes<!--en-->

- トーク履歴を必要時だけ追加取得し、バックグラウンドで無限取得しない同期設計。<!--ja-->
- On-demand history paging without endless background history fetching.<!--en-->
- 過去ログ閲覧中のスクロール位置を維持し、右下のボタンから最新位置へ戻れる UI。<!--ja-->
- Stable scroll position while reading history, plus a bottom-right jump-to-latest control.<!--en-->
- アナウンスを既定でコンパクト表示し、`∨` / `∧` で展開・折りたたみ。<!--ja-->
- Compact announcements by default with `∨` / `∧` expand/collapse controls.<!--en-->
- Docker の履歴・設定・メディア永続化、atomic write、復元後 flush の強化。<!--ja-->
- Stronger Docker persistence, atomic writes, and durable post-restore flushing.<!--en-->
- Note / Album、LIFF sender metadata、channel token lifecycle、期限切れ unsend 防止など upstream の有用な修正を選択的に同期。<!--ja-->
- Selected upstream fixes for Note/Album, LIFF sender metadata, channel-token lifecycle, expired-unsend guarding, and related hardening.<!--en-->

## GHCR / GitHub Actions

`.github/workflows/container.yml` が `main` push、`v*` tag、手動実行で Buildx を起動し、次を GHCR に push します。<!--ja-->
`.github/workflows/container.yml` runs Buildx on `main` pushes, `v*` tags, and manual dispatch, then pushes to GHCR.<!--en-->

```text
ghcr.io/tqmane/vyline:latest
linux/amd64
linux/arm64
```

branch / tag / `sha-*` タグ、GitHub Actions cache、provenance、SBOM も生成します。<!--ja-->
It also publishes branch/tag/`sha-*` tags and uses GitHub Actions cache, provenance, and SBOM output.<!--en-->

## Development

```bash
git clone --recurse-submodules https://github.com/tqmane/vyline.git
cd vyline
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

Bun 1.4 以降を使用してください。サブモジュールは tqmane 側リポジトリを参照します。<!--ja-->
Use Bun 1.4 or newer. Submodules point to the tqmane repositories.<!--en-->

## Security

Vyline を認証なしで直接インターネットへ公開しないでください。外部公開する場合は TLS と認証済み reverse proxy / VPN を使用してください。`.env`、トークン、バックアップ、アカウント DB、`data/`、`storage/` をコミットしないでください。<!--ja-->
Do not expose Vyline directly to the public Internet without authentication. Use TLS with an authenticated reverse proxy or VPN. Never commit `.env`, tokens, backups, account databases, `data/`, or `storage/`.<!--en-->

## Documentation

長い旧 README は [`docs/README.full.md`](docs/README.full.md) に退避しています。詳細な解析・開発ドキュメントは [`docs/`](docs/) を参照してください。<!--ja-->
The previous long README is archived at [`docs/README.full.md`](docs/README.full.md). Detailed analysis and developer documentation remains under [`docs/`](docs/).<!--en-->

## Upstream / License

Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). tqmane fork の意図的な差分を維持しつつ、有用な upstream 変更を選択的に取り込みます。<!--ja-->
Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). Useful upstream changes are integrated selectively without overwriting intentional tqmane-fork behavior.<!--en-->

ライセンスと attribution は [`LICENSE`](LICENSE) を参照してください。<!--ja-->
See [`LICENSE`](LICENSE) for license terms and attribution.<!--en-->
