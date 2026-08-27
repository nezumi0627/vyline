<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: en -->

[日本語](README.md)

[日本語](README.md)

<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: en -->

[日本語](README.md)

+# Vyline

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  An extensible LINE third-party client powered by its own protocol stack
</p>

> [!CAUTION]
> Vyline is an unofficial and unauthorised LINE third-party client. It is not affiliated with LINE Corporation or LY Corporation. Use it at your own risk after understanding the risks, including possible terms-of-service violations and account suspension.

> [!NOTE]
> Vyline is currently Beta 0.8.0. Beta software may introduce breaking changes, bugs, or data loss.

---

## What is Vyline?

**Vyline** is a Web/React-based LINE client with messaging, Flex/Rich rendering, theme customisation, backups, and more.

It communicates with LINE servers through the independently implemented **@vyline/protocol** package without relying on an external relay service.

| Item | Details |
| --- | --- |
| Audience | Custom UI users, developers, and self-hosters |
| Highlights | Own protocol stack, VyTheme, public API, local-first data |
| Technology | React + Vite / Hono on Bun / TypeScript / Thrift |
| Status | Beta 0.8.0 |
| License | MIT |

## Features

| Category | Details |
| --- | --- |
| Login | QR/email login, multiple accounts, and session restore |
| Messaging | Send/receive, replies, unsend, read controls, and resend |
| Mentions | @ALL / @name with LINE Desktop-compatible metadata |
| Media | Images, video, audio, LINE emoji, and stickers |
| Flex / Rich | Rendering compatible with official formats and carousel mouse dragging |
| Reactions | One-click reactions, official badges, and read-member lists |
| Chat management | Pin, hide, mute, block, MID copy, group creation, and invitations |
| VyTheme | Themes, font size, density, and profile background customisation |
| E2EE | Letter Sealing decrypt/send and LINE Desktop key import |
| Privacy | Streamer mode and PIN lock |
| Plugins | ZIP installation, permissions, and ES Module extensions |
| Search | Cross-chat search over local message history |
| VylineBackup | Snapshot, restore, and delete chat history and media |
| Setup & handoff | Three-step Vyline Setup, per-MID settings, and integrity-checked ZIP settings handoff |
| Diagnostics & safety | Redacted diagnostic logs, Windows DPAPI session protection, and installation-bound subdevice sessions |
| Developer tools | Bearer-token public API, OpenAPI 3.1, and JSONL diagnostics |

---

## Important notes before use

- Account use may be restricted or suspended if it violates LINE terms.
- Terms and disclaimers must be accepted before sync, network communication, or message display starts.
- Intended use is education, learning, research, and personal use. Do not use Vyline for unauthorised access, attacks, harassment, or infringement.
- Login information, sessions, keys, and chat history stay in your local or self-hosted environment.
- The developers and contributors provide no warranty for account suspension, data loss, corruption, or legal issues.
- The tools submodule is for education and research only. See docs/tools/DISCLAIMER.md.

---

## Installation and updates

### Development setup with Bun

    git clone https://github.com/nezumi0627/Vyline.git
    cd Vyline
    cp .env.example .env
    bun install
    bun run typecheck
    bun run dev

Open http://localhost:5173 in your browser. The backend listens on http://localhost:3001.

| Command | Description |
| --- | --- |
| bun run dev | Start backend and frontend together |
| bun run dev:backend | Start only the backend |
| bun run dev:frontend | Start only the frontend |
| bun run typecheck | Type-check all workspaces |
| bun run lint | Run Biome |
| bun run build | Build the frontend |

See docs/onboarding.md and docs/development.md for details.

### Docker

    git clone https://github.com/nezumi0627/Vyline.git
    cd Vyline
    docker compose up -d --build

Open http://localhost:3000. Data is persisted in ./data/; do not delete it because it contains sessions and keys.

### Linux standalone build

    tar -xzf Vyline-linux-x64-<version>.tar.gz
    cd Vyline-linux-x64-<version>
    ./install.sh
    ~/.local/bin/vyline

For self-hosting and Cloudflare Access, see docs/selfhosting.md.

---

## Architecture

    Frontend (React + Vite) -> Backend (Hono on Bun)
    Backend -> Vyline Protocol (Domain / Dictionary / E2EE / Thrift)
    Vyline Protocol -> LINE Servers

---

## Public API

The public API is available under /v1/. OpenAPI is served at /openapi.json, with interactive documentation at /docs and /swagger.

Set VYLINE_API_ADMIN_SECRET to create and manage Bearer tokens. See docs/api/openapi.md.

---

## E2EE and LINE Desktop keys

To decrypt historical Letter Sealing messages, extract your own key set from the official LINE Desktop client and place it at backend/data/desktop-e2ee-keys.json. The backend imports it at startup.

> [!CAUTION]
> This file contains sensitive information. Never commit, share, or log it.

---

## Versioning

Vyline follows semantic versioning (X.Y.Z, or X.Y.Z-beta during beta). Release tags use v<version>.

Use the version bump script to update all version locations and regenerate the README variants:

    bun run bump -- 0.7.0
    bun run docs:readme
    bun run docs:readme:check

Edit README.src.md, not README.md or README.en.md. Japanese is the default README language; English is available as README.en.md.

---

## Documentation

| Document | Description |
| --- | --- |
| docs/README.md | Documentation index |
| docs/onboarding.md | First-time setup |
| docs/development.md | Development environment and commands |
| docs/architecture.md | Architecture |
| docs/selfhosting.md | Docker and Cloudflare Access |
| docs/api/openapi.md | OpenAPI and public API |
| docs/CONTRIBUTING.md | Contribution guide |
| AGENTS.md | Coding-agent instructions |
| CHANGELOG.md | Changelog |

---

## Roadmap

- Stabilise /v1/, /openapi.json, /docs, and /swagger.
- JavaScript/TypeScript plugins with permission scopes and typed public APIs.
- Custom frontends, bots, and external integrations.
- Per-account authentication, data, and media isolation.
- Better storage management and backup restore.
- Multiple image sending and grouped display.
- Improved Docker Compose and self-hosting.
- Measure memory, CPU, and network usage.

---

## Contributing

Bug fixes, features, documentation, and design contributions are welcome. See docs/CONTRIBUTING.md. Do not include sessions, keys, tokens, or analysis data in issues or pull requests.

---

## License

Vyline is released under the MIT License.

Copyright © nezumi0627

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  Built with care by nezumi0627 and contributors.
</p>
