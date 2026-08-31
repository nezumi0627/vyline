import type { Context, MiddlewareHandler } from "hono";

const LOCAL_REQUEST_HEADER = "x-vyline-local-request";
const INSTALLATION_ID_HEADER = "x-vyline-installation-id";
export const SUBDEVICE_SESSION_COOKIE = "vyline_subdevice_session";
export const SUBDEVICE_INSTALLATION_COOKIE = "vyline_subdevice_installation";

export type RemoteSubdeviceSession = { accountId: string };

export interface RemoteAccessGuardOptions {
  remoteAuthRequired: boolean;
  mode: "local" | "subdevice";
  authenticateSubdevice?: (
    bearer: string,
    installationId: string | undefined,
  ) => Promise<RemoteSubdeviceSession | null>;
  authorizeSubdevice?: (
    context: Context,
    session: RemoteSubdeviceSession,
  ) => string | null | Promise<string | null>;
}

function isIpv4Loopback(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  return (
    octets.every((part, index) => {
      return (
        /^\d{1,3}$/.test(parts[index] ?? "") && Number.isInteger(part) && part >= 0 && part <= 255
      );
    }) && octets[0] === 127
  );
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1);
  return trimmed;
}

/** Only explicit loopback bind targets are treated as a local-only boundary. */
export function isLoopbackBindHost(host: string): boolean {
  const normalized = normalizeAddress(host).replace(/\.$/, "");
  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (isIpv4Loopback(normalized)) return true;
  if (normalized.startsWith("::ffff:")) return isIpv4Loopback(normalized.slice(7));
  return false;
}

export function resolveBackendHost(lanAccess: boolean, configuredHost: string | undefined): string {
  if (lanAccess) return "0.0.0.0";
  return configuredHost?.trim() || "127.0.0.1";
}

/** A non-loopback bind is remote even when the legacy LAN flag was left false. */
export function requiresRemoteAuthentication(lanAccess: boolean, bindHost: string): boolean {
  return lanAccess || !isLoopbackBindHost(bindHost);
}

/**
 * Explicit owner-access escape hatch for deployments whose outer transport is
 * already authenticated (for example Tailscale ACLs or Cloudflare Access).
 * This must stay opt-in because enabling it promotes every peer that can reach
 * the backend to the same trust level as a loopback owner request.
 */
export function trustsRemoteOwnerAccess(): boolean {
  return process.env.VYLINE_TRUST_REMOTE_OWNER === "true";
}

/**
 * Bun's requestIP address is the authority; forwarded/client-provided headers
 * are ignored. An operator can explicitly promote the already-protected remote
 * transport to owner trust with VYLINE_TRUST_REMOTE_OWNER=true.
 */
export function isLoopbackRequestAddress(address: string): boolean {
  return trustsRemoteOwnerAccess() || isLoopbackBindHost(address);
}

export function withServerVerifiedLocalRequest(request: Request, address: string): Request {
  const headers = new Headers(request.headers);
  headers.set(LOCAL_REQUEST_HEADER, isLoopbackRequestAddress(address) ? "1" : "0");
  return new Request(request, { headers });
}

export function bearerTokenFromAuthorization(value: string | undefined): string {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function cookieValue(header: string | undefined, name: string): string {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Header credentials remain the primary API mechanism. SameSite HttpOnly
 * cookies let browser subresources and the native WebSocket constructor use
 * the exact same installation-bound session without putting tokens in URLs.
 */
export function resolveSubdeviceCredentials(input: {
  authorization?: string | undefined;
  installationId?: string | undefined;
  cookie?: string | undefined;
}): { sessionToken: string; installationId: string | undefined } {
  const headerToken = bearerTokenFromAuthorization(input.authorization);
  if (headerToken || input.installationId) {
    return { sessionToken: headerToken, installationId: input.installationId };
  }
  const sessionToken = cookieValue(input.cookie, SUBDEVICE_SESSION_COOKIE);
  const cookieInstallationId = cookieValue(input.cookie, SUBDEVICE_INSTALLATION_COOKIE);
  return {
    sessionToken,
    installationId: cookieInstallationId || undefined,
  };
}

export function isServerVerifiedLocalRequest(context: Context): boolean {
  return context.req.header(LOCAL_REQUEST_HEADER) === "1";
}

/**
 * Enforces either loopback-only owner access or an installation-bound
 * subdevice session. The local marker must be overwritten by the Bun fetch
 * wrapper from requestIP before Hono receives the request.
 */
export function createRemoteAccessGuard(options: RemoteAccessGuardOptions): MiddlewareHandler {
  if (options.mode === "subdevice" && !options.authenticateSubdevice) {
    throw new Error("subdevice authentication callback is required");
  }

  return async (context, next) => {
    if (!options.remoteAuthRequired || isServerVerifiedLocalRequest(context)) {
      return next();
    }
    if (options.mode === "local") {
      return context.json({ ok: false, error: "local request required" }, 403);
    }

    const authorization = context.req.header("authorization");
    const installationId = context.req.header(INSTALLATION_ID_HEADER);
    const explicitBearer = bearerTokenFromAuthorization(authorization);
    // Cookie fallback exists for browser-managed subresources only. Mutating
    // BFF calls keep requiring the explicit installation-bound headers, which
    // avoids turning cookie support into a general CSRF surface.
    if (
      (!explicitBearer || !installationId) &&
      context.req.method !== "GET" &&
      context.req.method !== "HEAD"
    ) {
      return context.json({ ok: false, error: "subdevice authentication required" }, 401);
    }
    const credentials = resolveSubdeviceCredentials({
      authorization,
      installationId,
      cookie: context.req.header("cookie"),
    });
    const session = await options.authenticateSubdevice!(
      credentials.sessionToken,
      credentials.installationId,
    );
    if (!session) {
      return context.json({ ok: false, error: "subdevice authentication required" }, 401);
    }

    const authorizationError = await options.authorizeSubdevice?.(context, session);
    if (authorizationError) {
      return context.json({ ok: false, error: authorizationError }, 403);
    }
    return next();
  };
}
