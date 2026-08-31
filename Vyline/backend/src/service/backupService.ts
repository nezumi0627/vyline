/**
 * VylineBackup — SQLite-native chat snapshots with disk-backed media sidecars.
 *
 * A backup never materializes the account history or media bodies in JavaScript.
 * Chat data is copied between normalized SQLite tables, while media is copied
 * file-to-file. A compact SQLite index makes listing and quota checks independent
 * of message count and media directory size.
 */

import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import type { BackupStorageUsage } from "@vyline/types";
import { childLogger } from "../logger.js";
import {
  createAccountChatSnapshot,
  flushAccountChatDb,
  getChatDbLogicalStorageBytes,
  listChatsWithCounts,
  mergeAccountChatSnapshot,
} from "../storage/chatStore.js";
import {
  assertMediaStorageCapacity,
  getAccountMediaStorageSize,
  importMediaStorageFile,
  iterateAccountMediaStorage,
  removeMediaStorageEntry,
  statMediaStorage,
} from "../storage/mediaStorage.js";
import { BACKUP_STORAGE_LIMIT_BYTES, BackupStorageLimitError } from "../storage/backupLimits.js";
import {
  assertDiskBackedDestinationFreeSpace,
  assertDiskBackedWorkFreeSpace,
  reserveHeavyBackupWork,
  withDiskBackedWorkCapacityLock,
} from "./diskBackedWorkQueue.js";

export { BACKUP_STORAGE_LIMIT_BYTES, BackupStorageLimitError } from "../storage/backupLimits.js";
export type { BackupStorageUsage } from "@vyline/types";

const log = childLogger("vyline-backup");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
const BACKUP_DIR = resolve(process.env.VYLINE_BACKUP_DIR ?? join(DATA_DIR, "backups"));
const BACKUP_INDEX_PATH = join(BACKUP_DIR, "backup-index.sqlite");
const SNAPSHOT_SCHEMA_VERSION = 2;
const MEDIA_METADATA_BATCH = 250;
const EVENT_LOOP_BATCH = 128;
const SNAPSHOT_WORK_HEADROOM_BYTES = 4 * 1024 * 1024;

export interface BackupOptions {
  chatMids?: string[];
  includeMedia: boolean;
}

export interface RestoreOptions {
  chatMids?: string[];
  includeMedia: boolean;
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  accountId: string;
  chatCount: number;
  messageCount: number;
  mediaCount: number;
  includeMedia: boolean;
  sizeBytes: number;
}

interface BackupIndexRow {
  id: string;
  created_at: string;
  account_id: string;
  chat_count: number;
  message_count: number;
  media_count: number;
  include_media: number;
  size_bytes: number;
}

interface BackupManifestRow extends BackupIndexRow {
  schema_version: number;
}

interface BackupMediaRow {
  chat_mid: string;
  message_id: string;
  content_type: string;
  relative_path: string;
  size_bytes: number;
}

interface LocatedBackup {
  path: string;
  mediaDir: string;
  summary: BackupSummary;
}

const writes = new Map<string, Promise<unknown>>();

/** Serializes mutations for one account without blocking unrelated API work. */
export function withAccountBackupLock<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(accountId) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(accountId, next);
  return next.finally(() => {
    if (writes.get(accountId) === next) writes.delete(accountId);
  });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function accountHash(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex");
}

function backupAccountDir(accountId: string): string {
  return join(BACKUP_DIR, accountHash(accountId));
}

function snapshotPath(accountId: string, id: string): string {
  return join(backupAccountDir(accountId), `${id}.sqlite`);
}

function backupMediaDir(accountId: string, id: string): string {
  return join(backupAccountDir(accountId), `${id}.media`);
}

function idFor(date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `vyline-backup-${stamp}-${randomUUID()}`;
}

function validBackupId(id: string): boolean {
  return /^vyline-backup-[a-zA-Z0-9_-]+$/.test(id);
}

function selectedChatMids(chatMids: string[] | undefined): Set<string> | undefined {
  if (!Array.isArray(chatMids) || chatMids.length === 0) return undefined;
  const selected = new Set(chatMids.filter((mid) => typeof mid === "string" && mid.length > 0));
  return selected.size > 0 ? selected : undefined;
}

let backupIndexDb: Database | null = null;

async function getBackupIndexDb(): Promise<Database> {
  if (backupIndexDb) return backupIndexDb;
  await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const db = new Database(BACKUP_INDEX_PATH, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA wal_autocheckpoint = 256");
  db.exec("PRAGMA journal_size_limit = 4194304");
  db.exec("PRAGMA cache_size = -1024");
  db.exec("PRAGMA mmap_size = 0");
  db.exec("PRAGMA temp_store = FILE");
  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_index (
      account_id TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      chat_count INTEGER NOT NULL CHECK(chat_count >= 0),
      message_count INTEGER NOT NULL CHECK(message_count >= 0),
      media_count INTEGER NOT NULL CHECK(media_count >= 0),
      include_media INTEGER NOT NULL CHECK(include_media IN (0, 1)),
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
      PRIMARY KEY(account_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_backup_index_account_created
      ON backup_index(account_id, created_at DESC);
  `);
  backupIndexDb = db;
  return db;
}

function summaryFromRow(row: BackupIndexRow): BackupSummary {
  return {
    id: row.id,
    createdAt: row.created_at,
    accountId: row.account_id,
    chatCount: Number(row.chat_count),
    messageCount: Number(row.message_count),
    mediaCount: Number(row.media_count),
    includeMedia: row.include_media !== 0,
    sizeBytes: Number(row.size_bytes),
  };
}

function upsertBackupIndex(db: Database, summary: BackupSummary): void {
  db.query(`
    INSERT INTO backup_index (
      account_id, id, created_at, chat_count, message_count,
      media_count, include_media, size_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, id) DO UPDATE SET
      created_at = excluded.created_at,
      chat_count = excluded.chat_count,
      message_count = excluded.message_count,
      media_count = excluded.media_count,
      include_media = excluded.include_media,
      size_bytes = excluded.size_bytes
  `).run(
    summary.accountId,
    summary.id,
    summary.createdAt,
    summary.chatCount,
    summary.messageCount,
    summary.mediaCount,
    summary.includeMedia ? 1 : 0,
    summary.sizeBytes,
  );
}

async function readSnapshotSummary(path: string): Promise<BackupSummary | null> {
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true, strict: true });
    db.exec("PRAGMA query_only = ON");
    db.exec("PRAGMA cache_size = -512");
    db.exec("PRAGMA mmap_size = 0");
    db.exec("PRAGMA temp_store = FILE");
    const row = db
      .query(`
        SELECT schema_version, id, created_at, account_id, chat_count,
               message_count, media_count, include_media, size_bytes
        FROM backup_manifest
        LIMIT 1
      `)
      .get() as BackupManifestRow | null;
    if (!row || row.schema_version !== SNAPSHOT_SCHEMA_VERSION || !validBackupId(row.id)) {
      return null;
    }
    const media = db
      .query("SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM backup_media")
      .get() as { bytes: number };
    const actualSize = (await stat(path)).size + Number(media.bytes);
    return { ...summaryFromRow(row), sizeBytes: actualSize };
  } catch (error) {
    log.warn({ error, path }, "VylineBackup: unreadable SQLite snapshot");
    return null;
  } finally {
    db?.close();
  }
}

const indexedAccounts = new Set<string>();
const accountIndexInflight = new Map<string, Promise<void>>();

async function ensureAccountBackupIndex(accountId: string): Promise<void> {
  if (indexedAccounts.has(accountId)) return;
  const inflight = accountIndexInflight.get(accountId);
  if (inflight) return inflight;
  const work = (async () => {
    const dir = backupAccountDir(accountId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const files = await readdir(dir, { withFileTypes: true });
    const diskIds = new Set<string>();
    const db = await getBackupIndexDb();
    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue;
      const id = entry.name.slice(0, -".sqlite".length);
      if (!validBackupId(id)) continue;
      const summary = await readSnapshotSummary(join(dir, entry.name));
      if (!summary || summary.id !== id || summary.accountId !== accountId) continue;
      diskIds.add(id);
      upsertBackupIndex(db, summary);
      await yieldToEventLoop();
    }
    const indexed = db
      .query("SELECT id FROM backup_index WHERE account_id = ?")
      .all(accountId) as Array<{ id: string }>;
    const remove = db.query("DELETE FROM backup_index WHERE account_id = ? AND id = ?");
    for (const row of indexed) {
      if (!diskIds.has(row.id)) remove.run(accountId, row.id);
    }
    indexedAccounts.add(accountId);
  })().finally(() => {
    accountIndexInflight.delete(accountId);
  });
  accountIndexInflight.set(accountId, work);
  return work;
}

export async function ensureBackupDir(): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  await getBackupIndexDb();
}

/** Close the small backup index during graceful shutdown and isolated tests. */
export async function closeBackupStorage(): Promise<void> {
  await Promise.allSettled([...accountIndexInflight.values(), ...writes.values()]);
  const db = backupIndexDb;
  backupIndexDb = null;
  indexedAccounts.clear();
  accountIndexInflight.clear();
  if (!db) return;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

export async function getBackupStorageUsage(accountId: string): Promise<BackupStorageUsage> {
  await ensureAccountBackupIndex(accountId);
  const db = await getBackupIndexDb();
  const backup = db
    .query("SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM backup_index WHERE account_id = ?")
    .get(accountId) as { bytes: number };
  // Both calls are indexed/O(1) aggregate paths; do not enumerate messages here.
  const historyBytes = await getChatDbLogicalStorageBytes(accountId);
  const mediaBytes = await getAccountMediaStorageSize(accountId);
  const backupBytes = Number(backup.bytes);
  const usedBytes = backupBytes + historyBytes + mediaBytes;
  return {
    accountId,
    usedBytes,
    limitBytes: BACKUP_STORAGE_LIMIT_BYTES,
    remainingBytes: Math.max(0, BACKUP_STORAGE_LIMIT_BYTES - usedBytes),
    historyBytes,
    mediaBytes,
    backupBytes,
  };
}

/**
 * Lightweight total for the general storage screen. The compact index is
 * maintained when backups are published/deleted, so this never walks media
 * sidecar directories. Per-account quota reads still perform their bounded
 * manifest recovery before trusting the index.
 */
export async function getTotalBackupStorageBytes(): Promise<number> {
  const db = await getBackupIndexDb();
  const row = db.query("SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM backup_index").get() as {
    bytes: number;
  };
  return Number(row.bytes);
}

export async function getBackupChatList(
  accountId: string,
): Promise<Array<{ mid: string; name: string; messageCount: number }>> {
  return listChatsWithCounts(accountId);
}

async function sqliteBundleBytes(path: string): Promise<number> {
  let total = 0;
  // SHM is transient coordination state, not backup payload. WAL is included
  // until the final checkpoint so quota checks remain conservative.
  for (const candidate of [path, `${path}-wal`]) {
    try {
      total += (await stat(candidate)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return total;
}

function initializeSnapshotManifest(
  db: Database,
  summary: Omit<BackupSummary, "mediaCount" | "sizeBytes">,
): void {
  db.exec(`
    CREATE TABLE backup_manifest (
      schema_version INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      account_id TEXT NOT NULL,
      chat_count INTEGER NOT NULL CHECK(chat_count >= 0),
      message_count INTEGER NOT NULL CHECK(message_count >= 0),
      media_count INTEGER NOT NULL CHECK(media_count >= 0),
      include_media INTEGER NOT NULL CHECK(include_media IN (0, 1)),
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0)
    );
    CREATE TABLE backup_media (
      chat_mid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      content_type TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
      PRIMARY KEY(chat_mid, message_id)
    );
  `);
  db.query(`
    INSERT INTO backup_manifest (
      schema_version, id, created_at, account_id, chat_count,
      message_count, media_count, include_media, size_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0)
  `).run(
    SNAPSHOT_SCHEMA_VERSION,
    summary.id,
    summary.createdAt,
    summary.accountId,
    summary.chatCount,
    summary.messageCount,
    summary.includeMedia ? 1 : 0,
  );
}

async function finalizeSnapshotSize(
  db: Database,
  path: string,
  mediaCount: number,
  mediaBytes: number,
): Promise<number> {
  db.query("UPDATE backup_manifest SET media_count = ?, size_bytes = 0").run(mediaCount);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  // Published snapshots are immutable single-file databases. DELETE mode keeps
  // readers from creating persistent -wal/-shm companions beside the backup.
  db.exec("PRAGMA journal_mode = DELETE");
  let sizeBytes = (await sqliteBundleBytes(path)) + mediaBytes;
  for (let attempt = 0; attempt < 2; attempt++) {
    db.query("UPDATE backup_manifest SET size_bytes = ?").run(sizeBytes);
    const actual = (await sqliteBundleBytes(path)) + mediaBytes;
    if (actual === sizeBytes) break;
    sizeBytes = actual;
  }
  return sizeBytes;
}

export async function createBackup(
  accountId: string,
  options: BackupOptions,
): Promise<BackupSummary> {
  const usage = await getBackupStorageUsage(accountId);
  const estimatedBytes = Math.min(
    BACKUP_STORAGE_LIMIT_BYTES,
    usage.historyBytes +
      (options.includeMedia ? usage.mediaBytes : 0) +
      SNAPSHOT_WORK_HEADROOM_BYTES,
  );
  const reservation = await withDiskBackedWorkCapacityLock(async () => {
    const next = reserveHeavyBackupWork(accountId);
    try {
      next.resizeReservedBytes(estimatedBytes);
      await assertDiskBackedDestinationFreeSpace(BACKUP_DIR, estimatedBytes, next.reservedBytes);
      return next;
    } catch (error) {
      next.release();
      throw error;
    }
  });
  return reservation.enqueue(() =>
    withAccountBackupLock(accountId, () => createAccountBackup(accountId, options)),
  );
}

async function createAccountBackup(
  accountId: string,
  options: BackupOptions,
): Promise<BackupSummary> {
  const usage = await getBackupStorageUsage(accountId);
  if (usage.remainingBytes <= 0) throw new BackupStorageLimitError();

  const selected = selectedChatMids(options.chatMids);
  const createdAt = new Date();
  const id = idFor(createdAt);
  const finalPath = snapshotPath(accountId, id);
  const finalMediaDir = backupMediaDir(accountId, id);
  const partialToken = randomUUID();
  const temporaryPath = `${finalPath}.${partialToken}.partial`;
  const temporaryMediaDir = `${finalMediaDir}.${partialToken}.partial`;
  await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });

  let snapshotDb: Database | null = null;
  let mediaTransactionOpen = false;
  let publishedPath = false;
  let publishedMedia = false;
  let mediaCount = 0;
  let mediaBytes = 0;
  try {
    const counts = await createAccountChatSnapshot(accountId, temporaryPath, selected);
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    snapshotDb = new Database(temporaryPath, { create: false, strict: true });
    snapshotDb.exec("PRAGMA journal_mode = WAL");
    snapshotDb.exec("PRAGMA synchronous = NORMAL");
    snapshotDb.exec("PRAGMA busy_timeout = 5000");
    snapshotDb.exec("PRAGMA wal_autocheckpoint = 256");
    snapshotDb.exec("PRAGMA journal_size_limit = 4194304");
    snapshotDb.exec("PRAGMA cache_size = -2048");
    snapshotDb.exec("PRAGMA mmap_size = 0");
    snapshotDb.exec("PRAGMA temp_store = FILE");
    initializeSnapshotManifest(snapshotDb, {
      id,
      createdAt: createdAt.toISOString(),
      accountId,
      chatCount: counts.chats,
      messageCount: counts.messages,
      includeMedia: options.includeMedia,
    });
    snapshotDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const snapshotBaseBytes = await sqliteBundleBytes(temporaryPath);
    if (snapshotBaseBytes > usage.remainingBytes) throw new BackupStorageLimitError();

    if (options.includeMedia) {
      await mkdir(temporaryMediaDir, { recursive: true, mode: 0o700 });
      const containsMessage = snapshotDb.query(
        "SELECT 1 FROM staged_messages WHERE chat_mid = ? AND id = ? LIMIT 1",
      );
      const insertMedia = snapshotDb.query(`
        INSERT INTO backup_media (
          chat_mid, message_id, content_type, relative_path, size_bytes
        ) VALUES (?, ?, ?, ?, ?)
      `);
      let currentShard = "";
      let batchCount = 0;
      for await (const media of iterateAccountMediaStorage(accountId, selected)) {
        if (!containsMessage.get(media.chatMid, media.messageId)) continue;
        if (snapshotBaseBytes + mediaBytes + media.sizeBytes > usage.remainingBytes) {
          throw new BackupStorageLimitError();
        }
        const ordinal = mediaCount + 1;
        const shard = Math.floor((ordinal - 1) / 1000)
          .toString()
          .padStart(6, "0");
        const relativePath = `${shard}/${ordinal.toString().padStart(12, "0")}.blob`;
        if (shard !== currentShard) {
          currentShard = shard;
          await mkdir(join(temporaryMediaDir, shard), { recursive: true, mode: 0o700 });
        }
        if (!mediaTransactionOpen) {
          snapshotDb.exec("BEGIN IMMEDIATE");
          mediaTransactionOpen = true;
        }
        await copyFile(
          media.path,
          join(temporaryMediaDir, ...relativePath.split("/")),
          constants.COPYFILE_EXCL,
        );
        insertMedia.run(
          media.chatMid,
          media.messageId,
          media.contentType,
          relativePath,
          media.sizeBytes,
        );
        mediaCount++;
        mediaBytes += media.sizeBytes;
        batchCount++;
        if (batchCount >= MEDIA_METADATA_BATCH) {
          snapshotDb.exec("COMMIT");
          mediaTransactionOpen = false;
          batchCount = 0;
          snapshotDb.exec("PRAGMA wal_checkpoint(PASSIVE)");
          await yieldToEventLoop();
        }
      }
      if (mediaTransactionOpen) {
        snapshotDb.exec("COMMIT");
        mediaTransactionOpen = false;
      }
    }

    const sizeBytes = await finalizeSnapshotSize(snapshotDb, temporaryPath, mediaCount, mediaBytes);
    if (sizeBytes > usage.remainingBytes) throw new BackupStorageLimitError();
    snapshotDb.close();
    snapshotDb = null;

    if (mediaCount > 0) {
      await rename(temporaryMediaDir, finalMediaDir);
      publishedMedia = true;
    } else {
      await rm(temporaryMediaDir, { recursive: true, force: true });
    }
    await rename(temporaryPath, finalPath);
    publishedPath = true;

    const summary: BackupSummary = {
      id,
      createdAt: createdAt.toISOString(),
      accountId,
      chatCount: counts.chats,
      messageCount: counts.messages,
      mediaCount,
      includeMedia: options.includeMedia,
      sizeBytes,
    };
    const index = await getBackupIndexDb();
    upsertBackupIndex(index, summary);
    log.info({ accountId, id, ...counts, mediaCount, sizeBytes }, "VylineBackup created");
    return summary;
  } catch (error) {
    if (mediaTransactionOpen && snapshotDb) {
      try {
        snapshotDb.exec("ROLLBACK");
      } catch {
        /* Preserve the original failure. */
      }
    }
    if (publishedPath) await unlink(finalPath).catch(() => undefined);
    if (publishedMedia) {
      await rm(finalMediaDir, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    snapshotDb?.close();
    for (const path of [temporaryPath, `${temporaryPath}-wal`, `${temporaryPath}-shm`]) {
      await unlink(path).catch(() => undefined);
    }
    await rm(temporaryMediaDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function listBackups(accountId: string): Promise<BackupSummary[]> {
  await ensureAccountBackupIndex(accountId);
  const db = await getBackupIndexDb();
  const rows = db
    .query(`
      SELECT id, created_at, account_id, chat_count, message_count,
             media_count, include_media, size_bytes
      FROM backup_index
      WHERE account_id = ?
      ORDER BY created_at DESC
    `)
    .all(accountId) as BackupIndexRow[];
  return rows.map(summaryFromRow);
}

async function locateBackup(accountId: string, id: string): Promise<LocatedBackup | null> {
  if (!validBackupId(id)) return null;
  await ensureAccountBackupIndex(accountId);
  const index = await getBackupIndexDb();
  const row = index
    .query(`
      SELECT id, created_at, account_id, chat_count, message_count,
             media_count, include_media, size_bytes
      FROM backup_index
      WHERE account_id = ? AND id = ?
    `)
    .get(accountId, id) as BackupIndexRow | null;
  if (!row) return null;
  const path = snapshotPath(accountId, id);
  if (!existsSync(path)) {
    index.query("DELETE FROM backup_index WHERE account_id = ? AND id = ?").run(accountId, id);
    return null;
  }
  const summary = await readSnapshotSummary(path);
  if (!summary || summary.accountId !== accountId || summary.id !== id) return null;
  if (summary.sizeBytes !== Number(row.size_bytes)) upsertBackupIndex(index, summary);
  return { path, mediaDir: backupMediaDir(accountId, id), summary };
}

function backupMediaRows(db: Database): IterableIterator<BackupMediaRow> {
  return db
    .query(`
      SELECT chat_mid, message_id, content_type, relative_path, size_bytes
      FROM backup_media
      ORDER BY chat_mid, message_id
    `)
    .iterate() as IterableIterator<BackupMediaRow>;
}

async function resolveBackupMediaPath(
  rootPath: string,
  rootRealPath: string,
  row: BackupMediaRow,
): Promise<string> {
  if (!/^\d{6}\/\d{12}\.blob$/.test(row.relative_path) || row.size_bytes < 0) {
    throw new Error("バックアップのメディア索引が不正です");
  }
  const candidate = resolve(rootPath, ...row.relative_path.split("/"));
  const lexicalChild = relative(rootPath, candidate);
  if (!lexicalChild || lexicalChild.startsWith("..") || isAbsolute(lexicalChild)) {
    throw new Error("バックアップのメディアパスが不正です");
  }
  const resolvedCandidate = await realpath(candidate);
  const realChild = relative(rootRealPath, resolvedCandidate);
  if (!realChild || realChild.startsWith("..") || isAbsolute(realChild)) {
    throw new Error("バックアップのメディアパスが保存領域外を指しています");
  }
  const info = await stat(resolvedCandidate);
  if (!info.isFile() || info.size !== Number(row.size_bytes)) {
    throw new Error("バックアップのメディアサイズが一致しません");
  }
  return resolvedCandidate;
}

async function scanBackupMedia(
  backup: LocatedBackup,
  selected: Set<string> | undefined,
  visit: (row: BackupMediaRow, sourcePath: string) => Promise<void>,
): Promise<void> {
  if (backup.summary.mediaCount === 0) return;
  const mediaRoot = await realpath(backup.mediaDir).catch(() => null);
  if (!mediaRoot) throw new Error("バックアップのメディア保存領域が見つかりません");
  const db = new Database(backup.path, { readonly: true, strict: true });
  db.exec("PRAGMA query_only = ON");
  db.exec("PRAGMA cache_size = -512");
  db.exec("PRAGMA mmap_size = 0");
  db.exec("PRAGMA temp_store = FILE");
  let processed = 0;
  try {
    for (const row of backupMediaRows(db)) {
      if (selected && !selected.has(row.chat_mid)) continue;
      const sourcePath = await resolveBackupMediaPath(backup.mediaDir, mediaRoot, row);
      await visit(row, sourcePath);
      processed++;
      if (processed % EVENT_LOOP_BATCH === 0) await yieldToEventLoop();
    }
  } finally {
    db.close();
  }
}

export async function restoreBackup(
  accountId: string,
  id: string,
  options: RestoreOptions,
): Promise<{ restoredChats: number; restoredMessages: number; restoredMedia: number }> {
  const located = await locateBackup(accountId, id);
  if (!located) throw new Error("バックアップが見つかりません");
  const snapshotBytes = await sqliteBundleBytes(located.path);
  const estimatedBytes = Math.min(
    BACKUP_STORAGE_LIMIT_BYTES,
    snapshotBytes + SNAPSHOT_WORK_HEADROOM_BYTES,
  );
  const reservation = await withDiskBackedWorkCapacityLock(async () => {
    const next = reserveHeavyBackupWork(accountId);
    try {
      next.resizeReservedBytes(estimatedBytes);
      await assertDiskBackedWorkFreeSpace(estimatedBytes, next.reservedBytes);
      return next;
    } catch (error) {
      next.release();
      throw error;
    }
  });
  return reservation.enqueue(() =>
    withAccountBackupLock(accountId, () => restoreAccountBackup(accountId, id, options)),
  );
}

async function restoreAccountBackup(
  accountId: string,
  id: string,
  options: RestoreOptions,
): Promise<{ restoredChats: number; restoredMessages: number; restoredMedia: number }> {
  const backup = await locateBackup(accountId, id);
  if (!backup) throw new Error("バックアップが見つかりません");
  const selected = selectedChatMids(options.chatMids);

  let newMediaBytes = 0;
  if (options.includeMedia) {
    await scanBackupMedia(backup, selected, async (row) => {
      if (await statMediaStorage(accountId, row.chat_mid, row.message_id)) return;
      newMediaBytes += Number(row.size_bytes);
      if (!Number.isSafeInteger(newMediaBytes)) throw new BackupStorageLimitError();
    });
  }

  const usage = await getBackupStorageUsage(accountId);
  if (usage.usedBytes + newMediaBytes > usage.limitBytes) throw new BackupStorageLimitError();
  const maxHistoryBytes = usage.limitBytes - usage.backupBytes - usage.mediaBytes - newMediaBytes;
  if (maxHistoryBytes < 0) throw new BackupStorageLimitError();
  if (newMediaBytes > 0) await assertMediaStorageCapacity(newMediaBytes);

  let restoredMedia = 0;
  const importedMedia: Array<{ chatMid: string; messageId: string }> = [];
  let imported: Awaited<ReturnType<typeof mergeAccountChatSnapshot>>;
  try {
    // Copy media first. If any copy or the subsequent SQLite transaction fails,
    // only files created by this restore are removed; pre-existing media is kept.
    if (options.includeMedia) {
      await scanBackupMedia(backup, selected, async (row, sourcePath) => {
        if (
          await importMediaStorageFile(
            accountId,
            row.chat_mid,
            row.message_id,
            sourcePath,
            row.content_type,
          )
        ) {
          importedMedia.push({ chatMid: row.chat_mid, messageId: row.message_id });
          restoredMedia++;
        }
      });
    }
    imported = await mergeAccountChatSnapshot(accountId, backup.path, selected, maxHistoryBytes);
  } catch (error) {
    for (let index = importedMedia.length - 1; index >= 0; index--) {
      const media = importedMedia[index]!;
      await removeMediaStorageEntry(accountId, media.chatMid, media.messageId).catch(
        (cleanupError) => {
          log.warn({ cleanupError, ...media }, "failed to roll back restored media");
        },
      );
    }
    throw error;
  }
  await flushAccountChatDb(accountId).catch((error) => {
    // The merge transaction is already durable. A passive WAL checkpoint failure
    // must not report the restore as failed after both stores were committed.
    log.warn({ error, accountId }, "backup restore WAL checkpoint deferred");
  });
  log.info(
    {
      accountId,
      id,
      chats: imported.importedChats,
      messages: imported.importedMessages,
      restoredMedia,
    },
    "VylineBackup restored",
  );
  return {
    restoredChats: imported.importedChats,
    restoredMessages: imported.importedMessages,
    restoredMedia,
  };
}

export async function deleteBackup(accountId: string, id: string): Promise<boolean> {
  return withAccountBackupLock(accountId, async () => {
    const backup = await locateBackup(accountId, id);
    if (!backup) return false;
    const token = randomUUID();
    const deletingPath = `${backup.path}.${token}.deleting`;
    const deletingMediaDir = `${backup.mediaDir}.${token}.deleting`;
    let movedPath = false;
    let movedMedia = false;
    try {
      if (existsSync(backup.mediaDir)) {
        await rename(backup.mediaDir, deletingMediaDir);
        movedMedia = true;
      }
      await rename(backup.path, deletingPath);
      movedPath = true;
      await unlink(deletingPath);
      movedPath = false;
      if (movedMedia) {
        await rm(deletingMediaDir, { recursive: true, force: true });
        movedMedia = false;
      }
      const index = await getBackupIndexDb();
      index.query("DELETE FROM backup_index WHERE account_id = ? AND id = ?").run(accountId, id);
      return true;
    } catch (error) {
      if (movedPath) await rename(deletingPath, backup.path).catch(() => undefined);
      if (movedMedia) await rename(deletingMediaDir, backup.mediaDir).catch(() => undefined);
      throw error;
    }
  });
}
