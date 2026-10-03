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
