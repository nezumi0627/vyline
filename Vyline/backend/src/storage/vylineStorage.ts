/** Key-addressable persistent cache storage backed by SQLite. */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { accountDir } from "./accountDirs.js";
import { migrateOnce, sqlite } from "./sqlite.js";

const log = childLogger("VylineStorage");
const _dir = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");

type Row = { key: string; payload: string };
type RecordValue = Record<string, unknown>;

export class VylineStorage<T extends object> {
  readonly namespace: string;
  private readonly memory = new Map<string, T>();
  private readonly factory: () => T;

  constructor(namespace: string, empty: () => T) {
    this.namespace = namespace;
    this.factory = empty;
  }

  private ensureSchema(): void {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS vyline_kv (
      namespace TEXT NOT NULL,
      account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, account_id, key)
    );`);
  }

  private legacyPaths(accountId: string): string[] {
    return [
      join(accountDir(accountId), `vyline-${this.namespace}.json`),
      join(DATA_DIR, `vyline-${this.namespace}-${accountId}.json`),
      join(DATA_DIR, `nezu-${this.namespace}-${accountId}.json`),
    ];
  }

  private encode(data: T): Row[] {
    const obj = data as RecordValue;
    const rows: Row[] = [];
    if (this.namespace === "cache") {
      if (obj.version !== undefined) rows.push({ key: "$version", payload: JSON.stringify(obj.version) });
      for (const bucket of ["profiles", "groups"] as const) {
        const entries = obj[bucket];
        if (entries && typeof entries === "object") {
          for (const [id, value] of Object.entries(entries as RecordValue)) {
            rows.push({ key: `${bucket}:${id}`, payload: JSON.stringify(value) });
          }
        }
      }
      return rows;
    }
    return Object.entries(obj).map(([key, value]) => ({ key, payload: JSON.stringify(value) }));
  }

  private decode(rows: Row[]): T {
    const result = this.factory() as RecordValue;
    if (this.namespace === "cache") {
      result.profiles = {};
      result.groups = {};
      for (const row of rows) {
        if (row.key === "$version") result.version = JSON.parse(row.payload);
        else if (row.key.startsWith("profiles:")) {
          (result.profiles as RecordValue)[row.key.slice(9)] = JSON.parse(row.payload);
        } else if (row.key.startsWith("groups:")) {
          (result.groups as RecordValue)[row.key.slice(7)] = JSON.parse(row.payload);
        }
      }
      return result as T;
    }
    for (const row of rows) result[row.key] = JSON.parse(row.payload);
    return result as T;
  }

  private async ensureMigrated(accountId: string): Promise<void> {
    this.ensureSchema();
    const migrationName = `vyline-storage-json-v2:${this.namespace}:${accountId}`;
    const migrated = sqlite.query("SELECT 1 FROM app_migrations WHERE name = ?").get(migrationName);
    if (migrated) return;
    const legacyPath = this.legacyPaths(accountId).find(existsSync);
    if (!legacyPath) return;
    try {
      const source = JSON.parse(await readFile(legacyPath, "utf8")) as T;
      const rows = this.encode(source);
      migrateOnce(migrationName, () => {
        const insert = sqlite.query(`INSERT OR IGNORE INTO vyline_kv (namespace, account_id, key, payload)
          VALUES (?, ?, ?, ?)`);
        for (const row of rows) insert.run(this.namespace, accountId, row.key, row.payload);
      });
    } catch (err) {
      log.error({ accountId, namespace: this.namespace, err }, "legacy cache import failed; source retained");
      throw err;
    }
  }

  private writeDiff(accountId: string, before: T, after: T): void {
    this.ensureSchema();
    const oldRows = new Map(this.encode(before).map((row) => [row.key, row.payload]));
    const newRows = new Map(this.encode(after).map((row) => [row.key, row.payload]));
    const upsert = sqlite.query(`INSERT INTO vyline_kv (namespace, account_id, key, payload)
      VALUES (?, ?, ?, ?) ON CONFLICT(namespace, account_id, key)
      DO UPDATE SET payload = excluded.payload`);
    const remove = sqlite.query("DELETE FROM vyline_kv WHERE namespace = ? AND account_id = ? AND key = ?");
    sqlite.transaction(() => {
      for (const [key, payload] of newRows) {
        if (oldRows.get(key) !== payload) upsert.run(this.namespace, accountId, key, payload);
      }
      for (const key of oldRows.keys()) {
        if (!newRows.has(key)) remove.run(this.namespace, accountId, key);
      }
    }).immediate();
  }

  peek(accountId: string): T | undefined {
    return this.memory.get(accountId);
  }

  async load(accountId: string): Promise<T> {
    const cached = this.memory.get(accountId);
    if (cached) return cached;
    await this.ensureMigrated(accountId);
    const rows = sqlite.query("SELECT key, payload FROM vyline_kv WHERE namespace = ? AND account_id = ?")
      .all(this.namespace, accountId) as Row[];
    const data = this.decode(rows);
    this.memory.set(accountId, data);
    return data;
  }

  async getCacheEntries(
    accountId: string,
    bucket: "profiles" | "groups",
    keys: string[],
  ): Promise<Map<string, unknown>> {
    if (this.namespace !== "cache") throw new Error("key reads are only supported by the cache namespace");
    const unique = [...new Set(keys.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const prefix = `${bucket}:`;
    const cached = this.memory.get(accountId) as Record<string, Record<string, unknown>> | undefined;
    if (cached) return new Map(unique.flatMap((key) => cached[bucket]?.[key] === undefined
      ? [] : [[key, cached[bucket]![key]] as [string, unknown]]));
    await this.ensureMigrated(accountId);
    const placeholders = unique.map(() => "?").join(",");
    const rows = sqlite.query(`SELECT key, payload FROM vyline_kv
      WHERE namespace = ? AND account_id = ? AND key IN (${placeholders})`)
      .all(this.namespace, accountId, ...unique.map((key) => `${prefix}${key}`)) as Row[];
    return new Map(rows.map((row) => [row.key.slice(prefix.length), JSON.parse(row.payload) as unknown]));
  }

  async putCacheEntries(
    accountId: string,
    bucket: "profiles" | "groups",
    entries: Array<{ key: string; value: unknown }>,
  ): Promise<void> {
    if (this.namespace !== "cache") throw new Error("key writes are only supported by the cache namespace");
    if (entries.length === 0) return;
    await this.ensureMigrated(accountId);
    const upsert = sqlite.query(`INSERT INTO vyline_kv (namespace, account_id, key, payload)
      VALUES (?, ?, ?, ?) ON CONFLICT(namespace, account_id, key)
      DO UPDATE SET payload = excluded.payload`);
    sqlite.transaction(() => {
      for (const entry of entries) {
        if (!entry.key) continue;
        upsert.run(this.namespace, accountId, `${bucket}:${entry.key}`, JSON.stringify(entry.value));
      }
    }).immediate();
    const cached = this.memory.get(accountId) as Record<string, Record<string, unknown>> | undefined;
    if (cached) for (const entry of entries) if (entry.key) cached[bucket]![entry.key] = entry.value;
  }

  async mutate(accountId: string, fn: (data: T) => void): Promise<T> {
    const current = await this.load(accountId);
    const next = structuredClone(current);
    fn(next);
    this.writeDiff(accountId, current, next);
    this.memory.set(accountId, next);
    return next;
  }

  async replace(accountId: string, data: T): Promise<void> {
    const current = await this.load(accountId);
    this.writeDiff(accountId, current, data);
    this.memory.set(accountId, data);
  }

  async flush(_accountId: string): Promise<void> {}

  async flushAll(): Promise<void> {}
}
