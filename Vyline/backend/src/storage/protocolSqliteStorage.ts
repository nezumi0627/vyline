/** Account-scoped protocol key/value storage backed by the shared SQLite database. */

import { existsSync, readFileSync } from "node:fs";
import type { BaseStorage, Storage } from "@vyline/protocol/stack/storage";
import { migrateOnce, sqlite } from "./sqlite.js";

type ProtocolValue = Storage["Value"];

function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS protocol_kv (
      account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(account_id, key)
    );
  `);
}

function ensureLegacyImported(accountId: string, legacyPath: string): void {
  ensureSchema();
  const migrationName = `protocol-kv-json-v1:${accountId}`;
  if (sqlite.query("SELECT 1 FROM app_migrations WHERE name=?").get(migrationName)) return;

  let legacy: Record<string, ProtocolValue> | null = null;
  if (existsSync(legacyPath)) {
    const parsed: unknown = JSON.parse(readFileSync(legacyPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Legacy protocol storage must contain a JSON object");
    }
    legacy = parsed as Record<string, ProtocolValue>;
  }

  migrateOnce(migrationName, () => {
    if (!legacy) return;
    const insert = sqlite.query(
      "INSERT OR IGNORE INTO protocol_kv(account_id,key,value) VALUES(?,?,?)",
    );
    for (const [key, value] of Object.entries(legacy)) {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) continue;
      insert.run(accountId, key, serialized);
    }
  });
}

export class ProtocolSqliteStorage implements BaseStorage {
  constructor(
    private readonly accountId: string,
    private readonly legacyPath: string,
  ) {}

  async get(key: Storage["Key"]): Promise<ProtocolValue | undefined> {
    ensureLegacyImported(this.accountId, this.legacyPath);
    const row = sqlite
      .query("SELECT value FROM protocol_kv WHERE account_id=? AND key=?")
      .get(this.accountId, key) as { value: string } | null;
    return row ? (JSON.parse(row.value) as ProtocolValue) : undefined;
  }

  async set(key: Storage["Key"], value: ProtocolValue): Promise<void> {
    ensureLegacyImported(this.accountId, this.legacyPath);
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new TypeError(`Unsupported protocol storage value for key: ${key}`);
    sqlite
      .query(`INSERT INTO protocol_kv(account_id,key,value) VALUES(?,?,?)
      ON CONFLICT(account_id,key) DO UPDATE SET value=excluded.value`)
      .run(this.accountId, key, serialized);
  }

  async delete(key: Storage["Key"]): Promise<void> {
    ensureLegacyImported(this.accountId, this.legacyPath);
    sqlite.query("DELETE FROM protocol_kv WHERE account_id=? AND key=?").run(this.accountId, key);
  }

  async clear(): Promise<void> {
    ensureLegacyImported(this.accountId, this.legacyPath);
    sqlite.query("DELETE FROM protocol_kv WHERE account_id=?").run(this.accountId);
  }

  async migrate(target: BaseStorage): Promise<void> {
    ensureLegacyImported(this.accountId, this.legacyPath);
    const rows = sqlite
      .query("SELECT key,value FROM protocol_kv WHERE account_id=? ORDER BY key")
      .all(this.accountId) as Array<{ key: string; value: string }>;
    for (const row of rows) await target.set(row.key, JSON.parse(row.value) as ProtocolValue);
  }
}
