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
  const body = normalizeSearch(content.slice(prefixLength));
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const term = terms.find((term) => body.includes(term));
  if (!term) return "";
  const index = body.indexOf(term);
  const start = Math.max(0, index - 35);
  return `${start > 0 ? "…" : ""}${body.slice(start, index + term.length + 65).replace(/\s+/g, " ")}…`;
}
