import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

const accountId = "blocked-diff-account";
let dataDir: string;
let store: typeof import("./blockedContactStore.js");
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];
const u1 = `u${"1".repeat(32)}`;
const u2 = `u${"2".repeat(32)}`;
const u3 = `u${"3".repeat(32)}`;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-blocked-diff-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  store = await import("./blockedContactStore.js");
  ({ closeSqlite } = await import("./sqlite.js"));
});

afterAll(async () => {
  closeSqlite?.();
  await rm(dataDir, { recursive: true, force: true });
});

test("persists only changed blocked MIDs and isolates accounts", async () => {
  expect(await store.syncBlockedContactMids(accountId, [u1, u2])).toEqual({ added: 2, removed: 0 });
  expect(await store.syncBlockedContactMids(accountId, [u2, u3])).toEqual({ added: 1, removed: 1 });
  expect(await store.syncBlockedContactMids(accountId, [u2, u3])).toEqual({ added: 0, removed: 0 });
  expect(await store.listBlockedContactMids(accountId)).toEqual([u2, u3]);
  expect(await store.listBlockedContactMids("other-account")).toEqual([]);
});
