/**
 * storage/cdnAssetCache.ts
 *
 * stickershop / sticon CDN 画像のディスクキャッシュ。
 * ブラウザ → /cdn/line?... → ここ → CDN（初回のみ）
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("cdn-cache");

async function dirSize(target: string): Promise<number> {
  if (!existsSync(target)) return 0;
  let total = 0;
  try {
    const entries = await readdir(target, { withFileTypes: true });
    for (const e of entries) {
      const p = join(target, e.name);
      if (e.isDirectory()) {
        total += await dirSize(p);
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

const ICON_HOSTS = new Set(["profile.line-scdn.net"]);
const CDN_HOSTS = new Set([
  "stickershop.line-scdn.net",
  "shop.line-scdn.net",
  "static.line-scdn.net",
]);

const _dir = dirname(fileURLToPath(import.meta.url));
const LEGACY_ROOT = join(_dir, "../../data/cdn-cache");
const CACHE_ROOT = process.env.VYLINE_CDN_CACHE_DIR ?? join(_dir, "../../storage/cache/cdn-cache");
const ICON_ROOT = process.env.VYLINE_ICON_CACHE_DIR ?? join(_dir, "../../storage/cache/icons");

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

const memory = new Map<string, { buf: Uint8Array; contentType: string; at: number }>();
const MEMORY_MAX = 80;
const MEMORY_TTL_MS = 30 * 60_000;
/** CDN から取得するレスポンスの最大サイズ（不正/巨大レスポンスからの保護） */
const MAX_CDN_RESPONSE_BYTES = 10 * 1024 * 1024;

/** 同一 URL の同時リクエストを 1 回の CDN 取得にまとめる */
const inflight = new Map<string, Promise<{ buf: Uint8Array; contentType: string }>>();

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

/**
 * レスポンスボディを上限バイト数まで読み込む。
 * Content-Length が無い/偽っているレスポンスでも、ストリーム読み込み中に
 * 累積サイズを検査し、上限を超えたら読み込みを中断する。
 */
async function readBoundedBody(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new Error(`cdn response too large: ${ab.byteLength} bytes`);
    }
    return new Uint8Array(ab);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`cdn response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buf;
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
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function diskPath(url: string, contentType?: string): string {
  const h = hashKey(url);
  const ext = contentType ? extFromContentType(contentType, url) : "";
  const root = cacheRootForUrl(url);
  return join(root, h.slice(0, 2), `${h}${ext || ""}`);
}

async function readDisk(url: string): Promise<{ buf: Uint8Array; contentType: string } | null> {
  const h = hashKey(url);
  const root = cacheRootForUrl(url);
  const dir = join(root, h.slice(0, 2));
  try {
    const files = await readdir(dir);
    const hit = files.find((f) => f.startsWith(h));
    if (!hit) return null;
    const buf = await readFile(join(dir, hit));
    const ext = hit.includes(".") ? hit.slice(hit.lastIndexOf(".")) : "";
    const contentType =
      ext === ".png"
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
    return { buf: new Uint8Array(buf), contentType };
  } catch {
    return null;
  }
}

async function writeDisk(url: string, buf: Uint8Array, contentType: string): Promise<void> {
  const path = diskPath(url, contentType);
  const root = cacheRootForUrl(url);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
}

function remember(url: string, buf: Uint8Array, contentType: string): void {
  if (memory.size >= MEMORY_MAX) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) memory.delete(oldest[0]);
  }
  memory.set(url, { buf, contentType, at: Date.now() });
}

/**
 * CDN URL を取得（メモリ → ディスク → ネットワーク）。
 * 戻り値はキャッシュ済みバッファ。
 */
export async function getCachedLineCdn(
  url: string,
): Promise<{ buf: Uint8Array; contentType: string; fromCache: boolean }> {
  if (!isAllowedLineCdnUrl(url)) {
    throw new Error("cdn host not allowed");
  }

  const mem = memory.get(url);
  if (mem && Date.now() - mem.at < MEMORY_TTL_MS) {
    return { buf: mem.buf, contentType: mem.contentType, fromCache: true };
  }

  const disk = await readDisk(url);
  if (disk) {
    remember(url, disk.buf, disk.contentType);
    return { ...disk, fromCache: true };
  }

  // 同時リクエストの場合は 1 回のネットワーク取得にまとめる
  const existing = inflight.get(url);
  if (existing) {
    const net = await existing;
    remember(url, net.buf, net.contentType);
    return { ...net, fromCache: false };
  }

  const netPromise = (async () => {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Vyline/1.0",
        accept: "image/*,application/json,*/*",
      },
    });
    if (res.status === 404) {
      throw new CdnNotFoundError(url);
    }
    if (!res.ok) {
      throw new Error(`cdn fetch ${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_CDN_RESPONSE_BYTES) {
      throw new Error(`cdn response too large: ${declaredLength} bytes`);
    }

    const buf = await readBoundedBody(res, MAX_CDN_RESPONSE_BYTES);
    return { buf, contentType };
  })();
  inflight.set(url, netPromise);
  try {
    const net = await netPromise;
    remember(url, net.buf, net.contentType);
    void writeDisk(url, net.buf, net.contentType).catch((err) => {
      log.debug({ err, url }, "cdn disk write failed");
    });
    return { buf: net.buf, contentType: net.contentType, fromCache: false };
  } finally {
    inflight.delete(url);
  }
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
  return dirSize(CACHE_ROOT);
}

export async function getIconCacheSize(): Promise<number> {
  return dirSize(ICON_ROOT);
}

export async function clearCdnCache(): Promise<number> {
  memory.clear();
  return clearDir(CACHE_ROOT);
}

export async function clearIconCache(): Promise<number> {
  return clearDir(ICON_ROOT);
}

async function clearDir(root: string): Promise<number> {
  let removed = 0;
  try {
    const { readdir, rm, stat } = await import("node:fs/promises");
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
    const { logger } = await import("../logger.js");
    logger.info({ removed, root }, "cdn dir cleared");
  } catch (err) {
    log.debug({ err, root }, "cdn dir clear failed");
  }
  return removed;
}
