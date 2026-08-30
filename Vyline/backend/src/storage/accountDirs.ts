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

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeJsonAtomic } from "./safeFile.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const ACCOUNTS_ROOT = join(DATA_DIR, "accounts");
const REGISTRY_PATH = join(DATA_DIR, "accounts.json");

export interface AccountRegistryEntry {
  accountId: string;
  dirName: string;
  registeredAt: string;
}

function safeId(accountId: string): string {
  if (/^[a-z0-9_-]{1,100}$/.test(accountId)) return accountId;
  // '~' is outside the unchanged ID alphabet, so a literal account ID cannot
  // collide with a hashed ID on case-insensitive Windows filesystems either.
  return `~${createHash("sha256").update(accountId).digest("hex")}`;
}

function legacySafeId(accountId: string): string {
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
let registryWrite: Promise<void> = Promise.resolve();
export function ensureAccount(accountId: string): void {
  registryWrite = registryWrite
    .then(async () => {
      let reg: { accounts?: AccountRegistryEntry[] } = {};
      if (existsSync(REGISTRY_PATH)) {
        reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
      }
      reg.accounts = reg.accounts ?? [];
      if (!reg.accounts.some((a) => a.accountId === accountId)) {
        reg.accounts.push({
          accountId,
          dirName: safeId(accountId),
          registeredAt: new Date().toISOString(),
        });
        await writeJsonAtomic(REGISTRY_PATH, reg);
      }
    })
    .catch(() => {
      /* 更新失敗時は旧レジストリを保持し、読み込み側で所有者を確認する。 */
    });
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
  await registryWrite;
  const newPath = accountFile(accountId, filename);
  let accounts: AccountRegistryEntry[] = [];
  if (existsSync(REGISTRY_PATH)) {
    const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
    accounts = registry.accounts ?? [];
  }
  const owners = (dirName: string) => accounts.filter((entry) => entry.dirName === dirName);
  const ambiguous = () =>
    new Error(
      "旧データの保存先に重複するアカウントIDがあります。混在を防ぐため読み込みを停止しました。既存データは保持されています",
    );
  if (existsSync(newPath)) {
    if (owners(safeId(accountId)).some((entry) => entry.accountId !== accountId)) throw ambiguous();
    try {
      return JSON.parse(await readFile(newPath, "utf8")) as T;
    } catch {
      return null;
    }
  }
  const oldDirName = legacySafeId(accountId);
  const oldAccountPath = join(ACCOUNTS_ROOT, oldDirName, filename);
  if (oldDirName !== safeId(accountId) && existsSync(oldAccountPath)) {
    const oldOwners = owners(oldDirName);
    if (oldOwners.length !== 1 || oldOwners[0]?.accountId !== accountId) throw ambiguous();
    const parsed = JSON.parse(await readFile(oldAccountPath, "utf8")) as T;
    await writeJsonAtomic(newPath, parsed);
    // Keep the registry's old dirName and the source as ownership evidence.
    return parsed;
  }
  // Legacy files were flat. An account ID containing separators must not turn
  // this fallback into a read from another account directory.
  if (!/[\\/]/.test(accountId) && dirname(resolve(legacyPath)) === resolve(DATA_DIR) && existsSync(legacyPath)) {
    try {
      const parsed = JSON.parse(await readFile(legacyPath, "utf8")) as T;
      await mkdir(dirname(newPath), { recursive: true });
      await writeJsonAtomic(newPath, parsed);
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}
