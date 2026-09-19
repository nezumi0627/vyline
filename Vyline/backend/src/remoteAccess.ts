import type { Context, MiddlewareHandler } from "hono";

export type RemoteAccessOptions = {
  remoteAuthRequired?: boolean;
  mode?: "subdevice" | "bearer";
  authenticateSubdevice?: (
    token: string,
    installationId?: string,
  ) => Promise<{ accountId: string } | null>;
  authorizeSubdevice?: (context: Context, session: { accountId: string }) => string | null;
};

function bearer(context: Context): string {
  const authorization = context.req.header("authorization") ?? "";
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

function cookie(context: Context, name: string): string {
  const header = context.req.header("cookie") ?? "";
  const item = header.split(";").find((part) => part.trim().startsWith(`${name}=`));
  return item ? decodeURIComponent(item.trim().slice(name.length + 1)) : "";
}

/**
 * Validate WebSocket Origin while allowing TLS-terminating reverse proxies.
 * The backend URL may be HTTP internally, but the public Host header remains
 * the browser's same-origin authority.
 */
export function isAllowedWebSocketOrigin(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin || allowedOrigins.has(origin)) return true;

  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
  if (originUrl.origin === requestUrl.origin) return true;

  const host = request.headers.get("host")?.trim().toLowerCase();
  return Boolean(host && originUrl.host.toLowerCase() === host);
}

/**
 * Shared guard for routes that may be mounted outside the main server.
 * Authentication is deliberately explicit here instead of relying only on
 * the top-level LAN middleware.
 */
export function createRemoteAccessGuard(options: RemoteAccessOptions = {}): MiddlewareHandler {
  return async (context, next) => {
    if (!options.remoteAuthRequired) return next();

    const token = bearer(context) || cookie(context, "vyline_subdevice_session");
    const installationId =
      context.req.header("x-vyline-installation-id") ||
      cookie(context, "vyline_subdevice_installation");
    if (!token || options.mode !== "subdevice" || !options.authenticateSubdevice) {
      return context.json({ ok: false, error: "authentication required" }, 401);
    }

    const session = await options.authenticateSubdevice(token, installationId || undefined);
    if (!session) return context.json({ ok: false, error: "authentication required" }, 401);

    const accountId = context.req.param("accountId");
    if (accountId && accountId !== session.accountId) {
      return context.json({ ok: false, error: "account mismatch" }, 403);
    }
    const error = options.authorizeSubdevice?.(context, session);
    if (error) return context.json({ ok: false, error }, 403);
    return next();
  };
}
