# @vyline/cli

`@vyline/cli` provides the `vyl` command for Vyline setup, diagnostics, snapshots, and plugin scaffolding.

## Register the cross-platform command

From a Vyline checkout with Bun 1.4.0 or newer:

```bash
bun install
bun run vyl register
```

`vyl register` uses Bun's global link on Windows, macOS, and Linux, then remembers this checkout as the default project. Once Bun's global bin directory is on `PATH`, open a new terminal and run `vyl dev` or `vyl doctor` from any folder. Register another checkout from inside it or use `vyl register --project <path>`.

Remove the global command with `vyl unregister`. This leaves Bun installed.

When you do not want a global command, the root scripts remain available inside a checkout:

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
| `vyl register [--project <path>]` | Register `vyl` globally and remember the default checkout |
| `vyl unregister` | Remove the global command and saved checkout |
| `vyl doctor` | Lightweight local health check |
| `vyl fix` | Repair common local setup issues |
| `vyl dev` | Start backend and frontend |
| `vyl start` | Start backend server |
| `vyl snapshot create/list/restore/schedule` | Manage local data snapshots |
| `vyl plugin create <name>` | Create a plugin scaffold |

## What is intentionally not here

The normal CLI does not run heavy security scans, container scans, or npm publishing. Those belong in CI release workflows so everyday setup remains fast.
