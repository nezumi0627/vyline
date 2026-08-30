import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mid = "u11111111111111111111111111111111";
const otherMid = "u22222222222222222222222222222222";
const oldDataDir = process.env.VYLINE_DATA_DIR;
const oldLogDir = process.env.VYLINE_LOG_DIR;
let dataDir: string;
let app: Hono;
let settings: typeof import("./accountSettingsService.js");
let diagnostics: typeof import("./diagnosticsService.js");

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-diagnostics-test-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  Reflect.deleteProperty(process.env, "VYLINE_LOG_DIR");
  settings = await import("./accountSettingsService.js");
  diagnostics = await import("./diagnosticsService.js");
  const { requestDiagnostics } = await import("./requestDiagnostics.js");
  const { diagnosticsRouter } = await import("../api/diagnostics.js");
  app = new Hono();
  app.use(
    "*",
    requestDiagnostics((c) => (c.req.path.includes("other-account") ? otherMid : mid)),
  );
  app.post("/api/line/:accountId/messages/:messageId", (c) =>
    c.json({ ok: true, text: "private response" }),
  );
  app.get("/api/line/:accountId/profile", () => {
    throw new Error("secret token and private raw error");
  });
  app.onError((_error, c) => c.json({ ok: false, error: "internal server error" }, 500));
  app.route("/api/diagnostics", diagnosticsRouter);
  // Production registers the SPA fallback after all API handlers.
  app.get("*", (c) => c.html("<main>app</main>"));
});

afterAll(async () => {
  if (oldDataDir === undefined) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
  else process.env.VYLINE_DATA_DIR = oldDataDir;
  if (oldLogDir === undefined) Reflect.deleteProperty(process.env, "VYLINE_LOG_DIR");
  else process.env.VYLINE_LOG_DIR = oldLogDir;
  if (dataDir.startsWith(join(tmpdir(), "vyline-diagnostics-test-"))) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

describe("HTTP diagnostic collection", () => {
  test("records success and failure metadata and exports it without private request or response data", async () => {
    await app.request("/api/line/private-account/messages/private-message?token=secret-query", {
      method: "POST",
      headers: { authorization: "Bearer private-token", "content-type": "application/json" },
      body: JSON.stringify({ text: "private body", password: "private-password" }),
    });
    expect((await app.request("/api/line/private-account/profile")).status).toBe(500);
    const listed = await (await app.request(`/api/diagnostics/${mid}`)).json();
    expect(listed.entries).toHaveLength(2);
    expect(listed.entries[0].http).toEqual({
      method: "POST",
      route: "/api/line/:accountId/messages/:messageId",
      status: 200,
    });
    expect(listed.entries[1]).toMatchObject({ level: "error", http: { status: 500 } });
    const exported = await (await app.request(`/api/diagnostics/${mid}/export`)).json();
    expect(JSON.parse(exported.content)).toHaveLength(2);
    expect(exported.content).not.toMatch(/private|secret|Bearer|u111111/);
    const raw = await readFile(join(dataDir, "logs", `diagnostics-${mid}.jsonl`), "utf8");
    expect(raw).not.toMatch(/private|secret|Bearer/);
    expect(await diagnostics.listDiagnostics(otherMid)).toEqual([]);
    await app.request(`/api/diagnostics/${mid}`, { method: "DELETE" });
    expect((await (await app.request(`/api/diagnostics/${mid}`)).json()).entries).toEqual([]);
  });

  test("respects opt-out and level selection without breaking requests", async () => {
    const defaults = settings.defaultAccountSettings().debug;
    await settings.saveAccountSettings(mid, { debug: { ...defaults, enabled: false } });
    expect((await app.request("/api/line/account/profile")).status).toBe(500);
    expect(await diagnostics.listDiagnostics(mid)).toEqual([]);
    await settings.saveAccountSettings(mid, { debug: { ...defaults, level: "error" } });
    await app.request("/api/line/account/messages/id", { method: "POST" });
    expect(await diagnostics.listDiagnostics(mid)).toEqual([]);
    await app.request("/api/line/account/profile");
    expect(await diagnostics.listDiagnostics(mid)).toHaveLength(1);
  });

  test("rotates large files, excludes expired records and tolerates damaged lines", async () => {
    await settings.saveAccountSettings(mid, {
      debug: { ...settings.defaultAccountSettings().debug, retentionDays: 1 },
    });
    const path = join(dataDir, "logs", `diagnostics-${mid}.jsonl`);
    const old = JSON.stringify({
      at: new Date(Date.now() - 2 * 86400000).toISOString(),
      marker: "expired",
    });
    const recent = JSON.stringify({ at: new Date().toISOString(), marker: "x".repeat(400) });
    await writeFile(path, `${old}\ninvalid json\n${`${recent}\n`.repeat(3000)}`);
    expect((await stat(path)).size).toBeGreaterThan(1024 * 1024);
    await app.request("/api/line/account/profile");
    expect((await stat(path)).size).toBeLessThan(1024 * 1024);
    const entries = await diagnostics.listDiagnostics(mid, 1000);
    expect(entries).toHaveLength(501);
    expect(JSON.stringify(entries)).not.toContain("expired");
    expect(await diagnostics.listDiagnostics(mid, Number.NaN)).toHaveLength(200);
  });
});
