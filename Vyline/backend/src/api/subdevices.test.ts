import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let router: typeof import("./subdevices.js")["subdeviceRouter"];
let buildPairingUrl: typeof import("./subdevices.js")["buildPairingUrl"];
let dataDir: string;
const oldDataDir = process.env.VYLINE_DATA_DIR;
const oldLan = process.env.VYLINE_LAN_ACCESS;
beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-subdevice-api-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  ({ subdeviceRouter: router, buildPairingUrl } = await import("./subdevices.js"));
});
afterAll(async () => {
  if (oldDataDir === undefined) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
  else process.env.VYLINE_DATA_DIR = oldDataDir;
  if (oldLan === undefined) Reflect.deleteProperty(process.env, "VYLINE_LAN_ACCESS");
  else process.env.VYLINE_LAN_ACCESS = oldLan;
  if (dataDir.startsWith(join(tmpdir(), "vyline-subdevice-api-"))) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

describe("subdevice management", () => {
  test("pairs through an authenticated self-host proxy and enforces token binding and revocation", async () => {
    process.env.VYLINE_LAN_ACCESS = "false";
    const response = await router.request("/pairing", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vyline-local-request": "0" },
      body: JSON.stringify({ accountId: "account-2", origin: "https://vyline.example.com" }),
    });
    expect(response.status).toBe(200);
    const pairing = await response.json();
    expect(new URL(pairing.pairingUrl).origin).toBe("https://vyline.example.com");
    const installationId = crypto.randomUUID();
    const complete = () =>
      router.request(`/pairing/${pairing.token}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vyline-installation-id": installationId },
        body: JSON.stringify({ name: "Test browser", platform: "web" }),
      });
    const result = await (await complete()).json();
    expect(result.device.accountId).toBe("account-2");
    expect((await complete()).status).toBe(410);
    const headers = {
      authorization: `Bearer ${result.sessionToken}`,
      "x-vyline-installation-id": installationId,
    };
    expect((await router.request("/heartbeat", { method: "POST", headers })).status).toBe(200);
    expect(
      (
        await router.request("/heartbeat", {
          method: "POST",
          headers: { ...headers, "x-vyline-installation-id": crypto.randomUUID() },
        })
      ).status,
    ).toBe(401);
    // Even a loopback proxy must not promote a paired session to owner access.
    for (const [method, path] of [
      ["GET", "/"],
      ["POST", "/pairing"],
      ["DELETE", `/${result.device.id}`],
      ["POST", `/${result.device.id}/block`],
      ["DELETE", `/${result.device.id}/block`],
    ] as const) {
      expect(
        (
          await router.request(path!, {
            method,
            headers: { ...headers, "x-vyline-local-request": "1" },
          })
        ).status,
      ).toBe(403);
    }
    expect((await router.request(`/${result.device.id}/block`, { method: "POST" })).status).toBe(
      200,
    );
    expect((await router.request("/heartbeat", { method: "POST", headers })).status).toBe(401);
  });

  test("keeps LAN management local and ignores forwarded loopback addresses", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";
    for (const method of ["GET", "POST"]) {
      const response = await router.request(method === "GET" ? "/" : "/pairing", {
        method,
        headers: { "x-vyline-local-request": "0", "x-forwarded-for": "127.0.0.1" },
      });
      expect(response.status).toBe(403);
    }
    expect((await router.request("/", { headers: { "x-vyline-local-request": "1" } })).status).toBe(
      200,
    );
  });
});

describe("subdevice pairing URL", () => {
  test("does not issue a LAN QR URL while loopback access is disabled", () => {
    Reflect.deleteProperty(process.env, "VYLINE_LAN_ACCESS");
    expect(buildPairingUrl("http://127.0.0.1:5173", "vyp_test")).toBeUndefined();
  });

  test("rewrites loopback origin only when LAN access is enabled", () => {
    process.env.VYLINE_LAN_ACCESS = "true";
    const result = buildPairingUrl("http://127.0.0.1:5173", "vyp_test");
    expect(result).toMatch(/^http:\/\/[^/]+:5173\/subdevice\?pairing=vyp_test$/);
    expect(result).not.toContain("127.0.0.1");
  });

  test("keeps an already reachable origin unchanged", () => {
    Reflect.deleteProperty(process.env, "VYLINE_LAN_ACCESS");
    expect(buildPairingUrl("http://192.0.2.10:5173", "vyp_test")).toBe(
      "http://192.0.2.10:5173/subdevice?pairing=vyp_test",
    );
  });
});
