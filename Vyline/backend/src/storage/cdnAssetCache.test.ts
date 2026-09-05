import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const MAX_CDN_RESPONSE_BYTES = 10 * 1024 * 1024;

if (process.env.VYLINE_CDN_CACHE_TEST_CHILD !== "1") {
  test("CDN byte-budget cache integration in an isolated process", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, VYLINE_CDN_CACHE_TEST_CHILD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 60_000);
} else {
  const root = await fs.mkdtemp(join(tmpdir(), "vyline-cdn-cache-test-"));
  const storageRoot = join(root, "storage");
  process.env.VYLINE_STORAGE_DIR = storageRoot;
  Reflect.deleteProperty(process.env, "VYLINE_CDN_CACHE_DIR");
  Reflect.deleteProperty(process.env, "VYLINE_ICON_CACHE_DIR");
  const preexistingDir = join(storageRoot, "cache", "cdn-cache", "aa");
  await fs.mkdir(preexistingDir, { recursive: true });
  await fs.writeFile(join(preexistingDir, "preexisting.bin"), new Uint8Array(123));
  const stalePartialPath = join(preexistingDir, "stale.partial");
  await fs.writeFile(stalePartialPath, new Uint8Array(50));
  const {
    clearCdnCache,
    clearIconCache,
    getCdnCacheSize,
    getCachedLineCdnAsset,
    getCdnMemoryCacheStats,
    getIconCacheSize,
  } = await import("./cdnAssetCache.js");
  const initialScannedSize = await getCdnCacheSize();
  const originalFetch = globalThis.fetch;

  function streamedResponse(size: number, declaredSize = size): Response {
    let sent = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= size) {
            controller.close();
            return;
          }
          const bytes = new Uint8Array(Math.min(64 * 1024, size - sent));
          bytes.fill((sent / (64 * 1024)) % 251);
          sent += bytes.byteLength;
          controller.enqueue(bytes);
        },
      }),
      {
        headers: {
          "content-length": String(declaredSize),
          "content-type": "image/png",
        },
      },
    );
  }

  beforeEach(async () => {
    globalThis.fetch = originalFetch;
    await clearCdnCache();
    await clearIconCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await clearCdnCache();
    await clearIconCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("CDN byte-budget cache", () => {
    test("scans preexisting cache bytes once on first use", async () => {
      expect(initialScannedSize).toBe(123);
      await expect(fs.stat(stalePartialPath)).rejects.toThrow();
      expect(await getCdnCacheSize()).toBe(0);
    });

    test("rejects a declared response above the hard fetch limit", async () => {
      globalThis.fetch = (async () =>
        streamedResponse(1, MAX_CDN_RESPONSE_BYTES + 1)) as unknown as typeof fetch;

      await expect(
        getCachedLineCdnAsset("https://static.line-scdn.net/tests/declared-too-large.png"),
      ).rejects.toThrow("cdn response too large");
      expect(getCdnMemoryCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
      expect(await getCdnCacheSize()).toBe(0);
    });

    test("cancels and removes a streamed response that crosses the hard limit", async () => {
      globalThis.fetch = (async () =>
        streamedResponse(MAX_CDN_RESPONSE_BYTES + 1, 0)) as unknown as typeof fetch;

      await expect(
        getCachedLineCdnAsset("https://static.line-scdn.net/tests/streamed-too-large.png"),
      ).rejects.toThrow("cdn response exceeded");
      expect(getCdnMemoryCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
      expect(await getCdnCacheSize()).toBe(0);
    });

    test("follows an allowed relative redirect with manual redirect handling", async () => {
      const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        calls.push({ url, redirect: init?.redirect });
        if (calls.length === 1) {
          return new Response(null, { status: 302, headers: { location: "/tests/final.png" } });
        }
        return streamedResponse(128);
      }) as typeof fetch;

      const asset = await getCachedLineCdnAsset(
        "https://static.line-scdn.net/tests/redirect-start.png",
      );

      expect(asset.size).toBe(128);
      expect(calls).toEqual([
        {
          url: "https://static.line-scdn.net/tests/redirect-start.png",
          redirect: "manual",
        },
        { url: "https://static.line-scdn.net/tests/final.png", redirect: "manual" },
      ]);
    });

    test("rejects an untrusted redirect before issuing another fetch", async () => {
      const calls: string[] = [];
      globalThis.fetch = (async (input) => {
        calls.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:3001/private" },
        });
      }) as typeof fetch;

      await expect(
        getCachedLineCdnAsset("https://static.line-scdn.net/tests/redirect-localhost.png"),
      ).rejects.toThrow("cdn redirect target not allowed");
      expect(calls).toEqual(["https://static.line-scdn.net/tests/redirect-localhost.png"]);
      expect(await getCdnCacheSize()).toBe(0);
    });

    test("rejects redirect loops after the bounded hop count", async () => {
      const calls: string[] = [];
      globalThis.fetch = (async (input, init) => {
        calls.push(String(input));
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 307,
          headers: { location: `/tests/redirect-loop-${calls.length}.png` },
        });
      }) as typeof fetch;

      await expect(
        getCachedLineCdnAsset("https://static.line-scdn.net/tests/redirect-loop.png"),
      ).rejects.toThrow("cdn redirect rejected");
      expect(calls).toHaveLength(4);
      expect(await getCdnCacheSize()).toBe(0);
    });

    test("evicts by a 16MiB LRU byte budget and refreshes recency in O(1)", async () => {
      const entryBytes = 2 * 1024 * 1024;
      let fetches = 0;
      globalThis.fetch = (async () => {
        fetches++;
        return streamedResponse(entryBytes);
      }) as unknown as typeof fetch;

      let secondBuffer: Uint8Array | undefined;
      let thirdBuffer: Uint8Array | undefined;
      for (let index = 1; index <= 9; index++) {
        const asset = await getCachedLineCdnAsset(
          `https://static.line-scdn.net/tests/lru-${index}.png`,
        );
        expect(asset.kind).toBe("memory");
        if (asset.kind === "memory" && index === 2) secondBuffer = asset.buf;
        if (asset.kind === "memory" && index === 3) thirdBuffer = asset.buf;
      }
      expect(fetches).toBe(9);
      expect(getCdnMemoryCacheStats()).toEqual({
        entries: 8,
        bytes: 16 * 1024 * 1024,
        maxBytes: 16 * 1024 * 1024,
        maxEntryBytes: 4 * 1024 * 1024,
      });
      expect(await getCdnCacheSize()).toBe(18 * 1024 * 1024);

      const refreshed = await getCachedLineCdnAsset("https://static.line-scdn.net/tests/lru-2.png");
      expect(refreshed.kind === "memory" && refreshed.buf === secondBuffer).toBe(true);
      await getCachedLineCdnAsset("https://static.line-scdn.net/tests/lru-10.png");
      const evicted = await getCachedLineCdnAsset("https://static.line-scdn.net/tests/lru-3.png");
      expect(evicted.kind === "memory" && evicted.buf !== thirdBuffer).toBe(true);
      expect(getCdnMemoryCacheStats().bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(await getCdnCacheSize()).toBe(20 * 1024 * 1024);
    });

    test("keeps an asset above 4MiB disk-backed across cache hits", async () => {
      const largeBytes = 5 * 1024 * 1024;
      let fetches = 0;
      globalThis.fetch = (async () => {
        fetches++;
        return streamedResponse(largeBytes);
      }) as unknown as typeof fetch;
      const url = "https://static.line-scdn.net/tests/disk-backed-large.png";

      const first = await getCachedLineCdnAsset(url);
      expect(first.kind).toBe("file");
      if (first.kind === "file") expect(Bun.file(first.path).size).toBe(largeBytes);
      expect(getCdnMemoryCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
      expect(await getCdnCacheSize()).toBe(largeBytes);

      const second = await getCachedLineCdnAsset(url);
      expect(second).toMatchObject({ kind: "file", fromCache: true, size: largeBytes });
      expect(fetches).toBe(1);
      expect(getCdnMemoryCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
      expect(await getCdnCacheSize()).toBe(largeBytes);
    });

    test("coalesces concurrent misses into one streaming fetch", async () => {
      let fetches = 0;
      globalThis.fetch = (async () => {
        fetches++;
        await Bun.sleep(10);
        return streamedResponse(128 * 1024);
      }) as unknown as typeof fetch;
      const url = "https://static.line-scdn.net/tests/concurrent.png";

      const assets = await Promise.all(
        Array.from({ length: 32 }, () => getCachedLineCdnAsset(url)),
      );
      expect(fetches).toBe(1);
      expect(assets).toHaveLength(32);
      expect(assets.every((asset) => asset.size === 128 * 1024)).toBe(true);
      expect(getCdnMemoryCacheStats()).toMatchObject({ entries: 1, bytes: 128 * 1024 });
      expect(await getCdnCacheSize()).toBe(128 * 1024);
    });

    test("caps distinct fetches at four without losing disk-byte deltas", async () => {
      let active = 0;
      let maximumActive = 0;
      globalThis.fetch = (async () => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await Bun.sleep(5);
        active--;
        return streamedResponse(32 * 1024);
      }) as unknown as typeof fetch;
      await Promise.all(
        Array.from({ length: 32 }, (_, index) =>
          getCachedLineCdnAsset(`https://static.line-scdn.net/tests/parallel-${index}.png`),
        ),
      );
      expect(maximumActive).toBe(4);
      expect(await getCdnCacheSize()).toBe(32 * 32 * 1024);
      expect(getCdnMemoryCacheStats().bytes).toBe(32 * 32 * 1024);
    });

    test("tracks CDN and icon roots independently and resets totals on clear", async () => {
      globalThis.fetch = (async () => streamedResponse(32 * 1024)) as unknown as typeof fetch;

      await getCachedLineCdnAsset("https://static.line-scdn.net/tests/cdn-root.png");
      await getCachedLineCdnAsset("https://profile.line-scdn.net/tests/icon-root.png");
      expect(await getCdnCacheSize()).toBe(32 * 1024);
      expect(await getIconCacheSize()).toBe(32 * 1024);

      await clearCdnCache();
      expect(await getCdnCacheSize()).toBe(0);
      expect(await getIconCacheSize()).toBe(32 * 1024);
    });
  });
}
