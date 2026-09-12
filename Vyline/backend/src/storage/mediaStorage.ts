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

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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

function accountRoot(accountId: string, root = storageRoot()): string {
  // Never use an external account identifier as a path segment.
  const accountHash = createHash("sha256").update(accountId).digest("hex");
  return join(root, "accounts", accountHash);
}

function accountTypeRoot(accountId: string, type: keyof ReturnType<typeof typeRoots>): string {
  return join(
    accountRoot(accountId),
    type === "image"
      ? "images"
      : type === "video"
        ? "videos"
        : type === "audio"
          ? "audio"
          : "files",
  );
}

function trashRoot(accountId: string, type: keyof ReturnType<typeof typeRoots>): string {
  return join(
    storageRoot(),
    ".trash",
    "accounts",
    createHash("sha256").update(accountId).digest("hex"),
    type === "image"
      ? "images"
      : type === "video"
        ? "videos"
        : type === "audio"
          ? "audio"
          : "files",
  );
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
const MEMORY_MAX_BYTES = 64 * 1024 * 1024;
const MEMORY_TTL_MS = 10 * 60_000;
let memoryBytes = 0;

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

function clearAccountMemory(accountId: string): void {
  for (const [memKey, entry] of memory) {
    if (memKey.startsWith(`${accountId}:`)) {
      memoryBytes -= entry.buf.byteLength;
      memory.delete(memKey);
    }
  }
}

function diskPath(accountId: string, chatMid: string, messageId: string, ct: string): string {
  const h = key(accountId, chatMid, messageId);
  const type = ct.toLowerCase().startsWith("image/")
    ? "images"
    : ct.toLowerCase().startsWith("video/")
      ? "videos"
      : ct.toLowerCase().startsWith("audio/")
        ? "audio"
        : "files";
  const root = join(accountRoot(accountId), type);
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
    mem.at = Date.now();
    return { buf: mem.buf, contentType: mem.contentType };
  }
  const h = key(accountId, chatMid, messageId);

  const root = storageRoot();
  const accountRoots = Object.keys(typeRoots(root)).map((type) =>
    accountTypeRoot(accountId, type as keyof ReturnType<typeof typeRoots>),
  );
  const searchRoots = [
    ...accountRoots,
    root,
    LEGACY_ROOT,
    ...Object.values(typeRoots(root)),
  ].filter((root) => root !== LEGACY_ROOT || existsSync(root));
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
  if (buf.byteLength > MEMORY_MAX_BYTES) return;
  const previous = memory.get(memKey);
  if (previous) memoryBytes -= previous.buf.byteLength;
  memory.delete(memKey);
  while (memory.size >= MEMORY_MAX || memoryBytes + buf.byteLength > MEMORY_MAX_BYTES) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!oldest) break;
    memoryBytes -= oldest[1].buf.byteLength;
    memory.delete(oldest[0]);
  }
  memory.set(memKey, { buf, contentType, at: Date.now() });
  memoryBytes += buf.byteLength;
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
  throw new Error("accountId is required; refusing to clear shared media storage");
}

export async function clearMediaStorageType(
  type: "image" | "video" | "audio" | "file",
  accountId?: string,
): Promise<number> {
  if (!accountId) throw new Error("accountId is required; refusing to clear shared media storage");
  const root = accountTypeRoot(accountId, type);
  const moved = await moveToTrash(root, trashRoot(accountId, type));
  clearAccountMemory(accountId);
  return moved;
}

export async function clearMediaStorageForAccount(accountId: string): Promise<number> {
  if (!accountId) throw new Error("accountId is required");
  let moved = 0;
  for (const type of ["image", "video", "audio", "file"] as const) {
    moved += await clearMediaStorageType(type, accountId);
  }
  clearAccountMemory(accountId);
  return moved;
}

/** Restore one logically deleted attachment from the account's trash. */
export async function restoreMediaStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<boolean> {
  const h = key(accountId, chatMid, messageId);
  for (const type of ["image", "video", "audio", "file"] as const) {
    // The account's type directory is moved as a whole under the account trash
    // directory, so search from its parent (not the original type directory).
    const source = await findFile(dirname(trashRoot(accountId, type)), h);
    if (!source) continue;
    const destination = join(accountTypeRoot(accountId, type), h.slice(0, 2), source.name);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source.path, destination);
    return true;
  }
  return false;
}

async function moveToTrash(root: string, trash: string): Promise<number> {
  let moved = 0;
  try {
    const count = await countFiles(root);
    if (count === 0) return 0;
    await mkdir(dirname(trash), { recursive: true });
    await rename(root, join(dirname(trash), `${Date.now()}-${randomUUID()}`));
    moved = count;
    log.info({ moved, root, trash }, "media storage moved to trash");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT")
      log.warn({ err, root }, "media storage trash move failed");
  }
  return moved;
}

async function countFiles(root: string): Promise<number> {
  let count = 0;
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      count += entry.isDirectory() ? await countFiles(path) : 1;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return count;
}

async function findFile(
  root: string,
  prefix: string,
): Promise<{ path: string; name: string } | null> {
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        const hit = await findFile(path, prefix);
        if (hit) return hit;
      } else if (entry.name.startsWith(prefix)) {
        return { path, name: entry.name };
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return null;
}
