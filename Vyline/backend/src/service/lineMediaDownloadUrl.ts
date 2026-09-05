const TRUSTED_LINE_MEDIA_SUFFIXES = ["line-apps.com", "line-scdn.net"] as const;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

type MediaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Message metadata is remote-controlled input. Only allow LINE-owned HTTPS hosts
 * before the backend follows DOWNLOAD_URL so a crafted message cannot turn the
 * local/LAN backend into an SSRF proxy.
 */
export function isTrustedLineMediaDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return TRUSTED_LINE_MEDIA_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

/** Fetch a DOWNLOAD_URL while revalidating every manually followed redirect. */
export async function fetchTrustedLineMediaDownloadUrl(
  raw: string,
  init: Omit<RequestInit, "redirect"> = {},
  fetchImpl: MediaFetch = fetch,
): Promise<Response> {
  let currentUrl = raw;

  for (let redirects = 0; ; redirects += 1) {
    if (!isTrustedLineMediaDownloadUrl(currentUrl)) {
      throw new Error("blocked untrusted media download URL");
    }

    const response = await fetchImpl(currentUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location || redirects >= MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("media download redirect rejected");
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("media download redirect rejected");
    }
    await response.body?.cancel().catch(() => undefined);
    currentUrl = nextUrl;
  }
}
