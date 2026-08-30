const TRUSTED_LINE_MEDIA_SUFFIXES = ["line-apps.com", "line-scdn.net"] as const;

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
