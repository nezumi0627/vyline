import { expect, test } from "bun:test";

import { getCachedLineCdn } from "./cdnAssetCache.js";

const MAX_CDN_RESPONSE_BYTES = 10 * 1024 * 1024;

test("rejects a CDN response whose declared size exceeds the limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("small body", {
      headers: { "content-length": String(MAX_CDN_RESPONSE_BYTES + 1) },
    })) as unknown as typeof fetch;

  try {
    await expect(
      getCachedLineCdn("https://static.line-scdn.net/tests/declared-too-large.png"),
    ).rejects.toThrow("cdn response too large");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a CDN response that exceeds the limit while streaming", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_CDN_RESPONSE_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body)) as unknown as typeof fetch;

  try {
    await expect(
      getCachedLineCdn("https://static.line-scdn.net/tests/streamed-too-large.png"),
    ).rejects.toThrow("cdn response exceeded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
