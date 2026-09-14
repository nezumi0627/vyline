import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { accountId } from "./catalog.js";
import { createToken, revokeToken } from "../storage/apiTokenStore.js";
import { listSavedSessions } from "../storage/tokenStore.js";
import { writeTextAtomic } from "../storage/safeFile.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    accounts: { type: "string" },
    "tunnel-id": { type: "string" },
    "server-admin": { type: "boolean", default: false },
    revoke: { type: "boolean", default: false },
  },
});
const dataDir = process.env.VYLINE_DATA_DIR;
if (!dataDir) throw new Error("Set VYLINE_DATA_DIR to the existing server data directory");
const directory = join(dataDir, "chatgpt");
const authPath = join(directory, "authorization");
const profilePath = join(directory, "tunnel.yaml");
async function optionalText(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
if (values.revoke) {
  const authorization = await readFile(authPath, "utf8");
  await revokeToken(authorization.replace(/^Bearer /, "").trim());
  console.log("Plugin token revoked. Restart Vyline to reload tokens.");
} else {
  const saved = await listSavedSessions();
  if (!values.accounts || !values["tunnel-id"]) {
    console.log(
      JSON.stringify(
        { accounts: saved.map(({ accountId, displayName }) => ({ accountId, displayName })) },
        null,
        2,
      ),
    );
    console.log("Usage: --accounts account-a,account-b --tunnel-id tunnel_... [--server-admin]");
    process.exit(1);
  }
  const accounts = [...new Set(values.accounts.split(",").map((a) => accountId.parse(a.trim())))];
  if (accounts.length > 32) throw new Error("At most 32 accounts per grant");
  if (accounts.some((a) => !saved.some((s) => s.accountId === a)))
    throw new Error("Select existing saved account IDs");
  const tunnelId = values["tunnel-id"];
  if (!/^tunnel_[A-Za-z0-9]+$/.test(tunnelId)) throw new Error("Invalid tunnel ID");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Save the previous bearer for revocation only after the replacement is persisted.
  const previous = await optionalText(authPath);
  const previousProfile = await optionalText(profilePath);
  const token = await createToken(
    "ChatGPT plugin",
    accounts,
    values["server-admin"] ? ["read", "write", "admin"] : ["read", "write"],
  );
  try {
    await writeTextAtomic(
      profilePath,
      `config_version: 1
control_plane:
  base_url: https://api.openai.com
  tunnel_id: ${tunnelId}
  api_key: file:/run/secrets/openai-tunnel-runtime-key
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:3000/v1/chatgpt/mcp
  extra_headers:
    Authorization: file:/app/data/chatgpt/authorization
  discovery_extra_headers:
    Authorization: file:/app/data/chatgpt/authorization
  startup_wait_timeout: 60s
  max_concurrent_requests: 4
health:
  listen_addr: 127.0.0.1:8080
admin_ui:
  open_browser: false
log:
  level: info
  format: json
`,
    );
    await writeTextAtomic(authPath, `Bearer ${token.token}`);
  } catch (error) {
    if (previousProfile !== null) await writeTextAtomic(profilePath, previousProfile);
    else await rm(profilePath, { force: true });
    await revokeToken(token.token!);
    throw error;
  }
  if (previous) await revokeToken(previous.replace(/^Bearer /, "").trim());
  console.log(
    JSON.stringify({
      accountIds: accounts,
      scopes: token.scopes,
      profile: join(directory, "tunnel.yaml"),
      restartRequired: true,
    }),
  );
}
