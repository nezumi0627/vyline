import { describe, expect, test } from "bun:test";
import { parseBplist } from "./bplist.js";

function makeFixture(): Uint8Array {
  const date = new Uint8Array(9);
  date[0] = 0x33;
  new DataView(date.buffer, 1, 8).setFloat64(0, 0, false);

  const objects = [
    new Uint8Array([0xd4, 1, 2, 3, 4, 5, 6, 7, 8]),
    ascii("BackupKeyBag"),
    ascii("Date"),
    ascii("Flag"),
    ascii("Long"),
    new Uint8Array([0x41, 0xaa]),
    date,
    new Uint8Array([0x08]),
    new Uint8Array([0x5f, 0x10, 0x10, ...asciiBytes("0123456789abcdef")]),
  ];
  const header = new TextEncoder().encode("bplist00");
  const objectBytes = concat(objects);
  const offsetTableOffset = header.length + objectBytes.length;
  const offsets: number[] = [];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  const trailer = new Uint8Array(32);
  trailer[6] = 1;
  trailer[7] = 1;
  writeUInt64(trailer, 8, objects.length);
  writeUInt64(trailer, 16, 0);
  writeUInt64(trailer, 24, offsetTableOffset);
  return concat([header, objectBytes, Uint8Array.from(offsets), trailer]);
}

function ascii(value: string): Uint8Array {
  return new Uint8Array([0x50 | value.length, ...asciiBytes(value)]);
}

function asciiBytes(value: string): number[] {
  return Array.from(value, (character) => character.charCodeAt(0));
}

function writeUInt64(target: Uint8Array, offset: number, value: number): void {
  let remaining = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    target[offset + i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

describe("parseBplist", () => {
  test("parses iOS manifest marker types, dates, and extended lengths", () => {
    const parsed = parseBplist(makeFixture()) as {
      BackupKeyBag: Uint8Array;
      Date: Date;
      Flag: boolean;
      Long: string;
    };

    expect(parsed.BackupKeyBag).toEqual(new Uint8Array([0xaa]));
    expect(parsed.Date).toEqual(new Date("2001-01-01T00:00:00.000Z"));
    expect(parsed.Flag).toBe(false);
    expect(parsed.Long).toBe("0123456789abcdef");
  });
});
