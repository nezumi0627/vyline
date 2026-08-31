import { mkdir, mkdtemp, readdir, rm, stat, statfs } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { BACKUP_STORAGE_LIMIT_BYTES } from "../storage/backupLimits.js";
import { VYLINE_DATA_DIR } from "../storage/vylineStorageInfo.js";

const WORK_ROOT = resolve(VYLINE_DATA_DIR, "tmp", "backup-work");
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
// Android can temporarily hold source + extracted files + normalized staging.
// Persistent media is reserved independently on VYLINE_SAVED_MEDIA_DIR, which
// may be a different Docker volume from this VYLINE_DATA_DIR work root.
const DEFAULT_MAX_WORK_BYTES = 4 * BACKUP_STORAGE_LIMIT_BYTES;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

const HEAVY_WORK_CONCURRENCY = boundedInteger(
  process.env.VYLINE_BACKUP_HEAVY_CONCURRENCY ?? process.env.VYLINE_ANDROID_RESTORE_CONCURRENCY,
  1,
  1,
  4,
);
const HEAVY_WORK_MAX_ITEMS = boundedInteger(
  process.env.VYLINE_BACKUP_HEAVY_MAX_ITEMS,
  8,
  HEAVY_WORK_CONCURRENCY,
  64,
);
const HEAVY_WORK_MAX_ITEMS_PER_ACCOUNT = boundedInteger(
  process.env.VYLINE_BACKUP_HEAVY_MAX_ITEMS_PER_ACCOUNT,
  4,
  1,
  16,
);
const HEAVY_WORK_MAX_RESERVED_BYTES = boundedInteger(
  process.env.VYLINE_BACKUP_HEAVY_MAX_RESERVED_BYTES,
  DEFAULT_MAX_WORK_BYTES,
  1,
  Number.MAX_SAFE_INTEGER,
);
const HEAVY_WORK_MAX_RESERVED_BYTES_PER_ACCOUNT = boundedInteger(
  process.env.VYLINE_BACKUP_HEAVY_MAX_RESERVED_BYTES_PER_ACCOUNT,
  DEFAULT_MAX_WORK_BYTES,
  1,
  Number.MAX_SAFE_INTEGER,
);
const HEAVY_WORK_MAX_INPUT_BYTES = boundedInteger(
  process.env.VYLINE_BACKUP_HEAVY_MAX_INPUT_BYTES,
  BACKUP_STORAGE_LIMIT_BYTES,
  1,
  Number.MAX_SAFE_INTEGER,
);
const HEAVY_WORK_MAX_INPUT_BYTES_PER_ACCOUNT = boundedInteger(
  process.env.VYLINE_BACKUP_HEAVY_MAX_INPUT_BYTES_PER_ACCOUNT,
  BACKUP_STORAGE_LIMIT_BYTES,
  1,
  Number.MAX_SAFE_INTEGER,
);
const MIN_FREE_BYTES = boundedInteger(
  process.env.VYLINE_BACKUP_MIN_FREE_BYTES,
  512 * 1024 ** 2,
  0,
  Number.MAX_SAFE_INTEGER,
);

const activeWorkDirs = new Set<string>();
let diskCapacityTail: Promise<void> = Promise.resolve();

/**
 * Serializes only reservation admission and short free-space checks. Callers
 * must not perform network reads or long-running restore work while holding it.
 */
export async function withDiskBackedWorkCapacityLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = diskCapacityTail;
  let release!: () => void;
  diskCapacityTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("Backup work directory kind is invalid");
  return safe.slice(0, 64);
}

function assertWorkDir(path: string): string {
  const target = resolve(path);
  const child = relative(WORK_ROOT, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("Backup work directory escaped its persistent root");
  }
  return target;
}

/** Creates a disk-backed temporary directory below VYLINE_DATA_DIR. */
export async function createDiskBackedWorkDir(kind: string, prefix = "work"): Promise<string> {
  await assertDiskBackedWorkFreeSpace();
  const kindRoot = join(WORK_ROOT, safeSegment(kind));
  await mkdir(kindRoot, { recursive: true, mode: 0o700 });
  const path = resolve(await mkdtemp(join(kindRoot, `${safeSegment(prefix)}-`)));
  activeWorkDirs.add(path);
  return path;
}

/**
 * Refuses new writes before they consume the configured free-space reserve.
 * Logical reservations from other jobs are included because their bytes may
 * not have reached disk yet. The current job can exclude its already-tracked
 * reservation and supply only the additional bytes it is about to reserve.
 */
export async function assertDiskBackedWorkFreeSpace(
  additionalBytes = 0,
  currentReservationBytes = 0,
): Promise<void> {
  return assertDiskBackedDestinationFreeSpace(WORK_ROOT, additionalBytes, currentReservationBytes);
}

/** Applies the same reservation-aware guard to a configured destination volume. */
export async function assertDiskBackedDestinationFreeSpace(
  destinationRoot: string,
  additionalBytes = 0,
  currentReservationBytes = 0,
): Promise<void> {
  if (
    !Number.isSafeInteger(additionalBytes) ||
    additionalBytes < 0 ||
    !Number.isSafeInteger(currentReservationBytes) ||
    currentReservationBytes < 0
  ) {
    throw new Error("バックアップ作業領域の追加サイズが不正です");
  }
  const root = resolve(destinationRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await statfs(root);
  const available = BigInt(info.bavail) * BigInt(info.bsize);
  const otherReservedBytes = Math.max(0, reservedBytes - currentReservationBytes);
  const required = BigInt(additionalBytes) + BigInt(otherReservedBytes) + BigInt(MIN_FREE_BYTES);
  if (available < required) {
    throw new BackupWorkCapacityError(
      "バックアップ作業領域の空き容量が不足しています。不要なデータを削除して再試行してください",
    );
  }
}

/** Removes only directories proven to be descendants of the managed work root. */
export async function removeDiskBackedWorkDir(path: string): Promise<void> {
  const target = assertWorkDir(path);
  // SQLite/AV handles can be released a few milliseconds after close on
  // Windows. Native bounded retries avoid leaking completed restore workdirs.
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  activeWorkDirs.delete(target);
}

/** Removes abandoned work directories without touching currently active jobs. */
export async function pruneDiskBackedWorkDirs(
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): Promise<void> {
  await mkdir(WORK_ROOT, { recursive: true, mode: 0o700 });
  const threshold = Date.now() - Math.max(0, staleAfterMs);
  const kinds = await readdir(WORK_ROOT, { withFileTypes: true });
  for (const kind of kinds) {
    if (!kind.isDirectory()) continue;
    const kindRoot = resolve(join(WORK_ROOT, kind.name));
    const entries = await readdir(kindRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = assertWorkDir(join(kindRoot, entry.name));
      if (activeWorkDirs.has(path)) continue;
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < threshold) {
        await removeDiskBackedWorkDir(path).catch(() => undefined);
      }
    }
  }
}

interface QueuedHeavyWork<T> {
  reservation: HeavyWorkReservation;
  accountId: string;
  run: () => Promise<T>;
  cleanup?: () => Promise<void>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface HeavyWorkReservation {
  id: number;
  accountId: string;
  reservedBytes: number;
  inputBytes: number;
  state: "reserved" | "queued" | "active" | "cleanup-failed" | "released";
  cleanup: (() => Promise<void>) | undefined;
}

export interface HeavyBackupWorkReservation {
  readonly accountId: string;
  readonly reservedBytes: number;
  readonly inputBytes: number;
  resizeReservedBytes(bytes: number): void;
  resizeInputBytes(bytes: number): void;
  cleanupAndRelease(cleanup: () => Promise<void>): Promise<void>;
  enqueue<T>(run: () => Promise<T>, cleanup?: () => Promise<void>): Promise<T>;
  release(): void;
}

export class BackupWorkCapacityError extends Error {
  constructor(message = "バックアップ処理が混雑しています。完了後にもう一度お試しください") {
    super(message);
    this.name = "BackupWorkCapacityError";
  }
}

const heavyQueue: QueuedHeavyWork<unknown>[] = [];
const activeAccounts = new Set<string>();
const reservations = new Map<number, HeavyWorkReservation>();
let activeCount = 0;
let nextReservationId = 1;
let reservedBytes = 0;
let reservedInputBytes = 0;

function releaseReservation(reservation: HeavyWorkReservation): void {
  if (reservation.state === "released") return;
  reservations.delete(reservation.id);
  reservedBytes -= reservation.reservedBytes;
  reservedInputBytes -= reservation.inputBytes;
  reservation.reservedBytes = 0;
  reservation.inputBytes = 0;
  reservation.cleanup = undefined;
  reservation.state = "released";
}

function scheduleCleanupRetry(reservation: HeavyWorkReservation, attempt = 1): void {
  const timer = setTimeout(
    () => {
      if (reservation.state !== "cleanup-failed" || !reservation.cleanup) return;
      void reservation
        .cleanup()
        .then(() => {
          releaseReservation(reservation);
          drainHeavyQueue();
        })
        .catch(() => {
          // Never release capacity while work files may still exist. Retry for
          // the process lifetime with an unref'ed timer capped at 30 seconds.
          scheduleCleanupRetry(reservation, Math.min(attempt + 1, 6));
        });
    },
    Math.min(30_000, 1_000 * 2 ** (attempt - 1)),
  );
  timer.unref?.();
}

function resizeReservation(reservation: HeavyWorkReservation, bytes: number): void {
  if (reservation.state !== "reserved" && reservation.state !== "active") {
    throw new Error("待機中、cleanup中、または解放済みのバックアップ予約は変更できません");
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("バックアップ処理の予約サイズが不正です");
  }
  const nextTotal = reservedBytes - reservation.reservedBytes + bytes;
  if (nextTotal > HEAVY_WORK_MAX_RESERVED_BYTES) {
    throw new BackupWorkCapacityError(
      "バックアップの待機データ量が上限に達しています。完了後にもう一度お試しください",
    );
  }
  let accountBytes = 0;
  for (const current of reservations.values()) {
    if (current.accountId === reservation.accountId) accountBytes += current.reservedBytes;
  }
  const nextAccountTotal = accountBytes - reservation.reservedBytes + bytes;
  if (nextAccountTotal > HEAVY_WORK_MAX_RESERVED_BYTES_PER_ACCOUNT) {
    throw new BackupWorkCapacityError(
      "このアカウントのバックアップ待機データ量が上限に達しています",
    );
  }
  reservedBytes = nextTotal;
  reservation.reservedBytes = bytes;
}

function resizeInputReservation(reservation: HeavyWorkReservation, bytes: number): void {
  if (reservation.state !== "reserved") {
    throw new Error("開始済みまたは解放済みの入力予約は変更できません");
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("バックアップ入力の予約サイズが不正です");
  }
  const nextTotal = reservedInputBytes - reservation.inputBytes + bytes;
  if (nextTotal > HEAVY_WORK_MAX_INPUT_BYTES) {
    throw new BackupWorkCapacityError(
      "バックアップの待機入力データ量が上限に達しています。完了後にもう一度お試しください",
    );
  }
  let accountBytes = 0;
  for (const current of reservations.values()) {
    if (current.accountId === reservation.accountId) accountBytes += current.inputBytes;
  }
  const nextAccountTotal = accountBytes - reservation.inputBytes + bytes;
  if (nextAccountTotal > HEAVY_WORK_MAX_INPUT_BYTES_PER_ACCOUNT) {
    throw new BackupWorkCapacityError(
      "このアカウントのバックアップ待機入力データ量が上限に達しています",
    );
  }
  reservedInputBytes = nextTotal;
  reservation.inputBytes = bytes;
}

async function cleanupReservation(
  reservation: HeavyWorkReservation,
  cleanup: () => Promise<void>,
): Promise<void> {
  reservation.cleanup = cleanup;
  try {
    await cleanup();
    releaseReservation(reservation);
  } catch (error) {
    reservation.state = "cleanup-failed";
    scheduleCleanupRetry(reservation);
    throw error;
  }
}

async function runHeavyQueueEntry(entry: QueuedHeavyWork<unknown>): Promise<void> {
  let value: unknown;
  let failure: unknown;
  let failed = false;
  try {
    value = await entry.run();
  } catch (error) {
    failed = true;
    failure = error;
  }

  if (entry.cleanup) {
    try {
      await cleanupReservation(entry.reservation, entry.cleanup);
    } catch {
      // A successful restore is already durable. Keep its reservation in the
      // cleanup-failed registry and retry, but do not report committed work as failed.
    }
  } else releaseReservation(entry.reservation);

  if (failed) entry.reject(failure);
  else entry.resolve(value);
}

function drainHeavyQueue(): void {
  while (activeCount < HEAVY_WORK_CONCURRENCY) {
    const index = heavyQueue.findIndex((entry) => !activeAccounts.has(entry.accountId));
    if (index < 0) return;
    const entry = heavyQueue.splice(index, 1)[0];
    if (!entry) return;
    activeCount++;
    activeAccounts.add(entry.accountId);
    entry.reservation.state = "active";
    void runHeavyQueueEntry(entry).finally(() => {
      activeCount--;
      activeAccounts.delete(entry.accountId);
      drainHeavyQueue();
    });
  }
}

/**
 * Reserves one bounded queue slot before an upload writes to disk. The byte
 * reservation can grow with a streaming request and is retained while queued.
 */
export function reserveHeavyBackupWork(
  accountId: string,
  initialReservedBytes = 0,
): HeavyBackupWorkReservation {
  if (!accountId) throw new Error("accountId が必要です");
  if (reservations.size >= HEAVY_WORK_MAX_ITEMS) throw new BackupWorkCapacityError();
  let accountItems = 0;
  for (const reservation of reservations.values()) {
    if (reservation.accountId === accountId) accountItems++;
  }
  if (accountItems >= HEAVY_WORK_MAX_ITEMS_PER_ACCOUNT) {
    throw new BackupWorkCapacityError(
      "このアカウントのバックアップ処理は既に待機中です。完了後にもう一度お試しください",
    );
  }

  const reservation: HeavyWorkReservation = {
    id: nextReservationId++,
    accountId,
    reservedBytes: 0,
    inputBytes: 0,
    state: "reserved",
    cleanup: undefined,
  };
  reservations.set(reservation.id, reservation);
  try {
    resizeReservation(reservation, initialReservedBytes);
    resizeInputReservation(reservation, initialReservedBytes);
  } catch (error) {
    releaseReservation(reservation);
    throw error;
  }

  return {
    get accountId() {
      return reservation.accountId;
    },
    get reservedBytes() {
      return reservation.reservedBytes;
    },
    get inputBytes() {
      return reservation.inputBytes;
    },
    resizeReservedBytes(bytes: number) {
      resizeReservation(reservation, bytes);
    },
    resizeInputBytes(bytes: number) {
      resizeInputReservation(reservation, bytes);
    },
    cleanupAndRelease(cleanup: () => Promise<void>): Promise<void> {
      if (reservation.state !== "reserved" && reservation.state !== "cleanup-failed") {
        return Promise.reject(new Error("開始済みのバックアップ処理は直接cleanupできません"));
      }
      return cleanupReservation(reservation, cleanup);
    },
    enqueue<T>(run: () => Promise<T>, cleanup?: () => Promise<void>): Promise<T> {
      if (reservation.state !== "reserved") {
        return Promise.reject(new Error("バックアップ処理の予約は既に使用されています"));
      }
      reservation.state = "queued";
      return new Promise<T>((resolveWork, rejectWork) => {
        heavyQueue.push({
          reservation,
          accountId,
          run,
          ...(cleanup ? { cleanup } : {}),
          resolve: resolveWork as (value: unknown) => void,
          reject: rejectWork,
        });
        drainHeavyQueue();
      });
    },
    release() {
      if (reservation.state === "released") return;
      if (reservation.state !== "reserved") {
        throw new Error("開始済みのバックアップ処理は予約から解放できません");
      }
      releaseReservation(reservation);
    },
  };
}

/** Limits CPU/IO-heavy backup work globally and serializes it per account. */
export function enqueueHeavyBackupWork<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  try {
    return reserveHeavyBackupWork(accountId).enqueue(run);
  } catch (error) {
    return Promise.reject(error);
  }
}
