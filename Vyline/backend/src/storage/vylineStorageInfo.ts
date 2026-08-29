/**
 * storage/vylineStorageInfo.ts
 *
 * Vyline のストレージ使用量とディスク情報を集計する。
 */

import { existsSync } from "node:fs";
import { readdir, stat, statfs } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("vyline-storage");
const _dir = dirname(fileURLToPath(import.meta.url));

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export const VYLINE_DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
export const VYLINE_STORAGE_DIR =
  process.env.VYLINE_STORAGE_DIR ?? join(_dir, "..", "..", "storage");
export const VYLINE_CACHE_DIR = join(VYLINE_STORAGE_DIR, "cache");
export const VYLINE_SAVED_MEDIA_DIR =
  process.env.VYLINE_MEDIA_STORAGE_DIR ??
  process.env.VYLINE_MEDIA_CACHE_DIR ??
  join(VYLINE_STORAGE_DIR, "saved-media");

const CDN_CACHE_DIR = process.env.VYLINE_CDN_CACHE_DIR ?? join(VYLINE_CACHE_DIR, "cdn-cache");
const ICON_CACHE_DIR = process.env.VYLINE_ICON_CACHE_DIR ?? join(VYLINE_CACHE_DIR, "icons");

const MEDIA_TYPE_DIRS = {
  image: join(VYLINE_SAVED_MEDIA_DIR, "images"),
  video: join(VYLINE_SAVED_MEDIA_DIR, "videos"),
  audio: join(VYLINE_SAVED_MEDIA_DIR, "audio"),
  file: join(VYLINE_SAVED_MEDIA_DIR, "files"),
} as const;

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
          /* ignore individual files that disappear during the scan */
        }
      }
    }
  } catch (err) {
    log.debug({ err, target }, "dirSize failed");
  }
  return total;
}

function extractDriveLetter(path: string): string {
  const m = /^([a-zA-Z]:)/.exec(path);
  return m?.[1]?.toUpperCase() ?? "";
}

async function getDiskInfo(
  targetPath: string,
): Promise<{ totalBytes: number; freeBytes: number; usedBytes: number } | null> {
  try {
    const fs = await statfs(targetPath);
    const blockSize = Number(fs.bsize);
    const totalBytes = Number(fs.blocks) * blockSize;
    const freeBytes = Number(fs.bavail) * blockSize;
    if (Number.isFinite(totalBytes) && Number.isFinite(freeBytes) && totalBytes > 0) {
      return {
        totalBytes,
        freeBytes: Math.max(0, freeBytes),
        usedBytes: Math.max(0, totalBytes - freeBytes),
      };
    }
  } catch (err) {
    log.debug({ err, targetPath }, "statfs failed");
  }

  // Older Windows/Bun combinations may not expose a useful statfs result.
  if (process.platform !== "win32") return null;
  try {
    const driveLetter = extractDriveLetter(targetPath);
    if (!driveLetter) return null;
    const name = driveLetter.replace(":", "");
    const ps = `[pscustomobject]@{ Total = (Get-PSDrive ${name}).Used + (Get-PSDrive ${name}).Free; Free = (Get-PSDrive ${name}).Free; Used = (Get-PSDrive ${name}).Used } | ConvertTo-Json`;
    const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", ps], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout] = await Promise.all([proc.exited, streamToText(proc.stdout)]);
    if (typeof code === "number" && code === 0 && stdout.trim()) {
      const data = JSON.parse(stdout.trim());
      if (data && typeof data.Total === "number") {
        return { totalBytes: data.Total, freeBytes: data.Free, usedBytes: data.Used };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function getVylineStorageInfo() {
  const [
    cdnCacheSize,
    iconCacheSize,
    imagesSize,
    videosSize,
    audioSize,
    filesSize,
    dataSize,
    storageSize,
  ] = await Promise.all([
    dirSize(CDN_CACHE_DIR),
    dirSize(ICON_CACHE_DIR),
    dirSize(MEDIA_TYPE_DIRS.image),
    dirSize(MEDIA_TYPE_DIRS.video),
    dirSize(MEDIA_TYPE_DIRS.audio),
    dirSize(MEDIA_TYPE_DIRS.file),
    dirSize(VYLINE_DATA_DIR),
    dirSize(VYLINE_STORAGE_DIR),
  ]);

  const cacheSize = cdnCacheSize + iconCacheSize;
  const savedMediaSize = imagesSize + videosSize + audioSize + filesSize;

  // The storage page says "app usage", so count all persistent Vyline state,
  // not only disposable cache/media. This includes chatdb.json, account settings,
  // tokens/session metadata, restore backups, and other files under /app/data.
  const samePersistentRoot = resolve(VYLINE_DATA_DIR) === resolve(VYLINE_STORAGE_DIR);
  const vylineTotal = samePersistentRoot ? storageSize : dataSize + storageSize;
  const diskTarget = existsSync(VYLINE_STORAGE_DIR) ? VYLINE_STORAGE_DIR : VYLINE_DATA_DIR;
  const disk = await getDiskInfo(diskTarget);
  const driveLetter = extractDriveLetter(diskTarget) || diskTarget;

  return {
    ok: true,
    driveLetter,
    storagePath: diskTarget,
    disk,
    vylineTotal,
    dataSize,
    storageSize,
    cacheSize,
    savedMediaSize,
    cache: {
      cdn: cdnCacheSize,
      icons: iconCacheSize,
    },
    savedMedia: {
      image: imagesSize,
      video: videosSize,
      audio: audioSize,
      file: filesSize,
    },
  };
}
