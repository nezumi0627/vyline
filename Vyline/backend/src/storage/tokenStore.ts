/** Auth token and session metadata storage. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { migrateOnce, sqlite } from "./sqlite.js";

const log = childLogger("tokenStore");
const dir = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(dir, "..", "..", "data");
const TOKENS_FILE = join(DATA_DIR, "tokens.json");

export interface TokenEntry {
  authToken: string;
  /** Protocol KV path retained until its SQLite adapter is switched over. */
  storageFile: string;
  savedAt: string;
  mid?: string;
  displayName?: string;
  picturePath?: string;
  statusMessage?: string;
  premium?: {
    active: boolean;
    planType?: string | number;
    validUntil?: number;
    onFreeTrial?: boolean;
    willExpire?: boolean;
  };
}

export type TokenMap = Record<string, TokenEntry>;
export type SessionMeta = Pick<
  TokenEntry,
  "mid" | "displayName" | "picturePath" | "statusMessage" | "premium"
>;

type TokenRow = {
  account_id: string;
  auth_token: string;
  storage_file: string;
  saved_at: string;
  mid: string | null;
  display_name: string | null;
  picture_path: string | null;
  status_message: string | null;
  premium_active: number | null;
  premium_plan_type: string | null;
  premium_plan_is_number: number | null;
  premium_valid_until: number | null;
  premium_on_free_trial: number | null;
  premium_will_expire: number | null;
};

function ensureSchema(): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS account_tokens (
    account_id TEXT PRIMARY KEY,
    auth_token TEXT NOT NULL,
    storage_file TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    mid TEXT,
    display_name TEXT,
    picture_path TEXT,
    status_message TEXT,
    premium_active INTEGER,
    premium_plan_type TEXT,
    premium_plan_is_number INTEGER,
    premium_valid_until INTEGER,
    premium_on_free_trial INTEGER,
    premium_will_expire INTEGER
  );
`);
}

let legacyImported = false;
function ensureLegacyImported(): void {
  if (legacyImported) return;
  ensureSchema();
  if (existsSync(TOKENS_FILE))
    migrateOnce("tokens-json-v2", () => {
      const entries = JSON.parse(readFileSync(TOKENS_FILE, "utf8")) as TokenMap;
      const insert = sqlite.query(`
      INSERT OR IGNORE INTO account_tokens (
        account_id, auth_token, storage_file, saved_at, mid, display_name, picture_path,
        status_message, premium_active, premium_plan_type, premium_plan_is_number,
        premium_valid_until, premium_on_free_trial, premium_will_expire
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
      for (const [accountId, entry] of Object.entries(entries)) {
        if (typeof entry?.authToken !== "string" || !entry.authToken) continue;
        const premium = entry.premium;
        insert.run(
          accountId,
          entry.authToken,
          entry.storageFile ?? join(DATA_DIR, `storage-${accountId}.json`),
          entry.savedAt ?? new Date().toISOString(),
          entry.mid ?? null,
          entry.displayName ?? null,
          entry.picturePath ?? null,
          entry.statusMessage ?? null,
          premium ? (premium.active ? 1 : 0) : null,
          premium?.planType == null ? null : String(premium.planType),
          typeof premium?.planType === "number" ? 1 : 0,
          premium?.validUntil ?? null,
          premium?.onFreeTrial == null ? null : premium.onFreeTrial ? 1 : 0,
          premium?.willExpire == null ? null : premium.willExpire ? 1 : 0,
        );
      }
    });
  legacyImported = true;
}

function fromRow(row: TokenRow): TokenEntry {
  const entry: TokenEntry = {
    authToken: row.auth_token,
    storageFile: row.storage_file,
    savedAt: row.saved_at,
  };
  if (row.mid != null) entry.mid = row.mid;
  if (row.display_name != null) entry.displayName = row.display_name;
  if (row.picture_path != null) entry.picturePath = row.picture_path;
  if (row.status_message != null) entry.statusMessage = row.status_message;
  if (row.premium_active != null) {
    entry.premium = {
      active: row.premium_active === 1,
      ...(row.premium_plan_type != null
        ? {
            planType: row.premium_plan_is_number
              ? Number(row.premium_plan_type)
              : row.premium_plan_type,
          }
        : {}),
      ...(row.premium_valid_until != null ? { validUntil: row.premium_valid_until } : {}),
      ...(row.premium_on_free_trial != null
        ? { onFreeTrial: row.premium_on_free_trial === 1 }
        : {}),
      ...(row.premium_will_expire != null ? { willExpire: row.premium_will_expire === 1 } : {}),
    };
  }
  return entry;
}

function rowFor(accountId: string, entry: TokenEntry) {
  const premium = entry.premium;
  return [
    accountId,
    entry.authToken,
    entry.storageFile,
    entry.savedAt,
    entry.mid ?? null,
    entry.displayName ?? null,
    entry.picturePath ?? null,
    entry.statusMessage ?? null,
    premium ? (premium.active ? 1 : 0) : null,
    premium?.planType == null ? null : String(premium.planType),
    typeof premium?.planType === "number" ? 1 : 0,
    premium?.validUntil ?? null,
    premium?.onFreeTrial == null ? null : premium.onFreeTrial ? 1 : 0,
    premium?.willExpire == null ? null : premium.willExpire ? 1 : 0,
  ] as const;
}

function upsertToken(accountId: string, entry: TokenEntry): void {
  sqlite
    .query(`
  INSERT INTO account_tokens (
    account_id, auth_token, storage_file, saved_at, mid, display_name, picture_path,
    status_message, premium_active, premium_plan_type, premium_plan_is_number,
    premium_valid_until, premium_on_free_trial, premium_will_expire
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id) DO UPDATE SET
    auth_token = excluded.auth_token, storage_file = excluded.storage_file,
    saved_at = excluded.saved_at, mid = excluded.mid, display_name = excluded.display_name,
    picture_path = excluded.picture_path, status_message = excluded.status_message,
    premium_active = excluded.premium_active, premium_plan_type = excluded.premium_plan_type,
    premium_plan_is_number = excluded.premium_plan_is_number,
    premium_valid_until = excluded.premium_valid_until,
    premium_on_free_trial = excluded.premium_on_free_trial,
    premium_will_expire = excluded.premium_will_expire
`)
    .run(...rowFor(accountId, entry));
}

export async function loadTokens(): Promise<TokenMap> {
  ensureLegacyImported();
  const rows = sqlite.query("SELECT * FROM account_tokens").all() as TokenRow[];
  return Object.fromEntries(rows.map((row) => [row.account_id, fromRow(row)]));
}

function normalizeAuthToken(authToken: unknown): string | null {
  if (typeof authToken === "string" && authToken.trim()) return authToken.trim();
  if (authToken && typeof authToken === "object") {
    const obj = authToken as Record<string, unknown>;
    const access =
      (typeof obj.accessToken === "string" && obj.accessToken) ||
      (typeof obj.authToken === "string" && obj.authToken) ||
      (typeof obj.token === "string" && obj.token);
    if (access) return access;
  }
  return null;
}

export async function saveToken(
  accountId: string,
  authToken: unknown,
  meta?: SessionMeta,
): Promise<void> {
  ensureLegacyImported();
  const token = normalizeAuthToken(authToken);
  if (!token) {
    log.warn({ accountId }, "skip token save — empty authToken");
    return;
  }
  const existingRow = sqlite
    .query("SELECT * FROM account_tokens WHERE account_id = ?")
    .get(accountId) as TokenRow | null;
  const existing = existingRow ? fromRow(existingRow) : undefined;
  const entry: TokenEntry = {
    authToken: token,
    storageFile: existing?.storageFile ?? join(DATA_DIR, `storage-${accountId}.json`),
    savedAt: new Date().toISOString(),
  };
  const mid = meta?.mid ?? existing?.mid;
  const displayName = meta?.displayName ?? existing?.displayName;
  const picturePath = meta?.picturePath ?? existing?.picturePath;
  const statusMessage = meta?.statusMessage ?? existing?.statusMessage;
  const premium = meta?.premium ?? existing?.premium;
  if (mid) entry.mid = mid;
  if (displayName) entry.displayName = displayName;
  if (picturePath) entry.picturePath = picturePath;
  if (statusMessage) entry.statusMessage = statusMessage;
  if (premium) entry.premium = premium;
  upsertToken(accountId, entry);
  log.info({ accountId, displayName: entry.displayName, mid: entry.mid }, "token saved");
}

export async function updateSessionMeta(accountId: string, meta: SessionMeta): Promise<void> {
  ensureLegacyImported();
  const row = sqlite
    .query("SELECT * FROM account_tokens WHERE account_id = ?")
    .get(accountId) as TokenRow | null;
  if (!row) return;
  const existing = fromRow(row);
  if (meta.mid != null) existing.mid = meta.mid;
  if (meta.displayName != null) existing.displayName = meta.displayName;
  if (meta.picturePath != null) existing.picturePath = meta.picturePath;
  if (meta.statusMessage != null) existing.statusMessage = meta.statusMessage;
  if (meta.premium != null) existing.premium = meta.premium;
  existing.savedAt = new Date().toISOString();
  upsertToken(accountId, existing);
}

export async function deleteToken(accountId: string): Promise<void> {
  ensureLegacyImported();
  sqlite.query("DELETE FROM account_tokens WHERE account_id = ?").run(accountId);
  log.info({ accountId }, "token deleted");
}

export async function getToken(accountId: string): Promise<TokenEntry | undefined> {
  ensureLegacyImported();
  const row = sqlite
    .query("SELECT * FROM account_tokens WHERE account_id = ?")
    .get(accountId) as TokenRow | null;
  return row ? fromRow(row) : undefined;
}

export async function listSavedSessions(): Promise<
  Array<{
    accountId: string;
    savedAt: string;
    mid?: string;
    displayName?: string;
    picturePath?: string;
    statusMessage?: string;
    premium?: TokenEntry["premium"];
    hasToken: boolean;
  }>
> {
  const tokens = await loadTokens();
  return Object.entries(tokens)
    .map(([accountId, entry]) => ({
      accountId,
      savedAt: entry.savedAt,
      ...(entry.mid ? { mid: entry.mid } : {}),
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      ...(entry.picturePath ? { picturePath: entry.picturePath } : {}),
      ...(entry.statusMessage ? { statusMessage: entry.statusMessage } : {}),
      ...(entry.premium ? { premium: entry.premium } : {}),
      hasToken: Boolean(entry.authToken),
    }))
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}
