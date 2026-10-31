import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

const accountId = "offline-protocol-kv";
let dataDir: string;
let storagePath: string;
let ProtocolSqliteStorage: typeof import("./protocolSqliteStorage.js")["ProtocolSqliteStorage"];
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-protocol-kv-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  storagePath = join(dataDir, `storage-${accountId}.json`);
  await writeFile(storagePath, JSON.stringify({
    authMarker: "legacy-value",
    e2eeKey: { keyId: 7, privateKey: "offline-secret-fixture" },
  }));
  ({ ProtocolSqliteStorage } = await import("./protocolSqliteStorage.js"));
  ({ closeSqlite } = await import("./sqlite.js"));
});

afterAll(async () => {
  closeSqlite();
  delete process.env.VYLINE_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

test("imports legacy protocol keys once and stores later keys by account and key", async () => {
  const storage = new ProtocolSqliteStorage(accountId, storagePath);
  expect(await storage.get("authMarker")).toBe("legacy-value");
  expect(await storage.get("e2eeKey")).toEqual({ keyId: 7, privateKey: "offline-secret-fixture" });
  await Promise.all(Array.from({ length: 80 }, (_, index) => storage.set(`key-${index}`, index)));
  await storage.set("authMarker", "updated");
  expect(await storage.get("authMarker")).toBe("updated");
  expect(await readFile(storagePath, "utf8")).toContain("legacy-value");

  const { sqlite } = await import("./sqlite.js");
  expect(sqlite.query("SELECT COUNT(*) AS count FROM protocol_kv WHERE account_id=?").get(accountId))
    .toEqual({ count: 82 });
  expect(sqlite.query("SELECT value FROM protocol_kv WHERE account_id=? AND key=?")
    .get(accountId, "authMarker")).toEqual({ value: '"updated"' });
});

test("delete and clear affect only the selected protocol account", async () => {
  const storage = new ProtocolSqliteStorage(accountId, storagePath);
  await storage.set("remove-me", "x");
  await storage.delete("remove-me");
  expect(await storage.get("remove-me")).toBeUndefined();
  await storage.set("kept", true);
  const other = new ProtocolSqliteStorage("offline-protocol-other", join(dataDir, "other.json"));
  await other.set("kept", false);
  await storage.clear();
  expect(await storage.get("kept")).toBeUndefined();
  expect(await other.get("kept")).toBe(false);
});

test("malformed legacy protocol storage stays recoverable and can be retried", async () => {
  const retryPath = join(dataDir, "storage-offline-protocol-retry.json");
  await writeFile(retryPath, "{broken");
  const storage = new ProtocolSqliteStorage("offline-protocol-retry", retryPath);
  await expect(storage.get("key")).rejects.toThrow();
  expect(await readFile(retryPath, "utf8")).toBe("{broken");
  await writeFile(retryPath, JSON.stringify({ key: "recovered" }));
  expect(await storage.get("key")).toBe("recovered");
});
