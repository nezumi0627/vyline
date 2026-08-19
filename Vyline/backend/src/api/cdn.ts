/**
 * api/cdn.ts — LINE CDN（スタンプ / sticon）プロキシ + ディスクキャッシュ
 *
 * GET /cdn/line?u=<encoded https url>
 */

import { Hono } from "hono";
import {
  CdnNotFoundError,
  getCachedLineCdn,
  isAllowedLineCdnUrl,
} from "../storage/cdnAssetCache.js";
import { childLogger } from "../logger.js";

const log = childLogger("bff:cdn");

// 1x1 透明 PNG（404 フォールバック。壊れた画像アイコンを出さない）
const TRANSPARENT_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const cdnRouter = new Hono();

cdnRouter.get("/line", async (c) => {
  const raw = c.req.query("u") ?? c.req.query("url") ?? "";
  let url: string;
  try {
    url = decodeURIComponent(raw);
  } catch {
    return c.json({ ok: false, error: "bad url" }, 400);
  }
  if (!url || !isAllowedLineCdnUrl(url)) {
    return c.json({ ok: false, error: "url not allowed" }, 400);
  }

  try {
    const { buf, contentType, fromCache } = await getCachedLineCdn(url);
    const body = Buffer.from(buf);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Vyline-Cdn-Cache": fromCache ? "HIT" : "MISS",
      },
    });
  } catch (err) {
    log.debug({ err, url }, "cdn proxy failed");
    // 404 は透過 PNG を返してフォールバック（画像エラーを出さない）
    if (err instanceof CdnNotFoundError) {
      return new Response(Buffer.from(TRANSPARENT_PNG), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=604800, immutable",
          "X-Vyline-Cdn-Cache": "MISS-404",
        },
      });
    }
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
