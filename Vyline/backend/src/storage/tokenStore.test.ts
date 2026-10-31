import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
let tokenStore: typeof import("./tokenStore.js");
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-token-store-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  tokenStore = await import("./tokenStore.js");
  ({ closeSqlite } = await import("./sqlite.js"));
});

afterAll(async () => {
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("persists the newest refreshed token per account without crossing accounts", async () => {
  await tokenStore.saveToken("offline-token-a", "old-access");
  await tokenStore.saveToken("offline-token-b", "other-account");
  await tokenStore.saveToken("offline-token-a", "refreshed-access");

  expect((await tokenStore.getToken("offline-token-a"))?.authToken).toBe("refreshed-access");
  expect((await tokenStore.getToken("offline-token-b"))?.authToken).toBe("other-account");
});
