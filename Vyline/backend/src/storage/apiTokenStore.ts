/**
 * Vyline API トークン管理
 * data/api-tokens.json に永続化（gitignore 対象）
 */
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const TOKEN_FILE = join(DATA_DIR, "api-tokens.json");
const VALID_SCOPES = new Set(["read", "write"]);

type StoredApiToken = { tokenHash?: string; token?: string; name: string; scopes: string[]; createdAt: string; lastUsedAt?: string };
export interface ApiToken { token?: string; tokenHash?: string; name: string; scopes: string[]; createdAt: string; lastUsedAt?: string }
let cache: StoredApiToken[] | null = null;
function normalizeScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return ["read", "write"];
  const normalized = [...new Set(scopes.filter((scope): scope is string => typeof scope === "string" && VALID_SCOPES.has(scope)))];
  return normalized.length > 0 ? normalized : ["read"];
}
function hashToken(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }
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
      const record = { ...entry, scopes: normalizeScopes(entry.scopes) };
      if (!record.tokenHash && record.token) { record.tokenHash = hashToken(record.token); delete record.token; migrated = true; }
      if (record.scopes.join(",") !== (entry.scopes ?? []).join(",")) migrated = true;
      return record;
    });
    if (migrated) await save(cache);
  } catch { cache = []; }
  return cache;
}
async function save(tokens: StoredApiToken[]): Promise<void> { mkdirSync(DATA_DIR, { recursive: true }); await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf8"); cache = tokens; }
export async function listTokens(): Promise<ApiToken[]> { return load(); }
export async function createToken(name: string, scopes: string[] = ["read", "write"]): Promise<ApiToken> {
  const tokens = await load(); const token = `vyl_${randomBytes(32).toString("base64url")}`;
  const record: StoredApiToken = { tokenHash: hashToken(token), name, scopes: normalizeScopes(scopes), createdAt: new Date().toISOString() };
  tokens.push(record); await save(tokens); return { token, name: record.name, scopes: record.scopes, createdAt: record.createdAt };
}
export async function validateToken(token: string): Promise<ApiToken | null> {
  const tokens = await load(); const found = tokens.find((entry) => entry.tokenHash && tokenHashMatches(token, entry.tokenHash));
  if (!found) return null; found.lastUsedAt = new Date().toISOString(); void save(tokens).catch(() => undefined); return found;
}
export async function revokeToken(token: string): Promise<boolean> {
  const tokens = await load(); const idx = tokens.findIndex((entry) => entry.tokenHash && tokenHashMatches(token, entry.tokenHash));
  if (idx === -1) return false; tokens.splice(idx, 1); await save(tokens); return true;
}
