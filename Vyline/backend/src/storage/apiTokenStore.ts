/**
 * Vyline API トークン管理
 * data/api-tokens.json に永続化（gitignore 対象）
 */
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const TOKEN_FILE = join(DATA_DIR, "api-tokens.json");

export interface ApiToken {
  token: string; // "vyl_xxxx..."
  name: string; // 識別名
  scopes: string[]; // ["read", "write"] など
  createdAt: string; // ISO8601
  lastUsedAt?: string;
}

let cache: ApiToken[] | null = null;

async function load(): Promise<ApiToken[]> {
  if (cache) return cache;
  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    cache = JSON.parse(raw) as ApiToken[];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(tokens: ApiToken[]): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf8");
  cache = tokens;
}

export async function listTokens(): Promise<ApiToken[]> {
  return load();
}

export async function createToken(
  name: string,
  scopes: string[] = ["read", "write"],
): Promise<ApiToken> {
  const tokens = await load();
  const token: ApiToken = {
    token: `vyl_${randomBytes(16).toString("hex")}`,
    name,
    scopes,
    createdAt: new Date().toISOString(),
  };
  tokens.push(token);
  await save(tokens);
  return token;
}

export async function validateToken(token: string): Promise<ApiToken | null> {
  const tokens = await load();
  const found = tokens.find((t) => t.token === token);
  if (!found) return null;
  // lastUsedAt 更新（fire-and-forget）
  found.lastUsedAt = new Date().toISOString();
  void save(tokens).catch(() => undefined);
  return found;
}

export async function revokeToken(token: string): Promise<boolean> {
  const tokens = await load();
  const idx = tokens.findIndex((t) => t.token === token);
  if (idx === -1) return false;
  tokens.splice(idx, 1);
  await save(tokens);
  return true;
}
