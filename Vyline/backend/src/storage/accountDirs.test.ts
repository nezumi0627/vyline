import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
let accountDir: typeof import("./accountDirs.js")["accountDir"];
let ensureAccount: typeof import("./accountDirs.js")["ensureAccount"];
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-account-dirs-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  ({ accountDir, ensureAccount } = await import("./accountDirs.js"));
  ({ closeSqlite } = await import("./sqlite.js"));
});

afterAll(async () => {
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("distinct account IDs that sanitize to the same name get separate directories", () => {
  ensureAccount("ab");
  ensureAccount("a.b");
  expect(accountDir("ab")).not.toBe(accountDir("a.b"));
});

test("an unsafe directory name from the account registry cannot escape accounts/", async () => {
  const accountId = "path-traversal";
  const { sqlite } = await import("./sqlite.js");
  sqlite
    .query("INSERT INTO app_accounts (account_id, dir_name, registered_at) VALUES (?, ?, ?)")
    .run(accountId, "../../outside", "2026-01-01T00:00:00.000Z");

  ensureAccount(accountId);

  expect(accountDir(accountId)).toBe(join(dataDir, "accounts", accountId));

  const emptyNameAccount = "empty-registry-path";
  sqlite
    .query("INSERT INTO app_accounts (account_id, dir_name, registered_at) VALUES (?, ?, ?)")
    .run(emptyNameAccount, "", "2026-01-01T00:00:00.000Z");
  ensureAccount(emptyNameAccount);
  expect(accountDir(emptyNameAccount)).toBe(join(dataDir, "accounts", emptyNameAccount));
});

test("safe legacy directory names remain unchanged", async () => {
  const accountId = "legacy-path-compatible";
  const legacyDir = "account_日本.1";
  const { sqlite } = await import("./sqlite.js");
  sqlite
    .query("INSERT INTO app_accounts (account_id, dir_name, registered_at) VALUES (?, ?, ?)")
    .run(accountId, legacyDir, "2026-01-01T00:00:00.000Z");

  ensureAccount(accountId);

  expect(accountDir(accountId)).toBe(join(dataDir, "accounts", legacyDir));
});
