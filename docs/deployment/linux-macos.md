# Linux / macOS deployment

Vyline runs on Bun on Linux and macOS. Run it from the repository root:

```sh
bun install --frozen-lockfile
bun run dev
```

The backend listens on `127.0.0.1:3001` by default and the Vite UI on
`127.0.0.1:5173`. If either port is occupied, choose a free port explicitly:

```sh
VYLINE_BACKEND_PORT=3301 VITE_PORT=5174 bun run dev
```

To keep user data outside the checkout (recommended for service installs), set
absolute writable paths. The process creates missing directories and restricts
the SQLite data directory to the current user on Unix:

```sh
export VYLINE_DATA_DIR="$HOME/.local/share/vyline/data"
export VYLINE_STORAGE_DIR="$HOME/.local/share/vyline/storage"
```

On macOS, `~/Library/Application Support/Vyline/data` and
`~/Library/Application Support/Vyline/storage` are suitable alternatives.

For same-WiFi access, bind the UI/backend to the LAN and enable device auth:

```sh
VYLINE_LAN_ACCESS=true VYLINE_BACKEND_PORT=3001 VITE_PORT=5173 bun run dev
```

Open the machine's LAN address on the other device and pair it from Vyline's
device settings. Do not expose the service to the public internet without a
trusted HTTPS reverse proxy and an explicit network access policy. Avoid port
collisions by selecting unused ports rather than disabling the listener checks.

If running behind a reverse proxy, set `VYLINE_TRUST_PROXY=true`, configure the
proxy to overwrite `X-Forwarded-For` with the actual client address, and firewall
the backend port so only that proxy can reach it. Never enable proxy trust while
untrusted clients can connect directly to the backend. The development Vite
proxy forwards the socket peer address automatically.
