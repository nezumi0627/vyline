/**
 * backend/src/index.ts — Hono + Bun WebSocket（通話 PCM ブリッジ）
 *
 * 通話モジュールは遅延 import（ログイン等の基本機能を通話スタック障害から切り離す）
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./logger.js";
import { authRouter } from "./api/auth.js";
import { lineRouter } from "./api/line.js";
import { debugRouter } from "./api/debug.js";
import { cdnRouter } from "./api/cdn.js";
import { restoreAllSessions } from "./line/clientManager.js";
import { initNezuProfile } from "./nezu/profileBridge.js";
import { warmAccountCache } from "./storage/chatStore.js";
import type { CallWsData } from "./call/callManager.js";
import { ensureCdnCacheDir } from "./storage/cdnAssetCache.js";

const PORT = Number(process.env["PORT"] ?? 3001);

const app = new Hono();

app.use("*", cors({ origin: "http://localhost:5173" }));
app.use("*", honoLogger());

app.get("/healthz", (c) => c.json({ ok: true, status: "ready" }));
app.route("/auth", authRouter);
app.route("/line", lineRouter);
app.route("/debug", debugRouter);
app.route("/cdn", cdnRouter);

app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));

app.onError((err, c) => {
  logger.error({ err }, "unhandled error");
  return c.json({ ok: false, error: String(err) }, 500);
});

logger.info({ port: PORT }, "starting Vyline backend");

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const code =
    reason instanceof Error ? (reason as NodeJS.ErrnoException).code ?? "" : "";
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

await initNezuProfile();
void ensureCdnCacheDir().catch(() => undefined);

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
