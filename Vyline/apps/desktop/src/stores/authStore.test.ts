import { describe, expect, test } from "bun:test";
import { normalizeAccountId } from "./authStore.js";

describe("normalizeAccountId", () => {
  test("maps internal content sessions back to the owning account", () => {
    expect(normalizeAccountId("main:content")).toBe("main");
    expect(normalizeAccountId("work")).toBe("work");
    expect(normalizeAccountId(null)).toBeNull();
  });
});
