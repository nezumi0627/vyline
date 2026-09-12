export function parseMediaByteRange(
  value: string | undefined,
  size: number,
): { start: number; end: number; length: number } | "invalid" | null {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size < 0) return "invalid";
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
      return "invalid";
    end = Math.min(end, size - 1);
  }
  return { start, end, length: Math.max(0, end - start + 1) };
}
