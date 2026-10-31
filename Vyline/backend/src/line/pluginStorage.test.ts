import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
let getPluginSetting: typeof import("./pluginStorage.js")["getPluginSetting"];
let setPluginSetting: typeof import("./pluginStorage.js")["setPluginSetting"];
let getPluginStates: typeof import("./pluginStorage.js")["getPluginStates"];
let setStoredPluginState: typeof import("./pluginStorage.js")["setStoredPluginState"];
let closeSqlite: typeof import("../storage/sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-plugin-storage-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  const settingsDir = join(dataDir, "plugin-settings");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(join(settingsDir, "offline.sample.json"), JSON.stringify({ color: "blue", count: 2 }));
  await writeFile(join(dataDir, "plugin-states.json"), JSON.stringify({ offline: { sample: true } }));
  ({ getPluginSetting, setPluginSetting, getPluginStates, setStoredPluginState } = await import("./pluginStorage.js"));
  ({ closeSqlite } = await import("../storage/sqlite.js"));
});

afterAll(async () => {
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("imports plugin settings and enabled states into SQLite while retaining old files", () => {
  expect(getPluginSetting("offline", "sample", "color")).toBe("blue");
  setPluginSetting("offline", "sample", "color", "green");
  expect(getPluginSetting("offline", "sample", "color")).toBe("green");
  expect(getPluginStates("offline")).toEqual({ sample: true });
  setStoredPluginState("offline", "sample", false);
  expect(getPluginStates("offline")).toEqual({ sample: false });
  expect(existsSync(join(dataDir, "plugin-settings", "offline.sample.json"))).toBe(true);
  expect(existsSync(join(dataDir, "plugin-states.json"))).toBe(true);
});
