/** Vyline API token storage. Token values are only returned to the caller that creates them. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { migrateOnce, sqlite } from "./sqlite.js";
import { hashApiToken, parseApiScopes } from "../security/policies.js";

const dir = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(dir, "..", "..", "data");
const TOKEN_FILE = join(DATA_DIR, "api-tokens.json");

export interface ApiToken {
  token: string;
  name: string;
  accountId: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
}

export type ApiTokenMetadata = Omit<ApiToken, "token">;

function ensureSchema(): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_id TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS api_token_scopes (
    token TEXT NOT NULL REFERENCES api_tokens(token) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    scope TEXT NOT NULL,
    PRIMARY KEY (token, position)
  );
`);
  const columns = sqlite.query("PRAGMA table_info(api_tokens)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "account_id")) {
    sqlite.exec("ALTER TABLE api_tokens ADD COLUMN account_id TEXT");
  }
}

let legacyImported = false;
function ensureLegacyImported(): void {
  if (legacyImported) return;
  ensureSchema();
  if (existsSync(TOKEN_FILE))
    migrateOnce("api-tokens-json-v2", () => {
      const tokens = JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as ApiToken[];
      const insertToken = sqlite.query(`
      INSERT OR IGNORE INTO api_tokens (token, name, created_at, last_used_at, account_id)
      VALUES (?, ?, ?, ?, ?)
    `);
      const insertScope = sqlite.query(`
      INSERT OR IGNORE INTO api_token_scopes (token, position, scope) VALUES (?, ?, ?)
    `);
      for (const item of tokens) {
        const scopes = parseApiScopes(item.scopes) ?? [];
        insertToken.run(item.token, item.name, item.createdAt, item.lastUsedAt ?? null, item.accountId ?? null);
        scopes.forEach((scope, position) => insertScope.run(item.token, position, scope));
      }
    });
  migrateOnce("api-token-sha256-v1", () => {
    sqlite.exec("PRAGMA defer_foreign_keys = ON");
    const rows = sqlite
      .query("SELECT token FROM api_tokens WHERE token NOT LIKE 'sha256:%'")
      .all() as Array<{ token: string }>;
    for (const { token } of rows) {
      const digest = hashApiToken(token);
      sqlite.query("UPDATE api_tokens SET token = ? WHERE token = ?").run(digest, token);
      sqlite.query("UPDATE api_token_scopes SET token = ? WHERE token = ?").run(digest, token);
    }
  });
  legacyImported = true;
}

function listFromDatabase(): ApiTokenMetadata[] {
  const tokens = sqlite
    .query(
      "SELECT token, name, account_id AS accountId, created_at AS createdAt, last_used_at AS lastUsedAt FROM api_tokens ORDER BY id",
    )
    .all() as Array<{
      token: string;
      name: string;
      accountId: string | null;
      createdAt: string;
      lastUsedAt: string | null;
    }>;
  const scopes = sqlite
    .query("SELECT token, scope FROM api_token_scopes ORDER BY token, position")
    .all() as Array<{ token: string; scope: string }>;
  const scopesByToken = new Map<string, string[]>();
  for (const row of scopes) {
    const values = scopesByToken.get(row.token) ?? [];
    values.push(row.scope);
    scopesByToken.set(row.token, values);
  }
  return tokens.map(({ token, ...item }) => {
    const { lastUsedAt, ...metadata } = item;
    return {
      ...metadata,
      scopes: scopesByToken.get(token) ?? [],
      ...(lastUsedAt ? { lastUsedAt } : {}),
    };
  });
}

export async function listTokens(): Promise<ApiTokenMetadata[]> {
  ensureLegacyImported();
  return listFromDatabase();
}

export async function createToken(
  name: string,
  accountId: string,
  scopes: string[] = ["read", "write"],
): Promise<ApiToken> {
  ensureLegacyImported();
  const item: ApiToken = {
    token: `vyl_${randomBytes(16).toString("hex")}`,
    name,
    accountId,
    scopes,
    createdAt: new Date().toISOString(),
  };
  const digest = hashApiToken(item.token);
  sqlite.transaction(() => {
    sqlite
      .query("INSERT INTO api_tokens (token, name, account_id, created_at) VALUES (?, ?, ?, ?)")
      .run(digest, item.name, item.accountId, item.createdAt);
    const insertScope = sqlite.query(
      "INSERT INTO api_token_scopes (token, position, scope) VALUES (?, ?, ?)",
    );
    scopes.forEach((scope, position) => insertScope.run(digest, position, scope));
  })();
  return item;
}

export async function validateToken(token: string): Promise<ApiTokenMetadata | null> {
  ensureLegacyImported();
  const digest = hashApiToken(token);
  const item = sqlite
    .query("SELECT name, account_id AS accountId, created_at AS createdAt FROM api_tokens WHERE token = ?")
    .get(digest) as Omit<ApiTokenMetadata, "scopes" | "lastUsedAt"> | null;
  if (!item) return null;
  const scopes = sqlite
    .query("SELECT scope FROM api_token_scopes WHERE token = ? ORDER BY position")
    .all(digest) as Array<{ scope: string }>;
  const lastUsedAt = new Date().toISOString();
  sqlite.query("UPDATE api_tokens SET last_used_at = ? WHERE token = ?").run(lastUsedAt, digest);
  return { ...item, scopes: scopes.map((row) => row.scope), lastUsedAt };
}

export async function revokeToken(token: string): Promise<boolean> {
  ensureLegacyImported();
  return (
    sqlite.query("DELETE FROM api_tokens WHERE token = ?").run(hashApiToken(token)).changes > 0
  );
}
