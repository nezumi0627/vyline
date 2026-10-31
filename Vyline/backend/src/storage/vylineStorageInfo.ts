/**
 * storage/vylineStorageInfo.ts
 *
 * Vyline のストレージ使用量とディスク情報を集計する。
 */

import { existsSync } from "node:fs";
import { readdir, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("vyline-storage");
const _dir = dirname(fileURLToPath(import.meta.url));

export const VYLINE_DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
export const VYLINE_STORAGE_DIR =
  process.env.VYLINE_STORAGE_DIR ?? join(_dir, "..", "..", "storage");
export const VYLINE_CACHE_DIR = join(VYLINE_STORAGE_DIR, "cache");
export const VYLINE_SAVED_MEDIA_DIR =
  process.env.VYLINE_MEDIA_STORAGE_DIR ??
  process.env.VYLINE_MEDIA_CACHE_DIR ??
  join(VYLINE_STORAGE_DIR, "saved-media");

const CDN_CACHE_DIR = join(VYLINE_CACHE_DIR, "cdn-cache");
const ICON_CACHE_DIR = join(VYLINE_CACHE_DIR, "icons");
const LEGACY_CDN_CACHE_DIR = join(VYLINE_DATA_DIR, "cdn-cache");
const LEGACY_MEDIA_CACHE_DIR = join(VYLINE_DATA_DIR, "media-cache");

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
          /* ignore */
        }
      }
    }
  } catch (err) {
    log.debug({ err, target }, "dirSize failed");
  }
  return total;
}

async function sqliteFilesSize(): Promise<number> {
  const databasePath = join(VYLINE_DATA_DIR, "vyline.sqlite");
  const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  const sizes = await Promise.all(paths.map(async (path) => {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

function extractDriveLetter(path: string): string {
  const m = /^([a-zA-Z]:)/.exec(path);
  return m?.[1]?.toUpperCase() ?? "";
}

async function getDiskInfo(
  path: string,
): Promise<{ totalBytes: number; freeBytes: number; usedBytes: number } | null> {
  try {
    const info = await statfs(path);
    const totalBytes = Number(info.blocks) * Number(info.bsize);
    const freeBytes = Number(info.bavail) * Number(info.bsize);
    return { totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
  } catch {
    /* ignore */
  }
  return null;
}

export async function getVylineStorageInfo() {
  const driveLetter = extractDriveLetter(VYLINE_STORAGE_DIR);
  const [cdnCacheSize, iconCacheSize, imagesSize, videosSize, audioSize, filesSize, databaseSize] =
    await Promise.all([
      dirSize(CDN_CACHE_DIR),
      dirSize(ICON_CACHE_DIR),
      dirSize(MEDIA_TYPE_DIRS.image),
      dirSize(MEDIA_TYPE_DIRS.video),
      dirSize(MEDIA_TYPE_DIRS.audio),
      dirSize(MEDIA_TYPE_DIRS.file),
      sqliteFilesSize(),
    ]);

  const cacheSize = cdnCacheSize + iconCacheSize;
  const savedMediaSize = imagesSize + videosSize + audioSize + filesSize;
  const vylineTotal = cacheSize + savedMediaSize + databaseSize;
  const disk = await getDiskInfo(VYLINE_STORAGE_DIR);

  return {
    ok: true,
    driveLetter,
    disk,
    vylineTotal,
    databaseSize,
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
