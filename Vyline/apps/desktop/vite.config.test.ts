import { describe, expect, it } from "bun:test";
import config from "./vite.config.ts";

describe("Vite API proxy", () => {
  it("preserves the /api prefix required by internal BFF routes", () => {
    const proxy = config.server?.proxy?.["/api"];
    expect(proxy).toBeDefined();
    expect(typeof proxy).toBe("object");
    expect("rewrite" in (proxy as object)).toBeFalse();
  });
});
