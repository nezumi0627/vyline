/**
 * storage/cdnAssetCache.ts
 *
 * stickershop / sticon CDN 画像のディスクキャッシュ。
 * ブラウザ → /cdn/line?... → ここ → CDN（初回のみ）
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("cdn-cache");

const ALLOWED_HOSTS = new Set([
  "stickershop.line-scdn.net",
  "shop.line-scdn.net",
  "static.line-scdn.net",
]);

const _dir = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT =
  process.env["VYLINE_CDN_CACHE_DIR"] ?? join(_dir, "../../data/cdn-cache");

const memory = new Map<string, { buf: Uint8Array; contentType: string; at: number }>();
const MEMORY_MAX = 80;
const MEMORY_TTL_MS = 30 * 60_000;

function hashKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
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
  return join(CACHE_ROOT, h.slice(0, 2), `${h}${ext || ""}`);
}

async function readDisk(
  url: string,
): Promise<{ buf: Uint8Array; contentType: string } | null> {
  const h = hashKey(url);
  const dir = join(CACHE_ROOT, h.slice(0, 2));
  try {
    const { readdir } = await import("node:fs/promises");
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

async function writeDisk(
  url: string,
  buf: Uint8Array,
  contentType: string,
): Promise<void> {
  const path = diskPath(url, contentType);
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

  const res = await fetch(url, {
    headers: {
      "user-agent": "Vyline/1.0",
      accept: "image/*,application/json,*/*",
    },
  });
  if (!res.ok) {
    throw new Error(`cdn fetch ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const ab = await res.arrayBuffer();
  const buf = new Uint8Array(ab);
  remember(url, buf, contentType);
  void writeDisk(url, buf, contentType).catch((err) => {
    log.debug({ err, url }, "cdn disk write failed");
  });
  return { buf, contentType, fromCache: false };
}

export async function ensureCdnCacheDir(): Promise<void> {
  await mkdir(CACHE_ROOT, { recursive: true });
  try {
    await stat(CACHE_ROOT);
  } catch {
    /* ignore */
  }
}
