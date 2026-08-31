import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readdir, rm, statfs } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { VYLINE_DATA_DIR } from "../storage/vylineStorageInfo.js";

/** The old 15,000,000-character base64 limit represented at most 11,250,000 raw bytes. */
export const MEDIA_SEND_MAX_BYTES = 11_250_000;
export const MEDIA_SEND_MAX_BATCH_ITEMS = 64;
export const MEDIA_SEND_MAX_BATCH_BYTES = 128 * 1024 * 1024;
// One 512 MiB note/video upload must still fit; the extra headroom allows one
// ordinary chat attachment to finish while that slot is staged.
export const MEDIA_SEND_MAX_STAGED_BYTES = 640 * 1024 * 1024;

const MEDIA_SEND_ROOT = resolve(VYLINE_DATA_DIR, "tmp", "media-send");
const STALE_UPLOAD_MS = 60 * 60 * 1000;
const MEDIA_SEND_MAX_WORK_DIRS = 16;
const MEDIA_SEND_FREE_SPACE_FLOOR = 512 * 1024 * 1024;

export type StagedMediaType = "image" | "video" | "audio" | "file" | "gif";

export interface MediaUploadMetadata {
  mimeType?: string;
  filename?: string;
  mediaType?: StagedMediaType;
}

export interface StagedMediaSource extends MediaUploadMetadata {
  path: string;
  sizeBytes: number;
}

export interface StandaloneMediaUpload extends StagedMediaSource {
  workDir: string;
}

export class MediaSendUploadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413,
  ) {
    super(message);
    this.name = "MediaSendUploadError";
  }
}

interface MediaBatchUploadSession {
  id: string;
  accountId: string;
  chatMid: string;
  expectedItems: number;
  workDir: string;
  createdAt: number;
  updatedAt: number;
  stagedBytes: number;
  reservedBytes: number;
  state: "open" | "completing" | "cleanup-pending";
  writing: Set<number>;
  items: Map<number, StagedMediaSource>;
}

const sessions = new Map<string, MediaBatchUploadSession>();
const standaloneUploads = new Map<string, { bytes: number; createdAt: number }>();
let totalStagedBytes = 0;
let totalReservedBytes = 0;

function reserveStagingBytes(bytes: number): void {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    totalStagedBytes + totalReservedBytes + bytes > MEDIA_SEND_MAX_STAGED_BYTES
  ) {
    throw new MediaSendUploadError("media staging capacity exceeded", 413);
  }
  totalReservedBytes += bytes;
}

function releaseReservedBytes(bytes: number): void {
  totalReservedBytes = Math.max(0, totalReservedBytes - bytes);
}

function commitStagedBytes(reserved: number, actual: number): void {
  releaseReservedBytes(reserved);
  totalStagedBytes += actual;
}

function releaseStagedBytes(bytes: number): void {
  totalStagedBytes = Math.max(0, totalStagedBytes - bytes);
}

async function assertMediaStagingFreeSpace(): Promise<void> {
  await mkdir(MEDIA_SEND_ROOT, { recursive: true, mode: 0o700 });
  const info = await statfs(MEDIA_SEND_ROOT);
  const available = Number(info.bavail) * Number(info.bsize);
  if (!Number.isFinite(available) || available - totalReservedBytes < MEDIA_SEND_FREE_SPACE_FLOOR) {
    throw new MediaSendUploadError("media staging disk capacity exceeded", 413);
  }
}

function assertManagedWorkDir(path: string): string {
  const target = resolve(path);
  const child = relative(MEDIA_SEND_ROOT, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("media upload directory escaped its persistent root");
  }
  return target;
}

function normalizeMetadata(metadata: MediaUploadMetadata): MediaUploadMetadata {
  const result: MediaUploadMetadata = {};
  if (metadata.mimeType != null) {
    const mimeType = metadata.mimeType.trim();
    if (!mimeType || mimeType.length > 160 || /[\r\n]/.test(mimeType)) {
      throw new MediaSendUploadError("invalid media content type", 400);
    }
    result.mimeType = mimeType;
  }
  if (metadata.filename != null) {
    const filename = metadata.filename.trim();
    if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f]/.test(filename)) {
      throw new MediaSendUploadError("invalid media filename", 400);
    }
    result.filename = filename;
  }
  if (metadata.mediaType != null) {
    if (!(["image", "video", "audio", "file", "gif"] as const).includes(metadata.mediaType)) {
      throw new MediaSendUploadError("invalid media type", 400);
    }
    result.mediaType = metadata.mediaType;
  }
  return result;
}

function declaredContentLength(request: Request, maxBytes: number): number | null {
  const raw = request.headers.get("content-length");
  if (raw == null) return null;
  if (!/^\d+$/.test(raw)) throw new MediaSendUploadError("invalid Content-Length", 400);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new MediaSendUploadError("invalid Content-Length", 400);
  if (parsed > maxBytes) throw new MediaSendUploadError("file too large", 413);
  return parsed;
}

async function writeChunk(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error("media upload write made no progress");
    offset += bytesWritten;
  }
}

/** Stream a request body to disk one chunk at a time; awaited writes provide backpressure. */
async function streamRequestBody(
  request: Request,
  path: string,
  maxBytes: number,
): Promise<number> {
  if (!request.body) throw new MediaSendUploadError("media body required", 400);
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new MediaSendUploadError("encoded media bodies are not supported", 400);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("invalid media upload byte limit");
  }
  const declaredBytes = declaredContentLength(request, maxBytes);
  const handle = await open(path, "wx", 0o600);
  const reader = request.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (total + value.byteLength > maxBytes) {
        throw new MediaSendUploadError("file too large", 413);
      }
      await writeChunk(handle, value);
      total += value.byteLength;
    }
    if (total === 0) throw new MediaSendUploadError("media body required", 400);
    if (declaredBytes != null && declaredBytes !== total) {
      throw new MediaSendUploadError("media body length mismatch", 400);
    }
    return total;
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
    if (total === 0 || (declaredBytes != null && declaredBytes !== total)) {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }
}

async function createWorkDir(prefix: string): Promise<string> {
  if (sessions.size + standaloneUploads.size >= MEDIA_SEND_MAX_WORK_DIRS) {
    throw new MediaSendUploadError("too many active media uploads", 409);
  }
  await mkdir(MEDIA_SEND_ROOT, { recursive: true, mode: 0o700 });
  return assertManagedWorkDir(await mkdtemp(join(MEDIA_SEND_ROOT, `${prefix}-`)));
}

export async function removeStandaloneMediaUpload(upload: StandaloneMediaUpload): Promise<void> {
  const key = resolve(upload.workDir);
  const tracked = standaloneUploads.get(key);
  try {
    await rm(assertManagedWorkDir(upload.workDir), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  } catch {
    if (tracked) tracked.createdAt = 0;
    return;
  }
  if (tracked) {
    standaloneUploads.delete(key);
    releaseStagedBytes(tracked.bytes);
  }
}

export async function stageStandaloneMediaUpload(
  request: Request,
  metadata: MediaUploadMetadata,
  maxBytes = MEDIA_SEND_MAX_BYTES,
): Promise<StandaloneMediaUpload> {
  const normalized = normalizeMetadata(metadata);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MEDIA_SEND_MAX_STAGED_BYTES) {
    throw new Error("invalid standalone media byte limit");
  }
  await pruneStaleMediaUploads().catch(() => undefined);
  reserveStagingBytes(maxBytes);
  let reservationHeld = true;
  let workDir: string | undefined;
  let committed = false;
  try {
    await assertMediaStagingFreeSpace();
    workDir = await createWorkDir("single");
    standaloneUploads.set(resolve(workDir), { bytes: 0, createdAt: Date.now() });
  } catch (error) {
    releaseReservedBytes(maxBytes);
    throw error;
  }
  const path = join(workDir, "media.bin");
  try {
    const sizeBytes = await streamRequestBody(request, path, maxBytes);
    commitStagedBytes(maxBytes, sizeBytes);
    reservationHeld = false;
    committed = true;
    standaloneUploads.set(resolve(workDir), { bytes: sizeBytes, createdAt: Date.now() });
    return { workDir, path, sizeBytes, ...normalized };
  } catch (error) {
    if (reservationHeld) releaseReservedBytes(maxBytes);
    if (committed) releaseStagedBytes(standaloneUploads.get(resolve(workDir))?.bytes ?? 0);
    standaloneUploads.delete(resolve(workDir));
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function getSession(accountId: string, uploadId: string): MediaBatchUploadSession {
  const session = sessions.get(uploadId);
  if (!session || session.accountId !== accountId) {
    throw new MediaSendUploadError("media batch upload not found", 404);
  }
  return session;
}

export async function createMediaBatchUpload(
  accountId: string,
  chatMid: string,
  expectedItems: number,
): Promise<{ uploadId: string; maxItemBytes: number }> {
  if (!chatMid) throw new MediaSendUploadError("chatMid required", 400);
  if (
    !Number.isSafeInteger(expectedItems) ||
    expectedItems < 1 ||
    expectedItems > MEDIA_SEND_MAX_BATCH_ITEMS
  ) {
    throw new MediaSendUploadError(
      `itemCount must be between 1 and ${MEDIA_SEND_MAX_BATCH_ITEMS}`,
      400,
    );
  }
  await pruneStaleMediaUploads().catch(() => undefined);
  const uploadId = randomUUID();
  const workDir = await createWorkDir("batch");
  sessions.set(uploadId, {
    id: uploadId,
    accountId,
    chatMid,
    expectedItems,
    workDir,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stagedBytes: 0,
    reservedBytes: 0,
    state: "open",
    writing: new Set(),
    items: new Map(),
  });
  return { uploadId, maxItemBytes: MEDIA_SEND_MAX_BYTES };
}

export async function stageMediaBatchItem(
  accountId: string,
  uploadId: string,
  index: number,
  request: Request,
  metadata: MediaUploadMetadata,
): Promise<{ receivedBytes: number; receivedItems: number; expectedItems: number }> {
  const session = getSession(accountId, uploadId);
  if (session.state !== "open") throw new MediaSendUploadError("media batch is completing", 409);
  if (!Number.isSafeInteger(index) || index < 0 || index >= session.expectedItems) {
    throw new MediaSendUploadError("media batch item index out of range", 400);
  }
  if (session.items.has(index) || session.writing.has(index)) {
    throw new MediaSendUploadError("media batch item already uploaded", 409);
  }
  const normalized = normalizeMetadata(metadata);
  const path = join(session.workDir, `item-${String(index).padStart(4, "0")}.bin`);
  const batchRemaining = MEDIA_SEND_MAX_BATCH_BYTES - session.stagedBytes - session.reservedBytes;
  const globalRemaining = MEDIA_SEND_MAX_STAGED_BYTES - totalStagedBytes - totalReservedBytes;
  const itemLimit = Math.min(MEDIA_SEND_MAX_BYTES, batchRemaining, globalRemaining);
  if (itemLimit < 1) throw new MediaSendUploadError("media staging capacity exceeded", 413);
  // Reserve synchronously before the first await. Concurrent PUTs for the same
  // batch must observe each other's bytes and item index immediately.
  reserveStagingBytes(itemLimit);
  session.reservedBytes += itemLimit;
  session.updatedAt = Date.now();
  let reservationHeld = true;
  session.writing.add(index);
  try {
    await assertMediaStagingFreeSpace();
    const sizeBytes = await streamRequestBody(request, path, itemLimit);
    commitStagedBytes(itemLimit, sizeBytes);
    reservationHeld = false;
    session.reservedBytes -= itemLimit;
    session.stagedBytes += sizeBytes;
    session.updatedAt = Date.now();
    session.items.set(index, { path, sizeBytes, ...normalized });
    return {
      receivedBytes: sizeBytes,
      receivedItems: session.items.size,
      expectedItems: session.expectedItems,
    };
  } catch (error) {
    if (reservationHeld) {
      releaseReservedBytes(itemLimit);
      session.reservedBytes = Math.max(0, session.reservedBytes - itemLimit);
    }
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    session.writing.delete(index);
  }
}

export function completeMediaBatchUpload(
  accountId: string,
  uploadId: string,
): { chatMid: string; items: StagedMediaSource[] } {
  const session = getSession(accountId, uploadId);
  if (session.state !== "open") throw new MediaSendUploadError("media batch is completing", 409);
  if (session.writing.size > 0 || session.items.size !== session.expectedItems) {
    throw new MediaSendUploadError(
      `media batch incomplete (${session.items.size}/${session.expectedItems})`,
      400,
    );
  }
  const items: StagedMediaSource[] = [];
  for (let index = 0; index < session.expectedItems; index++) {
    const item = session.items.get(index);
    if (!item) throw new MediaSendUploadError(`media batch item ${index} missing`, 400);
    items.push(item);
  }
  session.state = "completing";
  session.updatedAt = Date.now();
  return { chatMid: session.chatMid, items };
}

export async function removeMediaBatchUpload(
  accountId: string,
  uploadId: string,
  force = false,
): Promise<void> {
  const session = getSession(accountId, uploadId);
  if (!force && (session.state === "completing" || session.writing.size > 0)) {
    throw new MediaSendUploadError("media batch is active", 409);
  }
  try {
    await rm(assertManagedWorkDir(session.workDir), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  } catch {
    session.state = "cleanup-pending";
    session.updatedAt = 0;
    return;
  }
  sessions.delete(uploadId);
  releaseStagedBytes(session.stagedBytes);
}

export async function pruneStaleMediaUploads(staleAfterMs = STALE_UPLOAD_MS): Promise<void> {
  await mkdir(MEDIA_SEND_ROOT, { recursive: true, mode: 0o700 });
  const threshold = Date.now() - Math.max(0, staleAfterMs);
  for (const [uploadId, session] of sessions) {
    if (
      (session.state === "open" || session.state === "cleanup-pending") &&
      session.writing.size === 0 &&
      session.updatedAt < threshold
    ) {
      try {
        await rm(assertManagedWorkDir(session.workDir), {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 50,
        });
      } catch {
        continue;
      }
      sessions.delete(uploadId);
      releaseStagedBytes(session.stagedBytes);
      releaseReservedBytes(session.reservedBytes);
    }
  }
  for (const [workDir, upload] of standaloneUploads) {
    if (upload.createdAt >= threshold) continue;
    try {
      await rm(assertManagedWorkDir(workDir), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    } catch {
      continue;
    }
    standaloneUploads.delete(workDir);
    releaseStagedBytes(upload.bytes);
  }
  const activeDirs = new Set([
    ...[...sessions.values()].map((session) => resolve(session.workDir)),
    ...standaloneUploads.keys(),
  ]);
  const entries = await readdir(MEDIA_SEND_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = assertManagedWorkDir(join(MEDIA_SEND_ROOT, entry.name));
    if (activeDirs.has(path)) continue;
    // No in-memory owner can survive a process restart. Untracked directories
    // are therefore abandoned and safe to remove immediately.
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}
