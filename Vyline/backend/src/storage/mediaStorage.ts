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
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { VYLINE_SAVED_MEDIA_DIR } from "./vylineStorageInfo.js";

const log = childLogger("media-storage");

const _dir = dirname(fileURLToPath(import.meta.url));
const LEGACY_ROOT = join(_dir, "../../data/media-cache");

function storageRoot(): string {
  if (process.env.VYLINE_MEDIA_STORAGE_DIR) return process.env.VYLINE_MEDIA_STORAGE_DIR;
  if (process.env.VYLINE_MEDIA_CACHE_DIR) return process.env.VYLINE_MEDIA_CACHE_DIR;
  if (process.env.VYLINE_STORAGE_DIR) return join(process.env.VYLINE_STORAGE_DIR, "saved-media");
  return VYLINE_SAVED_MEDIA_DIR;
}

function typeRoots(root = storageRoot()) {
  return {
    image: join(root, "images"),
    video: join(root, "videos"),
    audio: join(root, "audio"),
    file: join(root, "files"),
  } as const;
}

try {
  const root = storageRoot();
  const roots = typeRoots(root);
  if (!existsSync(root) && existsSync(LEGACY_ROOT)) {
    await mkdir(dirname(root), { recursive: true });
    await rename(LEGACY_ROOT, root);
  }
  await mkdir(root, { recursive: true });
  for (const dir of Object.values(roots)) {
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
  const roots = typeRoots();
  const lower = ct.toLowerCase();
  if (lower.startsWith("image/")) return roots.image;
  if (lower.startsWith("video/")) return roots.video;
  if (lower.startsWith("audio/")) return roots.audio;
  return roots.file;
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

  const root = storageRoot();
  const searchRoots = [root, LEGACY_ROOT, ...Object.values(typeRoots(root))].filter(
    (root) => root !== LEGACY_ROOT || existsSync(root),
  );
  const candidates = await Promise.all(
    searchRoots.map(async (root) => {
      const dir = join(root, h.slice(0, 2));
      try {
        const hit = (await readdir(dir)).find((file) => file.startsWith(h));
        return hit ? join(dir, hit) : null;
      } catch {
        return null;
      }
    }),
  );
  const hit = candidates.find((candidate): candidate is string => candidate !== null);
  if (!hit) return null;

  const buf = new Uint8Array(await readFile(hit));
  const contentType = contentTypeFromFilename(hit);
  remember(memKey, buf, contentType);
  return { buf, contentType };
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
  await mkdir(storageRoot(), { recursive: true });
}

export async function clearMediaStorage(): Promise<number> {
  memory.clear();
  return clearDir(storageRoot());
}

export async function clearMediaStorageType(
  type: "image" | "video" | "audio" | "file",
): Promise<number> {
  const root = typeRoots()[type];
  if (!root) return 0;
  return clearDir(root);
}

async function clearDir(root: string): Promise<number> {
  let removed = 0;
  try {
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
