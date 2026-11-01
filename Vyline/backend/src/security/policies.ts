import { createHash, timingSafeEqual } from "node:crypto";

export type ApiScope = "read" | "write";

const LINE_MEDIA_HOSTS = new Set([
  "obs.line-scdn.net",
  "obs.line-apps.com",
  "obs-jp.line-apps.com",
]);

export function isTrustedLineMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      LINE_MEDIA_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function hashApiToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function parseApiScopes(value: unknown): ApiScope[] | null {
  if (value === undefined) return ["read", "write"];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((scope) => scope !== "read" && scope !== "write")
  ) {
    return null;
  }
  return [...new Set(value)] as ApiScope[];
}

export function hasApiScope(scopes: readonly string[], required: ApiScope): boolean {
  return scopes.includes(required);
}

export function isApiTokenAuthorizedForAccount(
  tokenAccountId: string | null,
  requestedAccountId?: string,
): boolean {
  return (
    tokenAccountId !== null &&
    (requestedAccountId === undefined || tokenAccountId === requestedAccountId)
  );
}

export function isAllowedOrigin(
  origin: string | undefined,
  requestUrl: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

function withoutApiPrefix(path: string): string {
  return path.startsWith("/api/") ? path.slice(4) : path;
}

export function isLanProtectedPath(path: string): boolean {
  const localPath = withoutApiPrefix(path);
  return (
    /^\/(?:auth|line|debug|beta)(?:\/|$)/.test(localPath) ||
    /^\/(?:metrics|docs|swagger)(?:\/|$)/.test(localPath) ||
    /^\/openapi(?:\/|\.|$)/.test(localPath)
  );
}

export function isLanAccessEnabled(explicit: boolean, host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return explicit || !["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"].includes(normalized);
}

export function isPublicPairingRequest(path: string, method: string): boolean {
  const localPath = withoutApiPrefix(path);
  if (method === "GET") return /^\/auth\/subdevices\/pairing\/[^/]+$/.test(localPath);
  return method === "POST" && /^\/auth\/subdevices\/pairing\/[^/]+\/complete$/.test(localPath);
}

export function isSubdeviceHeartbeatPath(path: string, method: string): boolean {
  return method === "POST" && /^\/auth\/subdevices\/heartbeat$/.test(withoutApiPrefix(path));
}

export function isSubdeviceManagementPath(path: string): boolean {
  return /^\/auth\/subdevices(?:\/|$)/.test(withoutApiPrefix(path));
}

export function subdeviceAccountIdFromPath(path: string): string | null {
  const match = /^\/line\/([^/]+)(?:\/|$)/.exec(withoutApiPrefix(path));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function authorizeSubdeviceRoute(
  path: string,
  method: string,
  deviceAccountId: string | null,
): "allow" | "unauthorized" | "forbidden" {
  if (!deviceAccountId) return "unauthorized";
  if (isSubdeviceManagementPath(path) && !isSubdeviceHeartbeatPath(path, method))
    return "forbidden";
  const accountId = subdeviceAccountIdFromPath(path);
  if (accountId !== null) return accountId === deviceAccountId ? "allow" : "forbidden";
  return isSubdeviceHeartbeatPath(path, method) ? "allow" : "forbidden";
}

export function secretsEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
  );
}
