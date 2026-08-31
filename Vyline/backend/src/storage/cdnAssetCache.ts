/**
 * storage/cdnAssetCache.ts
 *
 * stickershop / sticon CDN 画像のディスクキャッシュ。
 * ブラウザ → /cdn/line?... → ここ → CDN（初回のみ）
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("cdn-cache");

async function scanDirSize(target: string): Promise<number> {
  if (!existsSync(target)) return 0;
  let total = 0;
  try {
    const entries = await readdir(target, { withFileTypes: true });
    for (const e of entries) {
      const p = join(target, e.name);
      if (e.isDirectory()) {
        total += await scanDirSize(p);
      } else if (e.name.endsWith(".partial")) {
        // No current-process partial exists before this one-time scan.
        await rm(p, { force: true }).catch(() => undefined);
      } else {
        try {
          const s = await stat(p);
          total += s.size;
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    log.debug({ err, target }, "dirSize failed");
  }
  return total;
}

const ALLOWED_HOSTS = new Set([
  "stickershop.line-scdn.net",
  "shop.line-scdn.net",
  "static.line-scdn.net",
  "profile.line-scdn.net",
]);
const CDN_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_CDN_REDIRECTS = 3;

const ICON_HOSTS = new Set(["profile.line-scdn.net"]);

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
const STORAGE_ROOT = process.env.VYLINE_STORAGE_DIR ?? join(_dir, "../../storage");
const LEGACY_ROOT = join(DATA_ROOT, "cdn-cache");
const CACHE_ROOT = process.env.VYLINE_CDN_CACHE_DIR ?? join(STORAGE_ROOT, "cache/cdn-cache");
const ICON_ROOT = process.env.VYLINE_ICON_CACHE_DIR ?? join(STORAGE_ROOT, "cache/icons");

type RootSizeState = {
  bytes: number | null;
  scan: Promise<number> | null;
  tail: Promise<void>;
};

const rootSizeStates = new Map<string, RootSizeState>();

function rootSizeState(root: string): RootSizeState {
  let state = rootSizeStates.get(root);
  if (!state) {
    state = { bytes: null, scan: null, tail: Promise.resolve() };
    rootSizeStates.set(root, state);
  }
  return state;
}

async function ensureRootSize(root: string, state: RootSizeState): Promise<number> {
  if (state.bytes !== null) return state.bytes;
  if (!state.scan) {
    state.scan = scanDirSize(root)
      .then((bytes) => {
        state.bytes = bytes;
        return bytes;
      })
      .finally(() => {
        state.scan = null;
      });
  }
  return state.scan;
}

/** Serialize size-changing operations so cached byte totals cannot lose deltas. */
function withRootSizeLock<T>(root: string, work: (state: RootSizeState) => Promise<T>): Promise<T> {
  const state = rootSizeState(root);
  const task = state.tail.catch(() => undefined).then(() => work(state));
  state.tail = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

try {
  if (!existsSync(CACHE_ROOT) && existsSync(LEGACY_ROOT)) {
    const { rename } = await import("node:fs/promises");
    await mkdir(dirname(CACHE_ROOT), { recursive: true });
    await rename(LEGACY_ROOT, CACHE_ROOT);
  }
  await mkdir(CACHE_ROOT, { recursive: true });
  await mkdir(ICON_ROOT, { recursive: true });
} catch {
  /* ignore */
}

type MemoryEntry = {
  buf: Uint8Array;
  contentType: string;
  expiresAt: number;
  bytes: number;
};

export type CachedLineCdnAsset =
  | {
      kind: "memory";
      buf: Uint8Array;
      contentType: string;
      fromCache: boolean;
      size: number;
    }
  | {
      kind: "file";
      path: string;
      contentType: string;
      fromCache: boolean;
      size: number;
    };

type CachedLineCdnLocation =
  | Omit<Extract<CachedLineCdnAsset, { kind: "memory" }>, "fromCache">
  | Omit<Extract<CachedLineCdnAsset, { kind: "file" }>, "fromCache">;

const memory = new Map<string, MemoryEntry>();
let memoryBytes = 0;
const MEMORY_MAX_BYTES = 16 * 1024 * 1024;
const MEMORY_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
// Byte accounting is authoritative, but retain a metadata guard for empty/tiny assets.
const MEMORY_MAX_ENTRIES = 1_024;
const MEMORY_TTL_MS = 30 * 60_000;
/** CDN から取得するレスポンスの最大サイズ（不正/巨大レスポンスからの保護） */
const MAX_CDN_RESPONSE_BYTES = 10 * 1024 * 1024;

/** 同一 URL の同時リクエストを 1 回の CDN 取得にまとめる */
const inflight = new Map<string, Promise<CachedLineCdnLocation>>();
const MAX_CONCURRENT_FETCHES = 4;
const MAX_PENDING_FETCHES = 256;
const fetchWaiters: Array<() => void> = [];
let activeFetches = 0;

function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  if (fetchWaiters.length >= MAX_PENDING_FETCHES) {
    return Promise.reject(new Error("cdn fetch queue full"));
  }
  return new Promise<void>((resolve) => fetchWaiters.push(resolve));
}

function releaseFetchSlot(): void {
  const next = fetchWaiters.shift();
  if (next) next();
  else activeFetches = Math.max(0, activeFetches - 1);
}

async function withFetchSlot<T>(work: () => Promise<T>): Promise<T> {
  await acquireFetchSlot();
  try {
    return await work();
  } finally {
    releaseFetchSlot();
  }
}

function hashKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/** CDN が 404 を返したことを表すエラー（キャッシュしない） */
export class CdnNotFoundError extends Error {
  constructor(url: string) {
    super(`cdn fetch 404: ${url}`);
    this.name = "CdnNotFoundError";
  }
}

function extFromContentType(ct: string, url: string): string {
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("json")) return ".json";
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(url);
  return m ? `.${m[1]!.toLowerCase()}` : ".bin";
}

function cacheRootForUrl(url: string): string {
  try {
    const u = new URL(url);
    if (ICON_HOSTS.has(u.hostname)) return ICON_ROOT;
  } catch {
    /* ignore */
  }
  return CACHE_ROOT;
}

export function isAllowedLineCdnUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "443") return false;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}

/**
 * Fetch a CDN asset without allowing the runtime to follow an unvalidated
 * redirect. This mirrors the DOWNLOAD_URL redirect boundary: every hop must
 * remain on the exact LINE CDN allowlist and the redirect chain is bounded.
 */
async function fetchAllowedLineCdn(url: string): Promise<Response> {
  let currentUrl = url;

  for (let redirects = 0; ; redirects += 1) {
    if (!isAllowedLineCdnUrl(currentUrl)) throw new Error("cdn redirect target not allowed");

    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        "user-agent": "Vyline/1.0",
        accept: "image/*,application/json,*/*",
      },
    });
    if (!CDN_REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location || redirects >= MAX_CDN_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("cdn redirect rejected");
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("cdn redirect rejected");
    }
    await response.body?.cancel().catch(() => undefined);
    if (!isAllowedLineCdnUrl(nextUrl)) throw new Error("cdn redirect target not allowed");
    currentUrl = nextUrl;
  }
}

function diskPath(url: string, contentType?: string): string {
  const h = hashKey(url);
  const ext = contentType ? extFromContentType(contentType, url) : "";
  const root = cacheRootForUrl(url);
  return join(root, h.slice(0, 2), `${h}${ext || ""}`);
}

async function initializeRootSize(root: string): Promise<void> {
  await withRootSizeLock(root, async (state) => {
    await ensureRootSize(root, state);
  });
}

async function publishDiskFile(
  root: string,
  partialPath: string,
  path: string,
  bytes: number,
): Promise<void> {
  await withRootSizeLock(root, async (state) => {
    await ensureRootSize(root, state);
    const previousBytes = await stat(path)
      .then((entry) => (entry.isFile() ? entry.size : 0))
      .catch(() => 0);
    await rename(partialPath, path);
    state.bytes = Math.max(0, (state.bytes ?? 0) - previousBytes + bytes);
  });
}

async function removeDiskFile(root: string, path: string): Promise<void> {
  await withRootSizeLock(root, async (state) => {
    await ensureRootSize(root, state);
    const bytes = await stat(path)
      .then((entry) => (entry.isFile() ? entry.size : 0))
      .catch(() => 0);
    await rm(path, { force: true });
    state.bytes = Math.max(0, (state.bytes ?? 0) - bytes);
  });
}

function concatenateChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Stream a bounded CDN response directly to an atomic disk-cache file. */
async function fetchToDisk(url: string): Promise<CachedLineCdnLocation> {
  const root = cacheRootForUrl(url);
  // Complete the one-time scan before an untracked partial file can appear.
  await initializeRootSize(root);
  const res = await fetchAllowedLineCdn(url);
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    throw new CdnNotFoundError(url);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`cdn fetch ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const declaredLength = Number(res.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_CDN_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`cdn response too large: ${declaredLength} bytes`);
  }

  const path = diskPath(url, contentType);
  const partialPath = `${path}.${randomUUID()}.partial`;
  await mkdir(dirname(path), { recursive: true });
  const file = await open(partialPath, "wx");
  const reader = res.body?.getReader();
  const memoryChunks: Uint8Array[] = [];
  let retainInMemory = declaredLength <= 0 || declaredLength <= MEMORY_MAX_ENTRY_BYTES;
  let total = 0;
  try {
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_CDN_RESPONSE_BYTES) {
          throw new Error(`cdn response exceeded ${MAX_CDN_RESPONSE_BYTES} bytes`);
        }
        let written = 0;
        while (written < value.byteLength) {
          const result = await file.write(value, written, value.byteLength - written);
          if (result.bytesWritten <= 0) throw new Error("cdn cache write made no progress");
          written += result.bytesWritten;
        }
        if (retainInMemory && total <= MEMORY_MAX_ENTRY_BYTES) memoryChunks.push(value);
        else if (retainInMemory) {
          retainInMemory = false;
          memoryChunks.length = 0;
        }
      }
    }
    await file.close();
    await publishDiskFile(root, partialPath, path, total);
    if (retainInMemory) {
      const buf = concatenateChunks(memoryChunks, total);
      return { kind: "memory", buf, contentType, size: total };
    }
    return { kind: "file", path, contentType, size: total };
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    await file.close().catch(() => undefined);
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function contentTypeFromDiskFilename(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return ext === ".png"
    ? "image/png"
    : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
        ? "image/gif"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".json"
            ? "application/json"
            : "application/octet-stream";
}

async function readDisk(url: string): Promise<CachedLineCdnLocation | null> {
  const h = hashKey(url);
  const root = cacheRootForUrl(url);
  const dir = join(root, h.slice(0, 2));
  try {
    const files = await readdir(dir);
    const hit = files.find((file) => file.startsWith(h) && !file.endsWith(".partial"));
    if (!hit) return null;
    const path = join(dir, hit);
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CDN_RESPONSE_BYTES) {
      await removeDiskFile(root, path).catch(() => undefined);
      return null;
    }
    const contentType = contentTypeFromDiskFilename(hit);
    if (info.size <= MEMORY_MAX_ENTRY_BYTES) {
      const buf = new Uint8Array(await readFile(path));
      return { kind: "memory", buf, contentType, size: buf.byteLength };
    }
    return { kind: "file", path, contentType, size: info.size };
  } catch {
    return null;
  }
}

function deleteMemoryEntry(url: string): void {
  const existing = memory.get(url);
  if (!existing) return;
  memory.delete(url);
  memoryBytes = Math.max(0, memoryBytes - existing.bytes);
}

function remember(url: string, buf: Uint8Array, contentType: string): void {
  deleteMemoryEntry(url);
  if (buf.byteLength > MEMORY_MAX_ENTRY_BYTES || buf.byteLength > MEMORY_MAX_BYTES) return;
  while (memory.size >= MEMORY_MAX_ENTRIES || memoryBytes + buf.byteLength > MEMORY_MAX_BYTES) {
    const oldestUrl = memory.keys().next().value as string | undefined;
    if (!oldestUrl) break;
    deleteMemoryEntry(oldestUrl);
  }
  const entry: MemoryEntry = {
    buf,
    contentType,
    expiresAt: Date.now() + MEMORY_TTL_MS,
    bytes: buf.byteLength,
  };
  memory.set(url, entry);
  memoryBytes += entry.bytes;
}

function readMemory(url: string): MemoryEntry | null {
  const entry = memory.get(url);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    deleteMemoryEntry(url);
    return null;
  }
  // Map insertion order is the LRU list: refresh without sorting/allocation.
  memory.delete(url);
  memory.set(url, entry);
  return entry;
}

/**
 * CDN URL を取得（メモリ → ディスク → ネットワーク）。大きなassetは
 * Uint8Arrayへhydrateせず、Responseへ渡せるディスクpathを返す。
 */
export async function getCachedLineCdnAsset(url: string): Promise<CachedLineCdnAsset> {
  if (!isAllowedLineCdnUrl(url)) {
    throw new Error("cdn host not allowed");
  }

  const mem = readMemory(url);
  if (mem) {
    return {
      kind: "memory",
      buf: mem.buf,
      contentType: mem.contentType,
      fromCache: true,
      size: mem.bytes,
    };
  }

  const disk = await readDisk(url);
  if (disk) {
    if (disk.kind === "memory") remember(url, disk.buf, disk.contentType);
    return { ...disk, fromCache: true };
  }

  // 同時リクエストの場合は 1 回のネットワーク取得にまとめる
  const existing = inflight.get(url);
  if (existing) {
    const net = await existing;
    return { ...net, fromCache: false };
  }

  const netPromise = withFetchSlot(async () => {
    const asset = await fetchToDisk(url);
    if (asset.kind === "memory") remember(url, asset.buf, asset.contentType);
    return asset;
  });
  inflight.set(url, netPromise);
  try {
    const net = await netPromise;
    return { ...net, fromCache: false };
  } finally {
    if (inflight.get(url) === netPromise) inflight.delete(url);
  }
}

/** Compatibility buffer API. Runtime HTTP delivery uses the path-backed API. */
export async function getCachedLineCdn(
  url: string,
): Promise<{ buf: Uint8Array; contentType: string; fromCache: boolean }> {
  const asset = await getCachedLineCdnAsset(url);
  const buf = asset.kind === "memory" ? asset.buf : new Uint8Array(await readFile(asset.path));
  return { buf, contentType: asset.contentType, fromCache: asset.fromCache };
}

export function getCdnMemoryCacheStats(): {
  entries: number;
  bytes: number;
  maxBytes: number;
  maxEntryBytes: number;
} {
  return {
    entries: memory.size,
    bytes: memoryBytes,
    maxBytes: MEMORY_MAX_BYTES,
    maxEntryBytes: MEMORY_MAX_ENTRY_BYTES,
  };
}

export async function ensureCdnCacheDir(): Promise<void> {
  await mkdir(CACHE_ROOT, { recursive: true });
  try {
    await stat(CACHE_ROOT);
  } catch {
    /* ignore */
  }
}

export async function getCdnCacheSize(): Promise<number> {
  return withRootSizeLock(CACHE_ROOT, (state) => ensureRootSize(CACHE_ROOT, state));
}

export async function getIconCacheSize(): Promise<number> {
  return withRootSizeLock(ICON_ROOT, (state) => ensureRootSize(ICON_ROOT, state));
}

export async function clearCdnCache(): Promise<number> {
  clearMemoryForRoot(CACHE_ROOT);
  return clearDir(CACHE_ROOT);
}

export async function clearIconCache(): Promise<number> {
  clearMemoryForRoot(ICON_ROOT);
  return clearDir(ICON_ROOT);
}

function clearMemoryForRoot(root: string): void {
  for (const url of [...memory.keys()]) {
    if (cacheRootForUrl(url) === root) deleteMemoryEntry(url);
  }
}

async function clearDir(root: string): Promise<number> {
  return withRootSizeLock(root, async (state) => {
    let removed = 0;
    try {
      await ensureRootSize(root, state);
      const { readdir, rm } = await import("node:fs/promises");
      await mkdir(root, { recursive: true });
      const entries = await readdir(root, { withFileTypes: true });
      for (const e of entries) {
        const p = join(root, e.name);
        if (e.isDirectory()) {
          const files = await readdir(p);
          for (const f of files) {
            await rm(join(p, f), { force: true });
            removed++;
          }
        } else {
          await rm(p, { force: true });
          removed++;
        }
      }
      state.bytes = 0;
      const { logger } = await import("../logger.js");
      logger.info({ removed, root }, "cdn dir cleared");
    } catch (err) {
      // A partial clear invalidates the counter; the next read repairs it once.
      state.bytes = null;
      log.debug({ err, root }, "cdn dir clear failed");
    }
    return removed;
  });
}
