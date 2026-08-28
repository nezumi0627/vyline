# vyl CLI

`vyl` is the lightweight command entrypoint for Vyline setup, repair, plugin scaffolding, and snapshots.

The goal is to make Vyline easier to try without forcing users to understand the full repository layout first.

## Local usage

From a Vyline checkout:

```bash
bun run vyl init
bun run vyl:doctor
bun run vyl:fix
bun run vyl:snapshot create manual
```

The package exposes both `vyl` and `vyline` bin names for future npm/Bun publishing.

## Commands

### Interactive setup

```bash
bun run vyl init
```

Starts a small interactive setup menu for common actions:

- start the development server
- run doctor
- repair setup
- create a plugin
- create a snapshot
- install from an archive

### Install without a full manual clone

```bash
bun run vyl install
```

The installer prefers an archive-based flow so users do not need to manually clone the whole repository. A developer mode is also available for shallow clone + shallow submodules when source work is needed.

### Doctor

```bash
bun run vyl doctor
```

Checks the local environment:

- Bun
- Git
- repository root
- backend entrypoint
- desktop package
- protocol package
- root `node_modules`
- `.env`
- data directory write access
- storage directory write access

### Fix

```bash
bun run vyl fix
bun run vyl fix --build
```

Repairs common setup issues:

- creates `data/` and `storage/`
- creates `.env` from `.env.example` when available
- initializes submodules when running inside a git checkout
- runs `bun install`
- optionally runs `bun run build`

### Plugin scaffold

```bash
bun run vyl plugin create my-plugin
```

Creates a plugin template under `plugins/my-plugin` with:

- `package.json`
- `vyline.plugin.json`
- `src/index.ts`
- `README.md`

### Snapshots

Backups are rebranded as **Snapshots**. A snapshot is a restorable archive of the Vyline data directory.

```bash
bun run vyl snapshot create manual
bun run vyl snapshot list
bun run vyl snapshot restore snapshots/vyline-snapshot-xxxx.tar.gz --force
bun run vyl snapshot schedule daily
```

Snapshot commands support custom directories:

```bash
bun run vyl snapshot create auto --data-dir ./data --snapshots ./snapshots
```

The schedule command stores `.vyline/snapshot-schedule.json`. On Windows it also tries to register a `VylineSnapshot` scheduled task via `schtasks`.

## Future npm shape

Recommended public package split:

- `@vyline/cli` / `vyl`
- `create-vyline-plugin`
- `@vyline/plugin-sdk`
- `@vyline/theme-sdk`

Control Center is intentionally not part of this PR.
