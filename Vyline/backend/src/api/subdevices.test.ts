import { afterEach, describe, expect, test } from "bun:test";
import { buildPairingUrl } from "./subdevices.js";

const previousLanAccess = process.env.VYLINE_LAN_ACCESS;

afterEach(() => {
  if (previousLanAccess === undefined) process.env.VYLINE_LAN_ACCESS = undefined;
  else process.env.VYLINE_LAN_ACCESS = previousLanAccess;
});

describe("subdevice pairing URL", () => {
  test("does not issue a LAN QR URL while loopback access is disabled", () => {
    process.env.VYLINE_LAN_ACCESS = undefined;

    expect(buildPairingUrl("http://127.0.0.1:5173", "vyp_test")).toBeUndefined();
  });

  test("rewrites loopback origin only when LAN access is enabled", () => {
    process.env.VYLINE_LAN_ACCESS = "true";

    const result = buildPairingUrl("http://127.0.0.1:5173", "vyp_test");
    expect(result).toMatch(/^http:\/\/[^/]+:5173\/subdevice\?pairing=vyp_test$/);
    expect(result).not.toContain("127.0.0.1");
  });

  test("keeps an already reachable origin unchanged", () => {
    process.env.VYLINE_LAN_ACCESS = undefined;

    expect(buildPairingUrl("http://192.0.2.10:5173", "vyp_test")).toBe(
      "http://192.0.2.10:5173/subdevice?pairing=vyp_test",
    );
  });
});
