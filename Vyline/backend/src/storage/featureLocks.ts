/** Account-scoped permanent locks for operations that may trigger an abuse block. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { migrateOnce, sqlite } from "./sqlite.js";

const log = childLogger("featureLocks");
const dir = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(dir, "..", "..", "data");
const LOCKS_FILE = join(DATA_DIR, "feature-locks.json");

export type AccountFeatureLocks = {
  createGroupBanned?: boolean;
  createGroupBannedAt?: string;
  createGroupBannedReason?: string;
};

function ensureSchema(): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS account_feature_locks (
    account_id TEXT PRIMARY KEY,
    create_group_banned INTEGER NOT NULL DEFAULT 0,
    create_group_banned_at TEXT,
    create_group_banned_reason TEXT
  );
`);
}

let legacyImported = false;
function ensureLegacyImported(): void {
  if (legacyImported) return;
  ensureSchema();
  if (existsSync(LOCKS_FILE)) migrateOnce("feature-locks-json-v2", () => {
      const data = JSON.parse(readFileSync(LOCKS_FILE, "utf8")) as Record<
        string,
        AccountFeatureLocks
      >;
      const insert = sqlite.query(`
        INSERT OR IGNORE INTO account_feature_locks
          (account_id, create_group_banned, create_group_banned_at, create_group_banned_reason)
        VALUES (?, ?, ?, ?)
      `);
      for (const [accountId, locks] of Object.entries(data)) {
        insert.run(
          accountId,
          locks.createGroupBanned === true ? 1 : 0,
          locks.createGroupBannedAt ?? null,
          locks.createGroupBannedReason ?? null,
        );
      }
  });
  legacyImported = true;
}

function read(accountId: string): AccountFeatureLocks {
  const row = sqlite
    .query(
      `SELECT create_group_banned, create_group_banned_at, create_group_banned_reason
       FROM account_feature_locks WHERE account_id = ?`,
    )
    .get(accountId) as
    | {
        create_group_banned: number;
        create_group_banned_at: string | null;
        create_group_banned_reason: string | null;
      }
    | null;
  if (!row) return {};
  return {
    createGroupBanned: row.create_group_banned === 1,
    ...(row.create_group_banned_at ? { createGroupBannedAt: row.create_group_banned_at } : {}),
    ...(row.create_group_banned_reason
      ? { createGroupBannedReason: row.create_group_banned_reason }
      : {}),
  };
}

export async function getFeatureLocks(accountId: string): Promise<AccountFeatureLocks> {
  ensureLegacyImported();
  return read(accountId);
}

export async function isCreateGroupBanned(accountId: string): Promise<boolean> {
  const locks = await getFeatureLocks(accountId);
  return locks.createGroupBanned === true;
}

export async function banCreateGroup(
  accountId: string,
  reason: string,
): Promise<AccountFeatureLocks> {
  ensureLegacyImported();
  const prev = read(accountId);
  if (prev.createGroupBanned) return prev;
  const at = new Date().toISOString();
  const boundedReason = reason.slice(0, 500);
  sqlite
    .query(`
      INSERT INTO account_feature_locks
        (account_id, create_group_banned, create_group_banned_at, create_group_banned_reason)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        create_group_banned = 1,
        create_group_banned_at = excluded.create_group_banned_at,
        create_group_banned_reason = excluded.create_group_banned_reason
      WHERE account_feature_locks.create_group_banned = 0
    `)
    .run(accountId, at, boundedReason);
  const next = read(accountId);
  log.warn({ accountId, reason: next.createGroupBannedReason }, "createGroup permanently banned");
  return next;
}

export async function unbanCreateGroup(accountId: string): Promise<AccountFeatureLocks> {
  ensureLegacyImported();
  const prev = read(accountId);
  if (!prev.createGroupBanned) return prev;
  sqlite
    .query(`
      UPDATE account_feature_locks
      SET create_group_banned = 0, create_group_banned_at = NULL, create_group_banned_reason = NULL
      WHERE account_id = ?
    `)
    .run(accountId);
  const next: AccountFeatureLocks = { createGroupBanned: false };
  log.info({ accountId }, "createGroup ban cleared (user override)");
  return next;
}
