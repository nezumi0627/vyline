import { afterEach, describe, expect, test } from "bun:test";
import { buildPairingUrl, subdeviceRouter } from "./subdevices.js";

const previousLanAccess = process.env.VYLINE_LAN_ACCESS;
const previousPublicHost = process.env.VYLINE_PUBLIC_HOST;

afterEach(() => {
  if (previousLanAccess === undefined) {
    // biome-ignore lint/performance/noDelete: assigning undefined leaves a literal "undefined" env value.
    delete process.env.VYLINE_LAN_ACCESS;
  } else process.env.VYLINE_LAN_ACCESS = previousLanAccess;
  if (previousPublicHost === undefined) process.env.VYLINE_PUBLIC_HOST = undefined;
  else process.env.VYLINE_PUBLIC_HOST = previousPublicHost;
});

describe("subdevice pairing URL", () => {
  test("does not issue a LAN QR URL while loopback access is disabled", () => {
    // biome-ignore lint/performance/noDelete: this test needs the variable to be absent, not stringified.
    delete process.env.VYLINE_LAN_ACCESS;

    expect(buildPairingUrl("http://127.0.0.1:5173", "vyp_test")).toBeUndefined();
  });

  test("rewrites loopback origin only when LAN access is enabled", () => {
    process.env.VYLINE_LAN_ACCESS = "true";
    process.env.VYLINE_PUBLIC_HOST = "192.0.2.10";

    const result = buildPairingUrl("http://127.0.0.1:5173", "vyp_test");
    expect(result).toMatch(/^http:\/\/[^/]+:5173\/subdevice\?pairing=vyp_test$/);
    expect(result).not.toContain("127.0.0.1");
  });

  test("keeps an already reachable origin unchanged", () => {
    // biome-ignore lint/performance/noDelete: this test needs the variable to be absent, not stringified.
    delete process.env.VYLINE_LAN_ACCESS;

    expect(buildPairingUrl("http://192.0.2.10:5173", "vyp_test")).toBe(
      "http://192.0.2.10:5173/subdevice?pairing=vyp_test",
    );
  });
});

describe("subdevice management authorization", () => {
  test("does not treat a bearer session as a local owner request", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";
    const response = await subdeviceRouter.request("/pairing", {
      method: "POST",
      headers: {
        authorization: "Bearer paired-session",
        "x-vyline-local-request": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ accountId: "u11111111111111111111111111111111" }),
    });
    expect(response.status).toBe(403);
  });
});
