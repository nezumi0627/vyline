import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";

export type LinkPreviewData = {
  title: string;
  description: string;
  site: string;
  imageId?: string;
};

type CachedPreview = { value: LinkPreviewData | null; expiresAt: number };
type CachedImage = { bytes: Buffer; contentType: string; expiresAt: number };
type SafeResponse = { status: number; headers: Record<string, string | undefined>; body: Buffer };

const PREVIEW_TTL_MS = 4 * 60 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 512;
const MAX_IMAGE_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_PREVIEWS = 128;
const MAX_FETCH_WAITERS = 64;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5_000;
const previews = new Map<string, CachedPreview>();
const images = new Map<string, CachedImage>();
const pending = new Map<string, Promise<LinkPreviewData | null>>();
const imagePending = new Map<string, Promise<boolean>>();
let imageCacheBytes = 0;
let activeFetches = 0;
const fetchWaiters: Array<() => void> = [];

function isPublicIp(address: string): boolean {
  if (address.includes(":")) {
    const normalized = address.toLowerCase().split("%")[0]!;
    const [left = "", right = ""] = normalized.split("::", 2);
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const groups = [
      ...leftParts,
      ...Array(Math.max(0, 8 - leftParts.length - rightParts.length)).fill("0"),
      ...rightParts,
    ].map((part) => Number.parseInt(part || "0", 16));
    if (
      groups.length !== 8 ||
      groups.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)
    )
      return false;
    if (groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff) {
      const v4 = `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
      return isPublicIp(v4);
    }
    // Global unicast only. Also reject documentation, 6to4, and special-purpose 2001:: ranges.
    return (
      (groups[0]! & 0xe000) === 0x2000 &&
      groups[0] !== 0x2002 &&
      !(groups[0] === 0x2001 && ((groups[1]! & 0xfe00) === 0 || groups[1] === 0x0db8))
    );
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b! >= 64 && b! <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b! >= 16 && b! <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isSensitivePreviewUrl(url: URL): boolean {
  if (url.username || url.password) return true;
  if (/password[_-]?reset|reset[_-]?password|oauth|authorize|callback/i.test(url.pathname))
    return true;
  if (
    /(?:token|auth|password|secret|credential|session|ticket|signature|reset)[=_-]/i.test(url.hash)
  )
    return true;
  const sensitive =
    /^(?:(?:access|refresh|id)?token|auth(?:orization)?|auth(?:access)?token|code|password|passwd|secret|clientsecret|credential|privatekey|bearer|oauth|(?:api)?key|session|sid|ticket|signature|sig|state|reset(?:token|code)?)$/;
  for (const key of url.searchParams.keys()) {
    if (sensitive.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) return true;
  }
  return false;
}

function parsePageUrl(raw: string): URL | null {
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || isSensitivePreviewUrl(url))
      return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    const hostname = url.hostname.toLowerCase();
    if (
      !hostname.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(hostname)
    )
      return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function resolvePublicAddresses(hostname: string) {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((address) => !isPublicIp(address.address))) {
    throw new Error("unsafe destination");
  }
  return addresses;
}

async function withFetchSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeFetches >= 4) {
    if (fetchWaiters.length >= MAX_FETCH_WAITERS) throw new Error("preview queue full");
    await new Promise<void>((resolve) => fetchWaiters.push(resolve));
  }
  activeFetches++;
  try {
    return await operation();
  } finally {
    activeFetches--;
    fetchWaiters.shift()?.();
  }
}

async function requestPublicUrl(url: URL, maxBytes: number): Promise<SafeResponse> {
  const addresses = await resolvePublicAddresses(url.hostname);
  const pinnedLookup: NonNullable<import("node:http").RequestOptions["lookup"]> = (
    _hostname,
    options,
    callback,
  ) => {
    const address = addresses[0]!;
    if (typeof options === "object" && options?.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };

  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const timeout = setTimeout(
      () => req.destroy(new Error("preview request timed out")),
      FETCH_TIMEOUT_MS,
    );
    const finish = (error?: Error, response?: SafeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (response) resolve(response);
    };
    const req = transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname || "/"}${url.search}`,
        method: "GET",
        headers: {
          accept:
            "text/html,application/xhtml+xml,image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.1",
          "accept-encoding": "identity",
          "user-agent": "Vyline-LinkPreview/1.0",
        },
        lookup: pinnedLookup,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          response.destroy(new Error("response too large"));
          return;
        }
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > maxBytes) {
            response.destroy(new Error("response too large"));
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () =>
          finish(undefined, {
            status: response.statusCode ?? 0,
            headers: {
              location: response.headers.location,
              "content-type": response.headers["content-type"],
            },
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", (error) => finish(error));
      },
    );
    req.on("error", (error) => finish(error));
    req.end();
  });
}

async function fetchPublic(
  url: URL,
  maxBytes: number,
): Promise<{ url: URL; response: SafeResponse }> {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await withFetchSlot(() => requestPublicUrl(current, maxBytes));
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location || redirects === MAX_REDIRECTS) throw new Error("redirect limit");
      const next = parsePageUrl(new URL(location, current).toString());
      if (!next) throw new Error("unsafe redirect");
      current = next;
      continue;
    }
    return { url: current, response };
  }
  throw new Error("redirect limit");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_match, code: string) => {
      const number =
        code[0]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(1), 16)
          : Number.parseInt(code, 10);
      return Number.isFinite(number) && number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : "";
    })
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp|#39);/gi,
      (entity) =>
        ({
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
          "&#39;": "'",
        })[entity.toLowerCase()] ?? entity,
    )
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataFromHtml(
  html: string,
  pageUrl: URL,
): Omit<LinkPreviewData, "imageId"> & { image?: string } {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    const rawTag = match[0];
    for (const attr of rawTag.matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      const key = attr[1]?.toLowerCase();
      if (key) attrs.set(key, decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? ""));
    }
    const name = (attrs.get("property") || attrs.get("name") || "").toLowerCase();
    const content = attrs.get("content")?.trim();
    if (name && content && !meta.has(name)) meta.set(name, content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "";
  const title = decodeHtml(meta.get("og:title") || meta.get("twitter:title") || titleTag).slice(
    0,
    200,
  );
  const description = decodeHtml(
    meta.get("og:description") || meta.get("twitter:description") || meta.get("description") || "",
  ).slice(0, 320);
  const image =
    meta.get("og:image:secure_url") || meta.get("og:image") || meta.get("twitter:image") || "";
  let imageUrl: string | undefined;
  try {
    const resolved = new URL(image, pageUrl);
    if (
      (resolved.protocol === "https:" || resolved.protocol === "http:") &&
      !resolved.username &&
      !resolved.password
    ) {
      imageUrl = resolved.toString();
    }
  } catch {
    /* Invalid metadata image URL: keep a text-only card. */
  }
  return {
    title: title || pageUrl.hostname,
    description,
    site: decodeHtml(meta.get("og:site_name") || pageUrl.hostname).slice(0, 100),
    ...(imageUrl ? { image: imageUrl } : {}),
  };
}

function cacheImage(id: string, bytes: Buffer, contentType: string): void {
  const old = images.get(id);
  if (old) imageCacheBytes -= old.bytes.length;
  images.delete(id);
  while (
    images.size >= MAX_CACHE_ENTRIES ||
    imageCacheBytes + bytes.length > MAX_IMAGE_CACHE_BYTES
  ) {
    const oldestKey = images.keys().next().value as string | undefined;
    if (!oldestKey) return;
    const oldest = images.get(oldestKey);
    if (oldest) imageCacheBytes -= oldest.bytes.length;
    images.delete(oldestKey);
  }
  images.set(id, { bytes, contentType, expiresAt: Date.now() + PREVIEW_TTL_MS });
  imageCacheBytes += bytes.length;
}

async function getPreview(raw: string, accountId: string): Promise<LinkPreviewData | null> {
  const url = parsePageUrl(raw);
  if (!url) return null;
  const id = createHash("sha256").update(`${accountId}\n${url.toString()}`).digest("hex");
  const cached = previews.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    previews.delete(id);
    previews.set(id, cached);
    const thumbnailId = cached.value?.imageId;
    if (thumbnailId) {
      const image = images.get(thumbnailId);
      if (!image || image.expiresAt <= Date.now()) {
        if (image) {
          imageCacheBytes -= image.bytes.length;
          images.delete(thumbnailId);
        }
        cached.value = {
          title: cached.value!.title,
          description: cached.value!.description,
          site: cached.value!.site,
        };
      } else {
        images.delete(thumbnailId);
        images.set(thumbnailId, image);
      }
    }
    return cached.value;
  }
  const running = pending.get(id);
  if (running) return running;
  if (pending.size >= MAX_PENDING_PREVIEWS) return null;

  const task = (async () => {
    try {
      const { url: finalUrl, response } = await fetchPublic(url, MAX_HTML_BYTES);
      const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
      if (
        response.status < 200 ||
        response.status >= 300 ||
        !/(?:text\/html|application\/xhtml\+xml)/.test(contentType)
      ) {
        return null;
      }
      const data = metadataFromHtml(new TextDecoder().decode(response.body), finalUrl);
      let thumbnailId: string | undefined;
      if (data.image) {
        const imageId = createHash("sha256").update(data.image).digest("hex");
        const cachedImage = images.get(imageId);
        if (cachedImage && cachedImage.expiresAt > Date.now()) {
          thumbnailId = imageId;
        } else {
          if (cachedImage) {
            imageCacheBytes -= cachedImage.bytes.length;
            images.delete(imageId);
          }
          const imageTask =
            imagePending.get(imageId) ??
            (async () => {
              try {
                const imageUrlValue = parsePageUrl(data.image!);
                if (!imageUrlValue) return false;
                const fetched = await fetchPublic(imageUrlValue, MAX_IMAGE_BYTES);
                const type =
                  fetched.response.headers["content-type"]?.split(";")[0]?.toLowerCase() ?? "";
                if (
                  fetched.response.status < 200 ||
                  fetched.response.status >= 300 ||
                  !/^image\/(?:jpeg|png|webp|gif|avif)$/.test(type)
                )
                  return false;
                cacheImage(imageId, fetched.response.body, type);
                return true;
              } catch {
                return false;
              }
            })();
          imagePending.set(imageId, imageTask);
          if (await imageTask) thumbnailId = imageId;
          if (imagePending.get(imageId) === imageTask) imagePending.delete(imageId);
        }
      }
      return {
        title: data.title,
        description: data.description,
        site: data.site,
        ...(thumbnailId ? { imageId: thumbnailId } : {}),
      };
    } catch {
      return null;
    }
  })();
  pending.set(id, task);
  const value = await task;
  if (pending.get(id) === task) pending.delete(id);
  while (previews.size >= MAX_CACHE_ENTRIES)
    previews.delete(previews.keys().next().value as string);
  previews.set(id, { value, expiresAt: Date.now() + (value ? PREVIEW_TTL_MS : NEGATIVE_TTL_MS) });
  return value;
}

export async function fetchLinkPreview(
  raw: unknown,
  accountId: string,
): Promise<LinkPreviewData | null> {
  if (typeof raw !== "string") return null;
  return getPreview(raw.trim(), accountId);
}

export function readLinkPreviewImage(id: string): { bytes: Buffer; contentType: string } | null {
  if (!/^[a-f\d]{64}$/i.test(id)) return null;
  const image = images.get(id);
  if (!image || image.expiresAt <= Date.now()) {
    if (image) {
      imageCacheBytes -= image.bytes.length;
      images.delete(id);
    }
    return null;
  }
  images.delete(id);
  images.set(id, image);
  return { bytes: image.bytes, contentType: image.contentType };
}
