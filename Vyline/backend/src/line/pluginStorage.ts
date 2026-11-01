import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "../logger.js";
import { migrateOnce, sqlite } from "../storage/sqlite.js";
import { DATA_DIR } from "./pluginPaths.js";

const log = childLogger("plugin-storage");
const settingsDir = join(DATA_DIR, "plugin-settings");

function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS plugin_settings (
      account_id TEXT NOT NULL, plugin_id TEXT NOT NULL, setting_key TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (account_id, plugin_id, setting_key)
    );
    CREATE TABLE IF NOT EXISTS plugin_states (
      account_id TEXT NOT NULL, plugin_id TEXT NOT NULL, enabled INTEGER NOT NULL,
      PRIMARY KEY (account_id, plugin_id)
    );
  `);
}

function ensureSettingsImported(accountId: string, pluginId: string): void {
  ensureSchema();
  const path = join(settingsDir, `${accountId}.${pluginId}.json`);
  if (!existsSync(path)) return;
  const name = `plugin-settings-json-v2:${accountId}:${pluginId}`;
  if (sqlite.query("SELECT 1 FROM app_migrations WHERE name = ?").get(name)) return;
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    log.error(
      { accountId, pluginId, err },
      "legacy plugin settings import failed; source retained",
    );
    return;
  }
  migrateOnce(name, () => {
    const insert = sqlite.query(`INSERT OR IGNORE INTO plugin_settings
      (account_id, plugin_id, setting_key, payload) VALUES (?, ?, ?, ?)`);
    for (const [key, value] of Object.entries(settings)) {
      insert.run(accountId, pluginId, key, JSON.stringify(value));
    }
  });
}

export function getPluginSetting(accountId: string, pluginId: string, key: string): unknown {
  ensureSettingsImported(accountId, pluginId);
  const row = sqlite
    .query(`SELECT payload FROM plugin_settings
    WHERE account_id = ? AND plugin_id = ? AND setting_key = ?`)
    .get(accountId, pluginId, key) as { payload: string } | null;
  return row ? JSON.parse(row.payload) : undefined;
}

export function setPluginSetting(
  accountId: string,
  pluginId: string,
  key: string,
  value: unknown,
): void {
  ensureSettingsImported(accountId, pluginId);
  if (value === undefined) {
    sqlite
      .query(
        "DELETE FROM plugin_settings WHERE account_id = ? AND plugin_id = ? AND setting_key = ?",
      )
      .run(accountId, pluginId, key);
    return;
  }
  const payload = JSON.stringify(value);
  if (payload === undefined) return;
  sqlite
    .query(`INSERT INTO plugin_settings (account_id, plugin_id, setting_key, payload)
    VALUES (?, ?, ?, ?) ON CONFLICT(account_id, plugin_id, setting_key)
    DO UPDATE SET payload = excluded.payload`)
    .run(accountId, pluginId, key, payload);
}

export function getPluginStates(accountId: string): Record<string, boolean> {
  ensureSchema();
  const path = join(DATA_DIR, "plugin-states.json");
  const name = "plugin-states-json-v2";
  if (existsSync(path) && !sqlite.query("SELECT 1 FROM app_migrations WHERE name = ?").get(name)) {
    try {
      const states = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        Record<string, boolean>
      >;
      migrateOnce(name, () => {
        const insert =
          sqlite.query(`INSERT OR IGNORE INTO plugin_states (account_id, plugin_id, enabled)
          VALUES (?, ?, ?)`);
        for (const [id, plugins] of Object.entries(states)) {
          for (const [pluginId, enabled] of Object.entries(plugins))
            insert.run(id, pluginId, enabled ? 1 : 0);
        }
      });
    } catch (err) {
      log.error({ err }, "legacy plugin state import failed; source retained");
    }
  }
  const rows = sqlite
    .query("SELECT plugin_id, enabled FROM plugin_states WHERE account_id = ?")
    .all(accountId) as Array<{ plugin_id: string; enabled: number }>;
  return Object.fromEntries(rows.map((row) => [row.plugin_id, row.enabled === 1]));
}

export function setStoredPluginState(accountId: string, pluginId: string, enabled: boolean): void {
  ensureSchema();
  sqlite
    .query(`INSERT INTO plugin_states (account_id, plugin_id, enabled) VALUES (?, ?, ?)
    ON CONFLICT(account_id, plugin_id) DO UPDATE SET enabled = excluded.enabled`)
    .run(accountId, pluginId, enabled ? 1 : 0);
}
