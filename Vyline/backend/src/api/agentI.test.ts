import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousLanAccess = process.env.VYLINE_LAN_ACCESS;
const previousDataDir = process.env.VYLINE_DATA_DIR;
const previousFetch = globalThis.fetch;
const testDataDir = await mkdtemp(join(tmpdir(), "vyline-agent-i-lan-"));
process.env.VYLINE_DATA_DIR = testDataDir;

const { agentIRouter } = await import("./agentI.js");
const { completePairing, createPairing } = await import("../storage/subdeviceStore.js");

afterEach(() => {
  if (previousLanAccess === undefined) {
    // biome-ignore lint/performance/noDelete: assigning undefined leaves a literal "undefined" env value.
    delete process.env.VYLINE_LAN_ACCESS;
  } else process.env.VYLINE_LAN_ACCESS = previousLanAccess;
  globalThis.fetch = previousFetch;
});

afterAll(async () => {
  if (previousDataDir === undefined) {
    // biome-ignore lint/performance/noDelete: assigning undefined leaves a literal "undefined" env value.
    delete process.env.VYLINE_DATA_DIR;
  } else process.env.VYLINE_DATA_DIR = previousDataDir;
  await rm(testDataDir, { recursive: true, force: true });
});

describe("Agent I LAN authentication", () => {
  test("rejects unauthenticated remote requests when LAN access is enabled", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";

    const response = await agentIRouter.request("/u-test/history", {
      headers: { "x-vyline-local-request": "0" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "subdevice authentication required",
    });
  });

  test("keeps trusted local requests available when LAN access is enabled", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";

    const response = await agentIRouter.request("/u-test/history", {
      headers: { "x-vyline-local-request": "1" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, history: [] });
  });

  test("allows only the account used when the subdevice was paired", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";
    const installationId = crypto.randomUUID();
    const pairing = await createPairing("account-a");
    const completed = await completePairing(pairing.token, "Test tablet", "web", installationId);
    expect(completed).not.toBeNull();

    const headers = {
      authorization: `Bearer ${completed!.sessionToken}`,
      "x-vyline-installation-id": installationId,
      "x-vyline-local-request": "0",
    };

    const allowed = await agentIRouter.request("/account-a/history", { headers });
    expect(allowed.status).toBe(200);

    const denied = await agentIRouter.request("/account-b/history", { headers });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ ok: false, error: "subdevice account mismatch" });
  });

  test("does not expose upstream Agent I error details", async () => {
    process.env.VYLINE_LAN_ACCESS = "false";
    globalThis.fetch = (async () =>
      new Response("upstream-secret-detail", { status: 503 })) as unknown as typeof fetch;

    const response = await agentIRouter.request("/security-error-account/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: "upstream service unavailable" });
  });
});
