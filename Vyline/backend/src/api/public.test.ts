import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { hashApiToken } from "../security/policies.js";

let dataDir: string;
let publicRouter: typeof import("./public.js")["publicRouter"];
let token: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-public-api-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  const publicApi = await import("./public.js");
  const tokens = await import("../storage/apiTokenStore.js");
  publicRouter = publicApi.publicRouter;
  token = (await tokens.createToken("account scoped", "authorized-account", ["read"])).token;
});

afterAll(async () => {
  const { closeSqlite } = await import("../storage/sqlite.js");
  closeSqlite();
  process.env.VYLINE_DATA_DIR = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

test("a public API token cannot request another account's chats", async () => {
  const response = await publicRouter.request("/accounts/other-account/chats", {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    error: "Token is not authorized for this account",
  });
});

test("an unbound legacy API token cannot enumerate accounts", async () => {
  // Legacy tokens have no accountId, so validation cannot grant them broad access.
  const { sqlite } = await import("../storage/sqlite.js");
  const legacyToken = "vyl_legacy-unbound";
  sqlite
    .query("INSERT INTO api_tokens (token, name, created_at) VALUES (?, ?, ?)")
    .run(hashApiToken(legacyToken), "legacy", new Date().toISOString());
  sqlite
    .query("INSERT INTO api_token_scopes (token, position, scope) VALUES (?, ?, ?)")
    .run(hashApiToken(legacyToken), 0, "read");
  const response = await publicRouter.request("/accounts", {
    headers: { authorization: `Bearer ${legacyToken}` },
  });

  expect(response.status).toBe(403);
});
