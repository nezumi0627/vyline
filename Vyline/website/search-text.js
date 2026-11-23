export const normalize = (text) => text.normalize("NFKC").toLocaleLowerCase();
const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });

// NFKC can expand characters (e.g. ㍿) or combine half-width kana. Keep
// offsets into the original text so excerpts and highlights stay aligned.
export function findMatch(text, query) {
  const needle = normalize(query);
  if (!needle) return null;
  const offsets = [];
  let searchable = "";
  for (const { segment, index } of graphemes.segment(text)) {
    const normalized = normalize(segment);
    searchable += normalized;
    for (let unit = 0; unit < normalized.length; unit++) {
      offsets.push({ start: index, end: index + segment.length });
    }
  }
  const start = searchable.indexOf(needle);
  return start < 0
    ? null
    : { start: offsets[start].start, end: offsets[start + needle.length - 1].end };
}

export function matchRanges(text, query) {
  const matches = query.trim().split(/\s+/).flatMap((term) => {
    const match = findMatch(text, term);
    return match ? [match] : [];
  }).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const match of matches) {
    const previous = merged.at(-1);
    if (previous && match.start <= previous.end) previous.end = Math.max(previous.end, match.end);
    else merged.push({ ...match });
  }
  return merged;
}
