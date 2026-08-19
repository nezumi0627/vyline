/**
 * utils/mention.ts — LINE メンション（@ALL / @名前）
 *
 * ワイヤ形式: contentMetadata.MENTION = JSON.stringify({
 *   MENTIONEES: [{ S, E, M } | { S, E, A: "1" }]
 * })
 * S/E は本文の UTF-16 code unit オフセット（"@" + 名前 の範囲を含む）。
 */

import { segmentTextWithSticon, sticonUrl, type SticonResource } from "./lineSticon";

/** メンション 1 件（送受信共通の範囲情報） */
export type MentionInfo = {
  /** 対象 mid（@ALL のときは undefined） */
  mid?: string;
  /** true なら @ALL */
  all?: boolean;
  /** 本文中の開始オフセット（UTF-16 code units） */
  S: number;
  /** 終了オフセット */
  E: number;
};

/** 下書き中のメンション（表示名 + 範囲を保持） */
export type MentionDraft = MentionInfo & {
  /** 表示名（例: "れんや" / "ALL"） */
  name: string;
};

/** contentMetadata.MENTION をパースしてメンション範囲を返す */
export function parseMentions(meta?: Record<string, unknown> | null): MentionInfo[] | undefined {
  const raw = meta?.MENTION;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      MENTIONEES?: Array<{ M?: string; S?: string; E?: string; A?: string }>;
    };
    const list = parsed?.MENTIONEES;
    if (!Array.isArray(list) || list.length === 0) return undefined;
    const out: MentionInfo[] = [];
    for (const x of list) {
      if (!x) continue;
      const S = Number(x.S);
      const E = Number(x.E);
      if (!Number.isFinite(S) || !Number.isFinite(E) || E <= S) continue;
      out.push({ S, E, mid: x.A === "1" ? undefined : x.M, all: x.A === "1" });
    }
    return out.length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** 送信用 MENTION metadata を構築（メンションが無ければ undefined） */
export function buildMentionMetadata(mentions: MentionDraft[]): string | undefined {
  if (!mentions.length) return undefined;
  const MENTIONEES = mentions.map((m) =>
    m.all
      ? { S: String(m.S), E: String(m.E), A: "1" }
      : { S: String(m.S), E: String(m.E), M: m.mid! },
  );
  return JSON.stringify({ MENTIONEES });
}

/**
 * 編集差分からメンション範囲を再計算する。
 * 編集範囲と重なったメンションは破棄（編集で壊れたメンションを残さない）。
 */
export function recomputeMentionsOnEdit(
  oldText: string,
  newText: string,
  mentions: MentionDraft[],
): MentionDraft[] {
  if (!mentions.length) return [];
  let p = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (p < minLen && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < minLen - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) {
    s++;
  }
  const oldEnd = oldText.length - s;
  const newEnd = newText.length - s;
  const delta = newEnd - p - (oldEnd - p);
  const out: MentionDraft[] = [];
  for (const m of mentions) {
    if (m.S < oldEnd && m.E > p) continue;
    if (m.S >= oldEnd) out.push({ ...m, S: m.S + delta, E: m.E + delta });
    else out.push(m);
  }
  return out;
}

/** sticon 範囲が無い場合に本文中のプレースホルダ（$ / ￼）位置から補う */
function resolveSticonRanges(text: string, sticons: SticonResource[]): SticonResource[] {
  if (!sticons.length) return [];
  if (sticons.every((r) => typeof r.S === "number")) return sticons;
  const out: SticonResource[] = [];
  let ri = 0;
  for (let i = 0; i < text.length && ri < sticons.length; i++) {
    if (text[i] === "$" || text[i] === "￼") {
      const r = sticons[ri++]!;
      out.push({ ...r, S: i, E: 1 });
    }
  }
  return out;
}

export type DraftSegment =
  | { type: "text"; value: string }
  | { type: "sticon"; url: string; alt: string }
  | { type: "mention"; value: string; all?: boolean; mid?: string };

/**
 * 本文を text / sticon / mention に分割する。
 * メンションが無い場合は既存の sticon 分割に委譲（従来動作を維持）。
 */
export function segmentTextWithMentions(
  text: string,
  sticons: SticonResource[],
  mentions: MentionInfo[],
): DraftSegment[] {
  if (!mentions.length) {
    return segmentTextWithSticon(text, sticons) as DraftSegment[];
  }

  const resolved = resolveSticonRanges(text, sticons);
  const segs: Array<{ start: number; end: number; seg: DraftSegment }> = [];

  for (const r of resolved) {
    const start = typeof r.S === "number" ? r.S : -1;
    if (start < 0) continue;
    const end = start + (typeof r.E === "number" && r.E > 0 ? r.E : 1);
    segs.push({
      start,
      end,
      seg: {
        type: "sticon",
        url: sticonUrl(r.productId, r.sticonId),
        alt: r.alt || "emoji",
      },
    });
  }
  for (const m of mentions) {
    if (!Number.isFinite(m.S) || !Number.isFinite(m.E) || m.E <= m.S) continue;
    segs.push({
      start: m.S,
      end: m.E,
      seg: {
        type: "mention",
        value: text.slice(m.S, m.E),
        all: m.all,
        mid: m.mid,
      },
    });
  }

  segs.sort((a, b) => a.start - b.start || a.end - b.end);

  const out: DraftSegment[] = [];
  let cursor = 0;
  for (const s of segs) {
    if (s.start < cursor) continue; // 重複（重なり）は先勝ち
    if (s.start > cursor) out.push({ type: "text", value: text.slice(cursor, s.start) });
    out.push(s.seg);
    cursor = s.end;
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}
