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
  openBackup,
  closeBackup,
  type BackupManifest,
  type ManifestPlist,
} from "./manifest.js";

export {
  extractBackup,
  getFileManifestDBEntry,
  getFileDecryptedCopy,
  type ExtractedBackup,
  type ExtractedFile,
  type ExtractOptions,
  type ExtractProgress,
} from "./extract.js";

export {
  parseLineDatabases,
  findLineDatabases,
  detectMyMid,
  type ParsedChatHistory,
  type ChatInfo,
  type MessageRecord,
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
import type { ParsedChatHistory } from "./parse.js";

export interface IosBackupResult {
  extracted: ExtractedBackup;
  parsed: ParsedChatHistory;
}

export async function extractAndParseLineHistory(
  backupRoot: string,
  udid: string,
  password: string,
  outputDir: string,
  onProgress?: (stage: string, current: number, total: number, message: string) => void,
): Promise<IosBackupResult> {
  const { extractBackup } = await import("./extract.js");
  const { parseLineDatabases, findLineDatabases, detectMyMid } = await import("./parse.js");

  const extracted = await extractBackup({
    backupRoot,
    udid,
    password,
    outputDir,
    onProgress: onProgress ? (p) => onProgress(p.stage, p.current, p.total, p.message) : undefined,
  });

  const dbs = findLineDatabases(outputDir);
  if (!dbs) {
    throw new Error("LINE databases not found in extracted backup");
  }

  const myMid = detectMyMid(dbs.lineDb);

  const parsed = await parseLineDatabases({
    lineDbPath: dbs.lineDb,
    unifiedGroupDbPath: dbs.unifiedGroupDb,
    outputDir: join(outputDir, "dump"),
    myMid,
    onProgress: onProgress ? (p) => onProgress(p.stage, p.current, p.total, p.message) : undefined,
  });

  return { extracted, parsed };
}
