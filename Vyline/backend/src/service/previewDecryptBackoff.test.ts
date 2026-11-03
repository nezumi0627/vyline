import { describe, expect, test } from "bun:test";
import { recordPreviewDecryptFailure, shouldSkipPreviewDecrypt } from "./previewDecryptBackoff.js";

describe("preview decrypt retry backoff", () => {
  test("suppresses repeated attempts only until the retry window expires", () => {
    const failed = new Map<string, number>();
    recordPreviewDecryptFailure(failed, "chat:message", 1_000);

    expect(shouldSkipPreviewDecrypt(failed, "chat:message", 1_001)).toBe(true);
    expect(shouldSkipPreviewDecrypt(failed, "chat:message", 301_000)).toBe(false);
    expect(failed.has("chat:message")).toBe(false);
  });

  test("bounds retained failures and evicts the oldest entry", () => {
    const failed = new Map<string, number>();
    for (let index = 0; index < 501; index++) {
      recordPreviewDecryptFailure(failed, `chat:${index}`, index);
    }

    expect(failed.size).toBe(500);
    expect(failed.has("chat:0")).toBe(false);
    expect(failed.has("chat:500")).toBe(true);
  });
});
