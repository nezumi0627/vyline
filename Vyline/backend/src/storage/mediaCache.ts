/**
 * storage/mediaCache.ts — メッセージ添付メディア（画像/動画/音声/ファイル）の
 * サーバー側ディスクキャッシュ。
 *
 * LINE OBS / 履歴 RPC から取得したバイト列を data/media-cache/ に保存し、
 * 以後は再取得せずディスクから返す。スマホ・端末を乗り換えても履歴の画像が
 * 消えないようにするための永続キャッシュ。E2EE で復号済みの平文を保持する。
 *
 * キー: accountId + chatMid + messageId（メッセージ単位）
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("media-cache");

const _dir = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = process.env.VYLINE_MEDIA_CACHE_DIR ?? join(_dir, "../../data/media-cache");

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

function diskPath(accountId: string, chatMid: string, messageId: string, ct: string): string {
  const h = key(accountId, chatMid, messageId);
  return join(CACHE_ROOT, h.slice(0, 2), `${h}${extFromContentType(ct)}`);
}

export async function readMediaCache(
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
  const dir = join(CACHE_ROOT, h.slice(0, 2));
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const hit = files.find((f) => f.startsWith(h));
    if (!hit) return null;
    const buf = new Uint8Array(await readFile(join(dir, hit)));
    const contentType = hit.endsWith(".jpg")
      ? "image/jpeg"
      : hit.endsWith(".png")
        ? "image/png"
        : hit.endsWith(".webp")
          ? "image/webp"
          : hit.endsWith(".gif")
            ? "image/gif"
            : hit.endsWith(".mp4")
              ? "video/mp4"
              : hit.endsWith(".m4a")
                ? "audio/m4a"
                : hit.endsWith(".pdf")
                  ? "application/pdf"
                  : "application/octet-stream";
    remember(memKey, buf, contentType);
    return { buf, contentType };
  } catch {
    return null;
  }
}

function remember(memKey: string, buf: Uint8Array, contentType: string): void {
  if (memory.size >= MEMORY_MAX) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) memory.delete(oldest[0]);
  }
  memory.set(memKey, { buf, contentType, at: Date.now() });
}

export async function writeMediaCache(
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
    log.debug({ err, messageId }, "media cache write failed");
  }
}

export async function ensureMediaCacheDir(): Promise<void> {
  await mkdir(CACHE_ROOT, { recursive: true });
}

export async function clearMediaCache(): Promise<number> {
  memory.clear();
  let removed = 0;
  try {
    const { readdir, rm, stat } = await import("node:fs/promises");
    await mkdir(CACHE_ROOT, { recursive: true });
    const entries = await readdir(CACHE_ROOT, { withFileTypes: true });
    for (const e of entries) {
      const p = join(CACHE_ROOT, e.name);
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
    logger.info({ removed }, "media cache cleared");
  } catch (err) {
    log.debug({ err }, "media cache clear failed");
  }
  return removed;
}
