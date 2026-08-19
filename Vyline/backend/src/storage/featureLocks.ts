/**
 * featureLocks.ts — アカウント単位の危険操作ロック（永続）
 *
 * ABUSE_BLOCK 等で BAN リスクがある操作を、以降呼ばないようにする。
 * 保存先: <backend>/data/feature-locks.json
 */

import { join, dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("featureLocks");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const LOCKS_FILE = join(DATA_DIR, "feature-locks.json");

export type AccountFeatureLocks = {
  /** createChat(GROUP) 永久禁止（ABUSE_BLOCK 検知後） */
  createGroupBanned?: boolean;
  createGroupBannedAt?: string;
  createGroupBannedReason?: string;
};

type LocksFile = Record<string, AccountFeatureLocks>;

async function ensureDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

async function readAll(): Promise<LocksFile> {
  try {
    if (!existsSync(LOCKS_FILE)) return {};
    const raw = await readFile(LOCKS_FILE, "utf8");
    return JSON.parse(raw) as LocksFile;
  } catch {
    return {};
  }
}

async function writeAll(data: LocksFile): Promise<void> {
  await ensureDir();
  await writeFile(LOCKS_FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function getFeatureLocks(accountId: string): Promise<AccountFeatureLocks> {
  const all = await readAll();
  return all[accountId] ?? {};
}

export async function isCreateGroupBanned(accountId: string): Promise<boolean> {
  const locks = await getFeatureLocks(accountId);
  return locks.createGroupBanned === true;
}

/** ABUSE_BLOCK 等を検知したら createGroup を永久禁止 */
export async function banCreateGroup(
  accountId: string,
  reason: string,
): Promise<AccountFeatureLocks> {
  const all = await readAll();
  const prev = all[accountId] ?? {};
  if (prev.createGroupBanned) return prev;
  const next: AccountFeatureLocks = {
    ...prev,
    createGroupBanned: true,
    createGroupBannedAt: new Date().toISOString(),
    createGroupBannedReason: reason.slice(0, 500),
  };
  all[accountId] = next;
  await writeAll(all);
  log.warn({ accountId, reason: next.createGroupBannedReason }, "createGroup permanently banned");
  return next;
}

/** グループ作成禁止を解除（オプション） */
export async function unbanCreateGroup(accountId: string): Promise<AccountFeatureLocks> {
  const all = await readAll();
  const prev = all[accountId] ?? {};
  if (!prev.createGroupBanned) return prev;
  const {
    createGroupBannedAt: _createGroupBannedAt,
    createGroupBannedReason: _createGroupBannedReason,
    ...rest
  } = prev;
  const next: AccountFeatureLocks = {
    ...rest,
    createGroupBanned: false,
  };
  all[accountId] = next;
  await writeAll(all);
  log.info({ accountId }, "createGroup ban cleared (user override)");
  return next;
}
