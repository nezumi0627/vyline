<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: en -->

[日本語](README.md)

# Vyline

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  An extensible LINE third-party client that starts from `vyl`
</p>

> [!CAUTION]
> Vyline is an unofficial and unauthorised LINE third-party client. It is not affiliated with LINE Corporation or LY Corporation. Use it at your own risk.

> [!NOTE]
> Vyline is currently Beta 0.8.0. Protect important data with `vyl snapshot`.

## Quick start

The new entrypoint is the **`vyl` CLI**. New users should start with the interactive flow instead of manually cloning the full repository first.

```bash
bunx vyl init
```

Before npm / bunx publishing, or inside this repository, use:

```bash
bun install
bun run vyl init
```

`vyl init` lets you choose startup, doctor, repair, plugin creation, Snapshot creation, and archive-first install interactively.

## Installation paths

| Goal | Recommended path | Command |
| --- | --- | --- |
| Try Vyline quickly | archive-first install | `bunx vyl install` |
| Repair an existing checkout | doctor / fix | `bun run vyl:doctor` → `bun run vyl:fix` |
| Development | shallow clone or normal clone | Developer mode in `vyl install`, or `git clone --recurse-submodules` |
| Self-hosting | Docker | `docker compose up -d --build` |
| Data protection | Snapshot | `bun run vyl snapshot create manual` |

## vyl CLI

`vyl` is the front door for Vyline. It groups install, diagnostics, repair, start, Snapshot, and plugin scaffolding.

| Command | Description |
| --- | --- |
| `vyl init` | Interactive setup |
| `vyl install` | Choose archive-first or shallow clone install |
| `vyl doctor` | Check Bun, Git, submodules, `.env`, and data/storage |
| `vyl fix` | Create `.env`, create data/storage, update submodules, run `bun install` |
| `vyl dev` | Start backend and frontend |
| `vyl start` | Start the backend server |
| `vyl plugin create <name>` | Create a TypeScript plugin template |
| `vyl snapshot create/list/restore/schedule` | Create, list, restore, and schedule Snapshots |

Inside the repository, run:

```bash
bun run vyl init
bun run vyl:doctor
bun run vyl:fix
bun run vyl:snapshot -- create manual
```

See [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) for details.

## Snapshot

Vyline rebrands backup/restore as **Snapshot**. The `data/` directory contains sessions, keys, settings, and history, so create a Snapshot before updates or major setting changes.

```bash
bun run vyl snapshot create before-update
bun run vyl snapshot list
bun run vyl snapshot restore snapshots/xxx.tar.gz --force
bun run vyl snapshot schedule daily
```

On Windows, `snapshot schedule` tries to register a `VylineSnapshot` scheduled task. On other platforms it writes a schedule config and prints a command for cron or a systemd timer.

## Development

```bash
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git
cd Vyline
bun install
bun run vyl:doctor
bun run vyl dev
```

| Command | Description |
| --- | --- |
| `bun run vyl:doctor` | Check the development environment |
| `bun run vyl:fix` | Repair common setup issues |
| `bun run typecheck` | Type-check all workspaces |
| `bun run lint` | Run Biome |
| `bun run build` | Build the frontend |
| `bun run docs:readme` | Regenerate README files from `README.src.md` |

Create a plugin scaffold with:

```bash
bun run vyl plugin create my-plugin
```

## Docker / self-hosting

```bash
git clone --recurse-submodules https://github.com/nezumi0627/Vyline.git
cd Vyline
docker compose up -d --build
```

Open `http://localhost:3000`. Do not delete `./data/`; it contains sessions and keys.

## Documentation

| Document | Description |
| --- | --- |
| [Vyline/docs/vyl-cli.md](Vyline/docs/vyl-cli.md) | `vyl` CLI, install, doctor, fix, Snapshot, plugin scaffold |
| [Vyline/docs/guides/ios-backup-restore.md](Vyline/docs/guides/ios-backup-restore.md) | Import flow from iOS backups |
| [AGENTS.md](AGENTS.md) | Coding-agent guide |
| [CHANGELOG.md](CHANGELOG.md) | Changelog |

## Roadmap

- Stabilise npm / bunx distribution for `vyl`
- Snapshot retention, encryption, and verification
- Plugin permission scopes and Marketplace registry
- Theme SDK and `vyl theme create`
- Lighter Docker / self-hosting operations
- Control Center is intentionally out of scope for this PR

## License

Vyline is released under the [MIT License](LICENSE).

Copyright © [nezumi0627](https://github.com/nezumi0627)
