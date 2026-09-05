import { existsSync, mkdirSync } from "node:fs";
import { appendFile, open, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { Unzip, UnzipInflate } from "fflate";
import type { MessageContentMeta, MessageReaction, MessageSnapshot } from "@vyline/types";
import { childLogger } from "../logger.js";
import { getClient } from "../line/clientManager.js";
import {
  flushAccountChatDb,
  mergeImportedChatDbFromStaging,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";
import {
  assertMediaStorageCapacity,
  importMediaStorageFile,
  removeMediaStorageEntry,
  statMediaStorage,
} from "../storage/mediaStorage.js";
import { getToken } from "../storage/tokenStore.js";
import { BACKUP_STORAGE_LIMIT_BYTES, BackupStorageLimitError } from "../storage/backupLimits.js";
import { getBackupStorageUsage, withAccountBackupLock } from "./backupService.js";
import {
  AndroidBackupStaging,
  type AndroidChatSeed,
  type PlannedAndroidMedia,
  type StagedAndroidMessage,
  type StagedAndroidReaction,
  type UnsupportedAndroidReaction,
} from "./androidBackupStaging.js";
import {
  assertDiskBackedWorkFreeSpace,
  createDiskBackedWorkDir,
  type HeavyBackupWorkReservation,
  pruneDiskBackedWorkDirs,
  removeDiskBackedWorkDir,
  reserveHeavyBackupWork,
  withDiskBackedWorkCapacityLock,
} from "./diskBackedWorkQueue.js";

const log = childLogger("android-backup");

export const MAX_UPLOAD_BYTES = BACKUP_STORAGE_LIMIT_BYTES;
const CHUNK_UPLOAD_BYTES = Math.min(
  768 * 1024,
  Math.max(64 * 1024, Number(process.env.VYLINE_ANDROID_BACKUP_CHUNK_BYTES ?? 512 * 1024)),
);
const CHUNK_UPLOAD_TTL_MS = Number(
  process.env.VYLINE_ANDROID_BACKUP_CHUNK_TTL_MS ?? 60 * 60 * 1000,
);
export const MAX_EXTRACT_BYTES = BACKUP_STORAGE_LIMIT_BYTES;
const SQLITE_MAGIC = "SQLite format 3\u0000";
const MEDIA_CONTENT_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "FILE"]);
const UNSENT_HISTORY_TYPES = new Set([27, 28, 38]);
const STAGING_BATCH_SIZE = boundedInteger(
  process.env.VYLINE_ANDROID_RESTORE_BATCH_SIZE,
  500,
  100,
  1000,
);
const MAX_ZIP_ENTRIES = boundedInteger(
  process.env.VYLINE_ANDROID_BACKUP_MAX_ENTRIES,
  100_000,
  1,
  1_000_000,
);
const BACKUP_SESSION_TTL_MS = boundedInteger(
  process.env.VYLINE_BACKUP_SESSION_TTL_MS,
  24 * 60 * 60 * 1000,
  60_000,
  7 * 24 * 60 * 60 * 1000,
);

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

export interface AndroidBackupProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
  file?: string;
}

export interface AndroidBackupSession {
  id: string;
  accountId: string;
  sourceName: string;
  includeMedia: boolean;
  status: "pending" | "running" | "completed" | "failed";
  progress: AndroidBackupProgress | null;
  result: {
    sourceName: string;
    sourceKind: "sqlite" | "zip";
    databaseVersion: number;
    restoredAt: string;
    parsed: {
      chats: number;
      totalMessages: number;
      reactions: number;
      unsupportedReactions: number;
    };
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

type SqlValue = string | number | bigint | Uint8Array | null;
type AndroidRow = Record<string, SqlValue>;

export interface AndroidDatabaseStagingProgress {
  phase: "metadata" | "reactions" | "messages" | "chats";
  current: number;
  total: number;
}

export interface StagedAndroidDatabaseSummary {
  stagingPath: string;
  databaseVersion: number;
  chats: number;
  totalMessages: number;
  mediaRefs: number;
  reactions: number;
  unsupportedReactions: number;
}

interface ExtractedAndroidZip {
  databasePath: string;
  mediaRoot: string | null;
  extractedBytes: number;
}

const sessions = new Map<string, AndroidBackupSession>();

function pruneCompletedSessions(now = Date.now()): void {
  const threshold = now - BACKUP_SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.completedAt !== null && session.completedAt < threshold) sessions.delete(id);
  }
}

const uploadWrites = new Map<string, Promise<unknown>>();

function withUploadLock<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const next = (uploadWrites.get(accountId) ?? Promise.resolve()).catch(() => undefined).then(work);
  uploadWrites.set(accountId, next);
  return next.finally(() => {
    if (uploadWrites.get(accountId) === next) uploadWrites.delete(accountId);
  });
}

async function yieldToEventLoop(): Promise<void> {
  await Bun.sleep(0);
}

async function createAndroidWorkDir(prefix: string): Promise<string> {
  return createDiskBackedWorkDir("android-restore", prefix);
}

async function removeAndroidWorkDir(path: string): Promise<void> {
  await removeDiskBackedWorkDir(path);
}

async function updateWorkReservation(
  reservation: HeavyBackupWorkReservation,
  bytes: number,
  beforeWrite: boolean,
): Promise<void> {
  await withDiskBackedWorkCapacityLock(async () => {
    const current = reservation.reservedBytes;
    const next = Math.max(current, bytes);
    const additional = Math.max(0, next - current);
    await assertDiskBackedWorkFreeSpace(beforeWrite ? additional : 0, current);
    reservation.resizeReservedBytes(next);
  });
}

let persistentWorkRootPruned = false;
async function prunePersistentWorkRoot(): Promise<void> {
  if (persistentWorkRootPruned) return;
  persistentWorkRootPruned = true;
  await pruneDiskBackedWorkDirs(CHUNK_UPLOAD_TTL_MS);
}

interface AndroidBackupChunkUpload {
  id: string;
  accountId: string;
  sourceName: string;
  includeMedia: boolean;
  expectedBytes: number;
  receivedBytes: number;
  nextIndex: number;
  workDir: string;
  sourcePath: string;
  updatedAt: number;
  reservation: HeavyBackupWorkReservation;
}

const chunkUploads = new Map<string, AndroidBackupChunkUpload>();

async function pruneStaleChunkUploads(): Promise<void> {
  await prunePersistentWorkRoot();
  const threshold = Date.now() - CHUNK_UPLOAD_TTL_MS;
  const stale = [...chunkUploads.values()].filter((upload) => upload.updatedAt < threshold);
  for (const upload of stale) {
    try {
      await upload.reservation.cleanupAndRelease(async () => {
        await removeAndroidWorkDir(upload.workDir);
        chunkUploads.delete(upload.id);
      });
    } catch {
      // Keep both the upload and reservation tracked so cleanup can be retried.
    }
  }
}

function createRestoreSession(
  accountId: string,
  sourceName: string,
  includeMedia: boolean,
  totalBytes: number,
): AndroidBackupSession {
  pruneCompletedSessions();
  const id = `android-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    accountId,
    sourceName: sanitizeDisplayName(sourceName),
    includeMedia,
    status: "pending",
    progress: {
      stage: "upload",
      current: 0,
      total: totalBytes > 0 ? totalBytes : 1,
      message: "Androidバックアップを受信しています",
    },
    result: null,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
  };
}

async function writeRequestBodyToFile(
  request: Request,
  targetPath: string,
  reservation: HeavyBackupWorkReservation,
): Promise<number> {
  const body = request.body;
  if (!body) return 0;

  const reader = body.getReader();
  const file = await open(targetPath, "w", 0o600);
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel("Android backup upload exceeded size limit").catch(() => undefined);
        throw new Error(
          `Androidバックアップが大きすぎます（上限 ${formatBytes(MAX_UPLOAD_BYTES)}）`,
        );
      }
      if (total > reservation.reservedBytes) {
        try {
          await withDiskBackedWorkCapacityLock(async () => {
            const current = reservation.reservedBytes;
            const additional = Math.max(0, total - current);
            await assertDiskBackedWorkFreeSpace(additional, current);
            reservation.resizeReservedBytes(total);
            reservation.resizeInputBytes(total);
          });
        } catch (error) {
          await reader.cancel("Android backup work quota exceeded").catch(() => undefined);
          throw error;
        }
      }

      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        if (bytesWritten <= 0) throw new Error("Androidバックアップの保存に失敗しました");
        offset += bytesWritten;
      }
    }
    await file.sync();
    return total;
  } finally {
    reader.releaseLock();
    await file.close();
  }
}

function queueRestore(
  session: AndroidBackupSession,
  sourcePath: string,
  workDir: string,
  reservation: HeavyBackupWorkReservation,
): AndroidBackupSession {
  session.progress = {
    stage: "queued",
    current: 1,
    total: 1,
    message: "復元処理を開始しています",
  };
  sessions.set(session.id, session);
  void reservation
    .enqueue(
      () =>
        withAccountBackupLock(session.accountId, () =>
          runRestore(session, sourcePath, workDir, reservation),
        ),
      () => removeAndroidWorkDir(workDir),
    )
    .catch((error) => {
      session.status = "failed";
      session.error =
        error instanceof Error ? error.message : "Androidバックアップの復元に失敗しました";
      session.completedAt = Date.now();
    });
  return session;
}

export async function startAndroidBackupRestore(
  accountId: string,
  sourceName: string,
  request: Request,
  includeMedia: boolean,
): Promise<AndroidBackupSession> {
  if (!accountId) throw new Error("accountId が必要です");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Androidバックアップが大きすぎます（上限 ${formatBytes(MAX_UPLOAD_BYTES)}）`);
  }

  const session = createRestoreSession(accountId, sourceName, includeMedia, contentLength);
  const reservedContentLength =
    Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : 0;
  const reservation = reserveHeavyBackupWork(accountId, reservedContentLength);

  let workDir: string | null = null;
  try {
    await withDiskBackedWorkCapacityLock(async () => {
      if (reservedContentLength > 0) {
        await assertDiskBackedWorkFreeSpace(reservedContentLength, reservation.reservedBytes);
      } else {
        await assertDiskBackedWorkFreeSpace(0, reservation.reservedBytes);
      }
    });
    await prunePersistentWorkRoot();
    workDir = await createAndroidWorkDir(`restore-${session.id}-`);
    const sourcePath = join(workDir, "source.bin");
    const written = await writeRequestBodyToFile(request, sourcePath, reservation);
    if (written <= 0) throw new Error("アップロードされたファイルが空です");
    if (written > MAX_UPLOAD_BYTES) {
      throw new Error(`Androidバックアップが大きすぎます（上限 ${formatBytes(MAX_UPLOAD_BYTES)}）`);
    }
    reservation.resizeReservedBytes(written);
    reservation.resizeInputBytes(written);
    return queueRestore(session, sourcePath, workDir, reservation);
  } catch (error) {
    if (workDir) {
      await reservation.cleanupAndRelease(() => removeAndroidWorkDir(workDir!));
    } else reservation.release();
    throw error;
  }
}

/**
 * Reverse proxy の body size 制限を避けるための分割アップロードを開始する。
 * chunk 自体は 1 MiB を十分下回るため、Nginx の既定 client_max_body_size=1m でも通る。
 */
export async function createAndroidBackupChunkUpload(
  accountId: string,
  sourceName: string,
  includeMedia: boolean,
  expectedBytes: number,
): Promise<{ uploadId: string; chunkSize: number }> {
  return withUploadLock(accountId, async () => {
    if (!accountId) throw new Error("accountId が必要です");
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
      throw new Error("Androidバックアップのファイルサイズが不正です");
    }
    if (expectedBytes > MAX_UPLOAD_BYTES) {
      throw new Error(`Androidバックアップが大きすぎます（上限 ${formatBytes(MAX_UPLOAD_BYTES)}）`);
    }

    await pruneStaleChunkUploads();
    const reservedBytes = [...chunkUploads.values()]
      .filter((upload) => upload.accountId === accountId)
      .reduce((total, upload) => total + upload.expectedBytes, 0);
    if (reservedBytes + expectedBytes > MAX_UPLOAD_BYTES) {
      throw new Error(
        "このアカウントのアップロード中データが10GBを超えます。先のアップロードを完了または中止してください",
      );
    }
    const reservation = reserveHeavyBackupWork(accountId, expectedBytes);
    let workDir: string | null = null;
    try {
      await withDiskBackedWorkCapacityLock(() =>
        assertDiskBackedWorkFreeSpace(expectedBytes, reservation.reservedBytes),
      );
      const id = `android-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      workDir = await createAndroidWorkDir(`upload-${id}-`);
      const sourcePath = join(workDir, "source.bin");
      await writeFile(sourcePath, new Uint8Array());
      chunkUploads.set(id, {
        id,
        accountId,
        sourceName: sanitizeDisplayName(sourceName),
        includeMedia,
        expectedBytes,
        receivedBytes: 0,
        nextIndex: 0,
        workDir,
        sourcePath,
        updatedAt: Date.now(),
        reservation,
      });
      return { uploadId: id, chunkSize: CHUNK_UPLOAD_BYTES };
    } catch (error) {
      if (workDir) {
        await reservation.cleanupAndRelease(() => removeAndroidWorkDir(workDir!));
      } else reservation.release();
      throw error;
    }
  });
}

export async function cancelAndroidBackupChunkUpload(
  accountId: string,
  uploadId: string,
): Promise<void> {
  return withUploadLock(accountId, async () => {
    const upload = chunkUploads.get(uploadId);
    if (!upload || upload.accountId !== accountId) return;
    await upload.reservation.cleanupAndRelease(async () => {
      await removeAndroidWorkDir(upload.workDir);
      chunkUploads.delete(uploadId);
    });
  });
}

async function readUploadChunk(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new Error("空のchunkは受け付けられません");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CHUNK_UPLOAD_BYTES) throw new Error("chunkが大きすぎます");
      parts.push(value);
    }
    return Buffer.concat(parts, bytes);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function appendAndroidBackupChunk(
  accountId: string,
  uploadId: string,
  index: number,
  request: Request,
): Promise<{ receivedBytes: number; expectedBytes: number; nextIndex: number }> {
  return withUploadLock(accountId, async () => {
    const upload = chunkUploads.get(uploadId);
    if (!upload || upload.accountId !== accountId) {
      throw new Error("Androidバックアップのアップロードセッションが見つかりません");
    }
    if (!Number.isInteger(index) || index < 0) throw new Error("chunk index が不正です");

    if (index < upload.nextIndex) {
      upload.updatedAt = Date.now();
      return {
        receivedBytes: upload.receivedBytes,
        expectedBytes: upload.expectedBytes,
        nextIndex: upload.nextIndex,
      };
    }
    if (index !== upload.nextIndex) {
      throw new Error(`chunk順序が不正です（expected=${upload.nextIndex}, received=${index}）`);
    }

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > CHUNK_UPLOAD_BYTES) {
      throw new Error(`chunkが大きすぎます（上限 ${formatBytes(CHUNK_UPLOAD_BYTES)}）`);
    }
    const bytes = await readUploadChunk(request);
    if (bytes.byteLength <= 0) throw new Error("空のchunkは受け付けられません");
    if (bytes.byteLength > CHUNK_UPLOAD_BYTES) {
      throw new Error(`chunkが大きすぎます（上限 ${formatBytes(CHUNK_UPLOAD_BYTES)}）`);
    }
    if (upload.receivedBytes + bytes.byteLength > upload.expectedBytes) {
      throw new Error("アップロードサイズが宣言されたファイルサイズを超えました");
    }

    await withDiskBackedWorkCapacityLock(async () => {
      await assertDiskBackedWorkFreeSpace(bytes.byteLength, upload.reservation.reservedBytes);
      await appendFile(upload.sourcePath, bytes);
      upload.receivedBytes += bytes.byteLength;
      upload.nextIndex += 1;
      upload.updatedAt = Date.now();
    });
    return {
      receivedBytes: upload.receivedBytes,
      expectedBytes: upload.expectedBytes,
      nextIndex: upload.nextIndex,
    };
  });
}

export async function completeAndroidBackupChunkUpload(
  accountId: string,
  uploadId: string,
): Promise<AndroidBackupSession> {
  return withUploadLock(accountId, async () => {
    const upload = chunkUploads.get(uploadId);
    if (!upload || upload.accountId !== accountId) {
      throw new Error("Androidバックアップのアップロードセッションが見つかりません");
    }
    if (upload.receivedBytes !== upload.expectedBytes) {
      throw new Error(
        `アップロードが未完了です（${formatBytes(upload.receivedBytes)} / ${formatBytes(upload.expectedBytes)}）`,
      );
    }

    const actualBytes = (await stat(upload.sourcePath)).size;
    if (actualBytes !== upload.expectedBytes) {
      await upload.reservation.cleanupAndRelease(async () => {
        await removeAndroidWorkDir(upload.workDir);
        chunkUploads.delete(uploadId);
      });
      throw new Error(
        `アップロード済みファイルサイズが一致しません（${formatBytes(actualBytes)} / ${formatBytes(upload.expectedBytes)}）`,
      );
    }
    const session = createRestoreSession(
      upload.accountId,
      upload.sourceName,
      upload.includeMedia,
      actualBytes,
    );
    const queued = queueRestore(session, upload.sourcePath, upload.workDir, upload.reservation);
    chunkUploads.delete(uploadId);
    return queued;
  });
}

export function getAndroidBackupSession(
  accountId: string,
  id: string,
): AndroidBackupSession | null {
  pruneCompletedSessions();
  const session = sessions.get(id);
  return session?.accountId === accountId ? session : null;
}

async function runRestore(
  session: AndroidBackupSession,
  sourcePath: string,
  workDir: string,
  reservation: HeavyBackupWorkReservation,
): Promise<void> {
  session.status = "running";
  try {
    const sourceBytes = (await stat(sourcePath)).size;
    let extractedBytes = 0;
    let measuredWorkBytes = sourceBytes;
    await updateWorkReservation(reservation, sourceBytes, false);
    const sourceKind = await detectBackupKind(sourcePath);
    let databasePath = sourcePath;
    let mediaRoot: string | null = null;

    if (sourceKind === "zip") {
      session.progress = {
        stage: "extract",
        current: 0,
        total: (await stat(sourcePath)).size,
        message: session.includeMedia
          ? "DBとAndroidの保存済みメディアを展開しています"
          : "AndroidバックアップからDBを取り出しています",
      };
      const extracted = await extractAndroidZip(
        sourcePath,
        join(workDir, "extracted"),
        session.includeMedia,
        (current, total, file) => {
          session.progress = {
            stage: "extract",
            current,
            total,
            message: session.includeMedia
              ? "DBとAndroidの保存済みメディアを展開しています"
              : "AndroidバックアップからDBを取り出しています",
            ...(file ? { file } : {}),
          };
        },
        async (reservedExtractionBytes) => {
          const projectedWorkBytes = sourceBytes + reservedExtractionBytes;
          await updateWorkReservation(reservation, projectedWorkBytes, true);
        },
      );
      databasePath = extracted.databasePath;
      mediaRoot = extracted.mediaRoot;
      extractedBytes = extracted.extractedBytes;
      measuredWorkBytes = sourceBytes + extractedBytes;
      reservation.resizeReservedBytes(measuredWorkBytes);
    }

    const token = await getToken(session.accountId);
    const selfMid =
      token?.mid?.trim() || String(getClient(session.accountId)?.base.profile?.mid ?? "").trim();
    if (!selfMid) {
      throw new Error(
        "復元先LINEアカウントのMIDを確認できません。再ログインしてから実行してください",
      );
    }

    const stagingPath = join(workDir, "android-import.sqlite");
    const staged = await stageAndroidDatabase(
      databasePath,
      stagingPath,
      selfMid,
      ({ phase, current, total }) => {
        const messages: Record<AndroidDatabaseStagingProgress["phase"], string> = {
          metadata: "Androidのチャット情報を解析しています",
          reactions: "Androidのリアクションを解析しています",
          messages: "Androidのトーク履歴を解析しています",
          chats: "復元するチャットを整理しています",
        };
        session.progress = {
          stage: "parse",
          current,
          total,
          message: messages[phase],
        };
      },
      async (stagingBytes) => {
        measuredWorkBytes = Math.max(
          measuredWorkBytes,
          sourceBytes + extractedBytes + stagingBytes,
        );
        await updateWorkReservation(reservation, measuredWorkBytes, false);
      },
    );

    let mediaPlan = { count: 0, sizeBytes: 0 };
    let restoredChatMids: string[] = [];
    const staging = new AndroidBackupStaging(stagingPath);
    try {
      if (session.includeMedia && mediaRoot) {
        session.progress = {
          stage: "media-plan",
          current: 0,
          total: Math.max(1, staged.mediaRefs),
          message: "Androidの保存済みメディアを確認しています",
        };
        await planAndroidMediaFromStaging(
          session.accountId,
          mediaRoot,
          staging,
          (current, total) => {
            session.progress = {
              stage: "media-plan",
              current,
              total,
              message: "Androidの保存済みメディアを確認しています",
            };
          },
        );
        mediaPlan = staging.mediaPlanStats();
      }
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
      // Publish new media first, then commit SQLite. A failed copy or merge rolls
      // back only media created by this restore; existing saved media is untouched.
      if (session.includeMedia && mediaRoot) {
        session.progress = {
          stage: "media",
          current: 0,
          total: Math.max(1, mediaPlan.count),
          message: "Androidの保存済みメディアを紐付けています",
        };
        const stagedMedia = new AndroidBackupStaging(stagingPath);
        try {
          media = await restoreAndroidMediaFromStaging(
            session.accountId,
            stagedMedia,
            importedMedia,
            (current, total) => {
              session.progress = {
                stage: "media",
                current,
                total: Math.max(1, total),
                message: "Androidの保存済みメディアを紐付けています",
              };
            },
          );
          media.skipped += staged.mediaRefs - mediaPlan.count;
        } finally {
          stagedMedia.close();
        }
      }

      session.progress = {
        stage: "merge",
        current: 0,
        total: Math.max(1, staged.chats + staged.totalMessages),
        message: "Androidのトーク履歴をVylineへ統合しています",
      };
      merged = await mergeImportedChatDbFromStaging(
        session.accountId,
        stagingPath,
        maxHistoryBytes,
        ({ current, total }) => {
          session.progress = {
            stage: "merge",
            current,
            total: Math.max(1, total),
            message: "Androidのトーク履歴をVylineへ統合しています",
          };
        },
      );
    } catch (error) {
      await rollbackImportedMedia(session.accountId, importedMedia, "Android");
      throw error;
    }

    session.progress = {
      stage: "save",
      current: 1,
      total: 1,
      message: "復元結果を保存しています",
    };
    await flushAccountChatDb(session.accountId).catch((error) => {
      log.warn({ error, accountId: session.accountId }, "Android restore WAL checkpoint deferred");
    });

    session.result = {
      sourceName: session.sourceName,
      sourceKind,
      databaseVersion: staged.databaseVersion,
      restoredAt: new Date().toISOString(),
      parsed: {
        chats: staged.chats,
        totalMessages: staged.totalMessages,
        reactions: staged.reactions,
        unsupportedReactions: staged.unsupportedReactions,
      },
      restoredChatMids,
      merged,
      media,
    };
    session.status = "completed";
    session.completedAt = Date.now();
  } catch (error) {
    session.status = "failed";
    session.error =
      error instanceof Error ? error.message : "Androidバックアップの復元に失敗しました";
    session.completedAt = Date.now();
    log.warn(
      { accountId: session.accountId, sourceName: session.sourceName, error },
      "Android backup restore failed",
    );
  }
}

async function detectBackupKind(path: string): Promise<"sqlite" | "zip"> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (header.toString("latin1") === SQLITE_MAGIC) return "sqlite";
    if (header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b) return "zip";
    throw new Error("SQLiteの naver_line DB または対応バックアップZIPを選択してください");
  } finally {
    await handle.close();
  }
}

export async function extractAndroidZip(
  sourcePath: string,
  outputDir: string,
  includeMedia: boolean,
  onProgress?: (current: number, total: number, file?: string) => void,
  onReservedBytes?: (bytes: number) => Promise<void>,
): Promise<ExtractedAndroidZip> {
  mkdirSync(outputDir, { recursive: true });
  const total = (await stat(sourcePath)).size;
  const maxArchiveEntries = Number(process.env.VYLINE_ANDROID_BACKUP_MAX_ENTRIES ?? 100_000);
  let current = 0;
  let extractedBytes = 0;
  let archiveEntries = 0;
  let extractionError: Error | null = null;
  const databaseCandidates: Array<{ path: string; rank: number }> = [];
  const endTasks: Promise<unknown>[] = [];
  const startTasks: Promise<void>[] = [];
  const writers = new Set<ReturnType<ReturnType<typeof Bun.file>["writer"]>>();
  const claimedTargets = new Set<string>();
  let dbIndex = 0;
  let extractedMedia = false;
  let entryCount = 0;
  let reservedExtractionBytes = 0;
  let declaredArchiveBytes = 0;
  let processedArchiveBytes = 0;

  const unzipper = new Unzip((file) => {
    entryCount++;
    if (!extractionError && entryCount > MAX_ZIP_ENTRIES) {
      extractionError = new Error(
        `AndroidバックアップのZIPエントリ数が上限 ${MAX_ZIP_ENTRIES.toLocaleString()} 件を超えます`,
      );
    }
    if (extractionError) return;
    archiveEntries += 1;
    if (archiveEntries > maxArchiveEntries) {
      extractionError = new Error(
        `AndroidバックアップのZIPエントリ数が上限 ${maxArchiveEntries} を超えます`,
      );
      return;
    }
    const name = file.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const dbRank = androidDatabaseCandidateRank(name);
    const media = includeMedia ? parseAndroidMediaEntry(name) : null;

    const hasDeclaredSize = file.originalSize !== undefined;
    const declaredSize = Number(file.originalSize ?? 0);
    if (hasDeclaredSize && (!Number.isSafeInteger(declaredSize) || declaredSize < 0)) {
      extractionError = new Error("AndroidバックアップのZIPエントリサイズが不正です");
      return;
    }
    if (hasDeclaredSize) {
      if (declaredSize > MAX_EXTRACT_BYTES - declaredArchiveBytes) {
        extractionError = new Error(
          `Androidバックアップの展開サイズが上限 ${formatBytes(MAX_EXTRACT_BYTES)} を超えます`,
        );
        return;
      }
      declaredArchiveBytes += declaredSize;
    }

    let processedForFile = 0;
    const accountOutput = (chunkBytes: number): boolean => {
      if (hasDeclaredSize && chunkBytes > declaredSize - processedForFile) {
        extractionError = new Error("AndroidバックアップのZIPエントリが宣言サイズを超えました");
        try {
          file.terminate();
        } catch {
          // ignore
        }
        return false;
      }
      if (chunkBytes > MAX_EXTRACT_BYTES - processedArchiveBytes) {
        extractionError = new Error(
          `Androidバックアップの展開サイズが上限 ${formatBytes(MAX_EXTRACT_BYTES)} を超えます`,
        );
        try {
          file.terminate();
        } catch {
          // ignore
        }
        return false;
      }
      processedForFile += chunkBytes;
      processedArchiveBytes += chunkBytes;
      return true;
    };
    const validateFinalSize = (final: boolean): boolean => {
      if (!final || !hasDeclaredSize || processedForFile === declaredSize) return true;
      extractionError = new Error("AndroidバックアップのZIPエントリサイズが宣言と一致しません");
      try {
        file.terminate();
      } catch {
        // ignore
      }
      return false;
    };

    if (dbRank === null && !media) {
      file.ondata = (error, chunk, final) => {
        if (error) {
          extractionError = error instanceof Error ? error : new Error(String(error));
          return;
        }
        if (!accountOutput(chunk.byteLength)) return;
        validateFinalSize(final);
      };
      try {
        // fflate buffers every compressed chunk until start() is called. Consume
        // ignored entries as a bounded stream instead of retaining them in RAM.
        file.start();
      } catch (error) {
        extractionError = error instanceof Error ? error : new Error(String(error));
      }
      return;
    }

    const bytesToReserve = hasDeclaredSize
      ? declaredSize
      : MAX_EXTRACT_BYTES - reservedExtractionBytes;
    if (
      !Number.isSafeInteger(bytesToReserve) ||
      bytesToReserve < 0 ||
      reservedExtractionBytes + bytesToReserve > MAX_EXTRACT_BYTES
    ) {
      extractionError = new Error(
        `Androidバックアップの展開サイズが上限 ${formatBytes(MAX_EXTRACT_BYTES)} を超えます`,
      );
      return;
    }
    reservedExtractionBytes += bytesToReserve;
    const entryReservedTotal = reservedExtractionBytes;

    const target = media
      ? join(outputDir, "media", media.chatMid, media.fileName)
      : join(outputDir, `database-${dbIndex++}.sqlite`);
    const normalizedTarget = resolve(target).replace(/\\/g, "/").toLowerCase();
    if (claimedTargets.has(normalizedTarget)) {
      extractionError = new Error(
        `Androidバックアップ内の複数エントリが同じ展開先を指しています: ${basename(target)}`,
      );
      return;
    }
    claimedTargets.add(normalizedTarget);
    mkdirSync(dirname(target), { recursive: true });
    const writer = Bun.file(target).writer({ highWaterMark: 1024 * 1024 });
    writers.add(writer);
    let writtenForFile = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        extractionError = error instanceof Error ? error : new Error(String(error));
        try {
          file.terminate();
        } catch {
          // ignore
        }
        return;
      }
      try {
        if (!accountOutput(chunk.byteLength) || !validateFinalSize(final)) return;
        writtenForFile += chunk.byteLength;
        extractedBytes += chunk.byteLength;
        if (chunk.byteLength > 0) writer.write(chunk);
        if (final) {
          writers.delete(writer);
          endTasks.push(Promise.resolve(writer.end()));
          if (media) {
            extractedMedia = extractedMedia || writtenForFile > 0;
          } else {
            databaseCandidates.push({ path: target, rank: dbRank ?? 99 });
          }
        }
      } catch (writeError) {
        extractionError = writeError instanceof Error ? writeError : new Error(String(writeError));
        try {
          file.terminate();
        } catch {
          // ignore
        }
      }
    };
    onProgress?.(current, total, basename(name));
    startTasks.push(
      Promise.resolve()
        .then(async () => {
          await onReservedBytes?.(entryReservedTotal);
          if (!extractionError) file.start();
        })
        .catch((error) => {
          extractionError = error instanceof Error ? error : new Error(String(error));
          try {
            file.terminate();
          } catch {
            // ignore
          }
        }),
    );
  });
  unzipper.register(UnzipInflate);

  try {
    for await (const chunk of Bun.file(sourcePath).stream()) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      current += bytes.byteLength;
      unzipper.push(bytes, false);
      await Promise.all(startTasks.splice(0));
      if (extractionError) throw extractionError;
      await Promise.all([...endTasks.splice(0), ...[...writers].map((writer) => writer.flush())]);
      onProgress?.(Math.min(current, total), total);
    }
    unzipper.push(new Uint8Array(), true);
    await Promise.all(startTasks.splice(0));
    if (extractionError) throw extractionError;
    await Promise.all(endTasks.splice(0));
  } finally {
    await Promise.allSettled([...endTasks, ...[...writers].map((writer) => writer.end())]);
  }

  const database = databaseCandidates.sort((a, b) => a.rank - b.rank)[0];
  if (!database || !existsSync(database.path)) {
    throw new Error("ZIP内に naver_line DB が見つかりませんでした");
  }
  return {
    databasePath: database.path,
    mediaRoot: includeMedia && extractedMedia ? join(outputDir, "media") : null,
    extractedBytes,
  };
}

function androidDatabaseCandidateRank(name: string): number | null {
  const lower = name.toLowerCase();
  if (/(^|\/)database\/naver_line(?:\.db)?$/.test(lower)) return 0;
  if (/(^|\/)naver_line(?:\.db)?$/.test(lower)) return 1;
  if (/(^|\/)chats\/naver_line_backup_[^/]+\.db$/.test(lower)) return 2;
  return null;
}

function parseAndroidMediaEntry(name: string): { chatMid: string; fileName: string } | null {
  const match = name.match(
    /(?:^|\/)chats\/([a-z0-9_-]{4,128})\/messages\/(\d+)(\.original|\.thumb)?$/i,
  );
  if (!match) return null;
  const chatMid = match[1];
  const messageId = match[2];
  if (!chatMid || !messageId) return null;
  return { chatMid, fileName: `${messageId}${match[3] ?? ""}` };
}

function sourceTableRowCount(db: Database, table: string): number {
  const row = db.query(`SELECT count(*) AS count FROM "${table}"`).get() as {
    count: number | bigint;
  };
  return Number(row.count);
}

async function sqliteBundleBytes(path: string): Promise<number> {
  let total = 0;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    total += (await stat(candidate).catch(() => null))?.size ?? 0;
  }
  return total;
}

function sourceColumnProjection(db: Database, table: string, columns: string[]): string {
  const available = new Set(
    (db.query(`PRAGMA table_info("${table}")`).all() as AndroidRow[])
      .map((row) => asString(row.name))
      .filter(Boolean),
  );
  return columns
    .map((column) => (available.has(column) ? `"${column}"` : `NULL AS "${column}"`))
    .join(", ");
}

function stagedReactionFromRow(row: AndroidRow): {
  staged: StagedAndroidReaction | null;
  restored: number;
  unsupported: number;
} {
  const messageId = asString(row.server_message_id);
  const fromMid = asString(row.member_id);
  const rawType = asString(row.reaction_type);
  const customReaction = asString(row.custom_reaction);
  const type = androidReactionType(rawType);
  const atMillis = asNumber(row.reaction_time_millis);
  if (messageId && fromMid && type) {
    return {
      staged: {
        messageId,
        supported: { fromMid, atMillis, type },
        unsupported: null,
      },
      restored: 1,
      unsupported: 0,
    };
  }
  if (!rawType && !customReaction) return { staged: null, restored: 0, unsupported: 0 };
  return {
    staged: messageId
      ? {
          messageId,
          supported: null,
          unsupported: {
            fromMid,
            atMillis,
            reactionType: rawType,
            customReaction,
          },
        }
      : null,
    restored: 0,
    unsupported: 1,
  };
}

function androidMessageId(row: AndroidRow): string {
  const localId = asString(row.id);
  if (!localId) return "";
  const serverId = asString(row.server_id);
  return serverId && serverId !== "0" ? serverId : `android-local-${localId}`;
}

function stagedMessageFromAndroidRow(
  row: AndroidRow,
  selfMid: string,
  savedAt: string,
  reactions: { supported: MessageReaction[]; unsupported: UnsupportedAndroidReaction[] },
): StagedAndroidMessage | null {
  const chatMid = asString(row.chat_id);
  const localId = asString(row.id);
  const messageId = androidMessageId(row);
  if (!chatMid || !localId || !messageId) return null;
  const rawFrom = asString(row.from_mid);
  const isMyMessage = !rawFrom || rawFrom === selfMid;
  const from = isMyMessage ? selfMid : rawFrom;
  const historyType = asNumber(row.type);
  const attachmentType = asNumber(row.attachement_type);
  const rawParameter = asNullableString(row.parameter);
  const parsedMetadata = parseAndroidParameter(rawParameter);
  const contentMetadata: MessageContentMeta | null =
    parsedMetadata || reactions.unsupported.length
      ? {
          ...(parsedMetadata ?? {}),
          ...(reactions.unsupported.length
            ? { ANDROID_CUSTOM_REACTIONS: JSON.stringify(reactions.unsupported) }
            : {}),
        }
      : null;
  const contentType = androidContentType(historyType, attachmentType);
  const relationType = String(contentMetadata?.message_relation_type_code ?? "").toLowerCase();
  const relationId = String(contentMetadata?.message_relation_server_message_id ?? "").trim();
  const createdTime = asNumber(row.created_time);
  const readCount = asNumber(row.read_count);
  const unsent = isAndroidUnsentRow(historyType, rawParameter);
  const stickerOption = String(contentMetadata?.STKOPT ?? "").toUpperCase();
  return {
    message: {
      id: messageId,
      chatMid,
      from,
      to: isMyMessage || chatMid.startsWith("c") || chatMid.startsWith("r") ? chatMid : selfMid,
      text: unsent ? null : asNullableString(row.content),
      contentType: unsent ? "UNSENT" : contentType,
      createdTime: Number.isFinite(createdTime) ? createdTime : 0,
      isMyMessage,
      ...(contentMetadata ? { contentMetadata } : {}),
      ...(readCount > 0 ? { readCount } : {}),
      ...(relationType === "reply" && relationId ? { relatedMessageId: relationId } : {}),
      ...(stickerOption.includes("A") ? { stickerAnimated: true } : {}),
      ...(reactions.supported.length ? { reactions: reactions.supported } : {}),
      ...(unsent ? { messageState: isMyMessage ? "revoked-by-self" : "revoked-by-other" } : {}),
      savedAt,
    },
    localId,
    mediaContentType: MEDIA_CONTENT_TYPES.has(contentType) ? contentType : null,
  };
}

/**
 * Production Android import parser. It keeps at most STAGING_BATCH_SIZE source
 * rows in memory and writes normalized rows directly to a disk-backed SQLite DB.
 */
export async function stageAndroidDatabase(
  dbPath: string,
  stagingPath: string,
  selfMid: string,
  onProgress?: (progress: AndroidDatabaseStagingProgress) => void,
  onStagingBytes?: (bytes: number) => Promise<void>,
): Promise<StagedAndroidDatabaseSummary> {
  const source = new Database(dbPath, { readonly: true, safeIntegers: true, strict: true });
  const staging = new AndroidBackupStaging(stagingPath);
  try {
    source.exec("PRAGMA query_only = ON");
    source.exec("PRAGMA cache_size = -2048");
    source.exec("PRAGMA mmap_size = 0");
    source.exec("PRAGMA temp_store = FILE");
    await onStagingBytes?.(await sqliteBundleBytes(stagingPath));

    const tables = new Set(
      (source.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as AndroidRow[])
        .map((row) => asString(row.name))
        .filter(Boolean),
    );
    if (!tables.has("chat_history")) {
      throw new Error(
        "chat_history テーブルがないため、LINE Androidの naver_line DB として読めません",
      );
    }

    const databaseVersion = Number(
      (source.query("PRAGMA user_version").get() as AndroidRow | null)?.user_version ?? 0,
    );
    staging.setMeta("databaseVersion", databaseVersion);
    const metadataTotal = ["chat", "groups", "contacts"]
      .filter((table) => tables.has(table))
      .reduce((sum, table) => sum + sourceTableRowCount(source, table), 0);
    let metadataCurrent = 0;
    onProgress?.({ phase: "metadata", current: 0, total: Math.max(1, metadataTotal) });

    if (tables.has("chat")) {
      let batch: Array<{ mid: string; seed: AndroidChatSeed }> = [];
      for (const row of source
        .query("SELECT * FROM chat")
        .iterate() as IterableIterator<AndroidRow>) {
        const mid = asString(row.chat_id);
        if (mid) {
          batch.push({
            mid,
            seed: {
              chatName: asString(row.chat_name),
              messageCount: asNumber(row.message_count),
              readMessageCount: asNumber(row.read_message_count),
              type: asNumber(row.type),
            },
          });
        }
        metadataCurrent++;
        if (metadataCurrent % STAGING_BATCH_SIZE === 0) {
          staging.writeChatSeeds(batch);
          batch = [];
          onProgress?.({
            phase: "metadata",
            current: metadataCurrent,
            total: Math.max(1, metadataTotal),
          });
          await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
          await yieldToEventLoop();
        }
      }
      staging.writeChatSeeds(batch);
    }

    const nameTables: Array<{ table: "groups" | "contacts"; priority: number }> = [
      { table: "groups", priority: 0 },
      { table: "contacts", priority: 1 },
    ];
    for (const { table, priority } of nameTables) {
      if (!tables.has(table)) continue;
      let batch: Array<{ mid: string; name: string; priority: number }> = [];
      for (const row of source
        .query(`SELECT * FROM "${table}"`)
        .iterate() as IterableIterator<AndroidRow>) {
        const mid = firstString(
          row,
          table === "groups" ? ["id", "mid", "m_id"] : ["m_id", "mid", "id"],
        );
        const name = firstString(
          row,
          table === "groups"
            ? ["name", "group_name", "display_name"]
            : ["custom_name", "name", "display_name", "contact_name"],
        );
        if (mid && name) batch.push({ mid, name, priority });
        metadataCurrent++;
        if (metadataCurrent % STAGING_BATCH_SIZE === 0) {
          staging.writeNames(batch);
          batch = [];
          onProgress?.({
            phase: "metadata",
            current: metadataCurrent,
            total: Math.max(1, metadataTotal),
          });
          await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
          await yieldToEventLoop();
        }
      }
      staging.writeNames(batch);
    }
    onProgress?.({
      phase: "metadata",
      current: Math.max(1, metadataTotal),
      total: Math.max(1, metadataTotal),
    });
    await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
    await yieldToEventLoop();

    let restoredReactions = 0;
    let unsupportedReactions = 0;
    const reactionTotal = tables.has("reactions") ? sourceTableRowCount(source, "reactions") : 0;
    let reactionCurrent = 0;
    onProgress?.({ phase: "reactions", current: 0, total: Math.max(1, reactionTotal) });
    if (tables.has("reactions")) {
      let batch: StagedAndroidReaction[] = [];
      for (const row of source
        .query("SELECT * FROM reactions")
        .iterate() as IterableIterator<AndroidRow>) {
        const parsed = stagedReactionFromRow(row);
        restoredReactions += parsed.restored;
        unsupportedReactions += parsed.unsupported;
        if (parsed.staged) batch.push(parsed.staged);
        reactionCurrent++;
        if (reactionCurrent % STAGING_BATCH_SIZE === 0) {
          staging.writeReactions(batch);
          batch = [];
          onProgress?.({
            phase: "reactions",
            current: reactionCurrent,
            total: Math.max(1, reactionTotal),
          });
          await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
          await yieldToEventLoop();
        }
      }
      staging.writeReactions(batch);
    }
    staging.setMeta("reactions", restoredReactions);
    staging.setMeta("unsupportedReactions", unsupportedReactions);
    onProgress?.({
      phase: "reactions",
      current: Math.max(1, reactionTotal),
      total: Math.max(1, reactionTotal),
    });
    await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
    await yieldToEventLoop();

    const messageTotal = sourceTableRowCount(source, "chat_history");
    const historyProjection = sourceColumnProjection(source, "chat_history", [
      "id",
      "server_id",
      "type",
      "chat_id",
      "from_mid",
      "content",
      "created_time",
      "read_count",
      "attachement_type",
      "parameter",
    ]);
    let messageCurrent = 0;
    const savedAt = new Date().toISOString();
    onProgress?.({ phase: "messages", current: 0, total: Math.max(1, messageTotal) });
    let historyBatch: AndroidRow[] = [];
    const flushHistoryBatch = async () => {
      if (historyBatch.length === 0) return;
      const reactions = staging.reactionsForMessages(historyBatch.map(androidMessageId));
      const stagedRows: StagedAndroidMessage[] = [];
      for (const row of historyBatch) {
        const messageId = androidMessageId(row);
        const staged = stagedMessageFromAndroidRow(
          row,
          selfMid,
          savedAt,
          reactions.get(messageId) ?? { supported: [], unsupported: [] },
        );
        if (staged) stagedRows.push(staged);
      }
      staging.writeMessages(stagedRows, mergeAndroidDuplicateMessage);
      historyBatch = [];
      if (messageCurrent % 5_000 === 0) Bun.gc(true);
      onProgress?.({
        phase: "messages",
        current: messageCurrent,
        total: Math.max(1, messageTotal),
      });
      await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
      await yieldToEventLoop();
    };
    for (const row of source
      .query(`SELECT ${historyProjection} FROM chat_history`)
      .iterate() as IterableIterator<AndroidRow>) {
      historyBatch.push(row);
      messageCurrent++;
      if (historyBatch.length >= STAGING_BATCH_SIZE) await flushHistoryBatch();
    }
    await flushHistoryBatch();
    onProgress?.({
      phase: "messages",
      current: Math.max(1, messageTotal),
      total: Math.max(1, messageTotal),
    });

    const chatTotal = staging.chatCandidateCount();
    let chatCurrent = 0;
    let afterMid = "";
    onProgress?.({ phase: "chats", current: 0, total: Math.max(1, chatTotal) });
    for (;;) {
      const mids = staging.chatMidPage(afterMid, STAGING_BATCH_SIZE);
      if (mids.length === 0) break;
      const chats: StoredChat[] = [];
      for (const mid of mids) {
        const seed = staging.chatSeed(mid);
        const parsedMessageCount = staging.messageCount(mid);
        const latest = staging.latestMessage(mid);
        const declaredMessageCount = seed?.messageCount ?? parsedMessageCount;
        const readMessageCount = seed?.readMessageCount ?? declaredMessageCount;
        const unreadCount = Math.max(0, declaredMessageCount - readMessageCount);
        chats.push({
          mid,
          name: seed?.chatName || staging.displayName(mid) || mid,
          kind: androidChatKind(mid, seed?.type ?? 0),
          hasMessages: parsedMessageCount > 0,
          restoredHistory: true,
          ...(latest
            ? {
                lastMessageTime: latest.createdTime,
                lastMessageId: latest.id,
                lastMessagePreview: previewForStoredMessage(latest),
              }
            : {}),
          ...(unreadCount > 0 ? { unreadCount } : {}),
          updatedAt: savedAt,
        });
      }
      staging.writeChats(chats);
      afterMid = mids.at(-1) ?? afterMid;
      chatCurrent += mids.length;
      onProgress?.({
        phase: "chats",
        current: chatCurrent,
        total: Math.max(1, chatTotal),
      });
      await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
      await yieldToEventLoop();
    }

    const counts = staging.counts();
    staging.checkpoint();
    await onStagingBytes?.(await sqliteBundleBytes(stagingPath));
    return {
      stagingPath,
      databaseVersion,
      chats: counts.chats,
      totalMessages: counts.messages,
      mediaRefs: counts.mediaRefs,
      reactions: restoredReactions,
      unsupportedReactions,
    };
  } finally {
    staging.close();
    source.close();
  }
}

function isAndroidUnsentRow(historyType: number, rawParameter: string | null): boolean {
  if (UNSENT_HISTORY_TYPES.has(historyType)) return true;
  const marker = rawParameter?.trim().toLowerCase() ?? "";
  return marker === "limesunsend" || marker === "leinsunsend";
}

function isStoredUnsent(message: StoredMessage): boolean {
  return (
    message.contentType === "UNSENT" ||
    message.messageState === "revoked-by-self" ||
    message.messageState === "revoked-by-other"
  );
}

function snapshotFromAndroidMessage(message: StoredMessage): MessageSnapshot {
  const snapshot: MessageSnapshot = {
    id: message.id,
    from: message.from,
    to: message.to,
    text: message.text,
    contentType: message.contentType,
    createdTime: message.createdTime,
    isMyMessage: message.isMyMessage,
  };
  if (message.contentMetadata !== undefined) {
    snapshot.contentMetadata = message.contentMetadata;
  }
  if (message.readCount !== undefined) snapshot.readCount = message.readCount;
  if (message.readBy !== undefined) snapshot.readBy = message.readBy;
  if (message.seen !== undefined) snapshot.seen = message.seen;
  if (message.relatedMessageId !== undefined) {
    snapshot.relatedMessageId = message.relatedMessageId;
  }
  if (message.reactions !== undefined) snapshot.reactions = message.reactions;
  if (message.stickerAnimated !== undefined) {
    snapshot.stickerAnimated = message.stickerAnimated;
  }
  if (message.stickerSticky !== undefined) snapshot.stickerSticky = message.stickerSticky;
  if (message.messageState !== undefined) snapshot.messageState = message.messageState;
  return snapshot;
}

function mergeAndroidDuplicateMessage(
  previous: StoredMessage | undefined,
  incoming: StoredMessage,
): StoredMessage {
  if (!previous) return incoming;
  const previousUnsent = isStoredUnsent(previous);
  const incomingUnsent = isStoredUnsent(incoming);

  if (incomingUnsent && !previousUnsent) {
    return {
      ...previous,
      contentType: "UNSENT",
      text: null,
      messageState: previous.isMyMessage ? "revoked-by-self" : "revoked-by-other",
      revokedSnapshot: previous.revokedSnapshot ?? snapshotFromAndroidMessage(previous),
      history: [
        ...(previous.history ?? []),
        {
          state: previous.messageState ?? "normal",
          text: previous.text,
          contentType: previous.contentType,
          updatedTime: incoming.createdTime || previous.createdTime,
        },
      ],
      ...(incoming.reactions?.length ? { reactions: incoming.reactions } : {}),
      savedAt: incoming.savedAt,
    };
  }

  if (previousUnsent && !incomingUnsent) {
    return {
      ...previous,
      revokedSnapshot: previous.revokedSnapshot ?? snapshotFromAndroidMessage(incoming),
      history: previous.history?.length
        ? previous.history
        : [
            {
              state: incoming.messageState ?? "normal",
              text: incoming.text,
              contentType: incoming.contentType,
              updatedTime: previous.createdTime || incoming.createdTime,
            },
          ],
      ...(incoming.reactions?.length ? { reactions: incoming.reactions } : {}),
    };
  }

  if (previousUnsent && incomingUnsent) {
    return {
      ...previous,
      ...(incoming.reactions?.length ? { reactions: incoming.reactions } : {}),
    };
  }

  return androidMessageRichness(incoming) > androidMessageRichness(previous) ? incoming : previous;
}

function androidMessageRichness(message: StoredMessage): number {
  let score = 0;
  if (message.contentType !== "NONE" && !message.contentType.startsWith("ANDROID_")) score += 4;
  if (message.text?.trim()) score += 2;
  if (message.contentMetadata && Object.keys(message.contentMetadata).length > 0) score += 2;
  if (message.relatedMessageId) score += 1;
  if (message.reactions?.length) score += 1;
  return score;
}

export function parseAndroidParameter(value: string | null): MessageContentMeta | null {
  if (!value) return null;
  const parts = value.split("\t");
  const output: MessageContentMeta = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = parts[i]?.trim();
    if (!key) continue;
    output[key] = parts[i + 1] ?? "";
  }
  if (parts.length % 2 === 1 && parts.at(-1)?.trim()) {
    output.ANDROID_PARAMETER_EXTRA = parts.at(-1) ?? "";
  }
  return Object.keys(output).length > 0 ? output : null;
}

export function androidContentType(historyType: number, attachmentType: number): string {
  if (UNSENT_HISTORY_TYPES.has(historyType)) return "UNSENT";
  switch (attachmentType) {
    case 0:
      return historyType === 1 ? "NONE" : historyType > 1 ? `ANDROID_${historyType}` : "NONE";
    case 1:
      return "IMAGE";
    case 2:
      return "VIDEO";
    case 3:
      return "AUDIO";
    case 6:
      return "CALL";
    case 7:
      return "STICKER";
    case 13:
      return "CONTACT";
    case 14:
      return "FILE";
    case 15:
      return "LOCATION";
    case 16:
      return "POSTNOTIFICATION";
    case 17:
      return "RICH";
    case 18:
      return "CHATEVENT";
    case 22:
      return "FLEX";
    default:
      return String(attachmentType);
  }
}

function androidReactionType(value: string): number | null {
  switch (value.trim().toLowerCase()) {
    case "nice":
      return 2;
    case "love":
      return 3;
    case "fun":
      return 4;
    case "amazing":
      return 5;
    case "sad":
      return 6;
    case "omg":
      return 7;
    default:
      return null;
  }
}

async function planAndroidMediaFromStaging(
  accountId: string,
  mediaRoot: string,
  staging: AndroidBackupStaging,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const total = staging.counts().mediaRefs;
  let current = 0;
  let cursor: { chatMid: string; messageId: string } | null = null;
  onProgress?.(0, Math.max(1, total));
  for (;;) {
    const refs = staging.mediaRefPage(cursor, STAGING_BATCH_SIZE);
    if (refs.length === 0) break;
    const plan: PlannedAndroidMedia[] = [];
    for (const ref of refs) {
      if (!/^[a-z0-9_-]{4,128}$/i.test(ref.chatMid) || !/^\d+$/.test(ref.localId)) continue;
      if (await statMediaStorage(accountId, ref.chatMid, ref.messageId)) continue;
      const candidates = [
        join(mediaRoot, ref.chatMid, `${ref.localId}.original`),
        join(mediaRoot, ref.chatMid, ref.localId),
        ...(ref.contentType === "IMAGE"
          ? [join(mediaRoot, ref.chatMid, `${ref.localId}.thumb`)]
          : []),
      ];
      const path = candidates.find((candidate) => existsSync(candidate));
      if (!path) continue;
      const info = await stat(path);
      if (info.isFile()) plan.push({ ...ref, path, sizeBytes: info.size });
    }
    staging.writeMediaPlan(plan);
    current += refs.length;
    const last = refs.at(-1);
    if (last) cursor = { chatMid: last.chatMid, messageId: last.messageId };
    onProgress?.(current, Math.max(1, total));
    await yieldToEventLoop();
  }
}

async function restoreAndroidMediaFromStaging(
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
  onProgress?.(0, Math.max(1, total));
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
      onProgress?.(current, Math.max(1, total));
    }
    const last = refs.at(-1);
    if (last) cursor = { chatMid: last.chatMid, messageId: last.messageId };
    await yieldToEventLoop();
  }
  return { restored, skipped };
}

async function rollbackImportedMedia(
  accountId: string,
  importedMedia: Array<{ chatMid: string; messageId: string }>,
  source: string,
): Promise<void> {
  for (let index = importedMedia.length - 1; index >= 0; index--) {
    const media = importedMedia[index]!;
    await removeMediaStorageEntry(accountId, media.chatMid, media.messageId).catch(
      (cleanupError) => {
        log.warn({ cleanupError, ...media }, `${source} restore media rollback failed`);
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
  if (kind === "IMAGE") return "image/jpeg";
  if (kind === "VIDEO") return "video/mp4";
  if (kind === "AUDIO") return "audio/mp4";
  return "application/octet-stream";
}

function androidChatKind(chatMid: string, type: number): StoredChat["kind"] {
  if (chatMid.startsWith("u") || type === 1) return "direct";
  if (chatMid.startsWith("c") || chatMid.startsWith("r") || type === 2 || type === 3) {
    return "group";
  }
  return "unknown";
}

function previewForStoredMessage(message: StoredMessage): string {
  const text = message.text?.trim();
  if (text) return text.slice(0, 120);
  switch (message.contentType) {
    case "IMAGE":
      return "画像";
    case "VIDEO":
      return "動画";
    case "AUDIO":
      return "音声";
    case "FILE":
      return "ファイル";
    case "STICKER":
      return "スタンプ";
    case "UNSENT":
      return "送信を取り消したメッセージ";
    case "CHATEVENT":
      return "チャットイベント";
    case "CALL":
      return "通話";
    default:
      return message.contentType || "メッセージ";
  }
}

function firstString(row: AndroidRow, keys: string[]): string {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return "";
}

function asString(value: SqlValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Uint8Array) return "";
  return String(value);
}

function asNullableString(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined || value instanceof Uint8Array) return null;
  return String(value);
}

function asNumber(value: SqlValue | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sanitizeDisplayName(value: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  return basename(decoded.replace(/\\/g, "/")).slice(0, 180) || "naver_line";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
