<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: en -->

[日本語](README.md)

# Vyline — tqmane fork

This is the tqmane fork of Vyline, an unofficial third-party LINE client.

> [!CAUTION]
> This is an unofficial, unapproved client. Use it only if you understand the account and data-loss risks.

## Quickstart

### Portainer

1. Open **Stacks → Add stack → Web editor** and paste [`docker-compose.portainer.yml`](docker-compose.portainer.yml).
2. Deploy it. The default image is `ghcr.io/tqmane/vyline:latest`.
3. To update, use **Pull latest image → Update the stack**. No host-side build is required.

`latest` is a multi-architecture manifest for `linux/amd64` and `linux/arm64`, so the same tag works on ordinary Linux PCs/servers, 64-bit Raspberry Pi systems, and arm64 Android Docker hosts.

### Docker Compose

```bash
mkdir -p vyline && cd vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d
```

Open `http://<server-ip>:3000` in a browser.

By default, persistent state lives in `./data` and `./storage`. Do not delete these directories during updates.

Use `VYLINE_BIND_ADDRESS=127.0.0.1` for localhost-only access. `VYLINE_PORT`, `VYLINE_DATA_PATH`, and `VYLINE_STORAGE_PATH` change the port and persistent paths.

## Main tqmane-fork changes

- On-demand history paging without endless background history fetching.
- Stable scroll position while reading history, plus a bottom-right jump-to-latest control.
- Compact announcements by default with `∨` / `∧` expand/collapse controls.
- Stronger Docker persistence, atomic writes, and durable post-restore flushing.
- Selected upstream fixes for Note/Album, LIFF sender metadata, channel-token lifecycle, expired-unsend guarding, and related hardening.

## GHCR / GitHub Actions

`.github/workflows/container.yml` runs Buildx on `main` pushes, `v*` tags, and manual dispatch, then pushes to GHCR.

```text
ghcr.io/tqmane/vyline:latest
linux/amd64
linux/arm64
```

It also publishes branch/tag/`sha-*` tags and uses GitHub Actions cache, provenance, and SBOM output.

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

Use Bun 1.4 or newer. Submodules point to the tqmane repositories.

## Security

Do not expose Vyline directly to the public Internet without authentication. Use TLS with an authenticated reverse proxy or VPN. Never commit `.env`, tokens, backups, account databases, `data/`, or `storage/`.

## Documentation

The previous long README is archived at [`docs/README.full.md`](docs/README.full.md). Detailed analysis and developer documentation remains under [`docs/`](docs/).

## Upstream / License

Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). Useful upstream changes are integrated selectively without overwriting intentional tqmane-fork behavior.

See [`LICENSE`](LICENSE) for license terms and attribution.
