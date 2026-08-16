/**
 * api/cdn.ts — LINE CDN（スタンプ / sticon）プロキシ + ディスクキャッシュ
 *
 * GET /cdn/line?u=<encoded https url>
 */

import { Hono } from "hono";
import {
  getCachedLineCdn,
  isAllowedLineCdnUrl,
} from "../storage/cdnAssetCache.js";
import { childLogger } from "../logger.js";

const log = childLogger("bff:cdn");

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
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});
