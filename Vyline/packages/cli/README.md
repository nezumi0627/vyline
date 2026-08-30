# @vyline/cli

`@vyline/cli` provides the `vyl` command for Vyline setup, diagnostics, snapshots, and plugin scaffolding.

## Usage

```bash
bunx @vyline/cli init
bunx @vyline/cli install
bunx @vyline/cli doctor
```

After the short-name package is published, the intended public entrypoint is:

```bash
bunx vyl init
```

Inside a Vyline repository checkout, use the root scripts instead:

```bash
bun run vyl init
bun run vyl:doctor
bun run vyl:snapshot -- create manual
```

## Commands

| Command | Purpose |
| --- | --- |
| `vyl init` | Interactive setup |
| `vyl install` | Archive-first install or developer shallow clone |
| `vyl doctor` | Lightweight local health check |
| `vyl fix` | Repair common local setup issues |
| `vyl dev` | Start backend and frontend |
| `vyl start` | Start backend server |
| `vyl snapshot create/list/restore/schedule` | Manage local data snapshots |
| `vyl plugin create <name>` | Create a plugin scaffold |

## What is intentionally not here

The normal CLI does not run heavy security scans, container scans, or npm publishing. Those belong in CI release workflows so everyday setup remains fast.
