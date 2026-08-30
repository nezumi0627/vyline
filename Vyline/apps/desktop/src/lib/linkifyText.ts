export type LinkifiedTextSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
const ALWAYS_TRAILING_PUNCTUATION = /[.,!?;:、。！？；：…，．）】」』〉》〕]/u;

function count(value: string, needle: string): number {
  return [...value].filter((character) => character === needle).length;
}

function trimUrlCandidate(candidate: string): { url: string; trailing: string } {
  let url = candidate;
  let trailing = "";

  while (url.length > 0) {
    const last = url.at(-1)!;
    const unmatchedClosing =
      (last === ")" && count(url, ")") > count(url, "(")) ||
      (last === "]" && count(url, "]") > count(url, "[")) ||
      (last === "}" && count(url, "}") > count(url, "{"));
    if (!ALWAYS_TRAILING_PUNCTUATION.test(last) && !unmatchedClosing) break;
    trailing = last + trailing;
    url = url.slice(0, -1);
  }

  return { url, trailing };
}

export function splitTextLinks(value: string): LinkifiedTextSegment[] {
  if (!value) return [];
  const segments: LinkifiedTextSegment[] = [];
  let offset = 0;
  URL_PATTERN.lastIndex = 0;

  for (const match of value.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > offset) segments.push({ type: "text", value: value.slice(offset, index) });

    const raw = match[0];
    const { url, trailing } = trimUrlCandidate(raw);
    if (url) {
      segments.push({
        type: "link",
        value: url,
        href: /^www\./i.test(url) ? `https://${url}` : url,
      });
    } else {
      segments.push({ type: "text", value: raw });
    }
    if (trailing) segments.push({ type: "text", value: trailing });
    offset = index + raw.length;
  }

  if (offset < value.length) segments.push({ type: "text", value: value.slice(offset) });
  return segments.length > 0 ? segments : [{ type: "text", value }];
}
