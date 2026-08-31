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
import { getClient, restoreAllSessions } from "./line/clientManager.js";
import { initVylineProfile } from "./vyline/profileBridge.js";
import type { CallWsData } from "./call/callManager.js";
import { ensureCdnCacheDir } from "./storage/cdnAssetCache.js";
import { ensureMediaStorageDir } from "./storage/mediaStorage.js";
import { subdeviceRouter } from "./api/subdevices.js";
import { getSubdeviceSession } from "./storage/subdeviceStore.js";
import { accountSettingsRouter } from "./api/accountSettings.js";
import { handoffRouter } from "./api/handoff.js";
import { diagnosticsRouter } from "./api/diagnostics.js";
import { requestDiagnostics } from "./service/requestDiagnostics.js";
import { BACKUP_STORAGE_LIMIT_BYTES } from "./storage/backupLimits.js";
import {
  createRemoteAccessGuard,
  isLoopbackRequestAddress,
  requiresRemoteAuthentication,
  resolveSubdeviceCredentials,
  resolveBackendHost,
  withServerVerifiedLocalRequest,
} from "./remoteAccess.js";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_REQUEST_BODY_BYTES = Number(
  process.env.VYLINE_MAX_REQUEST_BODY_BYTES ??
    BACKUP_STORAGE_LIMIT_BYTES,
);
const LAN_ACCESS = process.env.VYLINE_LAN_ACCESS === "true";
const HOST = resolveBackendHost(LAN_ACCESS, process.env.VYLINE_HOST);
const REMOTE_AUTH_REQUIRED = requiresRemoteAuthentication(LAN_ACCESS, HOST);
const CORS_ORIGIN = process.env.VYLINE_CORS_ORIGIN ?? "http://localhost:5173";
const CORS_ORIGINS = new Set(
  CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const STATIC_DIR =
  process.env.VYLINE_STATIC_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "desktop", "dist");

const app = new Hono();

function allowedCorsOrigin(origin: string | undefined) {
  if (!origin) return CORS_ORIGIN;
  return CORS_ORIGINS.has(origin) ? origin : CORS_ORIGIN;
}

function isPublicPairingRequest(path: string, method: string) {
  if (method === "GET") return /^\/(?:api\/)?auth\/subdevices\/pairing\/[^/]+$/.test(path);
  return method === "POST" && /^\/(?:api\/)?auth\/subdevices\/pairing\/[^/]+\/complete$/.test(path);
}

function isSubdeviceAuthRequest(path: string) {
  return /^\/(?:api\/)?auth\/subdevices(?:\/|$)/.test(path);
}

type AccountScope = { kind: "accountId" | "mid"; value: string };

function scopedAccount(path: string): AccountScope | null {
  const accountMatch = path.match(/^\/(?:api\/)?(?:line|beta\/agent-i)\/([^/]+)(?:\/|$)/);
  const midMatch = path.match(/^\/api\/(?:settings\/accounts|handoff|diagnostics)\/([^/]+)(?:\/|$)/);
  const match = accountMatch ?? midMatch;
  if (!match) return null;
  try {
    return {
      kind: accountMatch ? "accountId" : "mid",
      value: decodeURIComponent(match[1]!),
    };
  } catch {
    return { kind: accountMatch ? "accountId" : "mid", value: "" };
  }
}

app.use(
  "*",
  cors({
    origin: allowedCorsOrigin,
    credentials: true,
  }),
);

// Any non-loopback bind is a remote deployment even when VYLINE_LAN_ACCESS was
// left false. Remote BFF access is limited to installation-bound subdevice
// sessions. Only pairing inspection/completion is public before a session exists.
const requireRemoteSubdevice = createRemoteAccessGuard({
  remoteAuthRequired: REMOTE_AUTH_REQUIRED,
  mode: "subdevice",
  authenticateSubdevice: getSubdeviceSession,
  authorizeSubdevice(c, device) {
    const scope = scopedAccount(c.req.path);
    if (scope?.kind === "accountId" && scope.value !== device.accountId) {
      return "subdevice account mismatch";
    }
    if (scope?.kind === "mid") {
      const clientMid = String(getClient(device.accountId)?.base.profile?.mid ?? "");
      const ownMid =
        clientMid || (/^u[0-9a-f]{32}$/i.test(device.accountId) ? device.accountId : "");
      if (!ownMid || scope.value !== ownMid) return "subdevice account mismatch";
    }
    return null;
  },
});
const requireLocalRequest = createRemoteAccessGuard({
  remoteAuthRequired: REMOTE_AUTH_REQUIRED,
  mode: "local",
});

app.use("/line/*", requireRemoteSubdevice);
app.use("/cdn/*", requireRemoteSubdevice);
app.use("/line/:accountId/proxy", requireLocalRequest);
app.use("/beta/agent-i/*", requireRemoteSubdevice);
app.use("/debug/*", requireLocalRequest);
app.use("/api/line/:accountId/proxy", requireLocalRequest);

app.use("/api/*", async (c, next) => {
  // The public API alias has its own account-scoped Bearer/admin auth. Requiring
  // a subdevice token here would make the single Authorization header unusable.
  if (/^\/api\/v1(?:\/|$)/.test(c.req.path)) return next();
  if (isPublicPairingRequest(c.req.path, c.req.method)) return next();
  if (/^\/api\/debug(?:\/|$)/.test(c.req.path)) return requireLocalRequest(c, next);
  if (/^\/api\/auth(?:\/|$)/.test(c.req.path)) {
    if (!isSubdeviceAuthRequest(c.req.path)) return requireLocalRequest(c, next);
    return requireRemoteSubdevice(c, next);
  }
  return requireRemoteSubdevice(c, next);
});
app.use("/auth/*", async (c, next) => {
  if (isPublicPairingRequest(c.req.path, c.req.method)) return next();
  if (!isSubdeviceAuthRequest(c.req.path)) return requireLocalRequest(c, next);
  return requireRemoteSubdevice(c, next);
});

app.use("*", requestDiagnostics((c) => {
  const scope = scopedAccount(c.req.path);
  if (scope?.kind === "mid") return scope.value;
  if (scope?.kind === "accountId") {
    return getClient(scope.value)?.base.profile?.mid;
  }
  return undefined;
}));

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
app.route("/auth/subdevices", subdeviceRouter);
app.route("/api/auth/subdevices", subdeviceRouter);
app.route("/api/line", lineRouter);
app.route("/api/beta/agent-i", agentIRouter);
app.route("/api/debug", debugRouter);
app.route("/api/cdn", cdnRouter);
app.route("/api/settings/accounts", accountSettingsRouter);
app.route("/api/handoff", handoffRouter);
app.route("/api/diagnostics", diagnosticsRouter);

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
    const yamlPath =
      process.env.VYLINE_OPENAPI_PATH ??
      join(dirname(fileURLToPath(import.meta.url)), "../../../openapi.yaml");
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

const SPA_PATHS = new Set(["", "/", "/chat", "/settings", "/login", "/hub", "/subdevice"]);

async function serveStaticFile(path: string) {
  const normalized = normalize(path).replace(/\\/g, "/");
  if (normalized.includes("..")) {
    return new Response("forbidden", { status: 403 });
  }
  const file = join(STATIC_DIR, normalized === "/" ? "index.html" : normalized);
  if (!existsSync(file)) return null;
  const body = Bun.file(file);
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(body.size),
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

if (!LAN_ACCESS && REMOTE_AUTH_REQUIRED) {
  logger.warn(
    { host: HOST },
    "VYLINE_HOST is non-loopback while VYLINE_LAN_ACCESS is false; remote subdevice authentication is enforced and owner auth/pairing management remains loopback-only",
  );
}
logger.info(
  {
    port: PORT,
    host: HOST,
    staticDir: STATIC_DIR,
    cors: CORS_ORIGIN,
    remoteAuthRequired: REMOTE_AUTH_REQUIRED,
  },
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
void import("./tailscale.js").then((m) => m.startTailscaleWatcher(PORT)).catch(() => undefined);

restoreAllSessions().catch((err) => {
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
  /** AndroidバックアップZIPは数百MBになるため、ストリーム受信前のBun上限も合わせる。 */
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  /** 既読取得など LINE RPC が 10s を超えることがある */
  idleTimeout: 120,
  async fetch(req: Request, server: Bun.Server<CallWsData>) {
    const address = server.requestIP(req)?.address ?? "";
    const local = isLoopbackRequestAddress(address);
    // Never trust a client/proxy supplied local marker.
    const request = withServerVerifiedLocalRequest(req, address);
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/line\/([^/]+)\/call\/ws$/);
    if (m && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin && !CORS_ORIGINS.has(origin)) {
        return new Response("websocket origin not allowed", { status: 403 });
      }
      let accountId: string;
      try {
        accountId = decodeURIComponent(m[1]!);
      } catch {
        return new Response("invalid accountId", { status: 400 });
      }
      if (REMOTE_AUTH_REQUIRED && !local) {
        const credentials = resolveSubdeviceCredentials({
          authorization: request.headers.get("authorization") ?? undefined,
          installationId: request.headers.get("x-vyline-installation-id") ?? undefined,
          cookie: request.headers.get("cookie") ?? undefined,
        });
        const device = await getSubdeviceSession(
          credentials.sessionToken,
          credentials.installationId,
        );
        if (!device) {
          return new Response("subdevice authentication required", { status: 401 });
        }
        if (device.accountId !== accountId) {
          return new Response("subdevice account mismatch", { status: 403 });
        }
      }
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return new Response("sessionId required", { status: 400 });
      }
      // Bun requires the original Request object for WebSocket upgrades. The
      // cloned request is only for the server-verified local marker used by Hono.
      const ok = server.upgrade(req, { data: { accountId, sessionId } });
      if (ok) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return app.fetch(request, server);
  },
  websocket: {
    // Reject oversized PCM frames before Bun allocates its default 16 MiB
    // payload, and cap queued outbound audio for slow/disconnected browsers.
    maxPayloadLength: 64 * 1024,
    backpressureLimit: 512 * 1024,
    closeOnBackpressureLimit: true,
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
