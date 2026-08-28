# vyl CLI

`vyl` is the lightweight command entrypoint for Vyline setup, repair, plugin scaffolding, and Snapshots.

The goal is to make Vyline easier to try without forcing users to understand the full repository layout, Git submodules, or every Bun workspace command first.

## Recommended entrypoints

### New users

Use the future npm/Bun package entrypoint:

```bash
bunx vyl init
bunx vyl install
```

`vyl install` offers two paths:

- **Release/archive first**: easier install path that avoids a full manual GitHub clone.
- **Developer shallow clone**: shallow clone + shallow submodules for source work.

### Existing repository checkout

From a Vyline checkout:

```bash
bun install
bun run vyl init
bun run vyl:doctor
bun run vyl:fix
bun run vyl:snapshot -- create manual
```

The package exposes both `vyl` and `vyline` bin names for npm/Bun publishing, but the preferred short command is `vyl`.

## Commands

### Interactive setup

```bash
bunx vyl init
# or inside this repository
bun run vyl init
```

Starts a small interactive setup menu for common actions:

- start the development server
- run doctor
- repair setup
- create a plugin
- create a Snapshot
- install from an archive

### Install without a full manual clone

```bash
bunx vyl install
# or inside this repository
bun run vyl install
```

The installer prefers an archive-based flow so users do not need to manually clone the whole repository. Developer mode is available when source work is needed.

### Doctor

```bash
bun run vyl:doctor
# or
bun run vyl doctor
```

Checks the local environment:

- Bun
- Git
- repository root
- backend entrypoint
- desktop package
- protocol package / submodule state
- root `node_modules`
- `.env`
- data directory write access
- storage directory write access

### Fix

```bash
bun run vyl:fix
bun run vyl fix --build
```

Repairs common setup issues:

- creates `data/` and `storage/`
- creates `.env` from `.env.example` when available
- initializes submodules when running inside a Git checkout
- runs `bun install`
- optionally runs `bun run build`

### Development start

```bash
bun run vyl dev
```

Starts the usual backend + frontend development flow. Direct scripts such as `bun run dev`, `bun run typecheck`, `bun run lint`, and `bun run build` are still available for lower-level work.

### Plugin scaffold

```bash
bun run vyl plugin create my-plugin
```

Creates a plugin template under `plugins/my-plugin` with:

- `package.json`
- `vyline.plugin.json`
- `src/index.ts`
- `README.md`

The generated plugin is intentionally small and TypeScript-first. It is meant to become the base for `create-vyline-plugin` / `@vyline/plugin-sdk` publishing.

## Snapshots

Backup/restore is rebranded as **Snapshot**. A Snapshot is a restorable archive of the Vyline data directory.

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

The schedule command stores `.vyline/snapshot-schedule.json`.

On Windows it also tries to register a `VylineSnapshot` scheduled task via `schtasks`:

```powershell
bun run vyl snapshot schedule daily
```

On Linux/macOS it prints a command that can be wired into cron or a systemd timer.

## Current package shape

This PR adds the foundation without the Control Center.

- `Vyline/packages/cli` provides `vyl` / `vyline`.
- `Vyline/packages/create-plugin` provides the local plugin scaffold generator.
- Root scripts expose convenient wrappers: `vyl`, `vyl:init`, `vyl:doctor`, `vyl:fix`, `vyl:snapshot`.

## Future npm shape

Recommended public package split:

- `@vyline/cli` / `vyl`
- `create-vyline-plugin`
- `@vyline/plugin-sdk`
- `@vyline/theme-sdk`

Control Center is intentionally not part of this PR.
