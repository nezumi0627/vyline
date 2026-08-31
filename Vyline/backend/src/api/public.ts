/**
 * api/public.ts — Vyline 公開 REST API (/v1/)
 *
 * Bearer トークン認証付き。外部ツールやスクリプトから Vyline を操作するための
 * セルフホスト向け REST API。
 *
 * トークン管理（POST/GET/DELETE /v1/tokens）は VYLINE_API_ADMIN_SECRET で保護。
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { childLogger } from "../logger.js";
import {
  listTokens,
  createToken,
  validateToken,
  revokeToken,
  tokenAllowsAccount,
} from "../storage/apiTokenStore.js";
import type { ApiToken } from "../storage/apiTokenStore.js";
import { listAccounts as listLineAccounts } from "../line/clientManager.js";
import {
  fetchChats,
  fetchMessages,
  sendMessage,
  pollTalkEvents,
  NotLoggedInError,
} from "../service/lineService.js";

const log = childLogger("public-api");
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 300;
const rateWindows = new WeakMap<ApiToken, { startedAt: number; count: number }>();

export const publicRouter = new Hono();

// ─── 認証ヘルパー ──────────────────────────────────

/** Bearer トークン認証。失敗時は Response を返す */
async function requireToken(c: Context<any>): Promise<{ token: ApiToken } | Response> {
  const auth = c.req.header("authorization") ?? "";
  const tokenStr = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!tokenStr) {
    return c.json({ ok: false, error: "Authorization required" }, 401);
  }
  const apiToken = await validateToken(tokenStr);
  if (!apiToken) {
    return c.json({ ok: false, error: "Invalid or revoked token" }, 401);
  }
  const now = Date.now();
  const current = rateWindows.get(apiToken);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateWindows.set(apiToken, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > RATE_LIMIT_MAX_REQUESTS) {
      c.header(
        "Retry-After",
        String(Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - current.startedAt)) / 1000))),
      );
      return c.json({ ok: false, error: "rate limit exceeded" }, 429);
    }
  }
  return { token: apiToken };
}

/** 管理者認証（VYLINE_API_ADMIN_SECRET）。失敗時は Response を返す */
function requireScope(c: Context<any>, token: ApiToken, scope: "read" | "write"): true | Response {
  if (!token.scopes.includes(scope))
    return c.json({ ok: false, error: `token requires ${scope} scope` }, 403);
  return true;
}

function requireAccount(c: Context<any>, token: ApiToken, accountId: string): true | Response {
  if (!tokenAllowsAccount(token, accountId)) {
    return c.json({ ok: false, error: "token is not authorized for this account" }, 403);
  }
  return true;
}

function requireAdmin(c: Context<any>): true | Response {
  const adminSecret = process.env.VYLINE_API_ADMIN_SECRET;
  if (!adminSecret) {
    return c.json(
      { ok: false, error: "Admin API not configured (set VYLINE_API_ADMIN_SECRET)" },
      403,
    );
  }
  const auth = c.req.header("authorization") ?? "";
  const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret !== adminSecret) {
    return c.json({ ok: false, error: "Invalid admin secret" }, 403);
  }
  return true;
}

/** エラーを共通 JSON レスポンスに変換 */
function handlePublicError(err: unknown, c: Context<any>): Response {
  if (err instanceof NotLoggedInError) {
    return c.json({ ok: false, error: "account not found or not logged in" }, 404);
  }
  const message = err instanceof Error ? err.message : String(err);
  const isTimeout =
    message.includes("timed out") ||
    message.includes("Timeout") ||
    (err instanceof Error && err.name === "TimeoutError");
  if (isTimeout) {
    return c.json({ ok: false, error: "timeout" }, 504);
  }
  const isNetwork = /connection|connect|ECONN|ENET|ETIMEDOUT|Unable to connect/i.test(message);
  if (isNetwork) {
    log.warn({ err: message }, "public api network error");
    return c.json({ ok: false, error: "upstream service unavailable" }, 502);
  }
  log.error({ err }, "public api error");
  return c.json({ ok: false, error: "internal server error" }, 500);
}

// ─── アカウント一覧 ───────────────────────────────

/** GET /v1/accounts — ログイン中アカウント一覧 */
publicRouter.get("/accounts", async (c) => {
  const auth = await requireToken(c);
  if (auth instanceof Response) return auth;

  const permission = requireScope(c, auth.token, "read");
  if (permission instanceof Response) return permission;

  const accounts = listLineAccounts()
    .filter((accountId) => tokenAllowsAccount(auth.token, accountId))
    .map((accountId) => ({ accountId }));
  return c.json({ ok: true, accounts });
});

// ─── チャット ─────────────────────────────────────

/** GET /v1/accounts/:accountId/chats — チャット一覧 */
publicRouter.get("/accounts/:accountId/chats", async (c) => {
  const auth = await requireToken(c);
  if (auth instanceof Response) return auth;

  const permission = requireScope(c, auth.token, "read");
  if (permission instanceof Response) return permission;

  const accountId = c.req.param("accountId");
  const accountPermission = requireAccount(c, auth.token, accountId);
  if (accountPermission instanceof Response) return accountPermission;
  const light = c.req.query("light") === "1" || c.req.query("light") === "true";

  try {
    const chats = await fetchChats(accountId, { light });
    return c.json({ ok: true, data: chats });
  } catch (err) {
    return handlePublicError(err, c);
  }
});

// ─── メッセージ ───────────────────────────────────

/** GET /v1/accounts/:accountId/chats/:chatMid/messages — メッセージ履歴 */
publicRouter.get("/accounts/:accountId/chats/:chatMid/messages", async (c) => {
  const auth = await requireToken(c);
  if (auth instanceof Response) return auth;

  const permission = requireScope(c, auth.token, "read");
  if (permission instanceof Response) return permission;

  const accountId = c.req.param("accountId");
  const accountPermission = requireAccount(c, auth.token, accountId);
  if (accountPermission instanceof Response) return accountPermission;
  const chatMid = c.req.param("chatMid");
  const limitParam = Number(c.req.query("limit") ?? "20");
  const limit = Math.min(Math.max(1, Number.isFinite(limitParam) ? limitParam : 20), 100);
  const before = c.req.query("before");

  try {
    const opts: { beforeMessageId?: string } = {};
    if (before) opts.beforeMessageId = before;
    const messages = await fetchMessages(accountId, chatMid, limit, opts);
    return c.json({ ok: true, data: messages, hasMore: messages.length >= limit });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("timed out") || err.name === "TimeoutError")
    ) {
      return c.json({ ok: true, data: [], hasMore: false, timedOut: true });
    }
    return handlePublicError(err, c);
  }
});

/** POST /v1/accounts/:accountId/chats/:chatMid/messages — メッセージ送信 */
publicRouter.post("/accounts/:accountId/chats/:chatMid/messages", async (c) => {
  const auth = await requireToken(c);
  if (auth instanceof Response) return auth;

  const permission = requireScope(c, auth.token, "write");
  if (permission instanceof Response) return permission;

  const accountId = c.req.param("accountId");
  const accountPermission = requireAccount(c, auth.token, accountId);
  if (accountPermission instanceof Response) return accountPermission;
  const chatMid = c.req.param("chatMid");

  let body: { text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }

  if (!body.text) {
    return c.json({ ok: false, error: "text required" }, 400);
  }

  try {
    const message = await sendMessage(accountId, chatMid, body.text, {});
    return c.json({ ok: true, data: message ?? null });
  } catch (err) {
    return handlePublicError(err, c);
  }
});

// ─── イベントポーリング ───────────────────────────

/** GET /v1/accounts/:accountId/events/poll — Talk Push バッファから新着取得 */
publicRouter.get("/accounts/:accountId/events/poll", async (c) => {
  const auth = await requireToken(c);
  if (auth instanceof Response) return auth;

  const accountId = c.req.param("accountId");
  const accountPermission = requireAccount(c, auth.token, accountId);
  if (accountPermission instanceof Response) return accountPermission;
  const permission = requireScope(c, auth.token, "read");
  if (permission instanceof Response) return permission;

  const cursorParam = Number(c.req.query("cursor") ?? "0");
  const cursor = Number.isFinite(cursorParam) ? cursorParam : 0;

  try {
    const { cursor: next, events, reset, seq } = pollTalkEvents(accountId, cursor);
    return c.json({ ok: true, data: { cursor: next, events, reset, seq } });
  } catch (err) {
    return handlePublicError(err, c);
  }
});

// ─── トークン管理（管理者のみ）────────────────────

/** GET /v1/tokens — APIトークン一覧 */
publicRouter.get("/tokens", async (c) => {
  const admin = requireAdmin(c);
  if (admin instanceof Response) return admin;

  const tokens = await listTokens();
  const data = tokens.map(({ name, scopes, accountIds, createdAt, lastUsedAt }) => ({
    name,
    scopes,
    accountIds,
    createdAt,
    lastUsedAt,
  }));
  return c.json({ ok: true, data });
});

/** POST /v1/tokens — APIトークン作成 */
publicRouter.post("/tokens", async (c) => {
  const admin = requireAdmin(c);
  if (admin instanceof Response) return admin;

  let body: { name?: string; scopes?: string[]; accountIds?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }

  if (!body.name) {
    return c.json({ ok: false, error: "name required" }, 400);
  }
  const accountIds = body.accountIds === undefined ? listLineAccounts() : body.accountIds;
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return c.json({ ok: false, error: "accountIds must contain at least one active account" }, 400);
  }

  try {
    // Keep the documented legacy request shape useful without creating an
    // unscoped token: omission means exactly the accounts active at creation.
    const token = await createToken(body.name, accountIds, body.scopes);
    return c.json({ ok: true, data: token }, 201);
  } catch (err) {
    log.error({ err }, "failed to create token");
    return c.json({ ok: false, error: "failed to create token" }, 500);
  }
});

/** DELETE /v1/tokens/:token — APIトークン削除 */
publicRouter.delete("/tokens/:token", async (c) => {
  const admin = requireAdmin(c);
  if (admin instanceof Response) return admin;

  const token = c.req.param("token");
  try {
    const revoked = await revokeToken(token);
    if (!revoked) {
      return c.json({ ok: false, error: "token not found" }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    log.error({ err }, "failed to revoke token");
    return c.json({ ok: false, error: "failed to revoke token" }, 500);
  }
});
