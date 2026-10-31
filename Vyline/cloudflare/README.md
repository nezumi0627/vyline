# Vyline on Cloudflare

Cloudflare Workers routes traffic to one Cloudflare Container running the existing Bun backend and bundled desktop UI. The normal local workflow (`bun run dev`) is unchanged.

The container mounts a dedicated R2 bucket at `/mnt/vyline` for account data, session tokens, chat history, backups, media, and caches. Use a bucket reserved for this Vyline instance and an R2 API token limited to that bucket. The mount uses FUSE, so it has higher latency and weaker filesystem semantics than local disk; this deployment is intended for personal use and a single container instance. SQLite uses DELETE journaling and FULL synchronization on this mount (WAL is disabled), but object-backed FUSE still does not provide the same durability guarantees as a local filesystem. Keep independent Vyline backups and do not run multiple containers against the same bucket.

## Prerequisites

- Cloudflare Workers Paid plan with Containers enabled
- Docker Desktop or another Docker-compatible engine
- Wrangler 4.136.0 or later
- One R2 bucket and an R2 API token with read/write access to that bucket
- A custom domain protected by Cloudflare Access

## Configure and deploy

Run these commands from the repository root:

```sh
npm install --prefix Vyline/cloudflare --workspaces=false
cd Vyline/cloudflare
npm exec -- wrangler r2 bucket create vyline-data
```

Set `R2_ACCOUNT_ID` and `R2_BUCKET_NAME` in `wrangler.jsonc` under `vars`, then store the R2 credentials as secrets:

```sh
npm exec -- wrangler secret put AWS_ACCESS_KEY_ID
npm exec -- wrangler secret put AWS_SECRET_ACCESS_KEY
npm run dev
```

For deployment, configure a custom domain for the Worker and require Cloudflare Access on that hostname before exposing Vyline. `workers.dev` and preview URLs are disabled. Then run:

```sh
npm run deploy
```

The Worker sends all paths, including the UI and WebSocket endpoints, to the same container. Keep `max_instances` at `1`: this configuration uses one persistent filesystem mount for the account data.

## Local and cloud behavior

- Local primary workflow: `bun run dev` from the repository root; data stays in the existing local `Vyline/backend/data` directories.
- Cloudflare preview: `npm run dev`; it builds the same container and requires Docker plus R2 credentials in `.dev.vars`.
- Cloudflare deployment: `npm run deploy`; the running backend and frontend are served from the container.
- Cloudflare SQLite uses `VYLINE_SQLITE_JOURNAL_MODE=DELETE` and `VYLINE_SQLITE_SYNCHRONOUS=FULL`; startup fails if SQLite cannot apply the requested journal mode.

Do not use a public Worker hostname without Cloudflare Access. Vyline stores LINE session tokens and message/media data in the configured R2 bucket.
