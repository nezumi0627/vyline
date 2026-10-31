import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSqliteDurability } from "./sqliteConfig.js";

const dir = dirname(fileURLToPath(import.meta.url));
let connection: Database | undefined;
let connectionPath: string | undefined;

function getDatabase(): Database {
  const dataDir = process.env.VYLINE_DATA_DIR ?? join(dir, "..", "..", "data");
  const path = join(dataDir, "vyline.sqlite");
  if (connection) {
    if (connectionPath !== path) throw new Error("VYLINE_DATA_DIR cannot change after SQLite initialization");
    return connection;
  }
  const durability = getSqliteDurability(process.env);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dataDir, 0o700);
  const db = new Database(path);
  if (process.platform !== "win32") chmodSync(path, 0o600);
  const journal = db.query(`PRAGMA journal_mode = ${durability.journalMode}`).get() as
    | { journal_mode?: string }
    | null;
  if (journal?.journal_mode?.toUpperCase() !== durability.journalMode) {
    db.close();
    throw new Error(`SQLite could not enable ${durability.journalMode} journal mode`);
  }
  db.exec(`
  PRAGMA synchronous = ${durability.synchronous};
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS app_accounts (
    account_id TEXT PRIMARY KEY,
    dir_name TEXT NOT NULL,
    registered_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);
  connection = db;
  connectionPath = path;
  return db;
}

// Delay disk access until a storage operation occurs. This keeps pure imports
// and offline test discovery from touching the user's persistent data.
export const sqlite = new Proxy({} as Database, {
  get(_target, property) {
    const db = getDatabase();
    const value = Reflect.get(db, property, db);
    return typeof value === "function" ? value.bind(db) : value;
  },
});

export function closeSqlite(): void {
  connection?.close();
  connection = undefined;
  connectionPath = undefined;
}

/** Run a legacy import exactly once and record it atomically with its writes. */
export function migrateOnce(name: string, migrate: () => void): void {
  sqlite.transaction(() => {
    if (sqlite.query("SELECT 1 FROM app_migrations WHERE name = ?").get(name)) return;
    migrate();
    sqlite
      .query("INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)")
      .run(name, new Date().toISOString());
  }).immediate();
}
