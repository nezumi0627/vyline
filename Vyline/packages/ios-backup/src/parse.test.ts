import { describe, expect, test } from "bun:test";
import { parseBplist } from "./bplist.js";
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

  test("reads a binary plist date object from an iOS-style trailer", () => {
    const data = new Uint8Array(50);
    data.set(new TextEncoder().encode("bplist00"), 0);
    data[8] = 0x33;
    new DataView(data.buffer).setFloat64(9, 0, false);
    data[17] = 8;
    const trailer = new DataView(data.buffer, 18, 32);
    data[24] = 1;
    data[25] = 1;
    trailer.setBigUint64(8, 1n, false);
    trailer.setBigUint64(16, 0n, false);
    trailer.setBigUint64(24, 17n, false);

    expect(parseBplist(data)).toEqual(new Date("2001-01-01T00:00:00.000Z"));
  });
});
