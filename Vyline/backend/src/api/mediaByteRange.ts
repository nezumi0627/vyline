type MediaByteRange = { start: number; end: number };

/** Parse one RFC 7233 byte range. Multiple/invalid/unsatisfiable ranges return "invalid". */
export function parseMediaByteRange(
  header: string | undefined,
  size: number,
): MediaByteRange | null | "invalid" {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size < 0 || !header.startsWith("bytes=")) return "invalid";
  const value = header.slice(6).trim();
  if (!value || value.includes(",")) return "invalid";
  const match = /^(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  )
    return "invalid";
  return { start, end: Math.min(requestedEnd, size - 1) };
}
