import type { Context } from "hono";

/** Encoded media limit. The decoded payload is smaller than this value. */
export const MAX_MEDIA_BASE64_CHARS = Number(
  process.env.VYLINE_MAX_MEDIA_BASE64_CHARS ?? 15_000_000,
);
export const MAX_MEDIA_BATCH_ITEMS = Number(process.env.VYLINE_MAX_MEDIA_BATCH_ITEMS ?? 32);
export const MAX_MEDIA_BATCH_BASE64_CHARS = Number(
  process.env.VYLINE_MAX_MEDIA_BATCH_BASE64_CHARS ?? 60_000_000,
);
export const MAX_RAW_MEDIA_BYTES = Number(
  process.env.VYLINE_MAX_RAW_MEDIA_BYTES ?? 16 * 1024 * 1024,
);

export function contentLength(c: Context): number | null {
  const raw = c.req.header("content-length");
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function tooLargeContentLength(c: Context, limit: number): boolean {
  const length = contentLength(c);
  return length !== null && length > limit;
}

/** Read a request body without ever retaining more than limit + 1 bytes. */
export async function readLimitedBytes(c: Context, limit: number): Promise<Uint8Array | null> {
  if (tooLargeContentLength(c, limit)) return null;
  const stream = c.req.raw.body;
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("request body too large");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function bytesToBlob(bytes: Uint8Array, type?: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], type ? { type } : undefined);
}

export function isMalformedJsonError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "SyntaxError") return true;
  const message = error.message.toLowerCase();
  return message.includes("invalid json") || message.includes("unexpected end of json");
}
