/**
 * backend/src/index.ts — Hono + Bun WebSocket（通話 PCM ブリッジ）
 *
 * 通話モジュールは遅延 import（ログイン等の基本機能を通話スタック障害から切り離す）
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";
import { authRouter } from "./api/auth.js";
import { lineRouter } from "./api/line.js";
import { agentIRouter } from "./api/agentI.js";
import { debugRouter } from "./api/debug.js";
import { cdnRouter } from "./api/cdn.js";
import { publicRouter } from "./api/public.js";
import { lineOpenApiSpec } from "./api/openapi.line.js";
import { restoreAllSessions } from "./line/clientManager.js";
import { initVylineProfile } from "./vyline/profileBridge.js";
import { warmAccountCache } from "./storage/chatStore.js";
import type { CallWsData } from "./call/callManager.js";
import { ensureCdnCacheDir } from "./storage/cdnAssetCache.js";
import { ensureMediaStorageDir } from "./storage/mediaStorage.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.VYLINE_HOST ?? "127.0.0.1";
const CORS_ORIGIN = process.env.VYLINE_CORS_ORIGIN ?? "http://localhost:5173";
const STATIC_DIR =
  process.env.VYLINE_STATIC_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "desktop", "dist");

const app = new Hono();

app.use("*", cors({ origin: CORS_ORIGIN }));

app.get("/healthz", (c) => c.json({ ok: true, status: "ready" }));
app.get("/api/v1/status", (c) =>
  c.json({
    ok: true,
    status: "ready",
    uptimeSec: Math.floor(performance.now() / 1000),
    version: process.env.npm_package_version ?? "dev",
  }),
);

// 軽量メトリクス: リクエストカウンタ + プロセス統計のみ（重い集計は行わない）
const metricsState = { requests: 0, errors: 0 };
app.use("*", async (c, next) => {
  await next();
  if (c.req.path === "/metrics") return;
  metricsState.requests++;
  if (c.res.status >= 500) metricsState.errors++;
});
app.get("/metrics", (c) => {
  const mem = process.memoryUsage();
  const body = [
    "# TYPE vyline_requests_total counter",
    `vyline_requests_total ${metricsState.requests}`,
    "# TYPE vyline_errors_total counter",
    `vyline_errors_total ${metricsState.errors}`,
    "# TYPE vyline_process_uptime_seconds gauge",
    `vyline_process_uptime_seconds ${Math.floor(performance.now() / 1000)}`,
    "# TYPE vyline_memory_rss_bytes gauge",
    `vyline_memory_rss_bytes ${mem.rss}`,
    "# TYPE vyline_memory_heap_used_bytes gauge",
    `vyline_memory_heap_used_bytes ${mem.heapUsed}`,
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
});
app.route("/auth", authRouter);
app.route("/line", lineRouter);
app.route("/beta/agent-i", agentIRouter);
app.route("/debug", debugRouter);
app.route("/cdn", cdnRouter);

// セルフホスト用: /api プレフィックス付きでも同じルーターへ届ける
// （フロントは dev では Vite proxy、本番では同オリジンの /api を使う）
app.route("/api/auth", authRouter);
app.route("/api/line", lineRouter);
app.route("/api/beta/agent-i", agentIRouter);
app.route("/api/debug", debugRouter);
app.route("/api/cdn", cdnRouter);

// 公開 REST API（Bearer トークン認証）
app.route("/v1", publicRouter);
app.route("/api/v1", publicRouter);

// OpenAPI 仕様
// /openapi.yaml      — 公開 REST API (/v1) の YAML
// /openapi.json      — BFF (/line) API の JSON
// /openapi/v1.yaml   — 公開 REST API (/v1) の YAML（Swagger UI 用エイリアス）
// /docs, /swagger    — Swagger UI（CDN）
app.get("/openapi.yaml", async (c) => {
  try {
    const yamlPath = join(dirname(fileURLToPath(import.meta.url)), "../../../openapi.yaml");
    const yaml = await readFile(yamlPath, "utf8");
    return new Response(yaml, {
      status: 200,
      headers: { "Content-Type": "text/yaml; charset=utf-8" },
    });
  } catch {
    return c.json({ ok: false, error: "openapi.yaml not found" }, 404);
  }
});
app.get("/openapi/v1.yaml", (c) => c.redirect("/openapi.yaml"));
app.get("/openapi.json", (c) => c.json(lineOpenApiSpec));
app.get("/docs", (c) => docsHtml(c));
app.get("/swagger", (c) => docsHtml(c));

function docsHtml(c: Context): Response {
  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>Vyline API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin></script>
  </head>
  <body>
    <div id="swagger"></div>
    <script>
      window.onload = () =>
        SwaggerUIBundle({
          urls: [
            { name: "BFF API (/line)", url: "/openapi.json" },
            { name: "Public API (/v1)", url: "/openapi.yaml" },
          ],
          "urls.primaryName": "BFF API (/line)",
          dom_id: "#swagger",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout",
        });
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SPA_PATHS = new Set(["", "/", "/chat", "/settings", "/login", "/hub"]);

async function serveStaticFile(path: string) {
  const normalized = normalize(path).replace(/\\/g, "/");
  if (normalized.includes("..")) {
    return new Response("forbidden", { status: 403 });
  }
  const file = join(STATIC_DIR, normalized === "/" ? "index.html" : normalized);
  if (!existsSync(file)) return null;
  const buf = await readFile(file);
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    },
  });
}

if (existsSync(STATIC_DIR)) {
  app.get("*", async (c) => {
    const path = c.req.path || "/";
    const res = await serveStaticFile(path);
    if (res) return res;
    // SPA フォールバック（拡張子なし・既知ルートは index.html）
    if (!/\.[a-z0-9]+$/i.test(path) || SPA_PATHS.has(path)) {
      const idx = await serveStaticFile("/index.html");
      if (idx) return idx;
    }
    return c.json({ ok: false, error: "not found" }, 404);
  });
}

app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));

app.onError((err, c) => {
  logger.error({ err }, "unhandled error");
  // 内部の MID・パス・プロトコル詳細をクライアントに返さない
  return c.json({ ok: false, error: "internal server error" }, 500);
});

logger.info(
  { port: PORT, host: HOST, staticDir: STATIC_DIR, cors: CORS_ORIGIN },
  "starting Vyline backend",
);

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const code = reason instanceof Error ? ((reason as NodeJS.ErrnoException).code ?? "") : "";
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    msg.includes("ECONNRESET") ||
    msg.includes("socket connection was closed") ||
    (typeof reason === "object" &&
      reason !== null &&
      "path" in reason &&
      String((reason as { path?: string }).path ?? "").includes("/PUSH/"))
  ) {
    logger.debug({ reason, code, msg }, "push/listen connection reset (ignored)");
    return;
  }
  logger.error({ reason }, "unhandled rejection");
});

await initVylineProfile();
void ensureCdnCacheDir().catch(() => undefined);
void ensureMediaStorageDir().catch(() => undefined);

restoreAllSessions()
  .then(async () => {
    const { listAccounts } = await import("./line/clientManager.js");
    for (const id of listAccounts()) {
      await warmAccountCache(id).catch(() => undefined);
    }
  })
  .catch((err) => {
    logger.warn({ err }, "session restore had errors");
  });

type CallWsHandlers = typeof import("./call/callManager.js").callWebSocketHandler;
let callWsHandlers: CallWsHandlers | null = null;

async function getCallWsHandlers(): Promise<CallWsHandlers> {
  if (!callWsHandlers) {
    const mod = await import("./call/callManager.js");
    callWsHandlers = mod.callWebSocketHandler;
  }
  return callWsHandlers;
}

export default {
  port: PORT,
  hostname: HOST,
  /** 既読取得など LINE RPC が 10s を超えることがある */
  idleTimeout: 120,
  fetch(req: Request, server: Bun.Server<CallWsData>) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/line\/([^/]+)\/call\/ws$/);
    if (m && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const accountId = decodeURIComponent(m[1]!);
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return new Response("sessionId required", { status: 400 });
      }
      const ok = server.upgrade(req, { data: { accountId, sessionId } });
      if (ok) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return app.fetch(req, server);
  },
  websocket: {
    open(ws: Bun.ServerWebSocket<CallWsData>) {
      void getCallWsHandlers().then((h) => h.open(ws));
    },
    message(ws: Bun.ServerWebSocket<CallWsData>, message: string | Buffer) {
      void getCallWsHandlers().then((h) => h.message(ws, message));
    },
    close(ws: Bun.ServerWebSocket<CallWsData>) {
      void getCallWsHandlers().then((h) => h.close(ws));
    },
  },
};
