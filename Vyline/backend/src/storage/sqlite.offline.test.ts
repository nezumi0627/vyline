import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
const previousDataDir = process.env.VYLINE_DATA_DIR;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-offline-import-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  await import("./featureLocks.js");
});

afterAll(async () => {
  const { closeSqlite } = await import("./sqlite.js");
  closeSqlite();
  if (previousDataDir === undefined) process.env.VYLINE_DATA_DIR = undefined;
  else process.env.VYLINE_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("importing a storage module does not create persistent state", () => {
  expect(existsSync(join(dataDir, "vyline.sqlite"))).toBe(false);
});
