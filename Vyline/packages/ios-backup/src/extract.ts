import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { openBackup, closeBackup, BackupManifest } from "./manifest.js";
import { parseBplist, parseContentMetadata } from "./bplist.js";

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

        const result = getFileDecryptedCopy(
          backup.backupRoot,
          backup.udid,
          manifestEntry,
          targetPath,
        );

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
  backupRoot: string,
  udid: string,
  manifestEntry: FileManifestEntry,
  targetPath: string,
): { size: number } {
  const manifest = parseBplist(manifestEntry.file);

  const fileData = manifest.$objects?.[manifest.$top?.root] ?? manifest;
  const isEncrypted = "EncryptionKey" in fileData;
  const isFolder = fileData.Size === 0 && !isEncrypted;

  if (isFolder) {
    mkdirSync(targetPath, { recursive: true });
    return { size: 0 };
  }

  const sourcePath = join(backupRoot, udid, manifestEntry.fileID.slice(0, 2), manifestEntry.fileID);

  if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  if (isEncrypted) {
    throw new Error(
      "Encrypted file extraction not implemented in this helper - use full backup context",
    );
  }
  const data = readFileSync(sourcePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, data);
  return { size: data.length };
}

function readUInt64BE(buf: Uint8Array, offset: number): number {
  for (let i = 0; i < 8; i++) {
    result = (result << 8) | buf[offset + i];
  }
  return result;
}

function readUIntBE(buf: Uint8Array, offset: number, size: number): number {
  let result = 0;
  for (let i = 0; i < size; i++) {
    result = (result << 8) | buf[offset + i];
  }
  return result;
}
