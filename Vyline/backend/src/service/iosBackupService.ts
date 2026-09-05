import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractAndParseLineHistory } from "@vyline/ios-backup";
import { childLogger } from "../logger.js";
import { flushAccountChatDb, mergeImportedChatDbFromStaging } from "../storage/chatStore.js";
import { BACKUP_STORAGE_LIMIT_BYTES, BackupStorageLimitError } from "../storage/backupLimits.js";
import {
  assertMediaStorageCapacity,
  importMediaStorageFile,
  removeMediaStorageEntry,
  statMediaStorage,
} from "../storage/mediaStorage.js";
import { AndroidBackupStaging, type PlannedAndroidMedia } from "./androidBackupStaging.js";
import { getBackupStorageUsage, withAccountBackupLock } from "./backupService.js";
import {
  assertDiskBackedWorkFreeSpace,
  createDiskBackedWorkDir,
  type HeavyBackupWorkReservation,
  pruneDiskBackedWorkDirs,
  removeDiskBackedWorkDir,
  reserveHeavyBackupWork,
  withDiskBackedWorkCapacityLock,
} from "./diskBackedWorkQueue.js";

const log = childLogger("ios-backup");
const STAGING_BATCH_SIZE = 500;
const BACKUP_SESSION_TTL_MS = (() => {
  const fallback = 24 * 60 * 60 * 1000;
  const parsed = Number(process.env.VYLINE_BACKUP_SESSION_TTL_MS ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(7 * 24 * 60 * 60 * 1000, Math.max(60_000, Math.floor(parsed)));
})();

export interface IosBackupDevice {
  udid: string;
  name: string;
  iOSVersion: string;
  deviceType: string;
  encrypted: boolean;
  passcodeSet: boolean;
  backupRoot: string;
  modifiedAt: string;
}

export interface IosBackupProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
  file?: string;
}

export interface IosBackupSession {
  id: string;
  accountId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: IosBackupProgress | null;
  result: {
    deviceId: string;
    backupDate: string;
    restoredAt: string;
    extracted: { lineFiles: number; databases: number };
    parsed: { chats: number; totalMessages: number };
    restoredChatMids: string[];
    merged: {
      importedChats: number;
      skippedChats: number;
      importedMessages: number;
      skippedMessages: number;
    };
    media: { restored: number; skipped: number };
  } | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

const sessions = new Map<string, IosBackupSession>();

function pruneCompletedSessions(now = Date.now()): void {
  const threshold = now - BACKUP_SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.completedAt !== null && session.completedAt < threshold) sessions.delete(id);
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function backupRoots(): string[] {
  const configured = process.env.IOS_BACKUP_ROOT?.trim();
  if (configured) return [configured];
  const home = homedir();
  return [
    join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      "Apple Computer",
      "MobileSync",
      "Backup",
    ),
    join(home, "Apple", "MobileSync", "Backup"),
    join(home, "Library", "Application Support", "MobileSync", "Backup"),
  ];
}

async function findBackups(): Promise<IosBackupDevice[]> {
  const devices: IosBackupDevice[] = [];
  const seen = new Set<string>();
  for (const root of backupRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const backupRoot = join(root, entry.name);
      if (
        !existsSync(join(backupRoot, "Manifest.plist")) ||
        !existsSync(join(backupRoot, "Manifest.db"))
      ) {
        continue;
      }
      seen.add(entry.name);
      const info = await stat(backupRoot);
      devices.push({
        udid: entry.name,
        name: entry.name,
        iOSVersion: "不明（復元時に確認）",
        deviceType: "iPhone / iPad",
        encrypted: true,
        passcodeSet: true,
        backupRoot: root,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }
  return devices.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function listIosBackups(): Promise<IosBackupDevice[]> {
  return findBackups();
}

export async function startIosBackupRestore(
  accountId: string,
  udid: string,
  password: string,
): Promise<IosBackupSession> {
  pruneCompletedSessions();
  if (!accountId) throw new Error("accountId が必要です");
  if (!password) throw new Error("暗号化バックアップのパスワードが必要です");
  const device = (await findBackups()).find((item) => item.udid === udid);
  if (!device) throw new Error("指定された iOS バックアップが見つかりません");

  const id = `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session: IosBackupSession = {
    id,
    accountId,
    status: "pending",
    progress: null,
    result: null,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
  };
  sessions.set(id, session);
  session.progress = {
    stage: "queued",
    current: 0,
    total: 1,
    message: "ほかのバックアップ処理の完了を待っています",
  };
  void pruneDiskBackedWorkDirs().catch(() => undefined);
  let reservation: HeavyBackupWorkReservation | undefined;
  try {
    reservation = await withDiskBackedWorkCapacityLock(async () => {
      const next = reserveHeavyBackupWork(accountId);
      try {
        // iOS backups are read in place, but decrypt + extraction + normalized
        // staging may consume the full restore work budget. Reserve it before the
        // job enters the queue so queued restores cannot overcommit disk work.
        next.resizeReservedBytes(BACKUP_STORAGE_LIMIT_BYTES);
        await assertDiskBackedWorkFreeSpace(BACKUP_STORAGE_LIMIT_BYTES, next.reservedBytes);
        return next;
      } catch (error) {
        next.release();
        throw error;
      }
    });
  } catch (error) {
    reservation?.release();
    session.status = "failed";
    session.error = error instanceof Error ? error.message : "iOSバックアップの復元に失敗しました";
    session.completedAt = Date.now();
    return session;
  }
  const workReservation = reservation;
  let outputDir: string | null = null;
  void workReservation
    .enqueue(
      async () => {
        outputDir = await createDiskBackedWorkDir("ios", session.id);
        await runRestore(session, device, password, outputDir, workReservation);
      },
      async () => {
        if (outputDir) await removeDiskBackedWorkDir(outputDir);
      },
    )
    .catch((error) => {
      session.status = "failed";
      session.error =
        error instanceof Error ? error.message : "iOSバックアップの復元に失敗しました";
      session.completedAt = Date.now();
    });
  return session;
}

export function getIosBackupSession(accountId: string, id: string): IosBackupSession | null {
  pruneCompletedSessions();
  const session = sessions.get(id);
  return session?.accountId === accountId ? session : null;
}

async function runRestore(
  session: IosBackupSession,
  device: IosBackupDevice,
  password: string,
  outputDir: string,
  reservation: HeavyBackupWorkReservation,
): Promise<void> {
  session.status = "running";
  session.progress = {
    stage: "starting",
    current: 0,
    total: 1,
    message: "バックアップを準備しています",
  };
  try {
    let measuredWorkBytes = 0;
    const result = await extractAndParseLineHistory(
      device.backupRoot,
      device.udid,
      password,
      outputDir,
      (stage, current, total, message) => {
        session.progress = { stage, current, total, message };
      },
      BACKUP_STORAGE_LIMIT_BYTES,
      async (bytes) => {
        measuredWorkBytes = Math.max(measuredWorkBytes, bytes);
        await withDiskBackedWorkCapacityLock(async () => {
          const current = reservation.reservedBytes;
          const next = Math.max(current, bytes);
          await assertDiskBackedWorkFreeSpace(Math.max(0, next - current), current);
          reservation.resizeReservedBytes(next);
        });
      },
    );

    const { merged, media, restoredChatMids } = await withAccountBackupLock(
      session.accountId,
      async () => {
        session.progress = {
          stage: "media-plan",
          current: 0,
          total: Math.max(1, result.parsed.mediaRefs),
          message: "iOSバックアップ内のメディアを確認しています",
        };
        let mediaPlan = { count: 0, sizeBytes: 0 };
        let restoredChatMids: string[] = [];
        const staging = new AndroidBackupStaging(result.parsed.stagingPath);
        try {
          await planIosMediaFromStaging(
            session.accountId,
            result.extracted.fileIndexPath,
            staging,
            (current, total) => {
              session.progress = {
                stage: "media-plan",
                current,
                total: Math.max(1, total),
                message: "iOSバックアップ内のメディアを確認しています",
              };
            },
          );
          mediaPlan = staging.mediaPlanStats();
          restoredChatMids = staging.restoredChatMids();
          staging.checkpoint();
        } finally {
          staging.close();
        }

        const usage = await getBackupStorageUsage(session.accountId);
        const maxHistoryBytes =
          usage.limitBytes - usage.backupBytes - usage.mediaBytes - mediaPlan.sizeBytes;
        if (maxHistoryBytes < 0) throw new BackupStorageLimitError();
        if (mediaPlan.sizeBytes > 0) {
          await assertMediaStorageCapacity(mediaPlan.sizeBytes);
        }
        reservation.resizeReservedBytes(measuredWorkBytes);

        let media = { restored: 0, skipped: 0 };
        const importedMedia: Array<{ chatMid: string; messageId: string }> = [];
        let merged: Awaited<ReturnType<typeof mergeImportedChatDbFromStaging>>;
        try {
          // Publish new media first, then commit SQLite. Rollback records only
          // successful new copies, so pre-existing media is never removed.
          session.progress = {
            stage: "media",
            current: 0,
            total: Math.max(1, mediaPlan.count),
            message: "復元したメディアをDBへ紐付けています",
          };
          const stagedMedia = new AndroidBackupStaging(result.parsed.stagingPath);
          try {
            media = await restoreIosMediaFromStaging(
              session.accountId,
              stagedMedia,
              importedMedia,
              (current, total) => {
                session.progress = {
                  stage: "media",
                  current,
                  total: Math.max(1, total),
                  message: "復元したメディアをDBへ紐付けています",
                };
              },
            );
          } finally {
            stagedMedia.close();
          }
          media.skipped += result.parsed.mediaRefs - mediaPlan.count;

          session.progress = {
            stage: "merge",
            current: 0,
            total: Math.max(1, result.parsed.chats + result.parsed.totalMessages),
            message: "チャット履歴をVylineのDBへ取り込んでいます",
          };
          merged = await mergeImportedChatDbFromStaging(
            session.accountId,
            result.parsed.stagingPath,
            maxHistoryBytes,
            ({ current, total }) => {
              session.progress = {
                stage: "merge",
                current,
                total: Math.max(1, total),
                message: "チャット履歴をVylineのDBへ取り込んでいます",
              };
            },
          );
        } catch (error) {
          await rollbackIosImportedMedia(session.accountId, importedMedia);
          throw error;
        }

        session.progress = {
          stage: "save",
          current: 1,
          total: 1,
          message: "復元結果をDBへ保存しています",
        };
        await flushAccountChatDb(session.accountId).catch((error) => {
          log.warn({ error, accountId: session.accountId }, "iOS restore WAL checkpoint deferred");
        });
        return { merged, media, restoredChatMids };
      },
    );

    session.result = {
      deviceId: device.udid,
      backupDate: device.modifiedAt,
      restoredAt: new Date().toISOString(),
      extracted: {
        lineFiles: result.extracted.lineFiles,
        databases: result.extracted.databases,
      },
      parsed: { chats: result.parsed.chats, totalMessages: result.parsed.totalMessages },
      restoredChatMids,
      merged,
      media,
    };
    session.status = "completed";
    session.completedAt = Date.now();
  } catch (error) {
    session.status = "failed";
    session.error = error instanceof Error ? error.message : "iOSバックアップの復元に失敗しました";
    session.completedAt = Date.now();
    log.warn(
      { accountId: session.accountId, deviceId: device.udid, error },
      "iOS backup restore failed",
    );
  }
}

export async function planIosMediaFromStaging(
  accountId: string,
  fileIndexPath: string,
  staging: AndroidBackupStaging,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const total = staging.counts().mediaRefs;
  const lookup = new Database(staging.path, { strict: true });
  lookup.exec("PRAGMA query_only = ON");
  lookup.exec("PRAGMA cache_size = -2048");
  lookup.exec("PRAGMA mmap_size = 0");
  lookup.exec("PRAGMA temp_store = FILE");
  lookup.query("ATTACH DATABASE ? AS ios_files").run(fileIndexPath);
  const exact = lookup.query(`
    SELECT min(file.local_path) AS path, max(file.size_bytes) AS size_bytes,
      count(DISTINCT file.file_id) AS match_count
    FROM staged_ios_media_tokens token
    JOIN ios_files.extracted_files file
      ON file.basename_lower = token.token_lower OR file.stem_lower = token.token_lower
    WHERE token.chat_mid = ? AND token.message_id = ?
      AND file.is_directory = 0 AND file.is_database = 0
  `);
  const contains = lookup.query(`
    SELECT min(file.local_path) AS path, max(file.size_bytes) AS size_bytes,
      count(DISTINCT file.file_id) AS match_count
    FROM staged_ios_media_tokens token
    JOIN ios_files.extracted_files_fts search
      ON search.relative_lower MATCH (
        '"' || replace(token.token_lower, '"', '""') || '"'
      )
    JOIN ios_files.extracted_files file
      ON file.file_id = search.file_id
    WHERE token.chat_mid = ? AND token.message_id = ?
      AND length(token.token_lower) >= 8
      AND instr(file.relative_lower, token.token_lower) > 0
      AND file.is_directory = 0 AND file.is_database = 0
  `);
  let current = 0;
  let cursor: { chatMid: string; messageId: string } | null = null;
  onProgress?.(0, total);
  try {
    for (;;) {
      const refs = staging.mediaRefPage(cursor, STAGING_BATCH_SIZE);
      if (refs.length === 0) break;
      const planned: PlannedAndroidMedia[] = [];
      for (const ref of refs) {
        if (await statMediaStorage(accountId, ref.chatMid, ref.messageId)) continue;
        type Candidate = {
          path: string | null;
          size_bytes: number | null;
          match_count: number;
        };
        let candidate = exact.get(ref.chatMid, ref.messageId) as Candidate;
        // An ambiguous exact identity is unsafe even if a substring search
        // happens to return one row. Only fall back when there was no exact hit.
        if (Number(candidate.match_count) === 0) {
          candidate = contains.get(ref.chatMid, ref.messageId) as Candidate;
        }
        if (
          Number(candidate.match_count) !== 1 ||
          !candidate.path ||
          candidate.size_bytes === null
        ) {
          continue;
        }
        planned.push({
          ...ref,
          path: candidate.path,
          sizeBytes: Number(candidate.size_bytes),
        });
      }
      staging.writeMediaPlan(planned);
      current += refs.length;
      const last = refs.at(-1);
      if (last) cursor = { chatMid: last.chatMid, messageId: last.messageId };
      onProgress?.(current, total);
      await yieldToEventLoop();
    }
  } finally {
    try {
      lookup.exec("DETACH DATABASE ios_files");
    } finally {
      lookup.close();
    }
  }
}

async function restoreIosMediaFromStaging(
  accountId: string,
  staging: AndroidBackupStaging,
  importedMedia: Array<{ chatMid: string; messageId: string }>,
  onProgress?: (current: number, total: number) => void,
): Promise<{ restored: number; skipped: number }> {
  const total = staging.mediaPlanStats().count;
  let restored = 0;
  let skipped = 0;
  let current = 0;
  let cursor: { chatMid: string; messageId: string } | null = null;
  onProgress?.(0, total);
  for (;;) {
    const refs = staging.mediaPlanPage(cursor, STAGING_BATCH_SIZE);
    if (refs.length === 0) break;
    for (const ref of refs) {
      const file = await open(ref.path, "r");
      try {
        const header = Buffer.alloc(16);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        const copied = await importMediaStorageFile(
          accountId,
          ref.chatMid,
          ref.messageId,
          ref.path,
          sniffMediaMime(header.subarray(0, bytesRead), ref.contentType),
        );
        if (copied) {
          importedMedia.push({ chatMid: ref.chatMid, messageId: ref.messageId });
          restored++;
        } else skipped++;
      } finally {
        await file.close();
      }
      current++;
      onProgress?.(current, total);
    }
    const last = refs.at(-1);
    if (last) cursor = { chatMid: last.chatMid, messageId: last.messageId };
    await yieldToEventLoop();
  }
  return { restored, skipped };
}

async function rollbackIosImportedMedia(
  accountId: string,
  importedMedia: Array<{ chatMid: string; messageId: string }>,
): Promise<void> {
  for (let index = importedMedia.length - 1; index >= 0; index--) {
    const media = importedMedia[index]!;
    await removeMediaStorageEntry(accountId, media.chatMid, media.messageId).catch(
      (cleanupError) => {
        log.warn({ cleanupError, ...media }, "iOS restore media rollback failed");
      },
    );
  }
}

function sniffMediaMime(bytes: Uint8Array, kind: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const head = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp") {
    return kind === "AUDIO" ? "audio/mp4" : "video/mp4";
  }
  if (bytes.length >= 3 && Buffer.from(bytes.subarray(0, 3)).toString("ascii") === "ID3") {
    return "audio/mpeg";
  }
  const secondByte = bytes[1];
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    secondByte !== undefined &&
    (secondByte & 0xe0) === 0xe0
  ) {
    return "audio/mpeg";
  }
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (kind === "IMAGE" || kind === "STICKER") return "image/jpeg";
  if (kind === "VIDEO") return "video/mp4";
  if (kind === "AUDIO") return "audio/mp4";
  return "application/octet-stream";
}
