/**
 * storage/mediaStorage.ts — メッセージ添付メディアの永続ストレージ。
 *
 * 大きな動画・音声・ファイルはディスクからストリーム配信できるよう、path/stat API を
 * 正本にする。小さなファイル向けメモリキャッシュは個数ではなく総バイト数で制限する。
 * 物理ファイルの所有者・サイズは SQLite index に記録し、容量表示でディレクトリや
 * 全メッセージを毎回走査しない。
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { childLogger } from "../logger.js";
import { accountFile } from "./accountDirs.js";
import { BACKUP_STORAGE_LIMIT_BYTES } from "./backupLimits.js";
import {
  VYLINE_DATA_DIR,
  VYLINE_LEGACY_MEDIA_DIR,
  VYLINE_SAVED_MEDIA_DIR,
  VYLINE_STORAGE_DIR,
} from "./vylineStorageInfo.js";

const log = childLogger("media-storage");
const LEGACY_ROOT = VYLINE_LEGACY_MEDIA_DIR;
const STORAGE_ROOT = VYLINE_SAVED_MEDIA_DIR;
const MEDIA_INDEX_PATH =
  process.env.VYLINE_MEDIA_INDEX_PATH ?? join(VYLINE_STORAGE_DIR, "media-index.sqlite");
const DATA_ROOT = VYLINE_DATA_DIR;
const MEDIA_INDEX_VERSION = "1";
const INDEX_BATCH_SIZE = 500;
const MAX_REBUILD_HASH_SET = 100_000;
const DEFAULT_MEDIA_MAX_OBJECT_BYTES = 2 * 1024 ** 3;
const DEFAULT_MEDIA_MIN_FREE_BYTES = 512 * 1024 ** 2;
const MEDIA_CAPACITY_CHECK_INTERVAL_BYTES = 4 * 1024 ** 2;
const DEFAULT_MEDIA_WRITE_CONCURRENCY = 2;
const DEFAULT_MEDIA_WRITE_QUEUE_LIMIT = 32;

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Remote objects are capped by the independent per-account 10 GiB allowance. */
export const MEDIA_STORAGE_MAX_OBJECT_BYTES = Math.min(
  BACKUP_STORAGE_LIMIT_BYTES,
  positiveIntegerEnv("VYLINE_MEDIA_STORAGE_MAX_OBJECT_BYTES", DEFAULT_MEDIA_MAX_OBJECT_BYTES),
);

/** Operators may reserve more disk, but never lower the 512 MiB safety floor. */
export const MEDIA_STORAGE_MIN_FREE_BYTES = Math.max(
  DEFAULT_MEDIA_MIN_FREE_BYTES,
  positiveIntegerEnv("VYLINE_MEDIA_STORAGE_MIN_FREE_BYTES", DEFAULT_MEDIA_MIN_FREE_BYTES),
);

export const MEDIA_STORAGE_WRITE_CONCURRENCY = Math.min(
  16,
  positiveIntegerEnv("VYLINE_MEDIA_STORAGE_WRITE_CONCURRENCY", DEFAULT_MEDIA_WRITE_CONCURRENCY),
);

const MEDIA_STORAGE_WRITE_QUEUE_LIMIT = Math.min(
  1_024,
  positiveIntegerEnv("VYLINE_MEDIA_STORAGE_WRITE_QUEUE_LIMIT", DEFAULT_MEDIA_WRITE_QUEUE_LIMIT),
);

export class MediaStorageCapacityError extends Error {
  constructor(message = "media storage capacity is insufficient") {
    super(message);
    this.name = "MediaStorageCapacityError";
  }
}

export class MediaStorageObjectLimitError extends Error {
  constructor() {
    super("media object exceeds its storage limit");
    this.name = "MediaStorageObjectLimitError";
  }
}

export class MediaStorageBusyError extends Error {
  constructor() {
    super("media storage write queue is full; retry later");
    this.name = "MediaStorageBusyError";
  }
}

const TYPE_ROOTS = {
  image: join(STORAGE_ROOT, "images"),
  video: join(STORAGE_ROOT, "videos"),
  audio: join(STORAGE_ROOT, "audio"),
  file: join(STORAGE_ROOT, "files"),
} as const;

export type MediaStorageType = keyof typeof TYPE_ROOTS;

export interface MediaStorageStat {
  path: string;
  sizeBytes: number;
  contentType: string;
  mediaType: MediaStorageType;
}

export interface AccountMediaStorageEntry {
  chatMid: string;
  messageId: string;
  path: string;
  sizeBytes: number;
  contentType: string;
}

interface IndexedMediaRow {
  path: string;
  storage_hash: string;
  account_id: string | null;
  chat_mid: string | null;
  message_id: string | null;
  size_bytes: number;
  content_type: string;
  media_type: MediaStorageType;
}

interface MemoryEntry {
  buf: Uint8Array;
  contentType: string;
  mediaType: MediaStorageType;
  at: number;
}

const memory = new Map<string, MemoryEntry>();
const mediaWriteTails = new Map<string, Promise<void>>();
const mediaWriteWaiters: Array<() => void> = [];
const MEMORY_BUDGET_BYTES = 16 * 1024 * 1024;
const MEMORY_MAX_ITEM_BYTES = 4 * 1024 * 1024;
const MEMORY_TTL_MS = 10 * 60_000;
let memoryBytes = 0;
let activeMediaWrites = 0;
let reservedMediaCapacityBytes = 0;
let mediaCapacityTail: Promise<void> = Promise.resolve();

async function acquireMediaWriteSlot(): Promise<() => void> {
  if (activeMediaWrites >= MEDIA_STORAGE_WRITE_CONCURRENCY) {
    if (mediaWriteWaiters.length >= MEDIA_STORAGE_WRITE_QUEUE_LIMIT) {
      throw new MediaStorageBusyError();
    }
    await new Promise<void>((resolveWaiter) => mediaWriteWaiters.push(resolveWaiter));
  } else {
    activeMediaWrites++;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = mediaWriteWaiters.shift();
    if (next) next();
    else activeMediaWrites--;
  };
}

async function withMediaWriteSlot<T>(work: () => Promise<T>): Promise<T> {
  const release = await acquireMediaWriteSlot();
  try {
    return await work();
  } finally {
    release();
  }
}

async function withMediaCapacityLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = mediaCapacityTail;
  let release!: () => void;
  mediaCapacityTail = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

async function withMediaWriteLock<T>(storageHash: string, work: () => Promise<T>): Promise<T> {
  const previous = mediaWriteTails.get(storageHash) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  mediaWriteTails.set(storageHash, tail);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (mediaWriteTails.get(storageHash) === tail) mediaWriteTails.delete(storageHash);
  }
}

let indexDbPromise: Promise<Database> | null = null;
let rebuildPromise: Promise<void> | null = null;

try {
  if (!existsSync(STORAGE_ROOT) && existsSync(LEGACY_ROOT)) {
    const { rename } = await import("node:fs/promises");
    await mkdir(dirname(STORAGE_ROOT), { recursive: true });
    await rename(LEGACY_ROOT, STORAGE_ROOT);
  }
  await mkdir(STORAGE_ROOT, { recursive: true });
  for (const dir of Object.values(TYPE_ROOTS)) await mkdir(dir, { recursive: true });
} catch {
  /* Startup continues; individual operations report their own I/O failures. */
}

function key(accountId: string, chatMid: string, messageId: string): string {
  return createHash("sha256").update(`${accountId}:${chatMid}:${messageId}`).digest("hex");
}

function memoryKey(accountId: string, chatMid: string, messageId: string): string {
  return `${accountId}:${chatMid}:${messageId}`;
}

function extFromContentType(ct: string): string {
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("mp4")) return ".mp4";
  if (ct.includes("m4a") || ct.includes("mp4a") || ct.includes("audio")) return ".m4a";
  if (ct.includes("pdf")) return ".pdf";
  return ".bin";
}

function contentTypeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".m4a")) return "audio/m4a";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function mediaTypeForContentType(ct: string): MediaStorageType {
  const lower = ct.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("audio/")) return "audio";
  return "file";
}

function typeRootForContentType(ct: string): string {
  return TYPE_ROOTS[mediaTypeForContentType(ct)];
}

function diskPath(accountId: string, chatMid: string, messageId: string, ct: string): string {
  const hash = key(accountId, chatMid, messageId);
  return join(typeRootForContentType(ct), hash.slice(0, 2), `${hash}${extFromContentType(ct)}`);
}

function isStoredMediaPath(path: string): boolean {
  const candidate = resolve(path);
  for (const root of [STORAGE_ROOT, LEGACY_ROOT]) {
    const rel = relative(resolve(root), candidate);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return true;
  }
  return false;
}

async function storedMediaFileStat(path: string) {
  if (!isStoredMediaPath(path)) return null;
  let info;
  let actualPath: string;
  try {
    info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    actualPath = await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  for (const root of [STORAGE_ROOT, LEGACY_ROOT]) {
    try {
      const actualRoot = await realpath(root);
      const rel = relative(actualRoot, actualPath);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return info;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function mediaIndexDb(): Promise<Database> {
  indexDbPromise ??= (async () => {
    await mkdir(dirname(MEDIA_INDEX_PATH), { recursive: true });
    const db = new Database(MEDIA_INDEX_PATH, { create: true, strict: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA wal_autocheckpoint = 1000");
    db.exec("PRAGMA journal_size_limit = 8388608");
    db.exec("PRAGMA cache_size = -2048");
    db.exec("PRAGMA mmap_size = 0");
    db.exec("PRAGMA temp_store = FILE");
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_index (
        path TEXT PRIMARY KEY,
        storage_hash TEXT NOT NULL,
        account_id TEXT,
        chat_mid TEXT,
        message_id TEXT,
        size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
        content_type TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'audio', 'file')),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_index_account_size
        ON media_index(account_id, size_bytes);
      CREATE INDEX IF NOT EXISTS idx_media_index_type_size
        ON media_index(media_type, size_bytes);
      CREATE TABLE IF NOT EXISTS media_index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const hashIndex = db
      .query(
        "SELECT [unique] AS is_unique FROM pragma_index_list('media_index') WHERE name = 'idx_media_index_hash'",
      )
      .get() as { is_unique: number } | null;
    if (hashIndex?.is_unique !== 1) {
      withIndexTransaction(db, () => {
        db.exec(`
          DROP INDEX IF EXISTS idx_media_index_hash;
          DELETE FROM media_index
          WHERE rowid NOT IN (
            SELECT MAX(rowid) FROM media_index GROUP BY storage_hash
          );
          CREATE UNIQUE INDEX idx_media_index_hash ON media_index(storage_hash);
        `);
      });
    }
    return db;
  })();
  return indexDbPromise;
}

function withIndexTransaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* Preserve the original error. */
    }
    throw error;
  }
}

function upsertIndexRow(db: Database, row: IndexedMediaRow): string | null {
  const previous = db
    .query("SELECT path FROM media_index WHERE storage_hash = ?")
    .get(row.storage_hash) as { path: string } | null;
  db.query(`
    INSERT INTO media_index (
      path, storage_hash, account_id, chat_mid, message_id,
      size_bytes, content_type, media_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(storage_hash) DO UPDATE SET
      path = excluded.path,
      account_id = COALESCE(excluded.account_id, media_index.account_id),
      chat_mid = COALESCE(excluded.chat_mid, media_index.chat_mid),
      message_id = COALESCE(excluded.message_id, media_index.message_id),
      size_bytes = excluded.size_bytes,
      content_type = excluded.content_type,
      media_type = excluded.media_type
  `).run(
    row.path,
    row.storage_hash,
    row.account_id,
    row.chat_mid,
    row.message_id,
    row.size_bytes,
    row.content_type,
    row.media_type,
    Date.now(),
  );
  return previous && previous.path !== row.path ? previous.path : null;
}

async function removeSupersededMediaPath(path: string | null): Promise<void> {
  if (!path || !isStoredMediaPath(path)) return;
  await rm(path, { force: true }).catch((error) => {
    log.warn({ error, path }, "superseded media file cleanup failed");
  });
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
}

async function* physicalMediaFiles(): AsyncGenerator<IndexedMediaRow> {
  const roots = new Map<string, MediaStorageType | null>();
  roots.set(resolve(STORAGE_ROOT), null);
  if (existsSync(LEGACY_ROOT)) roots.set(resolve(LEGACY_ROOT), null);
  for (const [type, root] of Object.entries(TYPE_ROOTS) as Array<[MediaStorageType, string]>) {
    roots.set(resolve(root), type);
  }

  for (const [root, fixedType] of roots) {
    let prefixes;
    try {
      prefixes = await opendir(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for await (const prefix of prefixes) {
      if (!prefix.isDirectory() || !/^[0-9a-f]{2}$/i.test(prefix.name)) continue;
      const prefixPath = join(root, prefix.name);
      let entries;
      try {
        entries = await opendir(prefixPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for await (const entry of entries) {
        if (!entry.isFile()) continue;
        const storageHash = entry.name.split(".", 1)[0];
        if (!storageHash || !/^[0-9a-f]{64}$/i.test(storageHash)) continue;
        const path = join(prefixPath, entry.name);
        try {
          const sizeBytes = (await stat(path)).size;
          const contentType = contentTypeFromFilename(entry.name);
          yield {
            path,
            storage_hash: storageHash,
            account_id: null,
            chat_mid: null,
            message_id: null,
            size_bytes: sizeBytes,
            content_type: contentType,
            media_type: fixedType ?? mediaTypeForContentType(contentType),
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  }
}

async function registeredAccountIds(): Promise<string[]> {
  try {
    const raw = JSON.parse(await readFile(join(DATA_ROOT, "accounts.json"), "utf8")) as {
      accounts?: Array<{ accountId?: unknown }>;
    };
    return [
      ...new Set(
        (raw.accounts ?? [])
          .map((entry) => (typeof entry.accountId === "string" ? entry.accountId : ""))
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

async function attributeExistingMedia(db: Database): Promise<void> {
  const candidateRows = db
    .query("SELECT DISTINCT storage_hash FROM media_index WHERE account_id IS NULL LIMIT ?")
    .all(MAX_REBUILD_HASH_SET + 1) as Array<{ storage_hash: string }>;
  if (candidateRows.length === 0) return;
  const candidateHashes =
    candidateRows.length <= MAX_REBUILD_HASH_SET
      ? new Set(candidateRows.map((row) => row.storage_hash))
      : null;
  const candidateExists = db.query(
    "SELECT 1 AS found FROM media_index WHERE account_id IS NULL AND storage_hash = ? LIMIT 1",
  );
  const claim = db.query(`
    UPDATE media_index
    SET account_id = ?, chat_mid = ?, message_id = ?
    WHERE account_id IS NULL AND storage_hash = ?
  `);
  for (const accountId of await registeredAccountIds()) {
    if (candidateHashes?.size === 0) return;
    const path = accountFile(accountId, "chatdb.sqlite");
    if (!existsSync(path)) continue;
    const chatDb = new Database(path, { readonly: true, safeIntegers: false, strict: true });
    try {
      chatDb.exec("PRAGMA cache_size = -1024");
      chatDb.exec("PRAGMA mmap_size = 0");
      chatDb.exec("PRAGMA temp_store = FILE");
      const rows = chatDb.query("SELECT chat_mid, id FROM messages").iterate() as IterableIterator<{
        chat_mid: string;
        id: string;
      }>;
      let pending: Array<{ chatMid: string; id: string; hash: string }> = [];
      const flush = () => {
        if (pending.length === 0) return;
        withIndexTransaction(db, () => {
          for (const row of pending) {
            claim.run(accountId, row.chatMid, row.id, row.hash);
            candidateHashes?.delete(row.hash);
          }
        });
        pending = [];
      };
      for (const row of rows) {
        if (candidateHashes?.size === 0) break;
        const hash = key(accountId, row.chat_mid, row.id);
        const isCandidate = candidateHashes
          ? candidateHashes.has(hash)
          : candidateExists.get(hash) != null;
        if (!isCandidate) continue;
        pending.push({
          chatMid: row.chat_mid,
          id: row.id,
          hash,
        });
        if (pending.length >= INDEX_BATCH_SIZE) {
          flush();
          await yieldToEventLoop();
        }
      }
      flush();
    } catch (error) {
      log.debug({ error, accountId }, "media index ownership rebuild skipped");
    } finally {
      chatDb.close();
    }
  }
}

async function rebuildMediaIndex(db: Database): Promise<void> {
  // A missing/version-mismatched marker means the previous build was never complete.
  // Start clean so a crash-retry cannot retain rows for files that disappeared meanwhile.
  withIndexTransaction(db, () => db.exec("DELETE FROM media_index"));
  let pending: IndexedMediaRow[] = [];
  let indexed = 0;
  const flush = () => {
    if (pending.length === 0) return;
    withIndexTransaction(db, () => {
      for (const row of pending) upsertIndexRow(db, row);
    });
    indexed += pending.length;
    pending = [];
  };
  for await (const row of physicalMediaFiles()) {
    pending.push(row);
    if (pending.length >= INDEX_BATCH_SIZE) {
      flush();
      await yieldToEventLoop();
    }
  }
  flush();
  await attributeExistingMedia(db);
  db.query(`
    INSERT INTO media_index_meta(key, value) VALUES ('version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(MEDIA_INDEX_VERSION);
  log.info({ indexed }, "media index rebuilt");
}

async function ensureMediaIndex(): Promise<Database> {
  const db = await mediaIndexDb();
  const version = db.query("SELECT value FROM media_index_meta WHERE key = 'version'").get() as {
    value: string;
  } | null;
  if (version?.value === MEDIA_INDEX_VERSION) return db;
  rebuildPromise ??= rebuildMediaIndex(db).finally(() => {
    rebuildPromise = null;
  });
  await rebuildPromise;
  return db;
}

function forgetMemoryEntry(memKey: string): void {
  const entry = memory.get(memKey);
  if (!entry) return;
  memory.delete(memKey);
  memoryBytes = Math.max(0, memoryBytes - entry.buf.byteLength);
}

function remember(memKey: string, buf: Uint8Array, contentType: string): void {
  forgetMemoryEntry(memKey);
  if (buf.byteLength > MEMORY_MAX_ITEM_BYTES || buf.byteLength > MEMORY_BUDGET_BYTES) return;
  while (memoryBytes + buf.byteLength > MEMORY_BUDGET_BYTES && memory.size > 0) {
    const oldest = memory.keys().next().value as string | undefined;
    if (oldest == null) break;
    forgetMemoryEntry(oldest);
  }
  const retained = buf.slice();
  memory.set(memKey, {
    buf: retained,
    contentType,
    mediaType: mediaTypeForContentType(contentType),
    at: Date.now(),
  });
  memoryBytes += retained.byteLength;
}

function readMemory(memKey: string): { buf: Uint8Array; contentType: string } | null {
  const entry = memory.get(memKey);
  if (!entry) return null;
  if (Date.now() - entry.at >= MEMORY_TTL_MS) {
    forgetMemoryEntry(memKey);
    return null;
  }
  memory.delete(memKey);
  entry.at = Date.now();
  memory.set(memKey, entry);
  return { buf: entry.buf.slice(), contentType: entry.contentType };
}

/** Diagnostics/tests: the cache never exceeds the byte budget. */
export function getMediaMemoryCacheStats(): {
  entries: number;
  bytes: number;
  budgetBytes: number;
  maxItemBytes: number;
} {
  return {
    entries: memory.size,
    bytes: memoryBytes,
    budgetBytes: MEMORY_BUDGET_BYTES,
    maxItemBytes: MEMORY_MAX_ITEM_BYTES,
  };
}

async function findPhysicalMedia(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<MediaStorageStat | null> {
  const hash = key(accountId, chatMid, messageId);
  const roots = new Set([STORAGE_ROOT, LEGACY_ROOT, ...Object.values(TYPE_ROOTS)]);
  for (const root of roots) {
    const dir = join(root, hash.slice(0, 2));
    const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    const entry = entries.find(
      (candidate) => candidate.isFile() && candidate.name.startsWith(`${hash}.`),
    );
    if (!entry) continue;
    const path = join(dir, entry.name);
    const sizeBytes = (await stat(path)).size;
    const contentType = contentTypeFromFilename(entry.name);
    const mediaType = mediaTypeForContentType(contentType);
    const db = await mediaIndexDb();
    upsertIndexRow(db, {
      path,
      storage_hash: hash,
      account_id: accountId,
      chat_mid: chatMid,
      message_id: messageId,
      size_bytes: sizeBytes,
      content_type: contentType,
      media_type: mediaType,
    });
    return { path, sizeBytes, contentType, mediaType };
  }
  return null;
}

/** Resolve saved media to a disk path without reading the body into RAM. */
export async function statMediaStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<MediaStorageStat | null> {
  const db = await ensureMediaIndex();
  const hash = key(accountId, chatMid, messageId);
  const rows = db
    .query(`
      SELECT path, storage_hash, account_id, chat_mid, message_id,
             size_bytes, content_type, media_type
      FROM media_index
      WHERE storage_hash = ?
      ORDER BY created_at DESC
    `)
    .all(hash) as IndexedMediaRow[];
  for (const row of rows) {
    if (!isStoredMediaPath(row.path)) {
      db.query("DELETE FROM media_index WHERE path = ?").run(row.path);
      continue;
    }
    try {
      const info = await storedMediaFileStat(row.path);
      if (!info) {
        db.query("DELETE FROM media_index WHERE path = ?").run(row.path);
        continue;
      }
      if (
        row.account_id !== accountId ||
        row.chat_mid !== chatMid ||
        row.message_id !== messageId ||
        row.size_bytes !== info.size
      ) {
        db.query(`
          UPDATE media_index
          SET account_id = ?, chat_mid = ?, message_id = ?, size_bytes = ?
          WHERE path = ?
        `).run(accountId, chatMid, messageId, info.size, row.path);
      }
      return {
        path: row.path,
        sizeBytes: info.size,
        contentType: row.content_type,
        mediaType: row.media_type,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      db.query("DELETE FROM media_index WHERE path = ?").run(row.path);
    }
  }
  return findPhysicalMedia(accountId, chatMid, messageId);
}

/**
 * Stream one account's indexed media metadata without materializing all rows.
 * Backup writers can copy each yielded path disk-to-disk. Index rows outside the
 * managed roots, symlinks, and files removed behind Vyline's back are ignored and
 * pruned from the index in bounded batches.
 */
export async function* iterateAccountMediaStorage(
  accountId: string,
  selectedMids?: ReadonlySet<string>,
): AsyncGenerator<AccountMediaStorageEntry> {
  const writer = await ensureMediaIndex();
  const reader = new Database(MEDIA_INDEX_PATH, { readonly: true, strict: true });
  reader.exec("PRAGMA query_only = ON");
  reader.exec("PRAGMA cache_size = -1024");
  reader.exec("PRAGMA mmap_size = 0");
  const stalePaths: string[] = [];
  const pruneStale = () => {
    if (stalePaths.length === 0) return;
    withIndexTransaction(writer, () => {
      const remove = writer.query("DELETE FROM media_index WHERE path = ?");
      for (const path of stalePaths) remove.run(path);
    });
    stalePaths.length = 0;
  };

  try {
    const rows = reader
      .query(`
        SELECT path, chat_mid, message_id, size_bytes, content_type
        FROM media_index
        WHERE account_id = ?
      `)
      .iterate(accountId) as IterableIterator<{
      path: string;
      chat_mid: string | null;
      message_id: string | null;
      size_bytes: number;
      content_type: string;
    }>;
    for (const row of rows) {
      if (!row.chat_mid || !row.message_id) continue;
      if (selectedMids && !selectedMids.has(row.chat_mid)) continue;
      if (!isStoredMediaPath(row.path)) {
        stalePaths.push(row.path);
      } else {
        try {
          const info = await storedMediaFileStat(row.path);
          if (!info) {
            stalePaths.push(row.path);
          } else {
            if (info.size !== row.size_bytes) {
              writer
                .query("UPDATE media_index SET size_bytes = ? WHERE path = ?")
                .run(info.size, row.path);
            }
            yield {
              chatMid: row.chat_mid,
              messageId: row.message_id,
              path: row.path,
              sizeBytes: info.size,
              contentType: row.content_type,
            };
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          stalePaths.push(row.path);
        }
      }
      if (stalePaths.length >= 256) pruneStale();
    }
  } finally {
    reader.close();
    pruneStale();
  }
}

/** Compatibility API for small consumers. Large HTTP responses use statMediaStorage + Bun.file. */
export async function readMediaStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<{ buf: Uint8Array; contentType: string } | null> {
  const memKey = memoryKey(accountId, chatMid, messageId);
  const cached = readMemory(memKey);
  if (cached) return cached;
  const media = await statMediaStorage(accountId, chatMid, messageId);
  if (!media) return null;
  const buf = new Uint8Array(await readFile(media.path));
  remember(memKey, buf, media.contentType);
  return { buf, contentType: media.contentType };
}

/** Import large attachments disk-to-disk without buffering or overwriting saved media. */
export async function importMediaStorageFile(
  accountId: string,
  chatMid: string,
  messageId: string,
  sourcePath: string,
  contentType: string,
): Promise<boolean> {
  const storageHash = key(accountId, chatMid, messageId);
  return await withMediaWriteLock(storageHash, async () => {
    if (await statMediaStorage(accountId, chatMid, messageId)) return false;
    return await withMediaWriteSlot(async () => {
      const source = await lstat(sourcePath);
      if (!source.isFile()) throw new Error("media import source is not a regular file");
      assertMediaCapacityBytes(source.size);

      const path = diskPath(accountId, chatMid, messageId, contentType);
      const directory = dirname(path);
      await mkdir(directory, { recursive: true });
      const capacity = mediaCapacityReservation(directory);
      let ownsDestination = false;
      try {
        // The source may be on /app/data while this destination is a separate
        // /app/storage volume. Always reserve against the latter before copy.
        await assertMediaDiskCapacity(directory, source.size);
        await capacity.increase(source.size);
        const destination = await open(path, "wx", 0o600);
        ownsDestination = true;
        await destination.close();
        await copyFile(sourcePath, path);
        const copied = await lstat(path);
        if (!copied.isFile() || copied.size !== source.size) {
          throw new Error("imported media file size is invalid");
        }
        capacity.consume(source.size);

        const db = await ensureMediaIndex();
        const superseded = upsertIndexRow(db, {
          path,
          storage_hash: storageHash,
          account_id: accountId,
          chat_mid: chatMid,
          message_id: messageId,
          size_bytes: source.size,
          content_type: contentType,
          media_type: mediaTypeForContentType(contentType),
        });
        await removeSupersededMediaPath(superseded);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST" && !ownsDestination) return false;
        if (ownsDestination) await rm(path, { force: true }).catch(() => undefined);
        throw error;
      } finally {
        capacity.release();
      }
    });
  });
}

export async function removeMediaStorageEntry(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<boolean> {
  const storageHash = key(accountId, chatMid, messageId);
  return await withMediaWriteLock(storageHash, async () => {
    const media = await statMediaStorage(accountId, chatMid, messageId);
    if (!media) return false;
    await rm(media.path, { force: true });
    const db = await ensureMediaIndex();
    db.query("DELETE FROM media_index WHERE storage_hash = ?").run(storageHash);
    forgetMemoryEntry(memoryKey(accountId, chatMid, messageId));
    return true;
  });
}

type MessageRefMap = Record<string, Record<string, { id: string }>>;

/** Account usage is an indexed SUM; messages remains for source/API compatibility. */
export async function getAccountMediaStorageSize(
  accountId: string,
  messages?: MessageRefMap,
): Promise<number> {
  void messages;
  const db = await ensureMediaIndex();
  const row = db
    .query("SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM media_index WHERE account_id = ?")
    .get(accountId) as { bytes: number };
  return Number(row.bytes);
}

function assertMediaObjectBytes(bytes: number, allowEmpty = false): void {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < (allowEmpty ? 0 : 1) ||
    bytes > MEDIA_STORAGE_MAX_OBJECT_BYTES
  ) {
    throw new MediaStorageObjectLimitError();
  }
}

function assertMediaCapacityBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > BACKUP_STORAGE_LIMIT_BYTES) {
    throw new MediaStorageCapacityError("media storage capacity request is invalid");
  }
}

async function assertMediaDiskCapacityUnlocked(directory: string, pendingBytes = 0): Promise<void> {
  assertMediaCapacityBytes(pendingBytes);
  const filesystem = await statfs(directory);
  const availableBytes = BigInt(filesystem.bavail) * BigInt(filesystem.bsize);
  const requiredBytes =
    BigInt(MEDIA_STORAGE_MIN_FREE_BYTES) +
    BigInt(reservedMediaCapacityBytes) +
    BigInt(pendingBytes);
  if (availableBytes < requiredBytes) throw new MediaStorageCapacityError();
}

async function assertMediaDiskCapacity(directory: string, pendingBytes = 0): Promise<void> {
  await withMediaCapacityLock(() => assertMediaDiskCapacityUnlocked(directory, pendingBytes));
}

/**
 * Preflight capacity on the saved-media destination filesystem. Restore plans
 * may request up to the account allowance; the smaller remote-object limit is
 * intentionally not applied here.
 */
export async function assertMediaStorageCapacity(requiredBytes = 0): Promise<void> {
  assertMediaCapacityBytes(requiredBytes);
  await mkdir(STORAGE_ROOT, { recursive: true });
  await assertMediaDiskCapacity(STORAGE_ROOT, requiredBytes);
}

interface MediaCapacityReservation {
  readonly bytes: number;
  increase(bytes: number): Promise<void>;
  consume(bytes: number): void;
  release(): void;
}

function mediaCapacityReservation(directory: string): MediaCapacityReservation {
  let bytes = 0;
  let released = false;
  return {
    get bytes() {
      return bytes;
    },
    async increase(increment) {
      if (released) throw new Error("media capacity reservation is already released");
      assertMediaCapacityBytes(increment);
      if (increment === 0) return;
      await withMediaCapacityLock(async () => {
        await assertMediaDiskCapacityUnlocked(directory, increment);
        reservedMediaCapacityBytes += increment;
        bytes += increment;
      });
    },
    consume(consumed) {
      if (!Number.isSafeInteger(consumed) || consumed < 0 || consumed > bytes) {
        throw new Error("media capacity reservation consumption is invalid");
      }
      reservedMediaCapacityBytes -= consumed;
      bytes -= consumed;
    },
    release() {
      if (released) return;
      released = true;
      reservedMediaCapacityBytes -= bytes;
      bytes = 0;
    },
  };
}

async function fillMediaCapacityWindow(
  reservation: MediaCapacityReservation,
  pendingBytes: number,
  remainingAllowedBytes: number,
): Promise<void> {
  assertMediaObjectBytes(pendingBytes);
  assertMediaObjectBytes(remainingAllowedBytes);
  if (reservation.bytes >= pendingBytes) return;
  const shortage = pendingBytes - reservation.bytes;
  const desiredBytes = Math.max(
    pendingBytes,
    Math.min(MEDIA_CAPACITY_CHECK_INTERVAL_BYTES, remainingAllowedBytes),
  );
  const preferredIncrement = desiredBytes - reservation.bytes;
  try {
    await reservation.increase(preferredIncrement);
  } catch (error) {
    if (!(error instanceof MediaStorageCapacityError) || preferredIncrement === shortage) {
      throw error;
    }
    // Near the floor, accept a final smaller chunk when it alone still fits.
    await reservation.increase(shortage);
  }
}

export interface MediaStorageProducedFileGuard {
  readonly maxBytes: number;
  beforeWrite(nextTotalBytes: number, pendingBytes: number): Promise<void>;
}

function mediaProducedFileGuard(directory: string): MediaStorageProducedFileGuard & {
  guardedBytes(): number;
  finish(): void;
  release(): void;
} {
  let guardedBytes = 0;
  let pendingWriteBytes = 0;
  const reservation = mediaCapacityReservation(directory);
  return {
    maxBytes: MEDIA_STORAGE_MAX_OBJECT_BYTES,
    guardedBytes: () => guardedBytes,
    finish() {
      reservation.consume(pendingWriteBytes);
      pendingWriteBytes = 0;
      reservation.release();
    },
    release() {
      reservation.release();
    },
    async beforeWrite(nextTotalBytes, pendingBytes) {
      reservation.consume(pendingWriteBytes);
      pendingWriteBytes = 0;
      assertMediaObjectBytes(nextTotalBytes);
      assertMediaObjectBytes(pendingBytes);
      if (nextTotalBytes !== guardedBytes + pendingBytes) {
        throw new Error("produced media progress is invalid");
      }
      await fillMediaCapacityWindow(
        reservation,
        pendingBytes,
        MEDIA_STORAGE_MAX_OBJECT_BYTES - guardedBytes,
      );
      pendingWriteBytes = pendingBytes;
      guardedBytes = nextTotalBytes;
    },
  };
}

export async function writeMediaStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
  buf: Uint8Array,
  contentType: string,
): Promise<void> {
  assertMediaObjectBytes(buf.byteLength);
  const storageHash = key(accountId, chatMid, messageId);
  try {
    await withMediaWriteLock(storageHash, () =>
      withMediaWriteSlot(async () => {
        const normalizedContentType = contentType.trim() || "application/octet-stream";
        const path = diskPath(accountId, chatMid, messageId, normalizedContentType);
        const directory = dirname(path);
        await mkdir(directory, { recursive: true });
        const capacity = mediaCapacityReservation(directory);
        const temporaryPath = join(directory, `.media-${process.pid}-${randomUUID()}.partial`);
        let previousPath: string | undefined;
        let previousTemporaryPath: string | undefined;
        let previousMoved = false;
        let promoted = false;
        let indexed = false;
        try {
          await capacity.increase(buf.byteLength);
          const existing = await statMediaStorage(accountId, chatMid, messageId);
          previousPath = existing?.path;
          previousTemporaryPath = previousPath
            ? join(dirname(previousPath), `.media-${process.pid}-${randomUUID()}.previous`)
            : undefined;
          await writeFile(temporaryPath, buf, { flag: "wx", mode: 0o600 });
          capacity.consume(buf.byteLength);
          if (previousPath && previousTemporaryPath) {
            await rename(previousPath, previousTemporaryPath);
            previousMoved = true;
          }
          await rename(temporaryPath, path);
          promoted = true;
          const db = await ensureMediaIndex();
          upsertIndexRow(db, {
            path,
            storage_hash: storageHash,
            account_id: accountId,
            chat_mid: chatMid,
            message_id: messageId,
            size_bytes: buf.byteLength,
            content_type: normalizedContentType,
            media_type: mediaTypeForContentType(normalizedContentType),
          });
          indexed = true;
          if (previousTemporaryPath) {
            await rm(previousTemporaryPath, { force: true }).catch((error) => {
              log.warn({ error, previousTemporaryPath }, "replaced media cleanup failed");
            });
          }
          remember(memoryKey(accountId, chatMid, messageId), buf, normalizedContentType);
        } catch (error) {
          if (promoted && !indexed) await rm(path, { force: true }).catch(() => undefined);
          if (previousMoved && previousPath && previousTemporaryPath) {
            await rename(previousTemporaryPath, previousPath).catch(() => undefined);
          }
          throw error;
        } finally {
          if (!promoted) await rm(temporaryPath, { force: true }).catch(() => undefined);
          capacity.release();
        }
      }),
    );
  } catch (err) {
    log.warn({ err, messageId }, "media storage write failed");
    throw err;
  }
}

async function writeStreamChunk(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error("media storage write made no progress");
    offset += bytesWritten;
  }
}

/**
 * Persist a network body without materializing it in the JS heap. The temporary
 * file lives beside the final file, so rename never crosses a filesystem boundary.
 */
export async function writeMediaStorageStream(
  accountId: string,
  chatMid: string,
  messageId: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
  expectedBytes?: number,
): Promise<MediaStorageStat> {
  const storageHash = key(accountId, chatMid, messageId);
  return await withMediaWriteLock(storageHash, async () => {
    const existing = await statMediaStorage(accountId, chatMid, messageId);
    if (existing) {
      await body.cancel("media already stored").catch(() => undefined);
      return existing;
    }
    if (expectedBytes !== undefined) {
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
        const error = new Error("invalid media Content-Length");
        await body.cancel(error).catch(() => undefined);
        throw error;
      }
      if (expectedBytes > MEDIA_STORAGE_MAX_OBJECT_BYTES) {
        const error = new MediaStorageObjectLimitError();
        await body.cancel(error).catch(() => undefined);
        throw error;
      }
    }

    try {
      return await withMediaWriteSlot(async () => {
        const normalizedContentType = contentType.trim() || "application/octet-stream";
        const path = diskPath(accountId, chatMid, messageId, normalizedContentType);
        const directory = dirname(path);
        await mkdir(directory, { recursive: true });
        const temporaryPath = join(directory, `.media-${process.pid}-${randomUUID()}.partial`);
        const capacity = mediaCapacityReservation(directory);
        let handle: Awaited<ReturnType<typeof open>> | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let readerDone = false;
        let total = 0;
        let promoted = false;
        let indexed = false;
        try {
          // Reject an impossible declared body before opening or pulling it. The
          // rolling reservation below closes races with other active objects.
          await assertMediaDiskCapacity(directory, expectedBytes ?? 0);
          handle = await open(temporaryPath, "wx", 0o600);
          reader = body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              readerDone = true;
              break;
            }
            if (!value || value.byteLength === 0) continue;
            const nextTotal = total + value.byteLength;
            assertMediaObjectBytes(nextTotal);
            if (expectedBytes !== undefined && nextTotal > expectedBytes) {
              throw new Error(
                `media body length mismatch: expected ${expectedBytes}, received more data`,
              );
            }
            await fillMediaCapacityWindow(
              capacity,
              value.byteLength,
              (expectedBytes ?? MEDIA_STORAGE_MAX_OBJECT_BYTES) - total,
            );
            await writeStreamChunk(handle, value);
            capacity.consume(value.byteLength);
            total = nextTotal;
          }
          if (total === 0) throw new Error("media download returned empty body");
          if (expectedBytes !== undefined && total !== expectedBytes) {
            throw new Error(
              `media body length mismatch: expected ${expectedBytes}, received ${total}`,
            );
          }
          await handle.close();
          handle = undefined;

          // A concurrent process may have completed while this body was downloading.
          const raced = await statMediaStorage(accountId, chatMid, messageId);
          if (raced) return raced;

          try {
            await rename(temporaryPath, path);
            promoted = true;
          } catch (error) {
            const winner = await statMediaStorage(accountId, chatMid, messageId);
            if (winner) return winner;
            throw error;
          }

          const mediaType = mediaTypeForContentType(normalizedContentType);
          const db = await ensureMediaIndex();
          const superseded = upsertIndexRow(db, {
            path,
            storage_hash: storageHash,
            account_id: accountId,
            chat_mid: chatMid,
            message_id: messageId,
            size_bytes: total,
            content_type: normalizedContentType,
            media_type: mediaType,
          });
          indexed = true;
          await removeSupersededMediaPath(superseded);
          return { path, sizeBytes: total, contentType: normalizedContentType, mediaType };
        } catch (error) {
          if (reader && !readerDone) await reader.cancel(error).catch(() => undefined);
          else if (!reader) await body.cancel(error).catch(() => undefined);
          if (promoted && !indexed) await rm(path, { force: true }).catch(() => undefined);
          throw error;
        } finally {
          await handle?.close().catch(() => undefined);
          try {
            reader?.releaseLock();
          } catch {
            // Cancellation can release the reader while propagating an abort.
          }
          if (!promoted) await rm(temporaryPath, { force: true }).catch(() => undefined);
          capacity.release();
        }
      });
    } catch (error) {
      // Queue rejection happens before a reader exists, so explicitly release
      // the upstream response instead of leaving a socket/body pending.
      await body.cancel(error).catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Let an authenticated decoder write directly into an unpublished sibling file,
 * then atomically expose and index it. The producer must create `temporaryPath`
 * itself and return the exact number of plaintext bytes written.
 */
export async function writeMediaStorageProducedFile(
  accountId: string,
  chatMid: string,
  messageId: string,
  contentType: string,
  produce: (temporaryPath: string, guard: MediaStorageProducedFileGuard) => Promise<number>,
): Promise<MediaStorageStat> {
  const storageHash = key(accountId, chatMid, messageId);
  return await withMediaWriteLock(storageHash, async () => {
    const existing = await statMediaStorage(accountId, chatMid, messageId);
    if (existing) return existing;

    return await withMediaWriteSlot(async () => {
      const normalizedContentType = contentType.trim() || "application/octet-stream";
      const path = diskPath(accountId, chatMid, messageId, normalizedContentType);
      const directory = dirname(path);
      await mkdir(directory, { recursive: true });
      const temporaryPath = join(directory, `.media-${process.pid}-${randomUUID()}.partial`);
      const guard = mediaProducedFileGuard(directory);
      let promoted = false;
      let indexed = false;
      try {
        await assertMediaDiskCapacity(directory);
        const producedBytes = await produce(temporaryPath, guard);
        guard.finish();
        const info = await lstat(temporaryPath);
        assertMediaObjectBytes(producedBytes);
        if (
          !info.isFile() ||
          info.size !== producedBytes ||
          guard.guardedBytes() !== producedBytes
        ) {
          throw new Error("produced media file size is invalid");
        }

        const raced = await statMediaStorage(accountId, chatMid, messageId);
        if (raced) return raced;

        try {
          await rename(temporaryPath, path);
          promoted = true;
        } catch (error) {
          const winner = await statMediaStorage(accountId, chatMid, messageId);
          if (winner) return winner;
          throw error;
        }

        const mediaType = mediaTypeForContentType(normalizedContentType);
        const db = await ensureMediaIndex();
        const superseded = upsertIndexRow(db, {
          path,
          storage_hash: storageHash,
          account_id: accountId,
          chat_mid: chatMid,
          message_id: messageId,
          size_bytes: producedBytes,
          content_type: normalizedContentType,
          media_type: mediaType,
        });
        indexed = true;
        await removeSupersededMediaPath(superseded);
        return {
          path,
          sizeBytes: producedBytes,
          contentType: normalizedContentType,
          mediaType,
        };
      } catch (error) {
        if (promoted && !indexed) await rm(path, { force: true }).catch(() => undefined);
        throw error;
      } finally {
        if (!promoted) {
          await rm(temporaryPath, { force: true, recursive: true }).catch(() => undefined);
        }
        guard.release();
      }
    });
  });
}

export async function ensureMediaStorageDir(): Promise<void> {
  await mkdir(STORAGE_ROOT, { recursive: true });
  await ensureMediaIndex();
}

async function clearIndexedMedia(mediaType?: MediaStorageType): Promise<number> {
  const db = await ensureMediaIndex();
  let removed = 0;
  for (;;) {
    const rows = (
      mediaType
        ? db.query("SELECT path FROM media_index WHERE media_type = ? LIMIT 256").all(mediaType)
        : db.query("SELECT path FROM media_index LIMIT 256").all()
    ) as Array<{ path: string }>;
    if (rows.length === 0) break;
    const deleted: string[] = [];
    for (const row of rows) {
      if (!isStoredMediaPath(row.path)) {
        deleted.push(row.path);
        continue;
      }
      try {
        const info = await storedMediaFileStat(row.path);
        if (!info) {
          deleted.push(row.path);
          continue;
        }
        await rm(row.path, { force: true });
        deleted.push(row.path);
        removed++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          deleted.push(row.path);
          continue;
        }
        throw error;
      }
    }
    withIndexTransaction(db, () => {
      const statement = db.query("DELETE FROM media_index WHERE path = ?");
      for (const path of deleted) statement.run(path);
    });
    await yieldToEventLoop();
  }
  return removed;
}

async function clearPhysicalMedia(mediaType?: MediaStorageType): Promise<number> {
  let removed = 0;
  for await (const row of physicalMediaFiles()) {
    if (mediaType && row.media_type !== mediaType) continue;
    try {
      await rm(row.path, { force: true });
      removed++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (removed % INDEX_BATCH_SIZE === 0) await yieldToEventLoop();
  }
  if (mediaType) {
    await rm(TYPE_ROOTS[mediaType], { recursive: true, force: true });
  } else {
    await Promise.all([
      rm(STORAGE_ROOT, { recursive: true, force: true }),
      rm(LEGACY_ROOT, { recursive: true, force: true }),
    ]);
  }
  return removed;
}

export async function clearMediaStorage(): Promise<number> {
  memory.clear();
  memoryBytes = 0;
  const indexedRemoved = await clearIndexedMedia();
  const orphanRemoved = await clearPhysicalMedia();
  const removed = indexedRemoved + orphanRemoved;
  log.info({ removed, root: STORAGE_ROOT }, "media storage cleared");
  return removed;
}

export async function clearMediaStorageType(type: MediaStorageType): Promise<number> {
  for (const [memKey, entry] of memory) {
    if (entry.mediaType === type) forgetMemoryEntry(memKey);
  }
  const indexedRemoved = await clearIndexedMedia(type);
  const orphanRemoved = await clearPhysicalMedia(type);
  const removed = indexedRemoved + orphanRemoved;
  log.info({ removed, type }, "media storage type cleared");
  return removed;
}

export async function getMediaStorageIndexedTotals(): Promise<{
  total: number;
  image: number;
  video: number;
  audio: number;
  file: number;
}> {
  const db = await ensureMediaIndex();
  const totals = { total: 0, image: 0, video: 0, audio: 0, file: 0 };
  const rows = db
    .query(`
      SELECT media_type, COALESCE(SUM(size_bytes), 0) AS bytes
      FROM media_index
      GROUP BY media_type
    `)
    .all() as Array<{ media_type: MediaStorageType; bytes: number }>;
  for (const row of rows) {
    totals[row.media_type] = Number(row.bytes);
    totals.total += Number(row.bytes);
  }
  return totals;
}

export async function getMediaIndexDiskSize(): Promise<number> {
  await ensureMediaIndex();
  let total = 0;
  for (const path of [MEDIA_INDEX_PATH, `${MEDIA_INDEX_PATH}-wal`, `${MEDIA_INDEX_PATH}-shm`]) {
    try {
      total += (await stat(path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return total;
}

export async function getMediaStorageSize(): Promise<number> {
  return (await getMediaStorageIndexedTotals()).total;
}

export async function getMediaStorageSizeByType(): Promise<{
  image: number;
  video: number;
  audio: number;
  file: number;
}> {
  const { image, video, audio, file } = await getMediaStorageIndexedTotals();
  return { image, video, audio, file };
}

/** Flush and release process-wide media state for graceful shutdown and isolated tests. */
export async function closeMediaStorage(): Promise<void> {
  let rebuildError: unknown;
  const activeRebuild = rebuildPromise;
  if (activeRebuild) {
    try {
      await activeRebuild;
    } catch (error) {
      rebuildError = error;
    }
  }

  const activeDb = indexDbPromise;
  try {
    if (activeDb) {
      const db = await activeDb;
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        db.close();
      }
    }
  } finally {
    indexDbPromise = null;
    rebuildPromise = null;
    memory.clear();
    memoryBytes = 0;
  }
  if (rebuildError) throw rebuildError;
}
