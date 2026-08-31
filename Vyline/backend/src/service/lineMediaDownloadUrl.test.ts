import { describe, expect, test } from "bun:test";
import {
  fetchTrustedLineMediaDownloadUrl,
  isTrustedLineMediaDownloadUrl,
} from "./lineMediaDownloadUrl.js";

describe("LINE media DOWNLOAD_URL validation", () => {
  test("allows only LINE-owned HTTPS media hosts", () => {
    expect(isTrustedLineMediaDownloadUrl("https://obs-jp.line-apps.com/r/talk/m/123")).toBe(true);
    expect(isTrustedLineMediaDownloadUrl("https://static.line-scdn.net/path/image.png")).toBe(true);
    expect(isTrustedLineMediaDownloadUrl("https://line-apps.com./path/image.png")).toBe(true);

    expect(isTrustedLineMediaDownloadUrl("http://127.0.0.1:3001/private")).toBe(false);
    expect(isTrustedLineMediaDownloadUrl("https://localhost/private")).toBe(false);
    expect(isTrustedLineMediaDownloadUrl("http://obs-jp.line-apps.com/r/talk/m/123")).toBe(false);
    expect(isTrustedLineMediaDownloadUrl("https://user:pass@obs-jp.line-apps.com/file")).toBe(
      false,
    );
    expect(isTrustedLineMediaDownloadUrl("https://obs-jp.line-apps.com.evil.example/file")).toBe(
      false,
    );
    expect(isTrustedLineMediaDownloadUrl("https://static.line-scdn.net:8443/file")).toBe(false);
  });

  test("follows relative redirects manually and leaves the final body streaming", async () => {
    const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, redirect: init?.redirect });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: "/media/final" } });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };

    const response = await fetchTrustedLineMediaDownloadUrl(
      "https://obs-jp.line-apps.com/media/start",
      {},
      fetchImpl,
    );

    expect(calls).toEqual([
      { url: "https://obs-jp.line-apps.com/media/start", redirect: "manual" },
      { url: "https://obs-jp.line-apps.com/media/final", redirect: "manual" },
    ]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("rejects an untrusted redirect before issuing the second request", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:3001/private" },
      });
    };

    await expect(
      fetchTrustedLineMediaDownloadUrl("https://obs-jp.line-apps.com/media/start", {}, fetchImpl),
    ).rejects.toThrow("blocked untrusted media download URL");
    expect(calls).toEqual(["https://obs-jp.line-apps.com/media/start"]);
  });

  test("rejects redirect loops after the bounded hop count", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(null, { status: 307, headers: { location: `/hop-${calls}` } });
    };

    await expect(
      fetchTrustedLineMediaDownloadUrl("https://static.line-scdn.net/media/start", {}, fetchImpl),
    ).rejects.toThrow("media download redirect rejected");
    expect(calls).toBe(4);
  });
});
