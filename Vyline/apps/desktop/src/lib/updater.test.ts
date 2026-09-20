import { describe, expect, test } from "bun:test";
import { isNewerVersion } from "./updater";

describe("isNewerVersion", () => {
  test("orders stable releases after prereleases", () => {
    expect(isNewerVersion("0.6.0", "0.6.0-beta")).toBe(true);
    expect(isNewerVersion("0.6.0-beta", "0.6.0")).toBe(false);
  });

  test("does not offer an older or equal release", () => {
    expect(isNewerVersion("0.5.9", "0.6.0-beta")).toBe(false);
    expect(isNewerVersion("v0.6.0-beta", "0.6.0-beta")).toBe(false);
  });

  test("rejects malformed versions instead of prompting an unsafe update", () => {
    expect(isNewerVersion("latest", "0.6.0-beta")).toBe(false);
    expect(isNewerVersion("0.7", "0.6.0-beta")).toBe(false);
  });
});
