import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const dataDir = await mkdtemp(join(tmpdir(), "vyline-issue-report-test-"));
process.env.VYLINE_DATA_DIR = dataDir;

const diagnostics = await import("./diagnosticsService.js");
const { buildIssuePreview } = await import("./issueReportService.js");

const mid = "u1234567890abcdef1234567890abcdef";
const secret = "fixture-super-secret-token";
const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signature";
const context = {
  appVersion: "test",
  buildNumber: "test",
  platform: "desktop" as const,
  runtime: "Bun test",
  os: "test",
};

beforeAll(async () => {
  await diagnostics.clearDiagnostics(mid);
  await diagnostics.configureDiagnostics(mid, { enabled: true, level: "info" });
});

afterAll(async () => {
  // biome-ignore lint/performance/noDelete: assigning undefined recreates the data-dir bug as a literal path.
  delete process.env.VYLINE_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("issue report service", () => {
  test("never leaks secret fixtures through preview, title, or GitHub prefill", async () => {
    await diagnostics.appendDiagnostic(mid, context, {
      event: "fixture_failure",
      token: secret,
      note: `Bearer ${secret} ${jwt} user@example.com 192.168.1.10 ${mid}`,
    });

    const preview = await buildIssuePreview(mid, {
      summary: `Login failed token=${secret}`,
      reproduction: `Authorization: Bearer ${secret}`,
      expected: "contact user@example.com",
      actual: `session=${secret} ${jwt} ${mid}`,
    });
    const serialized = JSON.stringify(preview);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain(mid);
    expect(serialized).toContain("REDACTED");
  });

  test("falls back to copy mode when the GitHub prefill URL is too large", async () => {
    await diagnostics.clearDiagnostics(mid);
    for (let index = 0; index < 20; index += 1) {
      await diagnostics.appendDiagnostic(mid, context, {
        event: `large_fixture_${index}`,
        note: `${index}-${"z".repeat(500)}`,
      });
    }

    const preview = await buildIssuePreview(mid, { summary: "Large report" });
    expect(preview.delivery).toBe("copy");
    expect(preview.issueUrl).toBe("https://github.com/nezumi0627/vyline/issues/new");
    expect(preview.report).toContain("large_fixture_0");
    expect(preview.report.length).toBeGreaterThan(7_000);
  });
});
