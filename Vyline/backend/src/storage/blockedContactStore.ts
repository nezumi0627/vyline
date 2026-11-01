import { sqlite } from "./sqlite.js";

type BlockDiff = { added: number; removed: number };

function ensureSchema() {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS blocked_contacts (
    account_id TEXT NOT NULL,
    mid TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, mid)
  ); CREATE INDEX IF NOT EXISTS idx_blocked_contacts_account ON blocked_contacts(account_id, mid);`);
}

export async function listBlockedContactMids(accountId: string): Promise<string[]> {
  ensureSchema();
  const rows = sqlite
    .query("SELECT mid FROM blocked_contacts WHERE account_id = ? ORDER BY mid")
    .all(accountId) as { mid: string }[];
  return rows.map((row) => row.mid);
}

/** Replace the observed set in one transaction; unchanged rows are never rewritten. */
export async function syncBlockedContactMids(
  accountId: string,
  mids: string[],
): Promise<BlockDiff> {
  ensureSchema();
  const desired = new Set(mids.filter((mid) => /^u[0-9a-f]{32}$/i.test(mid)));
  const currentRows = sqlite
    .query("SELECT mid FROM blocked_contacts WHERE account_id = ?")
    .all(accountId) as { mid: string }[];
  const current = new Set(currentRows.map((row) => row.mid));
  const added = [...desired].filter((mid) => !current.has(mid));
  const removed = [...current].filter((mid) => !desired.has(mid));
  if (!added.length && !removed.length) return { added: 0, removed: 0 };
  const insert = sqlite.query("INSERT INTO blocked_contacts (account_id, mid) VALUES (?, ?)");
  const remove = sqlite.query("DELETE FROM blocked_contacts WHERE account_id = ? AND mid = ?");
  sqlite
    .transaction(() => {
      for (const mid of added) insert.run(accountId, mid);
      for (const mid of removed) remove.run(accountId, mid);
    })
    .immediate();
  return { added: added.length, removed: removed.length };
}

export async function setBlockedContactMid(
  accountId: string,
  mid: string,
  blocked: boolean,
): Promise<void> {
  if (!/^u[0-9a-f]{32}$/i.test(mid)) return;
  ensureSchema();
  if (blocked) {
    sqlite
      .query("INSERT OR IGNORE INTO blocked_contacts (account_id, mid) VALUES (?, ?)")
      .run(accountId, mid);
  } else {
    sqlite
      .query("DELETE FROM blocked_contacts WHERE account_id = ? AND mid = ?")
      .run(accountId, mid);
  }
}
