/**
 * storage/vylineStorageInfo.ts
 *
 * Vyline のストレージ使用量とディスク情報を集計する。
 */

import { existsSync } from "node:fs";
import { opendir, stat, statfs } from "node:fs/promises";
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
export const VYLINE_LEGACY_MEDIA_DIR = join(VYLINE_DATA_DIR, "media-cache");
const VYLINE_BACKUP_DIR = resolve(
  process.env.VYLINE_BACKUP_DIR ?? join(VYLINE_DATA_DIR, "backups"),
);

const CDN_CACHE_DIR = process.env.VYLINE_CDN_CACHE_DIR ?? join(VYLINE_CACHE_DIR, "cdn-cache");
const ICON_CACHE_DIR = process.env.VYLINE_ICON_CACHE_DIR ?? join(VYLINE_CACHE_DIR, "icons");

const TREE_CACHE_TTL_MS = Number(process.env.VYLINE_STORAGE_INFO_CACHE_TTL_MS ?? 60_000);

async function dirSize(
  target: string,
  excludedRoots: ReadonlySet<string> = new Set(),
): Promise<number> {
  if (!existsSync(target)) return 0;
  if (excludedRoots.has(resolve(target))) return 0;
  let total = 0;
  try {
    const entries = await opendir(target);
    for await (const e of entries) {
      const p = join(target, e.name);
      if (e.isDirectory()) {
        total += await dirSize(p, excludedRoots);
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

interface NonMediaStorageScan {
  dataSizeWithoutMedia: number;
  storageSizeWithoutMedia: number;
  cdnCacheSize: number;
  iconCacheSize: number;
}

let cachedScan: { at: number; value: NonMediaStorageScan } | null = null;
let scanInflight: Promise<NonMediaStorageScan> | null = null;

function isPathInside(path: string, root: string): boolean {
  const normalizedPath = resolve(path);
  const normalizedRoot = resolve(root);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}\\`) ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

async function scanStorageTree(target: string): Promise<{
  total: number;
  cdn: number;
  icons: number;
}> {
  const indexedRoots = new Set(
    [
      VYLINE_SAVED_MEDIA_DIR,
      VYLINE_LEGACY_MEDIA_DIR,
      VYLINE_BACKUP_DIR,
      CDN_CACHE_DIR,
      ICON_CACHE_DIR,
    ].map((path) => resolve(path)),
  );
  let total = 0;
  let cdn = 0;
  let icons = 0;
  const walk = async (dir: string): Promise<void> => {
    if (!existsSync(dir) || indexedRoots.has(resolve(dir))) return;
    let entries;
    try {
      entries = await opendir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for await (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      try {
        const bytes = (await stat(path)).size;
        total += bytes;
        if (isPathInside(path, CDN_CACHE_DIR)) cdn += bytes;
        else if (isPathInside(path, ICON_CACHE_DIR)) icons += bytes;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  };
  await walk(target);
  return { total, cdn, icons };
}

async function refreshNonMediaScan(): Promise<NonMediaStorageScan> {
  const samePersistentRoot = resolve(VYLINE_DATA_DIR) === resolve(VYLINE_STORAGE_DIR);
  const storage = await scanStorageTree(VYLINE_STORAGE_DIR);
  const dataSizeWithoutMedia = samePersistentRoot
    ? storage.total
    : await dirSize(
        VYLINE_DATA_DIR,
        new Set(
          [
            VYLINE_SAVED_MEDIA_DIR,
            VYLINE_LEGACY_MEDIA_DIR,
            VYLINE_BACKUP_DIR,
            CDN_CACHE_DIR,
            ICON_CACHE_DIR,
          ].map((path) => resolve(path)),
        ),
      );
  return {
    dataSizeWithoutMedia,
    storageSizeWithoutMedia: storage.total,
    cdnCacheSize: storage.cdn,
    iconCacheSize: storage.icons,
  };
}

async function getNonMediaScan(): Promise<NonMediaStorageScan> {
  if (cachedScan && Date.now() - cachedScan.at < TREE_CACHE_TTL_MS) return cachedScan.value;
  scanInflight ??= refreshNonMediaScan()
    .then((value) => {
      cachedScan = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      scanInflight = null;
    });
  return scanInflight;
}

export function invalidateVylineStorageInfoCache(): void {
  cachedScan = null;
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
  // Dynamic import avoids a static cycle: mediaStorage uses the path constants above.
  const [
    { getMediaStorageIndexedTotals },
    { getTotalBackupStorageBytes },
    { getCdnCacheSize, getIconCacheSize },
    scan,
  ] = await Promise.all([
    import("./mediaStorage.js"),
    import("../service/backupService.js"),
    import("./cdnAssetCache.js"),
    getNonMediaScan(),
  ]);
  const [media, backupSize, cdnCacheSize, iconCacheSize] = await Promise.all([
    getMediaStorageIndexedTotals(),
    getTotalBackupStorageBytes(),
    getCdnCacheSize(),
    getIconCacheSize(),
  ]);
  const imagesSize = media.image;
  const videosSize = media.video;
  const audioSize = media.audio;
  const filesSize = media.file;
  const samePersistentRoot = resolve(VYLINE_DATA_DIR) === resolve(VYLINE_STORAGE_DIR);
  const backupInData = isPathInside(VYLINE_BACKUP_DIR, VYLINE_DATA_DIR);
  const backupInStorage = isPathInside(VYLINE_BACKUP_DIR, VYLINE_STORAGE_DIR);
  const cacheBytes = cdnCacheSize + iconCacheSize;
  const cacheBytesInData =
    (isPathInside(CDN_CACHE_DIR, VYLINE_DATA_DIR) ? cdnCacheSize : 0) +
    (isPathInside(ICON_CACHE_DIR, VYLINE_DATA_DIR) ? iconCacheSize : 0);
  const cacheBytesInStorage =
    (isPathInside(CDN_CACHE_DIR, VYLINE_STORAGE_DIR) ? cdnCacheSize : 0) +
    (isPathInside(ICON_CACHE_DIR, VYLINE_STORAGE_DIR) ? iconCacheSize : 0);
  const dataSize =
    scan.dataSizeWithoutMedia +
    (samePersistentRoot ? media.total : 0) +
    (backupInData ? backupSize : 0) +
    cacheBytesInData;
  const storageSize =
    scan.storageSizeWithoutMedia +
    media.total +
    (backupInStorage ? backupSize : 0) +
    cacheBytesInStorage;

  const cacheSize = cacheBytes;
  const savedMediaSize = imagesSize + videosSize + audioSize + filesSize;

  // The storage page says "app usage", so count all persistent Vyline state,
  // not only disposable cache/media. This includes chatdb.json, account settings,
  // tokens/session metadata, restore backups, and other files under /app/data.
  const vylineTotal = samePersistentRoot ? storageSize : dataSize + storageSize;
  const diskTarget = existsSync(VYLINE_STORAGE_DIR) ? VYLINE_STORAGE_DIR : VYLINE_DATA_DIR;
  const disk = await getDiskInfo(diskTarget);
  const driveLetter = extractDriveLetter(diskTarget) || diskTarget;

  return {
    ok: true,
    driveLetter,
    dataPath: VYLINE_DATA_DIR,
    storagePath: VYLINE_STORAGE_DIR,
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
