import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateOnce, sqlite } from "./sqlite.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const FILE = join(DATA_DIR, "subdevices.json");
const PAIRING_TTL_MS = 2 * 60_000;

export type Subdevice = {
  id: string;
  accountId: string;
  name: string;
  platform: "ios" | "android" | "web" | "unknown";
  createdAt: string;
  lastSeenAt: string | null;
  blocked: boolean;
  tokenHash: string;
};

type Pairing = { id: string; tokenHash: string; expiresAt: number; accountId: string };
type State = { devices: Subdevice[]; pairings: Pairing[] };

function ensureSchema(): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS subdevices (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    blocked INTEGER NOT NULL DEFAULT 0,
    token_hash TEXT NOT NULL UNIQUE
  );
  CREATE INDEX IF NOT EXISTS subdevices_account_idx ON subdevices(account_id);
  CREATE TABLE IF NOT EXISTS subdevice_pairings (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    account_id TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS subdevice_pairings_expires_idx ON subdevice_pairings(expires_at);
`);
}

let legacyImported = false;
function ensureLegacyImported(): void {
  if (legacyImported) return;
  ensureSchema();
  if (existsSync(FILE))
    migrateOnce("subdevices-json-v2", () => {
      const state = JSON.parse(readFileSync(FILE, "utf8")) as State;
      const insertDevice = sqlite.query(`
      INSERT OR IGNORE INTO subdevices
        (id, account_id, name, platform, created_at, last_seen_at, blocked, token_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
      for (const device of state.devices ?? []) {
        insertDevice.run(
          device.id,
          device.accountId,
          device.name,
          device.platform,
          device.createdAt,
          device.lastSeenAt,
          device.blocked ? 1 : 0,
          device.tokenHash,
        );
      }
      const insertPairing = sqlite.query(`
      INSERT OR IGNORE INTO subdevice_pairings (id, token_hash, expires_at, account_id)
      VALUES (?, ?, ?, ?)
    `);
      for (const pairing of state.pairings ?? []) {
        insertPairing.run(pairing.id, pairing.tokenHash, pairing.expiresAt, pairing.accountId);
      }
    });
  legacyImported = true;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

export async function createPairing(accountId: string) {
  ensureLegacyImported();
  const raw = token("vyp");
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  sqlite.transaction(() => {
    sqlite.query("DELETE FROM subdevice_pairings WHERE expires_at <= ?").run(Date.now());
    sqlite
      .query(
        "INSERT INTO subdevice_pairings (id, token_hash, expires_at, account_id) VALUES (?, ?, ?, ?)",
      )
      .run(randomBytes(12).toString("hex"), hash(raw), expiresAt, accountId);
  })();
  return { token: raw, expiresAt };
}

export async function getPairing(raw: string) {
  ensureLegacyImported();
  const pairing = sqlite
    .query("SELECT expires_at FROM subdevice_pairings WHERE token_hash = ? AND expires_at > ?")
    .get(hash(raw), Date.now()) as { expires_at: number } | null;
  return pairing ? { expiresAt: pairing.expires_at } : null;
}

export async function completePairing(raw: string, name: string, platform: Subdevice["platform"]) {
  ensureLegacyImported();
  const sessionToken = token("vys");
  const now = new Date().toISOString();
  const device: Subdevice = {
    id: randomBytes(12).toString("hex"),
    accountId: "",
    name: name.trim().slice(0, 80) || "サブデバイス",
    platform,
    createdAt: now,
    lastSeenAt: now,
    blocked: false,
    tokenHash: hash(sessionToken),
  };
  const result = sqlite.transaction(() => {
    const pairing = sqlite
      .query("SELECT account_id FROM subdevice_pairings WHERE token_hash = ? AND expires_at > ?")
      .get(hash(raw), Date.now()) as { account_id: string } | null;
    if (!pairing) return false;
    device.accountId = pairing.account_id;
    sqlite.query("DELETE FROM subdevice_pairings WHERE token_hash = ?").run(hash(raw));
    sqlite
      .query(`
        INSERT INTO subdevices
          (id, account_id, name, platform, created_at, last_seen_at, blocked, token_hash)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `)
      .run(
        device.id,
        device.accountId,
        device.name,
        device.platform,
        device.createdAt,
        device.lastSeenAt,
        device.tokenHash,
      );
    return true;
  })();
  if (!result) return null;
  const { tokenHash: _tokenHash, ...safeDevice } = device;
  return { device: safeDevice, sessionToken };
}

export async function listSubdevices() {
  ensureLegacyImported();
  return sqlite
    .query(`
      SELECT id, account_id AS accountId, name, platform, created_at AS createdAt,
        last_seen_at AS lastSeenAt, blocked
      FROM subdevices ORDER BY rowid
    `)
    .all()
    .map((row) => {
      const device = row as Omit<Subdevice, "tokenHash" | "blocked"> & { blocked: number };
      return { ...device, blocked: device.blocked === 1 };
    });
}

export async function authenticateSubdevice(raw: string) {
  ensureLegacyImported();
  const row = sqlite
    .query(`
      UPDATE subdevices SET last_seen_at = ?
      WHERE token_hash = ? AND blocked = 0
      RETURNING id, account_id AS accountId, name, platform, created_at AS createdAt,
        last_seen_at AS lastSeenAt, blocked
    `)
    .get(new Date().toISOString(), hash(raw)) as
    | (Omit<Subdevice, "tokenHash" | "blocked"> & { blocked: number })
    | null;
  return row ? { ...row, blocked: row.blocked === 1 } : null;
}

export async function getSubdeviceSession(raw: string) {
  ensureLegacyImported();
  const row = sqlite
    .query(`
      SELECT id, account_id AS accountId, name, platform, created_at AS createdAt,
        last_seen_at AS lastSeenAt, blocked
      FROM subdevices WHERE token_hash = ? AND blocked = 0
    `)
    .get(hash(raw)) as (Omit<Subdevice, "tokenHash" | "blocked"> & { blocked: number }) | null;
  return row ? { ...row, blocked: row.blocked === 1 } : null;
}

export async function isSubdeviceSessionValid(raw: string) {
  ensureLegacyImported();
  return Boolean(
    sqlite.query("SELECT 1 FROM subdevices WHERE token_hash = ? AND blocked = 0").get(hash(raw)),
  );
}

export async function removeSubdevice(id: string) {
  ensureLegacyImported();
  return sqlite.query("DELETE FROM subdevices WHERE id = ?").run(id).changes > 0;
}

export async function setSubdeviceBlocked(id: string, blocked: boolean) {
  ensureLegacyImported();
  return (
    sqlite.query("UPDATE subdevices SET blocked = ? WHERE id = ?").run(blocked ? 1 : 0, id)
      .changes > 0
  );
}
