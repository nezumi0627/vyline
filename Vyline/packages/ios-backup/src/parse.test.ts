import { describe, expect, test } from "bun:test";
import { iosTimestampToIso } from "./parse.js";

describe("iosTimestampToIso", () => {
  test("keeps the Unix millisecond instant", () => {
    expect(iosTimestampToIso(Date.parse("2026-08-24T00:00:00.000Z"))).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });

  test("returns null for invalid timestamps", () => {
    expect(iosTimestampToIso(Number.NaN)).toBeNull();
  });
});
