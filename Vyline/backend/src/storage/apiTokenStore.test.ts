import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashApiToken } from "../security/policies.js";

const legacyToken = "vyl_legacy-token-for-migration-test";
let dataDir: string;
let tokenStore: typeof import("./apiTokenStore.js");

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-api-token-security-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  const previousDb = new Database(join(dataDir, "vyline.sqlite"));
  previousDb.exec(`
    CREATE TABLE api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      created_at TEXT NOT NULL, last_used_at TEXT
    );
    CREATE TABLE api_token_scopes (
      token TEXT NOT NULL REFERENCES api_tokens(token) ON DELETE CASCADE,
      position INTEGER NOT NULL, scope TEXT NOT NULL, PRIMARY KEY(token, position)
    );
  `);
  previousDb.close();
  await writeFile(
    join(dataDir, "api-tokens.json"),
    JSON.stringify([
      {
        token: legacyToken,
        name: "legacy read token",
        scopes: ["read"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
  );
  tokenStore = await import("./apiTokenStore.js");
});

afterAll(async () => {
  const { closeSqlite } = await import("./sqlite.js");
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("hashes legacy and new API tokens while preserving validation and revocation", async () => {
  const listed = await tokenStore.listTokens();
  const legacyGrant = await tokenStore.validateToken(legacyToken);
  const created = await tokenStore.createToken("write token", "account-1", ["write"]);
  const { sqlite } = await import("./sqlite.js");
  const rows = sqlite.query("SELECT token FROM api_tokens ORDER BY id").all() as Array<{
    token: string;
  }>;

  expect(legacyGrant?.scopes).toEqual(["read"]);
  expect(legacyGrant?.accountId).toBeNull();
  expect(listed).toHaveLength(1);
  expect("token" in listed[0]!).toBe(false);
  expect(rows.map((row) => row.token)).toEqual([
    hashApiToken(legacyToken),
    hashApiToken(created.token),
  ]);
  expect(await tokenStore.validateToken(created.token)).toMatchObject({ accountId: "account-1", scopes: ["write"] });
  expect(await tokenStore.revokeToken(created.token)).toBe(true);
  expect(await tokenStore.validateToken(created.token)).toBeNull();
});
