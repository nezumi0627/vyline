/**
 * featureLocks.ts — アカウント単位の危険操作ロック（永続）
 *
 * ABUSE_BLOCK 等で BAN リスクがある操作を、以降呼ばないようにする。
 * 保存先: <backend>/data/feature-locks.json
 */

import { join, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { writeJsonAtomic } from "./safeFile.js";

const log = childLogger("featureLocks");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const LOCKS_FILE = join(DATA_DIR, "feature-locks.json");
let writeQueue: Promise<void> = Promise.resolve();

export type AccountFeatureLocks = {
  /** createChat(GROUP) 永久禁止（ABUSE_BLOCK 検知後） */
  createGroupBanned?: boolean;
  createGroupBannedAt?: string;
  createGroupBannedReason?: string;
};

type LocksFile = Record<string, AccountFeatureLocks>;

function isLocksFile(value: unknown): value is LocksFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (!("createGroupBanned" in entry) ||
        typeof (entry as AccountFeatureLocks).createGroupBanned === "boolean") &&
      (!("createGroupBannedAt" in entry) ||
        typeof (entry as AccountFeatureLocks).createGroupBannedAt === "string") &&
      (!("createGroupBannedReason" in entry) ||
        typeof (entry as AccountFeatureLocks).createGroupBannedReason === "string"),
  );
}

// ponytail: one shared file needs one queue; split storage only if account volume grows.
function withWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.catch(() => undefined).then(work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readAll(): Promise<LocksFile> {
  try {
    const raw = await readFile(LOCKS_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isLocksFile(parsed)) throw new Error("feature lock file has an invalid schema");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeAll(data: LocksFile): Promise<void> {
  await writeJsonAtomic(LOCKS_FILE, data);
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
  return withWriteLock(async () => {
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
  });
}

/** グループ作成禁止を解除（オプション） */
export async function unbanCreateGroup(accountId: string): Promise<AccountFeatureLocks> {
  return withWriteLock(async () => {
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
  });
}
