import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

if (process.env.VYLINE_CDN_REDIRECT_TEST_CHILD !== "1") {
  test("CDN redirect validation runs in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-cdn-redirect-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_CDN_REDIRECT_TEST_CHILD: "1",
          VYLINE_CDN_CACHE_DIR: join(root, "cdn"),
          VYLINE_ICON_CACHE_DIR: join(root, "icons"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(`${stdout}\n${stderr}`).toContain("0 fail");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
} else {
  const { getCachedLineCdn } = await import("./cdnAssetCache.js");

  test("rejects a redirect to a host outside the CDN allowlist", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/payload" },
      });
    }) as unknown as typeof fetch;
    try {
      await expect(getCachedLineCdn("https://static.line-scdn.net/sticker.png")).rejects.toThrow(
        "cdn redirect target not allowed",
      );
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
