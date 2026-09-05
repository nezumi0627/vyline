export {
  parseKeybag,
  loopTLVBlocks,
  aesUnwrap,
  unlockClassKeys,
  unwrapKeyForClass,
  type ParsedKeybag,
  type ClassKey,
} from "./keybag.js";

export {
  DEFAULT_MAX_MANIFEST_PLIST_BYTES,
  openBackup,
  type BackupManifest,
  type ManifestPlist,
} from "./manifest.js";

export {
  extractBackup,
  getFileDecryptedCopy,
  DEFAULT_MAX_EXTRACT_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_MANIFEST_ROW_BYTES,
  IosBackupExtractionLimitError,
  type ExtractedBackup,
  type FileManifestEntry,
  type ExtractOptions,
  type ExtractProgress,
} from "./extract.js";

export {
  parseLineDatabases,
  findLineDatabases,
  detectMyMid,
  iosTimestampToIso,
  DEFAULT_MAX_STAGING_BYTES,
  type StagedChatHistory,
  type ParseOptions,
  type ParseProgress,
} from "./parse.js";

export {
  parseBplist,
  parseContentMetadata,
  bplistToJson,
  type BplistValue,
} from "./bplist.js";

import { join } from "node:path";
import type { ExtractedBackup } from "./extract.js";
import type { StagedChatHistory } from "./parse.js";

export interface IosBackupResult {
  extracted: ExtractedBackup;
  parsed: StagedChatHistory;
}

export async function extractAndParseLineHistory(
  backupRoot: string,
  udid: string,
  password: string,
  outputDir: string,
  onProgress?: (stage: string, current: number, total: number, message: string) => void,
  maxWorkBytes = 10 * 1024 ** 3,
  onWorkBytes?: (bytes: number) => Promise<void>,
): Promise<IosBackupResult> {
  const { extractBackup } = await import("./extract.js");
  const { parseLineDatabases, findLineDatabases, detectMyMid } = await import("./parse.js");

  const progressExtract = onProgress
    ? (p: import("./extract.js").ExtractProgress) =>
        onProgress(p.stage, p.current, p.total, p.message)
    : undefined;
  let extractedWorkBytes = 0;
  const extracted = await extractBackup({
    backupRoot,
    udid,
    password,
    outputDir,
    maxExtractBytes: maxWorkBytes,
    onWorkBytes: async (bytes) => {
      extractedWorkBytes = Math.max(extractedWorkBytes, bytes);
      await onWorkBytes?.(extractedWorkBytes);
    },
    ...(progressExtract ? { onProgress: progressExtract } : {}),
  });

  const dbs = findLineDatabases(extracted.fileIndexPath);
  if (!dbs) {
    throw new Error("LINE databases not found in extracted backup");
  }

  const myMid = detectMyMid(dbs.lineDb);
  const remainingStagingBytes = maxWorkBytes - extractedWorkBytes;
  if (remainingStagingBytes <= 0) {
    throw new Error(`iOS backup work files exceed the ${maxWorkBytes} byte work limit`);
  }

  const progressParse = onProgress
    ? (p: import("./parse.js").ParseProgress) => onProgress(p.stage, p.current, p.total, p.message)
    : undefined;
  const parsed = await parseLineDatabases({
    lineDbPath: dbs.lineDb,
    unifiedGroupDbPath: dbs.unifiedGroupDb,
    stagingPath: join(outputDir, "ios-import.sqlite"),
    myMid,
    // Extraction and staging share one workdir budget. Allowing each phase its
    // own max would permit almost twice the configured disk usage.
    maxStagingBytes: remainingStagingBytes,
    onWorkBytes: async (bytes) => {
      await onWorkBytes?.(extractedWorkBytes + bytes);
    },
    ...(progressParse ? { onProgress: progressParse } : {}),
  });

  return { extracted, parsed };
}
