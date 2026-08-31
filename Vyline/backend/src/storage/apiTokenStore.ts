/**
 * Vyline API トークン管理
 * data/api-tokens.json に永続化（gitignore 対象）
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const TOKEN_FILE = join(DATA_DIR, "api-tokens.json");
const VALID_SCOPES = new Set(["read", "write"]);
const LAST_USED_PERSIST_INTERVAL_MS = 60_000;

type StoredApiToken = {
  tokenHash?: string;
  token?: string;
  name: string;
  scopes: string[];
  accountIds: string[];
  createdAt: string;
  lastUsedAt?: string;
};

export interface ApiToken {
  token?: string;
  tokenHash?: string;
  name: string;
  scopes: string[];
  accountIds: string[];
  createdAt: string;
  lastUsedAt?: string;
}

let cache: StoredApiToken[] | null = null;
let saveQueue = Promise.resolve();

function normalizeScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return ["read", "write"];

  const normalized = [
    ...new Set(
      scopes.filter(
        (scope): scope is string => typeof scope === "string" && VALID_SCOPES.has(scope),
      ),
    ),
  ];

  return normalized.length > 0 ? normalized : ["read"];
}

function normalizeAccountIds(accountIds: unknown): string[] {
  if (!Array.isArray(accountIds)) return [];
  return [
    ...new Set(
      accountIds
        .filter((accountId): accountId is string => typeof accountId === "string")
        .map((accountId) => accountId.trim())
        .filter(Boolean),
    ),
  ].slice(0, 32);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenHashMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function load(): Promise<StoredApiToken[]> {
  if (cache) return cache;

  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredApiToken[];
    let migrated = false;

    cache = parsed.map((entry) => {
      const scopes = normalizeScopes(entry.scopes);
      const accountIds = normalizeAccountIds(entry.accountIds);
      const tokenHash = entry.tokenHash ?? (entry.token ? hashToken(entry.token) : undefined);
      const record: StoredApiToken = {
        name: entry.name,
        scopes,
        accountIds,
        createdAt: entry.createdAt,
        ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}),
        ...(tokenHash ? { tokenHash } : {}),
      };

      if (entry.token || tokenHash !== entry.tokenHash) migrated = true;
      if (scopes.join(",") !== (entry.scopes ?? []).join(",")) migrated = true;
      if (accountIds.join(",") !== (entry.accountIds ?? []).join(",")) migrated = true;

      return record;
    });

    if (migrated) await save(cache);
  } catch {
    cache = [];
  }

  return cache;
}

async function save(tokens: StoredApiToken[]): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(tokens, null, 2);
  const tempFile = `${TOKEN_FILE}.${randomBytes(8).toString("hex")}.tmp`;
  const queuedSave = saveQueue.then(async () => {
    try {
      await writeFile(tempFile, payload, "utf8");
      await rename(tempFile, TOKEN_FILE);
    } finally {
      await rm(tempFile, { force: true }).catch(() => undefined);
    }
  });

  saveQueue = queuedSave.catch(() => undefined);
  await queuedSave;
  cache = tokens;
}

export async function listTokens(): Promise<ApiToken[]> {
  return load();
}

export async function createToken(
  name: string,
  accountIds: string[],
  scopes: string[] = ["read", "write"],
): Promise<ApiToken> {
  const tokens = await load();
  const token = `vyl_${randomBytes(32).toString("base64url")}`;
  const normalizedAccountIds = normalizeAccountIds(accountIds);
  if (normalizedAccountIds.length === 0) {
    throw new Error("at least one accountId is required");
  }
  const record: StoredApiToken = {
    tokenHash: hashToken(token),
    name,
    scopes: normalizeScopes(scopes),
    accountIds: normalizedAccountIds,
    createdAt: new Date().toISOString(),
  };

  tokens.push(record);
  await save(tokens);

  return {
    token,
    name: record.name,
    scopes: record.scopes,
    accountIds: record.accountIds,
    createdAt: record.createdAt,
  };
}

export function tokenAllowsAccount(
  token: Pick<ApiToken, "accountIds">,
  accountId: string,
): boolean {
  return token.accountIds.includes(accountId);
}

export async function validateToken(token: string): Promise<ApiToken | null> {
  const tokens = await load();
  const found = tokens.find((entry) => entry.tokenHash && tokenHashMatches(token, entry.tokenHash));

  if (!found) return null;

  const now = Date.now();
  const previousLastUsed = found.lastUsedAt ? Date.parse(found.lastUsedAt) : Number.NaN;
  if (
    !Number.isFinite(previousLastUsed) ||
    now - previousLastUsed >= LAST_USED_PERSIST_INTERVAL_MS
  ) {
    found.lastUsedAt = new Date(now).toISOString();
    // Usage timestamps are best-effort and rate-limited so authenticated request
    // floods cannot build an unbounded disk-write queue on small devices.
    void save(tokens).catch(() => undefined);
  }
  return found;
}

export async function revokeToken(token: string): Promise<boolean> {
  const tokens = await load();
  const idx = tokens.findIndex(
    (entry) => entry.tokenHash && tokenHashMatches(token, entry.tokenHash),
  );

  if (idx === -1) return false;

  tokens.splice(idx, 1);
  await save(tokens);
  return true;
}
