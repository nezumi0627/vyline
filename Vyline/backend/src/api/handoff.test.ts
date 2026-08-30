import { describe, expect, test } from "bun:test";
import { handoffRouter } from "./handoff.js";

const MID = "u1234567890abcdef1234567890abcdef";

describe("handoff API error handling", () => {
  test("does not expose archive parser errors", async () => {
    const response = await handoffRouter.request(`/${MID}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archiveBase64: Buffer.from("not a zip").toString("base64") }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid handoff archive" });
  });

  test("keeps explicit import cancellation as a safe client-facing error", async () => {
    const response = await handoffRouter.request(`/${MID}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archiveBase64: "AA==", mode: "cancel" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "import cancelled" });
  });
});
