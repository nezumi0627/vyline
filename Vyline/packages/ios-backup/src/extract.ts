import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Database } from "bun:sqlite";
import { parseBplist } from "./bplist.js";
import { unwrapKeyForClass } from "./keybag.js";
import { openBackup, type BackupManifest } from "./manifest.js";

const EXTRACT_BATCH_SIZE = 500;
export const DEFAULT_MAX_EXTRACT_BYTES = 10 * 1024 ** 3;
export const DEFAULT_MAX_FILES = 1_000_000;
export const DEFAULT_MAX_MANIFEST_ROW_BYTES = 64 * 1024;

export class IosBackupExtractionLimitError extends Error {
  constructor(limit: number) {
    super(`iOS backup extraction exceeds the ${limit} byte work limit`);
    this.name = "IosBackupExtractionLimitError";
  }
}

class IosBackupFilenameCollisionError extends Error {}

class IosBackupWorkReservationError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "IosBackupWorkReservationError";
  }
}

export interface FileManifestEntry {
  fileID: string;
  domain: string;
  relativePath: string;
  file: Uint8Array;
}

export interface ExtractedBackup {
  manifestDbPath: string;
  fileIndexPath: string;
  backupRoot: string;
  udid: string;
  lineFiles: number;
  databases: number;
}

export interface ExtractOptions {
  backupRoot: string;
  udid: string;
  password: string;
  outputDir: string;
  domains?: string[];
  maxExtractBytes?: number;
  maxFiles?: number;
  maxManifestRowBytes?: number;
  onWorkBytes?: (bytes: number) => Promise<void>;
  onProgress?: (progress: ExtractProgress) => void;
}

export interface ExtractProgress {
  stage: "unlocking" | "listing" | "extracting" | "complete" | "error";
  current: number;
  total: number;
  message: string;
  file?: string;
}

interface FileRow {
  fileID: string;
  domain: string;
  relativePath: string;
  file: Uint8Array;
}

interface IndexedFile {
  fileId: string;
  domain: string;
  relativePath: string;
  size: number;
  localPath: string;
  isDatabase: boolean;
  isDirectory: boolean;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function extractedPath(outputDir: string, domain: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const rawName = basename(normalized);
  if (!rawName || rawName === "." || rawName === "..") {
    throw new Error(`Invalid backup relative path: ${relativePath}`);
  }
  const safeName = rawName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[ .]+$/g, "_")
    .slice(0, 200);
  const family = createHash("sha256")
    .update(domain)
    .update("\0")
    .update(dirname(normalized))
    .digest("hex");
  // Database WAL/SHM siblings retain their basename relationship in one
  // deterministic directory, while untrusted manifest paths never escape it.
  return join(outputDir, "files", family.slice(0, 2), family, safeName);
}

function initializeFileIndex(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA wal_autocheckpoint = 256");
    db.exec("PRAGMA journal_size_limit = 8388608");
    db.exec("PRAGMA cache_size = -2048");
    db.exec("PRAGMA mmap_size = 0");
    db.exec("PRAGMA temp_store = FILE");
    db.exec(`
    DROP TABLE IF EXISTS extracted_files;
    DROP TABLE IF EXISTS extracted_files_fts;

    CREATE TABLE IF NOT EXISTS extracted_files (
      file_id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      relative_lower TEXT NOT NULL,
      basename_lower TEXT NOT NULL,
      stem_lower TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      local_path TEXT NOT NULL,
      is_database INTEGER NOT NULL,
      is_directory INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_extracted_files_basename
      ON extracted_files(basename_lower);
    CREATE INDEX IF NOT EXISTS idx_extracted_files_stem
      ON extracted_files(stem_lower);
    CREATE INDEX IF NOT EXISTS idx_extracted_files_database
      ON extracted_files(is_database, relative_lower);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_extracted_files_local_path
      ON extracted_files(local_path);
    CREATE VIRTUAL TABLE extracted_files_fts USING fts5(
      file_id UNINDEXED,
      relative_lower,
      tokenize = 'trigram'
    );
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function writeIndexedFiles(db: Database, rows: IndexedFile[]): void {
  if (rows.length === 0) return;
  const insert = db.query(`
    INSERT INTO extracted_files (
      file_id, domain, relative_path, relative_lower, basename_lower,
      stem_lower, size_bytes, local_path, is_database, is_directory
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSearch = db.query(`
    INSERT INTO extracted_files_fts(file_id, relative_lower)
    VALUES (?, ?)
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const name = basename(row.relativePath).toLowerCase();
      const extension = extname(name);
      insert.run(
        row.fileId,
        row.domain,
        row.relativePath,
        row.relativePath.toLowerCase(),
        name,
        extension ? name.slice(0, -extension.length) : name,
        row.size,
        row.localPath,
        row.isDatabase ? 1 : 0,
        row.isDirectory ? 1 : 0,
      );
      insertSearch.run(row.fileId, row.relativePath.toLowerCase());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function extractBackup(options: ExtractOptions): Promise<ExtractedBackup> {
  const { backupRoot, udid, password, outputDir, domains = ["%line%"], onProgress } = options;
  const maxExtractBytes = options.maxExtractBytes ?? DEFAULT_MAX_EXTRACT_BYTES;
  if (!Number.isSafeInteger(maxExtractBytes) || maxExtractBytes <= 0) {
    throw new Error("maxExtractBytes must be a positive safe integer");
  }
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
    throw new Error("maxFiles must be a positive safe integer");
  }
  const maxManifestRowBytes = options.maxManifestRowBytes ?? DEFAULT_MAX_MANIFEST_ROW_BYTES;
  if (!Number.isSafeInteger(maxManifestRowBytes) || maxManifestRowBytes <= 0) {
    throw new Error("maxManifestRowBytes must be a positive safe integer");
  }
  const reportWorkBytes = async (bytes: number) => {
    try {
      await options.onWorkBytes?.(bytes);
    } catch (error) {
      throw new IosBackupWorkReservationError(error);
    }
  };
  onProgress?.({ stage: "unlocking", current: 0, total: 1, message: "Unlocking backup..." });

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const backup = await openBackup(
    backupRoot,
    udid,
    password,
    outputDir,
    maxExtractBytes,
    reportWorkBytes,
  );
  const manifest = new Database(backup.manifestDbPath, { readonly: true, strict: true });
  const fileIndexPath = join(outputDir, "extracted-files.sqlite");
  let index: Database | null = null;
  try {
    index = initializeFileIndex(fileIndexPath);
    manifest.exec("PRAGMA query_only = ON");
    manifest.exec("PRAGMA cache_size = -2048");
    manifest.exec("PRAGMA mmap_size = 0");
    manifest.exec("PRAGMA temp_store = FILE");
    const clauses = domains.map(() => "domain LIKE ?");
    if (clauses.length === 0) throw new Error("At least one backup domain is required");
    const where = clauses.join(" OR ");
    const total = Number(
      (
        manifest.query(`SELECT count(*) AS count FROM Files WHERE ${where}`).get(...domains) as {
          count?: number;
        } | null
      )?.count ?? 0,
    );
    if (!Number.isSafeInteger(total) || total > maxFiles) {
      throw new Error(`iOS backup contains too many LINE files (${total}, limit ${maxFiles})`);
    }
    const oversized = manifest
      .query(`
        SELECT fileID AS file_id, length(file) AS metadata_bytes
        FROM Files
        WHERE (${where}) AND length(file) > ?
        ORDER BY fileID
        LIMIT 1
      `)
      .get(...domains, maxManifestRowBytes) as {
      file_id: string;
      metadata_bytes: number;
    } | null;
    if (oversized) {
      throw new Error(
        `iOS backup manifest row ${oversized.file_id} exceeds the ${maxManifestRowBytes} byte limit`,
      );
    }
    onProgress?.({
      stage: "listing",
      current: 0,
      total: Math.max(1, total),
      message: `Found ${total} LINE files`,
    });

    const manifestBytes = (await stat(backup.manifestDbPath)).size;
    let extractedFileBytes = 0;
    let indexBytes = await sqliteBundleBytes(fileIndexPath);
    if (manifestBytes + indexBytes > maxExtractBytes) {
      throw new IosBackupExtractionLimitError(maxExtractBytes);
    }
    await reportWorkBytes(manifestBytes + indexBytes);

    let processed = 0;
    let lineFiles = 0;
    let databases = 0;
    let afterFileId = "";
    for (;;) {
      const rows = manifest
        .query(`
          SELECT fileID, domain, relativePath, file
          FROM Files
          WHERE (${where}) AND fileID > ?
          ORDER BY fileID
          LIMIT ?
        `)
        .all(...domains, afterFileId, EXTRACT_BATCH_SIZE) as FileRow[];
      if (rows.length === 0) break;
      const batch: IndexedFile[] = [];
      for (const row of rows) {
        processed++;
        onProgress?.({
          stage: "extracting",
          current: processed,
          total: Math.max(1, total),
          message: `Extracting ${row.relativePath} (${processed}/${total})`,
          file: row.relativePath,
        });
        try {
          if (!/^[a-f0-9]{2,128}$/i.test(row.fileID)) {
            throw new Error(`Invalid backup file ID: ${row.fileID}`);
          }
          const relativeLower = row.relativePath.toLowerCase();
          const isDatabase = [".sqlite", ".db", ".storedata"].some((extension) =>
            relativeLower.endsWith(extension),
          );
          const targetPath = extractedPath(outputDir, row.domain, row.relativePath);
          if (existsSync(targetPath)) {
            throw new IosBackupFilenameCollisionError(
              `Multiple iOS backup entries resolve to ${targetPath}`,
            );
          }
          const remainingBytes = maxExtractBytes - manifestBytes - extractedFileBytes - indexBytes;
          if (remainingBytes < 0) throw new IosBackupExtractionLimitError(maxExtractBytes);
          const result = await getFileDecryptedCopy(
            backup,
            {
              fileID: row.fileID,
              domain: row.domain,
              relativePath: row.relativePath,
              file: row.file,
            },
            targetPath,
            remainingBytes,
            async (fileBytes) => {
              await reportWorkBytes(manifestBytes + extractedFileBytes + indexBytes + fileBytes);
            },
          );
          extractedFileBytes += result.size;
          await reportWorkBytes(manifestBytes + extractedFileBytes + indexBytes);
          lineFiles++;
          if (isDatabase && !result.isDirectory) databases++;
          batch.push({
            fileId: row.fileID,
            domain: row.domain,
            relativePath: row.relativePath,
            size: result.size,
            localPath: targetPath,
            isDatabase,
            isDirectory: result.isDirectory,
          });
        } catch (error) {
          if (error instanceof IosBackupExtractionLimitError) {
            throw new IosBackupExtractionLimitError(maxExtractBytes);
          }
          if (
            error instanceof IosBackupFilenameCollisionError ||
            error instanceof IosBackupWorkReservationError ||
            isCriticalLineDatabaseFile(row.relativePath)
          ) {
            throw error;
          }
          console.error(`Failed to extract ${row.relativePath}:`, error);
        }
      }
      writeIndexedFiles(index, batch);
      indexBytes = await sqliteBundleBytes(fileIndexPath);
      if (manifestBytes + extractedFileBytes + indexBytes > maxExtractBytes) {
        throw new IosBackupExtractionLimitError(maxExtractBytes);
      }
      await reportWorkBytes(manifestBytes + extractedFileBytes + indexBytes);
      afterFileId = rows[rows.length - 1]!.fileID;
      await yieldToEventLoop();
    }
    index.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    onProgress?.({
      stage: "complete",
      current: Math.max(1, total),
      total: Math.max(1, total),
      message: "Extraction complete",
    });
    return {
      manifestDbPath: backup.manifestDbPath,
      fileIndexPath,
      backupRoot: backup.backupRoot,
      udid: backup.udid,
      lineFiles,
      databases,
    };
  } catch (error) {
    onProgress?.({
      stage: "error",
      current: 0,
      total: 1,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    index?.close();
    manifest.close();
  }
}

class ByteLimitTransform extends Transform {
  private remaining: number;
  written = 0;

  constructor(limit: number) {
    super();
    this.remaining = Math.max(0, limit);
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.remaining > 0) {
      const data = chunk.subarray(0, Math.min(chunk.length, this.remaining));
      this.remaining -= data.length;
      this.written += data.length;
      if (data.length > 0) this.push(data);
    }
    callback();
  }
}

export async function getFileDecryptedCopy(
  backup: BackupManifest,
  manifestEntry: FileManifestEntry,
  targetPath: string,
  maxBytes = Number.MAX_SAFE_INTEGER,
  beforeWrite?: (bytes: number) => Promise<void>,
): Promise<{ size: number; isDirectory: boolean }> {
  const parsed = parseBplist(manifestEntry.file);
  const fileData = asRecord(parsed);
  const top = asRecord(fileData.$top);
  const root = typeof top.root === "number" ? top.root : undefined;
  const objects = Array.isArray(fileData.$objects) ? fileData.$objects : undefined;
  const entry = findFileRecord(fileData, root, objects);
  const isEncrypted = "EncryptionKey" in entry;
  const declaredSize = Number(entry.Size ?? 0);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
    throw new Error(`Invalid declared backup file size: ${String(entry.Size)}`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error("Invalid backup extraction byte limit");
  }
  const sourcePath = join(
    backup.backupRoot,
    backup.udid,
    manifestEntry.fileID.slice(0, 2),
    manifestEntry.fileID,
  );
  const mode = Number(entry.Mode);
  const isDirectory = Number.isInteger(mode)
    ? (mode & 0xf000) === 0x4000
    : declaredSize === 0 && !isEncrypted && !existsSync(sourcePath);

  if (isDirectory) {
    await mkdir(targetPath, { recursive: true, mode: 0o700 });
    return { size: 0, isDirectory: true };
  }

  if (!existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);
  const sourceSize = (await stat(sourcePath)).size;
  const outputSize = isEncrypted ? declaredSize : sourceSize;
  if (outputSize > maxBytes) throw new IosBackupExtractionLimitError(maxBytes);
  if (existsSync(targetPath)) {
    throw new IosBackupFilenameCollisionError(`Refusing to replace extracted file ${targetPath}`);
  }
  await beforeWrite?.(outputSize);
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const partialPath = `${targetPath}.partial`;
  await rm(partialPath, { recursive: true, force: true });
  try {
    let size: number;
    if (isEncrypted) {
      const wrapped = asBytes(resolveBplistValue(entry.EncryptionKey, objects));
      if (!wrapped || wrapped.length < 5) throw new Error("Encrypted file key is missing");
      const protectionClass = resolveProtectionClass(
        entry.ProtectionClass,
        backup.keybag.classKeys,
      );
      const fileKey = unwrapKeyForClass(
        backup.keybag.classKeys,
        protectionClass,
        wrapped.subarray(4),
      );
      const decipher = createDecipheriv("aes-256-cbc", fileKey, new Uint8Array(16));
      decipher.setAutoPadding(false);
      const limiter = new ByteLimitTransform(declaredSize);
      await pipeline(
        createReadStream(sourcePath),
        decipher,
        limiter,
        createWriteStream(partialPath, { mode: 0o600 }),
      );
      size = limiter.written;
      if (size !== declaredSize) {
        throw new Error(
          `Decrypted backup file size ${size} does not match declared size ${declaredSize}`,
        );
      }
    } else {
      await copyFile(sourcePath, partialPath);
      size = (await stat(partialPath)).size;
    }
    await rename(partialPath, targetPath);
    return { size, isDirectory: false };
  } catch (error) {
    await rm(partialPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function sqliteBundleBytes(path: string): Promise<number> {
  let total = 0;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    total += (await stat(candidate).catch(() => null))?.size ?? 0;
  }
  return total;
}

function isCriticalLineDatabaseFile(relativePath: string): boolean {
  const name = basename(relativePath.replace(/\\/g, "/")).toLowerCase();
  return /^(line|unifiedgroup)\.sqlite(?:-(?:wal|shm))?$/.test(name);
}

interface BplistRecord extends Record<string, unknown> {
  $top?: unknown;
  $objects?: unknown[];
  root?: unknown;
  Size?: unknown;
  EncryptionKey?: unknown;
  ProtectionClass?: unknown;
  Mode?: unknown;
}

function asRecord(value: unknown): BplistRecord {
  return typeof value === "object" && value !== null ? (value as BplistRecord) : {};
}

function resolveBplistValue(value: unknown, objects: unknown[] | undefined): unknown {
  if (typeof value === "number" && objects?.[value] !== undefined) {
    return resolveBplistValue(objects[value], objects);
  }
  if (typeof value === "object" && value !== null && "NS.data" in value) {
    return resolveBplistValue((value as { "NS.data"?: unknown })["NS.data"], objects);
  }
  return value;
}

function findFileRecord(
  root: BplistRecord,
  rootIndex: number | undefined,
  objects: unknown[] | undefined,
): BplistRecord {
  const indexed = rootIndex === undefined ? undefined : asRecord(objects?.[rootIndex]);
  if (indexed && ("Size" in indexed || "Mode" in indexed || "EncryptionKey" in indexed)) {
    return indexed;
  }
  if ("EncryptionKey" in root && "ProtectionClass" in root) return root;
  for (const object of objects ?? []) {
    const candidate = asRecord(object);
    if ("EncryptionKey" in candidate && "ProtectionClass" in candidate) return candidate;
  }
  for (const object of objects ?? []) {
    const candidate = asRecord(object);
    if ("Size" in candidate || "Mode" in candidate) return candidate;
  }
  return root;
}

function resolveProtectionClass(value: unknown, classKeys: Map<number, unknown>): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric)) throw new Error("Encrypted file class is missing");
  if (classKeys.has(numeric)) return numeric;
  const bytes = [
    (numeric >>> 24) & 0xff,
    (numeric >>> 16) & 0xff,
    (numeric >>> 8) & 0xff,
    numeric & 0xff,
  ];
  const littleEndian = bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24);
  if (classKeys.has(littleEndian)) return littleEndian;
  throw new Error(`No key for protection class ${numeric}`);
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}
