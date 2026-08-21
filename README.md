<h1 align="center">Vyline <sup>Beta</sup></h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  API-first, extensible third-party LINE client architecture for desktop, server, plugins, and custom clients.
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-beta-a78bfa?style=flat-square" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun%201.6-f472b6?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
</p>

---

## About

Vyline is an independent third-party LINE client project.

Vyline aims to become a clean, fast, extensible LINE client architecture with:

- desktop client support
- server mode support
- separated frontend / backend
- OpenAPI / Swagger based API
- JavaScript / TypeScript plugin system
- custom client support
- multi-account support
- grouped multi-image sending
- storage management
- backup / restore
- Docker-friendly deployment
- lightweight CPU / memory / network usage

Vyline is currently in **Beta**.

The project is still changing quickly. Some features are implemented, some are experimental, and some are planned.

---

## Project Goals

Vyline is built around these goals:

- provide a clean desktop client experience
- separate frontend and backend completely
- expose a stable backend API
- provide Swagger / OpenAPI documentation
- allow users to build custom clients
- allow plugins written in JavaScript / TypeScript
- isolate data per account
- separate cache and saved media
- make backup / restore reliable
- run locally or on a server
- support Docker / Docker Compose deployment
- keep memory, CPU, and network usage low
- keep documentation accurate and readable

Vyline should not become heavy or over-engineered.

Unnecessary abstractions, wrappers, services, dependencies, and large rewrites should be avoided unless they clearly improve the project.

---

## Status

Vyline is currently a **Beta project**.

Current priority areas:

- repository cleanup
- documentation cleanup
- frontend / backend separation
- Swagger / OpenAPI API design
- plugin system
- custom client support
- multi-account storage isolation
- multi-image sending
- server mode
- Docker deployment
- update / migration flow
- performance optimization

---

## Features

### Desktop Client

Vyline provides a desktop client experience for LINE-like messaging workflows.

The UI should remain clean, fast, and easy to use.

---

### API-first Architecture

Vyline must be designed as an API-first application.

The backend should expose a stable API that can be used by:

- the official Vyline frontend
- custom frontends
- server dashboards
- plugins
- automation tools
- future CLI wrappers
- external clients

Frontend code must not depend directly on backend private modules.

The frontend should communicate with the backend through the public API or a generated API client.

---

## API / Swagger / OpenAPI

Vyline must provide a documented backend API.

Swagger / OpenAPI support is required.

The API should be available in development and server mode.

Required API documentation routes:

```txt
GET /docs
GET /swagger
GET /openapi.json
```

The API must be versioned.

Example:

```txt
/api/v1/...
```

Public API, internal API, plugin API, and desktop IPC must be separated.

---

### Required API Areas

The backend API must cover at least:

* accounts
* sessions
* chats
* messages
* media
* multi-image sending
* storage
* cache
* saved media
* backup
* restore
* settings
* themes
* plugins
* notifications
* health checks
* metrics

---

### Example API Endpoints

```txt
GET    /health
GET    /metrics
GET    /api/v1/status

GET    /api/v1/accounts
POST   /api/v1/accounts/switch
GET    /api/v1/accounts/:accountId/profile

GET    /api/v1/accounts/:accountId/chats
GET    /api/v1/accounts/:accountId/chats/:chatId/messages
POST   /api/v1/accounts/:accountId/chats/:chatId/messages

POST   /api/v1/accounts/:accountId/chats/:chatId/media/batch

GET    /api/v1/accounts/:accountId/storage
GET    /api/v1/accounts/:accountId/storage/cache
DELETE /api/v1/accounts/:accountId/storage/cache

GET    /api/v1/accounts/:accountId/plugins
POST   /api/v1/accounts/:accountId/plugins/:pluginId/enable
POST   /api/v1/accounts/:accountId/plugins/:pluginId/disable

POST   /api/v1/accounts/:accountId/backup
POST   /api/v1/accounts/:accountId/restore
```

Actual endpoint names may change during Beta, but the final API must be documented through OpenAPI / Swagger.

---

## Frontend / Backend Separation

Vyline must separate frontend and backend completely.

The frontend should be replaceable.

The backend should be reusable.

The desktop shell should only bundle or connect frontend and backend. It should not create hidden dependencies between them.

Required direction:

```txt
apps/
  web/
  desktop/
  server/

packages/
  api/
  api-client/
  core/
  line/
  storage/
  plugin-sdk/
  plugin-runtime/
  shared/
  ui/
```

Rules:

* frontend must not import backend private modules
* backend must not import React components
* shared types must live in shared packages
* API types should be generated or shared safely
* desktop IPC must not replace the public API
* server mode and desktop mode should use the same core logic

---

## Custom Clients

Vyline is not only a themeable client.

Users and developers should be able to build their own clients using Vyline's backend API.

Possible clients:

* official Vyline desktop frontend
* custom web client
* minimal chat viewer
* notification-only client
* media manager
* server dashboard
* future CLI wrapper

Custom clients should use:

* public REST API
* generated API client
* shared types
* documented auth flow
* documented account scope

The goal is to allow client replacement, not just theme replacement.

---

## Plugin System

Vyline must support a JavaScript / TypeScript plugin system.

TypeScript is recommended.

The design can be inspired by plugin-based clients such as Vencord, but it must be safe for Vyline's architecture.

Plugins should extend Vyline without modifying core code.

---

### Plugin Requirements

Plugins must support:

* install
* enable
* disable
* update
* remove
* activate
* deactivate
* settings
* permissions
* logs
* error isolation
* developer mode
* examples
* plugin SDK

Disabled plugins should have almost zero runtime cost.

Plugin crashes must not crash Vyline itself.

---

### Example Plugin

```ts
import { definePlugin } from "@vyline/plugin-sdk";

export default definePlugin({
  id: "example-plugin",
  name: "Example Plugin",
  version: "0.1.0",
  description: "Example Vyline plugin",
  permissions: ["messages:read", "notifications:send"],

  async activate(ctx) {
    ctx.messages.on("message", (message) => {
      ctx.logger.info("New message", message.id);
    });
  },

  async deactivate(ctx) {
    // cleanup listeners / resources
  },
});
```

---

### Plugin Permissions

Example permissions:

```txt
messages:read
messages:send
chats:read
media:read
media:write
storage:read
storage:write
notifications:send
ui:extend
network:request
settings:read
settings:write
```

Plugins must not access:

* raw tokens
* sessions
* cookies
* private keys
* unrestricted filesystem paths
* backend private APIs
* another account's data
* raw MID values unless absolutely required and permissioned

Plugin APIs must be account-scoped.

---

## Multi-account Support

Vyline must support multiple LINE accounts.

Account data must be separated by account scope using the user's LINE `mid` or a safe derived account identifier.

Raw MID values should not be exposed unnecessarily.

Recommended storage direction:

```txt
data/
  accounts/
    <safe-account-id>/
      profile.json
      session/
      storage/
      cache/
      media/
      db/
      plugins/
      logs/
      backup/
```

The following data must not be mixed between accounts:

* messages
* chats
* media
* cache
* saved media
* sessions
* settings
* plugin data
* logs
* backups
* pending uploads
* pending multi-image batches

Account switching must clean up old listeners, stale UI state, old sockets, old plugin contexts, and old media references.

---

## Multi-image Sending

Vyline must support grouped multi-image sending.

For LINE Desktop compatibility, multiple images should not be merged into one message.

Instead, multiple images should be sent as separate `IMAGE` messages and connected using relation fields.

Required relation fields:

* `relatedMessageId`
* `messageRelationType`
* `relatedMessageServiceCode`, if required

Expected behavior:

```txt
image 1 -> IMAGE message
image 2 -> IMAGE message, relatedMessageId = image 1 message id
image 3 -> IMAGE message, relatedMessageId = image 2 message id
```

The UI should group related image messages visually while keeping each image as an individual message internally.

This must work across:

* frontend file picker
* frontend send action
* backend media batch API
* protocol layer
* E2EE path
* plain media path
* storage
* message list API
* frontend message model
* UI grouped rendering
* app restart
* multi-account environments

This feature is not complete until:

* relation fields are sent
* relation fields are saved
* relation fields are returned by the message API
* the UI groups related images
* restart keeps the grouping
* account switching does not mix media
* E2EE and plain paths both work
* partial failures do not cause duplicate sending

---

## Storage Management

Vyline must separate temporary cache from saved user media.

Cache is temporary and can be deleted safely.

Saved media is user-owned persistent data and must be preserved through backup and restore.

Required storage categories:

* cache
* saved media
* account data
* plugin data
* logs
* backups
* temporary uploads

Cache and saved media must not be mixed.

Storage size calculation should be incremental or cached. It must not block the UI with full scans on every startup.

---

## Backup / Restore

Backup and restore must be account-aware.

Backup should preserve:

* saved media
* message references
* account settings
* plugin settings, where safe
* storage metadata

Restore must not mix data between accounts.

Restore should handle missing media, old schemas, and partial data safely.

---

## Server Mode

Vyline must be able to run on a server, not only as a desktop app.

Server mode should expose:

* REST API
* Swagger / OpenAPI docs
* health check endpoint
* metrics endpoint
* static frontend serving option
* configurable storage paths
* configurable plugin directory
* configurable logs directory
* CORS settings
* auth settings
* reverse proxy support

Example target command:

```bash
bun run server
```

Required server endpoints:

```txt
GET /health
GET /metrics
GET /docs
GET /swagger
GET /openapi.json
```

---

## Docker Support

Vyline should be easy to run in Docker or Docker Compose.

Required files:

```txt
Dockerfile
docker-compose.yml
.dockerignore
```

Recommended persistent directories:

* data
* config
* logs
* plugins
* media

Example:

```yaml
services:
  vyline:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
      - ./logs:/app/logs
      - ./plugins:/app/plugins
    environment:
      - VYLINE_HOST=0.0.0.0
      - VYLINE_PORT=3000
      - VYLINE_DATA_DIR=/app/data
      - VYLINE_CONFIG_DIR=/app/config
      - VYLINE_LOG_DIR=/app/logs
      - VYLINE_PLUGIN_DIR=/app/plugins
```

---

## Update / Migration

Vyline should be easy to update.

Required documentation:

* source update guide
* Docker update guide
* backup before update
* rollback guide
* database migration guide
* config migration guide
* breaking changes guide

Example source update flow:

```bash
git pull
bun install --frozen-lockfile
bun run build
bun run migrate
bun run server
```

Example Docker update flow:

```bash
docker compose pull
docker compose up -d --build
```

---

## Runtime

Vyline targets **Bun 1.6**.

Common commands:

```bash
bun install
bun run dev
bun run build
bun run test
bun run typecheck
bun run server
```

Actual commands may change while the project is in Beta.

Documentation should always reflect the actual commands in the repository.

---

## Performance Policy

Vyline should be lightweight.

A third-party client is not useful if it is heavier than the official desktop client.

Vyline should avoid:

* loading all messages into memory
* loading all media at startup
* storing large image buffers in UI state
* converting large media to base64 unnecessarily
* unnecessary polling
* duplicate network requests
* full cache scans on every startup
* keeping inactive accounts fully loaded
* keeping disabled plugins active
* excessive background CPU usage
* unlimited in-memory logs
* unnecessary deep clones
* unnecessary JSON stringify / parse cycles

Vyline should use:

* lazy loading
* pagination
* virtualized message lists
* virtualized media grids
* incremental storage scanning
* bounded memory caches
* request deduplication
* retry backoff
* upload concurrency limits
* worker threads or web workers for heavy tasks
* cleanup after account switching
* cleanup after plugin disable
* memory and CPU measurement

Performance improvements must be measured, not guessed.

Important metrics:

* startup time
* idle memory usage
* idle CPU usage
* message list rendering time
* media loading memory
* account switch memory delta
* server idle memory
* network request count
* duplicate request count

---

## Documentation

README should stay short enough to be an entry point.

Detailed documentation should live in `docs/`.

Required documentation structure:

```txt
docs/
  user-guide/
    installation.md
    update.md
    account-switching.md
    sending-media.md
    storage.md
    backup-restore.md
    troubleshooting.md

  developer-guide/
    architecture.md
    frontend.md
    backend.md
    api.md
    plugin-system.md
    plugin-sdk.md
    custom-client.md
    multi-account.md
    account-storage.md
    multi-image-sending.md
    message-relations.md
    performance-budget.md
    memory-policy.md
    network-optimization.md
    testing.md

  api/
    openapi.md
    swagger.md
    media-batch.md

  deployment/
    local.md
    docker.md
    docker-compose.md
    server.md
    reverse-proxy.md
    systemd.md

  agents/
    overview.md
    coding-rules.md
    review-rules.md
```

Docs must match the actual implementation.

Do not claim features as complete unless they are verified.

---

## Development Policy

Vyline development follows these principles:

* keep code simple
* avoid unnecessary abstractions
* prefer existing APIs and standard library features
* avoid unnecessary dependencies
* keep frontend and backend separated
* keep APIs stable and documented
* protect user data
* isolate account data
* make plugins permission-based
* measure performance changes
* separate confirmed bugs from suspected issues
* keep README readable
* move detailed information into docs

Existing implementation should be questioned, but not blindly replaced.

If existing code is correct and has a valid reason to exist, keep it.

If the structure blocks future development, it may be rebuilt.

Breaking changes are allowed when necessary, but existing features must not be broken without a migration path.

---

## Branch Rules

Recommended branch names:

```txt
feature/<short-name>
fix/<short-name>
docs/<short-name>
refactor/<short-name>
security/<short-name>
perf/<short-name>
chore/<short-name>
```

Recommended commit style:

```txt
feat(api): add media batch endpoint
fix(storage): separate cache from saved media
docs(readme): simplify project overview
perf(messages): virtualize message list
security(plugins): restrict filesystem access
```

---

## Agent / Skill Policy

Vyline development may use coding-agent skill sets to reduce unnecessary code, avoid over-engineering, and improve review quality.

Before large refactors, audits, API redesigns, plugin work, or documentation cleanup, the agent should check and use the following skill / rule sets when available.

### Required Skill Sets

| Skill | Repository | Purpose |
|---|---|---|
| Ponytail | `DietrichGebert/ponytail` | YAGNI, standard library first, reuse existing code, avoid unnecessary abstraction |
| Caveman | `JuliusBrussee/caveman` | Compress reports and explanations while keeping code blocks intact |
| agent-skills-standard | `HoangNguyen0403/agent-skills-standard` | Load task-specific skills only when needed |
| agent-skills | `addyosmani/agent-skills` | Production-grade frontend, performance, API, testing, and documentation guidance |
| Minimize-Cursor-Cost | `inboxpraveen/Minimize-Cursor-Cost` | Reduce repeated reads, wasted tool calls, unnecessary verification, and token cost |

### How These Skills Should Be Used

Ponytail should be used as the default engineering mindset.

Use it to avoid:

- unnecessary wrappers
- unnecessary services
- unnecessary managers
- unnecessary dependencies
- unnecessary rewrites
- future-proofing without actual need
- code that only passes data through another layer

Caveman should be used only for shortening reports, comments, and summaries.

Do not apply Caveman to:

- source code
- OpenAPI schemas
- JSON
- YAML
- TOML
- SQL
- Dockerfiles
- migration files
- security warnings
- legal disclaimers
- user-facing documentation

`agent-skills-standard` and `addyosmani/agent-skills` should be loaded only when relevant.

Do not load every skill at once.

Examples:

- API redesign → load API / OpenAPI related skills
- plugin system → load plugin / sandbox / security related skills
- Docker / server mode → load deployment / DevOps related skills
- performance work → load frontend / React / server performance related skills
- docs cleanup → load documentation related skills

`Minimize-Cursor-Cost` should be used to keep the workflow efficient.

The agent should:

- avoid reading the same file repeatedly
- avoid re-checking already confirmed facts
- batch related searches
- inspect only relevant files first
- run targeted tests before full test suites
- report unknowns instead of wasting time pretending everything is verified

### Skill Priority

These skills are helpers, not final authority.

Priority order:

1. User instructions
2. Security
3. Privacy
4. Data safety
5. Existing feature compatibility
6. Actual repository behavior
7. Test results
8. Ponytail minimalism
9. Other skill recommendations
10. Token reduction

Token reduction must never override correctness, security, privacy, or maintainability.

### Required Agent Report

When an AI coding agent starts a large task, it should include a short skill bootstrap report:

```md
## Skill Bootstrap

| Skill | Status | Used for |
|---|---|---|
| Ponytail | Available / Not available | Minimal implementation and YAGNI |
| Caveman | Available / Not available | Report compression only |
| agent-skills-standard | Available / Not available | Task-specific skills |
| addyosmani/agent-skills | Available / Not available | Production-grade review |
| Minimize-Cursor-Cost | Available / Not available | Efficient repository exploration |

Notes:
- Missing skills must be listed.
- If a skill is unavailable, continue with the same principles manually.
- Do not stop work only because a skill is unavailable.
```

---

## Support Vyline

Vyline is developed as an independent project.

Small support is appreciated and helps with development, testing, documentation, and maintenance.

Suggested support tiers:

|            Amount | Tier              | Notes                                                             |
| ----------------: | ----------------- | ----------------------------------------------------------------- |
|     Under 500 JPY | Thank you support | Helps development and maintenance                                 |
|   500 JPY or more | Supporter         | May be listed as a supporter if requested                         |
| 1,000 JPY or more | Special supporter | May receive acknowledgement in docs or release notes if requested |
| 3,000 JPY or more | Major supporter   | May be listed as a major supporter if requested                   |

Support does not guarantee:

* feature implementation
* bug fixes
* private support
* priority support
* special permissions
* account support

Supporter names are only listed with permission.

Payment details such as PayPay links or QR codes should be documented carefully and should not expose private information.

---

## Security and Privacy

Vyline should never expose sensitive data unnecessarily.

Do not log or expose:

* raw MID values
* tokens
* sessions
* cookies
* private keys
* local user paths
* message contents in debug logs
* account identifiers without need
* plugin private data
* backup private data

Plugins must use permission-scoped APIs.

Account data must remain separated.

Multi-account data mixing is a serious bug.

---

## Disclaimer

Vyline is an independent third-party client project.

Vyline is not affiliated with, endorsed by, or sponsored by LY Corporation or LINE.

Use this project at your own risk.

The maintainers are not responsible for account issues, data loss, service restrictions, or damages caused by using this software.

If there is a problem with content in this repository, please contact the maintainer.

---

## License

MIT License.

See `LICENSE` for details.
