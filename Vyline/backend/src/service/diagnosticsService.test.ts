import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const dataDir = await mkdtemp(join(tmpdir(), "vyline-diagnostics-test-"));
process.env.VYLINE_DATA_DIR = dataDir;

const diagnostics = await import("./diagnosticsService.js");
const { anonymousId } = await import("./redaction.js");

const mid = "u1234567890abcdef1234567890abcdef";
const otherMid = "uabcdef1234567890abcdef1234567890";
const context = {
  appVersion: "test",
  buildNumber: "test",
  platform: "desktop" as const,
  runtime: "Bun test",
  os: "test",
};

beforeAll(async () => {
  await diagnostics.clearDiagnostics(mid);
  await diagnostics.configureDiagnostics(mid, {
    enabled: true,
    retentionDays: 14,
    level: "info",
  });
});

afterAll(async () => {
  // biome-ignore lint/performance/noDelete: assigning undefined recreates the data-dir bug as a literal path.
  delete process.env.VYLINE_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("diagnostics service", () => {
  test("persists sanitized diagnostics and honors log levels", async () => {
    expect(
      await diagnostics.appendDiagnostic(mid, context, {
        event: "request_failed",
        token: "must-not-persist",
      }),
    ).toBe(true);
    expect(await diagnostics.appendDiagnostic(mid, context, { event: "verbose" }, "debug")).toBe(
      false,
    );

    const exported = await diagnostics.exportDiagnostics(mid);
    expect(exported).toContain("request_failed");
    expect(exported).not.toContain("must-not-persist");
    expect(exported).not.toContain("verbose");
  });

  test("turning diagnostics off stops new writes without deleting existing logs", async () => {
    const before = await diagnostics.listDiagnostics(mid, 1000);
    await diagnostics.configureDiagnostics(mid, { enabled: false });
    expect(await diagnostics.appendDiagnostic(mid, context, { event: "disabled" })).toBe(false);
    const after = await diagnostics.listDiagnostics(mid, 1000);
    expect(after).toEqual(before);

    await diagnostics.configureDiagnostics(mid, { enabled: true });
  });

  test("removes a current log after its retention window expires", async () => {
    await diagnostics.clearDiagnostics(mid);
    await diagnostics.configureDiagnostics(mid, { enabled: true, retentionDays: 1 });
    await diagnostics.appendDiagnostic(mid, context, { event: "old" });

    const logPath = join(dataDir, "logs", `diagnostics-${anonymousId(mid)}.jsonl`);
    const old = new Date(Date.now() - 2 * 86_400_000);
    await utimes(logPath, old, old);

    expect(await diagnostics.listDiagnostics(mid)).toEqual([]);
    expect(existsSync(logPath)).toBe(false);
  });

  test("rotates before a write would exceed the per-file size limit", async () => {
    await diagnostics.clearDiagnostics(mid);
    await diagnostics.configureDiagnostics(mid, {
      enabled: true,
      retentionDays: 14,
      level: "info",
    });
    const logPath = join(dataDir, "logs", `diagnostics-${anonymousId(mid)}.jsonl`);
    await mkdir(join(dataDir, "logs"), { recursive: true });
    await writeFile(logPath, "x".repeat(1024 * 1024 - 128), "utf8");

    await diagnostics.appendDiagnostic(mid, context, {
      event: "after_rotation",
      note: "y".repeat(300),
    });

    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect((await stat(logPath)).size).toBeLessThanOrEqual(1024 * 1024);
    expect(await diagnostics.exportDiagnostics(mid)).toContain("after_rotation");
  });

  test("keeps account logs isolated", async () => {
    await Promise.all([
      diagnostics.clearDiagnostics(mid),
      diagnostics.clearDiagnostics(otherMid),
      diagnostics.configureDiagnostics(mid, { enabled: true }),
      diagnostics.configureDiagnostics(otherMid, { enabled: true }),
    ]);
    await diagnostics.appendDiagnostic(mid, context, { event: "account_a_only" });
    await diagnostics.appendDiagnostic(otherMid, context, { event: "account_b_only" });

    const [a, b] = await Promise.all([
      diagnostics.exportDiagnostics(mid),
      diagnostics.exportDiagnostics(otherMid),
    ]);
    expect(a).toContain("account_a_only");
    expect(a).not.toContain("account_b_only");
    expect(b).toContain("account_b_only");
    expect(b).not.toContain("account_a_only");
  });

  test("persists diagnostic settings for the next service start", async () => {
    await diagnostics.configureDiagnostics(mid, {
      enabled: false,
      retentionDays: 7,
      level: "debug",
    });
    const { loadAccountSettings } = await import("./accountSettingsService.js");
    const settings = await loadAccountSettings(mid);

    expect(settings.debug.enabled).toBe(false);
    expect(settings.debug.retentionDays).toBe(7);
    expect(settings.debug.level).toBe("debug");
    await diagnostics.configureDiagnostics(mid, {
      enabled: true,
      retentionDays: 14,
      level: "info",
    });
  });

  test("records startup diagnostics on a clean start and again after restart", async () => {
    await diagnostics.clearDiagnostics(mid);
    await diagnostics.configureDiagnostics(mid, {
      enabled: true,
      retentionDays: 14,
      level: "info",
    });
    const accountDir = join(dataDir, "accounts", encodeURIComponent(mid));
    await mkdir(accountDir, { recursive: true });
    await writeFile(
      join(accountDir, "credentials.json"),
      JSON.stringify({
        authToken: "local-test-token",
        storageFile: join(accountDir, "protocol.json"),
        savedAt: new Date().toISOString(),
        mid,
      }),
      "utf8",
    );

    await diagnostics.initializeDiagnostics();
    await diagnostics.initializeDiagnostics();

    const entries = await diagnostics.listDiagnostics(mid, 1000);
    const startupEntries = entries.filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { details?: { event?: string } }).details?.event === "backend_started",
    );
    expect(startupEntries).toHaveLength(2);
    expect(JSON.stringify(entries)).not.toContain("local-test-token");
  });
});
