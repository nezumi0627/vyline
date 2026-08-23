/**
 * storage/mediaStorage.ts — メッセージ添付メディア（画像/動画/音声/ファイル）の
 * サーバー側永続ストレージ。
 *
 * LINE OBS / 履歴 RPC から取得したバイト列を storage/saved-media/ に保存し、
 * 以後は再取得せずディスクから返す。送信元バイト列と E2EE 復号済みの平文を
 * 保持するため、CDN やプロフィール画像の再取得可能なキャッシュとは分離する。
 *
 * キー: accountId + chatMid + messageId（メッセージ単位）
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { VYLINE_SAVED_MEDIA_DIR } from "./vylineStorageInfo.js";

const log = childLogger("media-storage");

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

const _dir = dirname(fileURLToPath(import.meta.url));
const LEGACY_ROOT = join(_dir, "../../data/media-cache");
const STORAGE_ROOT = VYLINE_SAVED_MEDIA_DIR;

const TYPE_ROOTS = {
  image: join(STORAGE_ROOT, "images"),
  video: join(STORAGE_ROOT, "videos"),
  audio: join(STORAGE_ROOT, "audio"),
  file: join(STORAGE_ROOT, "files"),
} as const;

try {
  if (!existsSync(STORAGE_ROOT) && existsSync(LEGACY_ROOT)) {
    const { rename } = await import("node:fs/promises");
    await mkdir(dirname(STORAGE_ROOT), { recursive: true });
    await rename(LEGACY_ROOT, STORAGE_ROOT);
  }
  await mkdir(STORAGE_ROOT, { recursive: true });
  for (const dir of Object.values(TYPE_ROOTS)) {
    await mkdir(dir, { recursive: true });
  }
} catch {
  /* ignore */
}

const memory = new Map<string, { buf: Uint8Array; contentType: string; at: number }>();
const MEMORY_MAX = 40;
const MEMORY_TTL_MS = 10 * 60_000;

function key(accountId: string, chatMid: string, messageId: string): string {
  return createHash("sha256").update(`${accountId}:${chatMid}:${messageId}`).digest("hex");
}

function extFromContentType(ct: string): string {
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("mp4")) return ".mp4";
  if (ct.includes("m4a") || ct.includes("mp4a") || ct.includes("audio")) return ".m4a";
  if (ct.includes("pdf")) return ".pdf";
  return ".bin";
}

function contentTypeFromFilename(name: string): string {
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".m4a")) return "audio/m4a";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function typeRootForContentType(ct: string): string {
  const lower = ct.toLowerCase();
  if (lower.startsWith("image/")) return TYPE_ROOTS.image;
  if (lower.startsWith("video/")) return TYPE_ROOTS.video;
  if (lower.startsWith("audio/")) return TYPE_ROOTS.audio;
  return TYPE_ROOTS.file;
}

function diskPath(accountId: string, chatMid: string, messageId: string, ct: string): string {
  const h = key(accountId, chatMid, messageId);
  const root = typeRootForContentType(ct);
  const ext = extFromContentType(ct);
  return join(root, h.slice(0, 2), `${h}${ext}`);
}

export async function readMediaStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<{ buf: Uint8Array; contentType: string } | null> {
  const memKey = `${accountId}:${chatMid}:${messageId}`;
  const mem = memory.get(memKey);
  if (mem && Date.now() - mem.at < MEMORY_TTL_MS) {
    return { buf: mem.buf, contentType: mem.contentType };
  }
  const h = key(accountId, chatMid, messageId);

  const searchRoots = [STORAGE_ROOT, LEGACY_ROOT, ...Object.values(TYPE_ROOTS)];
  for (const root of searchRoots) {
    if (root === LEGACY_ROOT && existsSync(root) === false) continue;
    const dir = join(root, h.slice(0, 2));
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(dir);
      const hit = files.find((f) => f.startsWith(h));
      if (!hit) continue;
      const buf = new Uint8Array(await readFile(join(dir, hit)));
      const contentType = contentTypeFromFilename(hit);
      remember(memKey, buf, contentType);
      return { buf, contentType };
    } catch {}
  }
  return null;
}

function remember(memKey: string, buf: Uint8Array, contentType: string): void {
  if (memory.size >= MEMORY_MAX) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) memory.delete(oldest[0]);
  }
  memory.set(memKey, { buf, contentType, at: Date.now() });
}

export async function writeMediaStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
  buf: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    const path = diskPath(accountId, chatMid, messageId, contentType);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    remember(`${accountId}:${chatMid}:${messageId}`, buf, contentType);
  } catch (err) {
    log.warn({ err, messageId }, "media storage write failed");
  }
}

export async function ensureMediaStorageDir(): Promise<void> {
  await mkdir(STORAGE_ROOT, { recursive: true });
}

export async function clearMediaStorage(): Promise<number> {
  memory.clear();
  return clearDir(STORAGE_ROOT);
}

export async function clearMediaStorageType(
  type: "image" | "video" | "audio" | "file",
): Promise<number> {
  const root = TYPE_ROOTS[type];
  if (!root) return 0;
  return clearDir(root);
}

export async function getMediaStorageSize(): Promise<number> {
  return dirSize(STORAGE_ROOT);
}

export async function getMediaStorageSizeByType(): Promise<{
  image: number;
  video: number;
  audio: number;
  file: number;
}> {
  const [image, video, audio, file] = await Promise.all([
    dirSize(TYPE_ROOTS.image),
    dirSize(TYPE_ROOTS.video),
    dirSize(TYPE_ROOTS.audio),
    dirSize(TYPE_ROOTS.file),
  ]);
  return { image, video, audio, file };
}

async function clearDir(root: string): Promise<number> {
  let removed = 0;
  try {
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
    const { logger } = await import("../logger.js");
    logger.info({ removed, root }, "media storage cleared");
  } catch (err) {
    log.debug({ err, root }, "media storage clear failed");
  }
  return removed;
}
