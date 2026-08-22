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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const ACCOUNTS_ROOT = join(DATA_DIR, "accounts");
const REGISTRY_PATH = join(DATA_DIR, "accounts.json");

export interface AccountRegistryEntry {
  accountId: string;
  dirName: string;
  registeredAt: string;
}

function safeId(accountId: string): string {
  const s = accountId.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return s || `acct-${hash(accountId)}`;
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** アカウントのデータディレクトリ（存在しない場合は作成しない。書き込み側で mkdir する） */
export function accountDir(accountId: string): string {
  return join(ACCOUNTS_ROOT, safeId(accountId));
}

/** 新レイアウトのファイルパス */
export function accountFile(accountId: string, filename: string): string {
  return join(accountDir(accountId), filename);
}

/** レジストリにアカウントを記録（冪等・軽量） */
export function ensureAccount(accountId: string): void {
  try {
    let reg: { accounts?: AccountRegistryEntry[] } = {};
    if (existsSync(REGISTRY_PATH)) {
      reg = JSON.parse(require("node:fs").readFileSync(REGISTRY_PATH, "utf8"));
    }
    reg.accounts = reg.accounts ?? [];
    if (!reg.accounts.some((a) => a.accountId === accountId)) {
      reg.accounts.push({
        accountId,
        dirName: safeId(accountId),
        registeredAt: new Date().toISOString(),
      });
      require("node:fs").writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), "utf8");
    }
  } catch {
    /* レジストリ失敗はデータ分離に影響させない */
  }
}

/**
 * アカウント JSON を読む。新レイアウト優先、無ければ旧フラットパスから
 * 読んで新レイアウトへコピーして返す。
 */
export async function readAccountJson<T>(
  accountId: string,
  filename: string,
  legacyPath: string,
): Promise<T | null> {
  ensureAccount(accountId);
  const newPath = accountFile(accountId, filename);
  if (existsSync(newPath)) {
    try {
      return JSON.parse(await readFile(newPath, "utf8")) as T;
    } catch {
      return null;
    }
  }
  if (existsSync(legacyPath)) {
    try {
      const parsed = JSON.parse(await readFile(legacyPath, "utf8")) as T;
      await mkdir(dirname(newPath), { recursive: true });
      await writeFile(newPath, JSON.stringify(parsed), "utf8");
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}
