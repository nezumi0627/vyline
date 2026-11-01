import { describe, expect, test } from "bun:test";
import { parseCallDurationSeconds } from "./mappers.js";

describe("parseCallDurationSeconds", () => {
  test("converts LINE DURATION milliseconds to seconds", () => {
    expect(parseCallDurationSeconds({ DURATION: "10000" })).toBe(10);
  });

  test("keeps the legacy duration field in seconds", () => {
    expect(parseCallDurationSeconds({ duration: 185 })).toBe(185);
  });

  test("returns undefined for missing or invalid duration", () => {
    expect(parseCallDurationSeconds(null)).toBeUndefined();
    expect(parseCallDurationSeconds({ DURATION: "0" })).toBeUndefined();
  });
});
