import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { Readable } from "node:stream";
import { addressKind } from "../storage/recordingWebDav.js";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const uploadSource = z.union([
  z.strictObject({
    dataBase64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }),
  z.strictObject({
    downloadUrl: z.url().max(8192),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    length: z.number().int().min(1).max(MAX_UPLOAD_BYTES).optional(),
  }),
]);
export async function readBounded(response: Response, maximum: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new Error("Body too large");
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** Handles both genuine HTTP Range responses and upstreams that ignore Range, without buffering the whole object. */
export async function readMediaSlice(response: Response, offset: number, length: number) {
  const range = response.headers.get("content-range");
  const match = range?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  const contentLength = response.headers.get("content-length");
  const total = match ? Number(match[3]) : contentLength !== null ? Number(contentLength) : null;
  if (response.status === 206 && (!match || Number(match[1]) !== offset))
    throw new Error("Unexpected media range");
  const skip = response.status === 206 ? 0 : offset;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  let kept = 0;
  let eof = false;
  if (reader) {
    try {
      while (kept <= length) {
        const item = await reader.read();
        if (item.done) {
          eof = true;
          break;
        }
        const start = Math.min(item.value.length, Math.max(0, skip - seen));
        seen += item.value.length;
        const part = item.value.subarray(start, start + Math.max(0, length + 1 - kept));
        chunks.push(part);
        kept += part.length;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } else eof = true;
  const bytes = Buffer.concat(chunks).subarray(0, length);
  return {
    bytes,
    total,
    more: total !== null ? offset + bytes.length < total : kept > length || !eof,
  };
}
export function allowedUploadUrl(raw: string): URL {
  const url = new URL(raw);
  const hosts = (process.env.VYLINE_CHATGPT_UPLOAD_HOSTS ?? "files.oaiusercontent.com")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
    !hosts.includes(url.hostname)
  )
    throw new Error("Upload URL host is not allowed");
  return url;
}
export async function fetchUpload(source: z.output<typeof uploadSource>): Promise<Buffer> {
  if ("dataBase64" in source) return Buffer.from(source.dataBase64, "base64");
  const url = allowedUploadUrl(source.downloadUrl);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Upload DNS timeout")), 5000);
    }),
  ]).finally(() => clearTimeout(deadline));
  if (!addresses.length || addresses.some(({ address }) => addressKind(address) !== "public"))
    throw new Error("Private upload address");
  // Match the existing WebDAV transport: pin the validated address, retain TLS hostname verification.
  return new Promise<Buffer>((resolve, reject) => {
    const req = request(
      {
        hostname: addresses[0]!.address,
        servername: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Host: url.host,
          "Accept-Encoding": "identity",
          ...(source.offset !== undefined || source.length !== undefined
            ? {
                Range: `bytes=${source.offset ?? 0}-${(source.offset ?? 0) + (source.length ?? MAX_UPLOAD_BYTES) - 1}`,
              }
            : {}),
        },
        agent: false,
      },
      async (res) => {
        try {
          if (source.offset !== undefined || source.length !== undefined) {
            if (res.statusCode !== 200 && res.statusCode !== 206)
              throw new Error("Upload download refused");
            const headers = new Headers();
            for (const field of ["content-length", "content-range"]) {
              const value = res.headers[field];
              if (typeof value === "string") headers.set(field, value);
            }
            const response = new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
              status: res.statusCode,
              headers,
            });
            resolve(
              (
                await readMediaSlice(
                  response,
                  source.offset ?? 0,
                  source.length ?? MAX_UPLOAD_BYTES,
                )
              ).bytes,
            );
            return;
          }
          if (res.statusCode !== 200 || Number(res.headers["content-length"]) > MAX_UPLOAD_BYTES)
            throw new Error("Upload download refused");
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of res) {
            const bytes = Buffer.from(chunk);
            size += bytes.length;
            if (size > MAX_UPLOAD_BYTES) throw new Error("Upload too large");
            chunks.push(bytes);
          }
          resolve(Buffer.concat(chunks, size));
        } catch (error) {
          reject(error);
        } finally {
          res.destroy();
        }
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("Upload deadline")), 30000);
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}
