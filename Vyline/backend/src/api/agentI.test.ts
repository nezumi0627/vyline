import { afterEach, describe, expect, test } from "bun:test";
import { agentIRouter } from "./agentI.js";

const previousLanAccess = process.env.VYLINE_LAN_ACCESS;

afterEach(() => {
  if (previousLanAccess === undefined) process.env.VYLINE_LAN_ACCESS = undefined;
  else process.env.VYLINE_LAN_ACCESS = previousLanAccess;
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
});
