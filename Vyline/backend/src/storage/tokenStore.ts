/**
 * tokenStore.ts
 *
 * authToken とセッションメタのローカル保存。
 * 保存先: <backend>/data/tokens.json
 *
 * 構造:
 * {
 *   "accountId": {
 *     "authToken": "...",
 *     "storageFile": "<backend>/data/storage-accountId.json",
 *     "savedAt": "ISO8601",
 *     "mid": "u...",
 *     "displayName": "...",
 *     "picturePath": "...",
 *     "statusMessage": "..."
 *   }
 * }
 */

import { join, dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("tokenStore");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const TOKENS_FILE = join(DATA_DIR, "tokens.json");

export interface TokenEntry {
  authToken: string;
  /** VylineFileStorage のパス */
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

export type SessionMeta = {
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
};

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
    log.debug({ dir: DATA_DIR }, "created data dir");
  }
}

export async function loadTokens(): Promise<TokenMap> {
  await ensureDataDir();
  if (!existsSync(TOKENS_FILE)) return {};
  try {
    const raw = await readFile(TOKENS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TokenMap;
    // 空トークンのゴミを除外
    const cleaned: TokenMap = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry?.authToken && typeof entry.authToken === "string") {
        cleaned[id] = entry;
      }
    }
    return cleaned;
  } catch (err) {
    log.warn({ err }, "failed to parse tokens.json, returning empty");
    return {};
  }
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
  const token = normalizeAuthToken(authToken);
  if (!token) {
    log.warn({ accountId }, "skip token save — empty authToken");
    return;
  }

  await ensureDataDir();
  const tokens = await loadTokens();
  const existing = tokens[accountId];
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
  tokens[accountId] = entry;

  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
  log.info({ accountId, displayName: entry.displayName, mid: entry.mid }, "token saved");
}

export async function updateSessionMeta(accountId: string, meta: SessionMeta): Promise<void> {
  const tokens = await loadTokens();
  const existing = tokens[accountId];
  if (!existing) return;
  if (meta.mid != null) existing.mid = meta.mid;
  if (meta.displayName != null) existing.displayName = meta.displayName;
  if (meta.picturePath != null) existing.picturePath = meta.picturePath;
  if (meta.statusMessage != null) existing.statusMessage = meta.statusMessage;
  if (meta.premium != null) existing.premium = meta.premium;
  existing.savedAt = new Date().toISOString();
  tokens[accountId] = existing;
  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

export async function deleteToken(accountId: string): Promise<void> {
  const tokens = await loadTokens();
  delete tokens[accountId];
  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
  log.info({ accountId }, "token deleted");
}

export async function getToken(accountId: string): Promise<TokenEntry | undefined> {
  const tokens = await loadTokens();
  return tokens[accountId];
}

/** ログイン画面用のセッション一覧 */
export async function listSavedSessions(): Promise<
  Array<{
    accountId: string;
    savedAt: string;
    mid?: string;
    displayName?: string;
    picturePath?: string;
    statusMessage?: string;
    hasToken: boolean;
  }>
> {
  const tokens = await loadTokens();
  return Object.entries(tokens)
    .map(([accountId, entry]) => {
      const row: {
        accountId: string;
        savedAt: string;
        mid?: string;
        displayName?: string;
        picturePath?: string;
        statusMessage?: string;
        premium?: TokenEntry["premium"];
        hasToken: boolean;
      } = {
        accountId,
        savedAt: entry.savedAt,
        hasToken: Boolean(entry.authToken),
      };
      if (entry.mid) row.mid = entry.mid;
      if (entry.displayName) row.displayName = entry.displayName;
      if (entry.picturePath) row.picturePath = entry.picturePath;
      if (entry.statusMessage) row.statusMessage = entry.statusMessage;
      if (entry.premium) row.premium = entry.premium;
      return row;
    })
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}
