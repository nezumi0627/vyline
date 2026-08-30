import { describe, expect, test } from "bun:test";
import { isTrustedLineMediaDownloadUrl } from "./lineMediaDownloadUrl.js";

describe("isTrustedLineMediaDownloadUrl", () => {
  test("allows LINE-owned HTTPS media hosts", () => {
    expect(isTrustedLineMediaDownloadUrl("https://obs-jp.line-apps.com/r/talk/m/123")).toBe(true);
    expect(isTrustedLineMediaDownloadUrl("https://static.line-scdn.net/path/image.png")).toBe(true);
  });

  test("rejects local, non-HTTPS, credentialed, and lookalike URLs", () => {
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
});
