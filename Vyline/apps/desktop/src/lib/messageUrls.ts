export type MessageTextPart =
  | { type: "text"; value: string }
  | { type: "url"; value: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:。、「」『』）)\]}〉》」』】…]+$/u;
const SENSITIVE_QUERY_KEY =
  /^(?:(?:access|refresh|id)?token|auth(?:orization)?|auth(?:access)?token|code|password|passwd|secret|clientsecret|credential|privatekey|bearer|oauth|(?:api)?key|session|sid|ticket|signature|sig|state|reset(?:token|code)?)$/i;

function parseHttpUrl(raw: string): URL | null {
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
      return null;
    return url;
  } catch {
    return null;
  }
}

export function splitMessageUrls(value: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const matched = match[0];
    let raw = matched;
    while (TRAILING_PUNCTUATION.test(raw)) raw = raw.replace(TRAILING_PUNCTUATION, "");
    const parsed = parseHttpUrl(raw);
    if (!raw || !parsed) continue;
    if (start > cursor) parts.push({ type: "text", value: value.slice(cursor, start) });
    parts.push({ type: "url", value: raw, href: parsed.toString() });
    cursor = start + raw.length;
  }
  if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  return parts.length ? parts : [{ type: "text", value }];
}

export function previewUrlsForText(value: string, limit = 3): string[] {
  const maxUrls = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 3));
  if (maxUrls === 0) return [];
  const urls = new Set<string>();
  for (const part of splitMessageUrls(value)) {
    if (part.type !== "url") continue;
    const url = parseHttpUrl(part.href);
    if (
      !url ||
      /password[_-]?reset|reset[_-]?password|oauth|authorize|callback/i.test(url.pathname)
    )
      continue;
    if (
      /(?:token|auth|password|secret|credential|session|ticket|signature|reset)[=_-]/i.test(
        url.hash,
      )
    )
      continue;
    if (
      [...url.searchParams.keys()].some((key) =>
        SENSITIVE_QUERY_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, "")),
      )
    )
      continue;
    urls.add(part.href);
    if (urls.size >= maxUrls) break;
  }
  return [...urls];
}
