import { describe, expect, test } from "bun:test";
import { parseMediaByteRange } from "./mediaByteRange.js";

describe("parseMediaByteRange", () => {
  test("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseMediaByteRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
    expect(parseMediaByteRange("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
    expect(parseMediaByteRange("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(parseMediaByteRange("bytes=-20", 10)).toEqual({ start: 0, end: 9 });
  });

  test("rejects malformed, multi-range, empty, and unsatisfiable requests", () => {
    for (const header of [
      "bytes=",
      "bytes=2-1",
      "bytes=10-10",
      "bytes=1-2,4-5",
      "items=1-2",
      "bytes=-0",
    ]) {
      expect(parseMediaByteRange(header, 10)).toBe("invalid");
    }
    expect(parseMediaByteRange("bytes=0-", 0)).toBe("invalid");
    expect(parseMediaByteRange(undefined, 10)).toBeNull();
  });
});
