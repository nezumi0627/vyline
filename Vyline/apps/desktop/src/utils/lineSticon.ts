/**
 * utils/lineSticon.ts — LINE 絵文字（sticon）描画
 * Desktop / stack: contentMetadata.REPLACE.sticon.resources
 * CDN は /api/cdn/line 経由でキャッシュ
 */

import { lineCdnProxy } from "./lineMedia";

export type SticonResource = {
  productId: string;
  sticonId: string;
  /** 本文中の開始インデックス（UTF-16 code units） */
  S?: number;
  /** 長さ */
  E?: number;
  /** 代替文字長 */
  alt?: string;
};

export type SticonReplace = {
  sticon?: { resources?: SticonResource[] };
};

export function sticonUrl(productId: string, sticonId: string): string {
  return lineCdnProxy(
    `https://stickershop.line-scdn.net/sticonshop/v1/sticon/${productId}/android/${sticonId}.png`,
  );
}

export function parseSticonReplace(
  meta?: Record<string, string | undefined> | null,
): SticonResource[] {
  if (!meta?.REPLACE) return [];
  try {
    const raw = typeof meta.REPLACE === "string" ? meta.REPLACE : JSON.stringify(meta.REPLACE);
    const parsed = JSON.parse(raw) as SticonReplace;
    return parsed.sticon?.resources ?? [];
  } catch {
    return [];
  }
}

export type TextSegment =
  | { type: "text"; value: string }
  | { type: "sticon"; url: string; alt: string };

/**
 * REPLACE の S/E は UTF-16 インデックス。無い場合は先頭から順に 1 文字置換を仮定。
 */
export function segmentTextWithSticon(text: string, resources: SticonResource[]): TextSegment[] {
  if (!text) return [];
  if (!resources.length) return [{ type: "text", value: text }];

  const withRange = resources
    .map((r, i) => {
      const start = typeof r.S === "number" ? r.S : -1;
      // r.E は終端オフセット（exclusive）。長さではなく範囲の終わりの位置
      const end = typeof r.E === "number" ? r.E : -1;
      return { ...r, start, end, order: i };
    })
    .filter((r) => r.start >= 0 && r.end > r.start)
    .sort((a, b) => a.start - b.start);

  if (withRange.length === 0) {
    // 範囲不明: プレースホルダ文字（よく `$`）を先頭から置換
    const out: TextSegment[] = [];
    let ri = 0;
    for (const ch of text) {
      if ((ch === "$" || ch === "￼") && ri < resources.length) {
        const r = resources[ri++]!;
        out.push({
          type: "sticon",
          url: sticonUrl(r.productId, r.sticonId),
          alt: r.alt || "emoji",
        });
      } else {
        const last = out[out.length - 1];
        if (last?.type === "text") last.value += ch;
        else out.push({ type: "text", value: ch });
      }
    }
    return out;
  }

  const out: TextSegment[] = [];
  let cursor = 0;
  for (const r of withRange) {
    if (r.start > cursor) {
      out.push({ type: "text", value: text.slice(cursor, r.start) });
    }
    out.push({
      type: "sticon",
      url: sticonUrl(r.productId, r.sticonId),
      alt: r.alt || text.slice(r.start, r.end) || "emoji",
    });
    cursor = r.end;
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}

// Unicode 絵文字の判定（1F000-1FAFF / 2600-27BF + VS16 + ZWJ 連結）
const EMOJI_RE = /(\p{Emoji_Presentation}|\p{Emoji}️)(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️))*/gu;

export type RichTextSegment = { type: "text"; value: string } | { type: "emoji"; value: string };

/** テキストを Unicode 絵文字 / 通常文字に分割（絵文字は一貫サイズで描画するため） */
export function segmentUnicodeEmoji(text: string): RichTextSegment[] {
  if (!text) return [];
  const out: RichTextSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(EMOJI_RE)) {
    const idx = m.index ?? 0;
    if (idx > cursor) out.push({ type: "text", value: text.slice(cursor, idx) });
    out.push({ type: "emoji", value: m[0] });
    cursor = idx + m[0].length;
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}
