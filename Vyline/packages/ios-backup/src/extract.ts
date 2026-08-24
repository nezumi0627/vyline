import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { openBackup, closeBackup, type BackupManifest } from "./manifest.js";
import { parseBplist, parseContentMetadata } from "./bplist.js";
import { unwrapKeyForClass } from "./keybag.js";

export interface FileManifestEntry {
  fileID: string;
  domain: string;
  relativePath: string;
  file: Uint8Array;
}

export interface ExtractedFile {
  fileID: string;
  domain: string;
  relativePath: string;
  size: number;
  localPath: string;
  manifest: FileManifestEntry;
}

export interface ExtractedBackup {
  manifestDbPath: string;
  backupRoot: string;
  udid: string;
  files: ExtractedFile[];
  lineFiles: ExtractedFile[];
  databases: ExtractedFile[];
}

export interface ExtractOptions {
  backupRoot: string;
  udid: string;
  password: string;
  outputDir: string;
  domains?: string[];
  onProgress?: (progress: ExtractProgress) => void;
}

export interface ExtractProgress {
  stage: "unlocking" | "listing" | "extracting" | "complete" | "error";
  current: number;
  total: number;
  message: string;
  file?: string;
}

export async function extractBackup(options: ExtractOptions): Promise<ExtractedBackup> {
  const { backupRoot, udid, password, outputDir, domains = ["%line%"], onProgress } = options;

  onProgress?.({ stage: "unlocking", current: 0, total: 3, message: "Unlocking backup..." });

  const backup = await openBackup(backupRoot, udid, password);

  try {
    onProgress?.({ stage: "listing", current: 1, total: 3, message: "Scanning for LINE files..." });

    const db = new Database(backup.manifestDbPath, { readonly: true });

    let whereClause = "";
    const params: string[] = [];
    for (const domain of domains) {
      if (whereClause) whereClause += " OR ";
      whereClause += "domain LIKE ?";
      params.push(domain);
    }

    const rows = db
      .prepare(
        `SELECT fileID, domain, relativePath, flags, file FROM Files WHERE ${whereClause} ORDER BY domain, relativePath`,
      )
      .all(...params) as FileRow[];

    const lineFiles = rows.filter((r) => r.domain.toLowerCase().includes("line"));
    const databases = lineFiles.filter((r) =>
      [".sqlite", ".db", ".storedata"].some((ext) => r.relativePath.toLowerCase().endsWith(ext)),
    );

    onProgress?.({
      stage: "extracting",
      current: 2,
      total: 3,
      message: `Found ${lineFiles.length} LINE files, ${databases.length} databases`,
    });

    mkdirSync(outputDir, { recursive: true });

    const extractedFiles: ExtractedFile[] = [];
    const extractedLineFiles: ExtractedFile[] = [];
    const extractedDatabases: ExtractedFile[] = [];

    for (let i = 0; i < lineFiles.length; i++) {
      const row = lineFiles[i];
      if (!row) continue;
      onProgress?.({
        stage: "extracting",
        current: 2,
        total: 3,
        message: `Extracting ${row.relativePath} (${i + 1}/${lineFiles.length})`,
        file: row.relativePath,
      });

      try {
        const manifestEntry = getFileManifestDBEntry(backup.manifestDbPath, row.fileID);
        const safeName = row.relativePath.replace(/[\\/:]/g, "__");
        const targetName = `${row.domain}__${safeName}`;
        const targetPath = join(outputDir, targetName);

        const result = getFileDecryptedCopy(backup, manifestEntry, targetPath);

        const extracted: ExtractedFile = {
          fileID: row.fileID,
          domain: row.domain,
          relativePath: row.relativePath,
          size: result.size,
          localPath: targetPath,
          manifest: manifestEntry,
        };

        extractedFiles.push(extracted);
        extractedLineFiles.push(extracted);

        if (databases.some((d) => d.fileID === row.fileID)) {
          extractedDatabases.push(extracted);
        }
      } catch (e) {
        console.error(`Failed to extract ${row.relativePath}:`, e);
      }
    }

    onProgress?.({ stage: "complete", current: 3, total: 3, message: "Extraction complete" });

    return {
      manifestDbPath: backup.manifestDbPath,
      backupRoot: backup.backupRoot,
      udid: backup.udid,
      files: extractedFiles,
      lineFiles: extractedLineFiles,
      databases: extractedDatabases,
    };
  } finally {
    closeBackup(backup.manifestDbPath);
  }
}

export interface FileRow {
  fileID: string;
  domain: string;
  relativePath: string;
  flags: number;
  file: Uint8Array;
}

export function getFileManifestDBEntry(manifestDbPath: string, fileID: string): FileManifestEntry {
  const db = new Database(manifestDbPath, { readonly: true });
  const row = db
    .prepare("SELECT fileID, domain, relativePath, file FROM Files WHERE fileID = ? LIMIT 1")
    .get(fileID) as FileRow | undefined;
  db.close();

  if (!row) {
    throw new Error(`File not found in manifest: ${fileID}`);
  }

  return {
    fileID: row.fileID,
    domain: row.domain,
    relativePath: row.relativePath,
    file: row.file,
  };
}

export function getFileDecryptedCopy(
  backup: BackupManifest,
  manifestEntry: FileManifestEntry,
  targetPath: string,
): { size: number } {
  const parsed = parseBplist(manifestEntry.file);
  const fileData = asRecord(parsed);
  const top = asRecord(fileData.$top);
  const root = typeof top.root === "number" ? top.root : undefined;
  const objects = Array.isArray(fileData.$objects) ? fileData.$objects : undefined;
  const entry = findFileRecord(fileData, root, objects);
  const isEncrypted = "EncryptionKey" in entry;
  const isFolder = Number(entry.Size ?? 0) === 0 && !isEncrypted;

  if (isFolder) {
    mkdirSync(targetPath, { recursive: true });
    return { size: 0 };
  }

  const sourcePath = join(
    backup.backupRoot,
    backup.udid,
    manifestEntry.fileID.slice(0, 2),
    manifestEntry.fileID,
  );

  if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  if (isEncrypted) {
    const wrapped = asBytes(resolveBplistValue(entry.EncryptionKey, objects));
    if (!wrapped || wrapped.length < 5) throw new Error("Encrypted file key is missing");
    const protectionClass = resolveProtectionClass(entry.ProtectionClass, backup.keybag.classKeys);
    if (!Number.isInteger(protectionClass)) throw new Error("Encrypted file class is missing");
    const fileKey = unwrapKeyForClass(
      backup.keybag.classKeys,
      protectionClass,
      wrapped.subarray(4),
    );
    const decrypted = decryptAesCbc(readFileSync(sourcePath), fileKey);
    const data = decrypted.subarray(0, Number(entry.Size));
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, data);
    return { size: data.length };
  }
  const data = readFileSync(sourcePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, data);
  return { size: data.length };
}

interface BplistRecord extends Record<string, unknown> {
  $top?: unknown;
  $objects?: unknown[];
  root?: unknown;
  Size?: unknown;
  EncryptionKey?: unknown;
  ProtectionClass?: unknown;
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
  const candidates = [
    rootIndex === undefined ? undefined : objects?.[rootIndex],
    root,
    ...(objects ?? []),
  ];
  return (
    candidates
      .map(asRecord)
      .find((candidate) => "EncryptionKey" in candidate && "ProtectionClass" in candidate) ?? root
  );
}

function resolveProtectionClass(value: unknown, classKeys: Map<number, unknown>): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric)) throw new Error("Encrypted file class is missing");
  if (classKeys.has(numeric)) return numeric;

  // iOS Manifest.db stores ProtectionClass as a 32-bit little-endian integer
  // in some Apple Devices/iTunes backup versions.
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

function decryptAesCbc(data: Uint8Array, key: Uint8Array): Uint8Array {
  const decipher = createDecipheriv("aes-256-cbc", key, new Uint8Array(16));
  decipher.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([decipher.update(data), decipher.final()]));
}

function readUInt64BE(buf: Uint8Array, offset: number): number {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result = (result << 8) | (buf[offset + i] ?? 0);
  }
  return result;
}

function readUIntBE(buf: Uint8Array, offset: number, size: number): number {
  let result = 0;
  for (let i = 0; i < size; i++) {
    result = (result << 8) | (buf[offset + i] ?? 0);
  }
  return result;
}
