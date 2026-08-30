import { describe, expect, test } from "bun:test";
import { parseKeybag } from "./keybag.js";

function block(tag: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + data.length);
  result.set(new TextEncoder().encode(tag), 0);
  new DataView(result.buffer).setUint32(4, data.length, false);
  result.set(data, 8);
  return result;
}

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
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

describe("parseKeybag", () => {
  test("keeps four-byte class attributes on the class record", () => {
    const classUuid = new Uint8Array(16).fill(1);
    const wrappedKey = new Uint8Array(40).fill(2);
    const keybag = concat([
      block("TYPE", u32(1)),
      block("UUID", new Uint8Array(16).fill(3)),
      block("UUID", classUuid),
      block("CLAS", u32(0x13)),
      block("WRAP", u32(3)),
      block("KTYP", u32(0)),
      block("WPKY", wrappedKey),
    ]);

    const parsed = parseKeybag(keybag);
    const classKey = parsed.classKeys.get(0x13);
    expect(classKey?.uuid).toEqual(classUuid);
    expect(classKey?.wrap).toBe(3);
    expect(classKey?.wpky).toEqual(wrappedKey);
    expect(parsed.type).toBe(1);
  });
});
