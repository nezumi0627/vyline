import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
let store: import("./vylineStorage.js").VylineStorage<{ version: number; profiles: Record<string, { value: number }>; groups: Record<string, unknown> }>;
let sqlite: typeof import("./sqlite.js")["sqlite"];
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-storage-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  const { VylineStorage } = await import("./vylineStorage.js");
  store = new VylineStorage("cache", () => ({ version: 1, profiles: {}, groups: {} }));
  ({ sqlite, closeSqlite } = await import("./sqlite.js"));
  await writeFile(join(dataDir, "vyline-cache-account.json"), JSON.stringify({
    version: 1, profiles: { a: { value: 1 }, b: { value: 2 } }, groups: {},
  }));
});

afterAll(async () => {
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("imports legacy cache once and persists only changed keys in SQLite", async () => {
  const records = await store.load("account");
  expect(records.profiles.a).toEqual({ value: 1 });
  await store.mutate("account", (value) => { value.profiles.a = { value: 3 }; });
  expect(sqlite.query("SELECT COUNT(*) AS count FROM vyline_kv WHERE namespace = ? AND account_id = ?")
    .get("cache", "account")).toEqual({ count: 3 });
  expect(existsSync(join(dataDir, "vyline-cache-account.json"))).toBe(true);
  expect(sqlite.query("SELECT payload FROM vyline_kv WHERE namespace = ? AND account_id = ? AND key = ?")
    .get("cache", "account", "profiles")).toBeNull();
});

test("cache entries can be read and written by key without hydrating the account cache", async () => {
  await store.putCacheEntries("targeted", "profiles", [{ key: "mid-a", value: { value: 7 } }]);
  expect(await store.getCacheEntries("targeted", "profiles", ["mid-a", "missing"]))
    .toEqual(new Map([["mid-a", { value: 7 }]]));
  expect(store.peek("targeted")).toBeUndefined();
});

test("a failed SQLite mutation does not leak the uncommitted value into memory", async () => {
  await store.load("write-failure");
  sqlite.exec(`CREATE TRIGGER reject_cache_write BEFORE INSERT ON vyline_kv
    WHEN NEW.account_id = 'write-failure' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`);

  await expect(store.mutate("write-failure", (value) => {
    value.profiles.failed = { value: 9 };
  })).rejects.toThrow("injected write failure");

  expect(store.peek("write-failure")?.profiles).toEqual({});
});

test("chat cache lookup reads only requested IDs instead of hydrating the full cache", async () => {
  await store.putCacheEntries("chat-name-map", "profiles", [
    { key: "u-visible", value: { mid: "u-visible", displayName: "Visible", updatedAt: 1 } },
    { key: "u-unrelated", value: { mid: "u-unrelated", displayName: "Unrelated", updatedAt: 1 } },
  ]);
  const { vylineGetChatCacheEntries } = await import("./vylineCache.js");
  const entries = await vylineGetChatCacheEntries("chat-name-map", ["u-visible"]);
  expect([...entries.profiles]).toEqual([[
    "u-visible", { mid: "u-visible", displayName: "Visible", updatedAt: 1 },
  ]]);
  expect(entries.groups.size).toBe(0);
});
