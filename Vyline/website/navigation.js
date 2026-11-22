export const normalizeSearch = (text) =>
  String(text)
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\u200b-\u200d\ufeff]/g, "");

export function matchesDocument(doc, query, category = "all") {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return (
    (category === "all" || doc.category === category) &&
    terms.every((term) => normalizeSearch(doc.search).includes(term))
  );
}

export function searchExcerpt(content, query, prefixLength = 0) {
  const normalized = normalizeSearch(content);
  const term = normalizeSearch(query).trim().split(/\s+/).find(Boolean);
  if (!term) return "";
  const index = normalized.indexOf(term);
  if (index < prefixLength) return "";
  const start = Math.max(prefixLength, index - 35);
  return `${start > prefixLength ? "…" : ""}${normalized.slice(start, index + term.length + 65).replace(/\s+/g, " ")}…`;
}
