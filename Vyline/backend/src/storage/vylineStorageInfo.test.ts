import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
let getVylineStorageInfo: typeof import("./vylineStorageInfo.js")["getVylineStorageInfo"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-storage-info-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  process.env.VYLINE_STORAGE_DIR = join(dataDir, "storage");
  await mkdir(process.env.VYLINE_STORAGE_DIR, { recursive: true });
  await writeFile(join(dataDir, "vyline.sqlite"), "db");
  await writeFile(join(dataDir, "vyline.sqlite-wal"), "wal!");
  await writeFile(join(dataDir, "vyline.sqlite-shm"), "s");
  ({ getVylineStorageInfo } = await import("./vylineStorageInfo.js"));
});

afterAll(async () => {
  process.env.VYLINE_DATA_DIR = undefined;
  process.env.VYLINE_STORAGE_DIR = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

test("storage overview includes the active SQLite database and WAL files", async () => {
  const info = await getVylineStorageInfo();
  expect(info.databaseSize).toBe(7);
  expect(info.vylineTotal).toBe(7);
  expect(info.disk?.totalBytes).toBeGreaterThan(0);
  expect(info.disk?.freeBytes).toBeGreaterThan(0);
});
