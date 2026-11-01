import { describe, expect, test } from "bun:test";
import { createSupportZip, redactSupportValue } from "./supportBundle";

describe("support bundle privacy", () => {
  test("redacts auth fields and bearer/JWT strings", () => {
    const clean = redactSupportValue({
      token: "private-token",
      note: "Bearer abc.def and access_token=secret",
    }) as Record<string, unknown>;
    expect(clean.token).toBe("[REDACTED]");
    expect(clean.note).not.toContain("private-token");
    expect(clean.note).not.toContain("abc.def");
    expect(clean.note).not.toContain("access_token=secret");
  });

  test("redacts the entire cookie header including subsequent cookie pairs", () => {
    expect(redactSupportValue("Cookie: session=secret; auth=also-secret\nnext line")).toBe(
      "[REDACTED_COOKIE]\nnext line",
    );
  });

  test("keeps proxy host but removes credentials and query values", () => {
    expect(
      redactSupportValue("https://alice:secret@proxy.example:8443/path?token=private", "proxyUrl"),
    ).toBe("https://proxy.example:8443/");
  });

  test("creates a ZIP archive with UTF-8 filenames", async () => {
    const archive = createSupportZip([
      { name: "診断/report.json", data: new TextEncoder().encode("{}") },
    ]);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(bytes)).toContain("診断_report.json");
  });
});
