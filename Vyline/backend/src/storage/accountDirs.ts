/**
 * storage/accountDirs.ts — マルチアカウントのディレクトリ分離
 *
 * 目標レイアウト（README「Multi-account Support」）:
 *   data/accounts/<safe-id>/  にアカウント固有ファイルを集約
 *
 * 移行方針:
 * - 書き込みは常に新レイアウトへ
 * - 読み込みは新 → 旧フラット (data/<name>-<id>.json) の順にフォールバックし、
 *   見つかった場合は新レイアウトへ自動コピーする（nezu-* からの移行と同じ方式）
 */

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "../logger.js";
import { migrateOnce, sqlite } from "./sqlite.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const ACCOUNTS_ROOT = join(DATA_DIR, "accounts");
const REGISTRY_PATH = join(DATA_DIR, "accounts.json");
const log = childLogger("accountDirs");

export interface AccountRegistryEntry {
  accountId: string;
  dirName: string;
  registeredAt: string;
}

const registeredAccounts = new Set<string>();
const resolvedDirNames = new Map<string, string>();

function safeId(accountId: string): string {
  const s = accountId.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return s || `acct-${hash(accountId)}`;
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function isSafeDirName(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/:\u0000-\u001f]/.test(value);
}

function dirNameFor(accountId: string): string {
  const cached = resolvedDirNames.get(accountId);
  if (cached) return cached;
  const existing = sqlite
    .query("SELECT dir_name FROM app_accounts WHERE account_id = ?")
    .get(accountId) as { dir_name: string } | null;
  if (existing?.dir_name && isSafeDirName(existing.dir_name)) {
    resolvedDirNames.set(accountId, existing.dir_name);
    return existing.dir_name;
  }
  const base = safeId(accountId);
  const collision = sqlite
    .query("SELECT 1 FROM app_accounts WHERE dir_name = ? AND account_id != ? LIMIT 1")
    .get(base, accountId);
  const dirName = collision ? `${base}-${hash(accountId)}` : base;
  if (registeredAccounts.has(accountId)) resolvedDirNames.set(accountId, dirName);
  return dirName;
}

/** アカウントのデータディレクトリ（存在しない場合は作成しない。書き込み側で mkdir する） */
export function accountDir(accountId: string): string {
  return join(ACCOUNTS_ROOT, dirNameFor(accountId));
}

/** 新レイアウトのファイルパス */
export function accountFile(accountId: string, filename: string): string {
  return join(accountDir(accountId), filename);
}

/** レジストリにアカウントを記録（冪等・軽量） */
export function ensureAccount(accountId: string): void {
  if (registeredAccounts.has(accountId)) return;
  try {
    if (existsSync(REGISTRY_PATH))
      migrateOnce("accounts-json-v2", () => {
        const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as {
          accounts?: AccountRegistryEntry[];
        };
        const insert = sqlite.query(
          "INSERT OR IGNORE INTO app_accounts (account_id, dir_name, registered_at) VALUES (?, ?, ?)",
        );
        for (const entry of reg.accounts ?? []) {
          insert.run(entry.accountId, entry.dirName, entry.registeredAt);
        }
      });
    const dirName = dirNameFor(accountId);
    sqlite
      .query("UPDATE app_accounts SET dir_name = ? WHERE account_id = ?")
      .run(dirName, accountId);
    sqlite
      .query(
        "INSERT OR IGNORE INTO app_accounts (account_id, dir_name, registered_at) VALUES (?, ?, ?)",
      )
      .run(accountId, dirName, new Date().toISOString());
    registeredAccounts.add(accountId);
    resolvedDirNames.set(accountId, dirName);
  } catch (err) {
    log.error({ accountId, err }, "account registry update failed");
  }
}
