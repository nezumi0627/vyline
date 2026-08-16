/**
 * Flex / RICH contentMetadata パーサ
 * Desktop: FLEX_JSON / MARKUP_JSON / ALT_TEXT（文字列。二重エンコードあり）
 */

import type { FlexContainer, RichMarkup } from "./types.js";

// 同じ FLEX_JSON / MARKUP_JSON 文字列は何度も mapMessage で渡るため結果をキャッシュ
const jsonParseCache = new Map<string, unknown>();
const JSON_CACHE_MAX = 500;

export function parseJsonField(raw: unknown): unknown {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  const cached = jsonParseCache.get(raw);
  if (cached !== undefined) return cached;

  let cur: unknown = raw.trim();
  // 二重・三重に stringify されたケースをほどく
  for (let i = 0; i < 3; i++) {
    if (typeof cur !== "string") break;
    const s = cur.trim();
    if (!s) return null;
    try {
      cur = JSON.parse(s);
    } catch {
      if (i === 0) {
        cur = null;
        break;
      }
      break;
    }
  }
  if (jsonParseCache.size >= JSON_CACHE_MAX) jsonParseCache.clear();
  jsonParseCache.set(raw, cur);
  return cur;
}

export function isFlexContentType(contentType: string | number | undefined): boolean {
  const u = String(contentType ?? "").toUpperCase();
  return u === "FLEX" || u === "22";
}

export function isRichContentType(contentType: string | number | undefined): boolean {
  const u = String(contentType ?? "").toUpperCase();
  return u === "RICH" || u === "17";
}

function metaGet(meta: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (meta[k] != null && meta[k] !== "") return meta[k];
    const lower = k.toLowerCase();
    for (const [mk, mv] of Object.entries(meta)) {
      if (mk.toLowerCase() === lower && mv != null && mv !== "") return mv;
    }
  }
  return undefined;
}

function looksLikeFlexContainer(obj: unknown): obj is FlexContainer {
  if (!obj || typeof obj !== "object") return false;
  const t = (obj as { type?: unknown }).type;
  return t === "bubble" || t === "carousel" || typeof t === "string";
}

export function parseFlexContainer(
  meta?: Record<string, unknown> | null,
  textFallback?: string | null,
): FlexContainer | null {
  if (meta) {
    const raw = metaGet(meta, "FLEX_JSON", "flexJson", "flex_json");
    const parsed = parseJsonField(raw);
    if (looksLikeFlexContainer(parsed)) return parsed;
  }
  if (textFallback?.trim().startsWith("{")) {
    const parsed = parseJsonField(textFallback);
    if (looksLikeFlexContainer(parsed)) return parsed;
  }
  return null;
}

export function parseRichMarkup(meta?: Record<string, unknown> | null): RichMarkup | null {
  if (!meta) return null;
  const raw = metaGet(meta, "MARKUP_JSON", "markupJson", "markup_json");
  const parsed = parseJsonField(raw);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as RichMarkup;
}

export function altTextFromMeta(meta?: Record<string, unknown> | null): string | undefined {
  if (!meta) return undefined;
  const alt = metaGet(meta, "ALT_TEXT", "altText", "alt_text");
  if (typeof alt === "string" && alt.trim()) return alt.trim();
  return undefined;
}

export function richDownloadUrl(meta?: Record<string, unknown> | null): string | undefined {
  if (!meta) return undefined;
  const url = metaGet(meta, "DOWNLOAD_URL", "downloadUrl", "download_url");
  if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
  return undefined;
}

/** チャット一覧・プレビュー用 */
export function flexRichPreviewLabel(
  contentType: string | number | undefined,
  meta?: Record<string, unknown> | null,
  text?: string | null,
): string {
  const alt = altTextFromMeta(meta);
  if (alt) return alt.length > 60 ? `${alt.slice(0, 60)}…` : alt;
  if (text?.trim() && !text.trim().startsWith("{")) {
    const t = text.trim();
    return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  }
  if (isFlexContentType(contentType)) return "Flexメッセージ";
  if (isRichContentType(contentType)) return "リッチメッセージ";
  return "";
}
