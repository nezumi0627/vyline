import { expect, test } from "bun:test";
import { decodeCallVideoFrame, encodeCallVideoFrame } from "./callVideo";

test("video bridge frame preserves VP8 and rejects malformed headers and size", () => {
  const frame = {
    data: new Uint8Array([0x30, 0, 0, 0x9d, 1, 0x2a, 0x80, 2, 0x68, 1, 0, 0]),
    key: true,
    timestamp: 9000,
    rotation: 0,
  };
  const packet = encodeCallVideoFrame(frame);
  expect([...packet.slice(0, 8)]).toEqual([1, 1, 0, 0, 0, 0, 35, 40]);
  expect(decodeCallVideoFrame(packet)).toEqual(frame);
  for (const invalid of [
    packet.slice(0, 8),
    new Uint8Array(1048585),
    new Uint8Array([...packet].map((b, i) => (i === 0 ? 2 : b))),
  ]) {
    expect(() => decodeCallVideoFrame(invalid)).toThrow();
  }
  expect(() => encodeCallVideoFrame({ ...frame, timestamp: Number.NaN })).toThrow();
});

test("group video bridge carries a validated participant MID without changing direct frames", () => {
  const frame = {
    data: new Uint8Array([1]),
    key: true,
    timestamp: 9,
    rotation: 0,
    sourceMid: `u${"1".repeat(32)}`,
  };
  const packet = encodeCallVideoFrame(frame);
  expect(packet[0]).toBe(2);
  expect(packet.length).toBe(42);
  expect(decodeCallVideoFrame(packet)).toEqual(frame);
  for (const sourceMid of ["", "u-peer", `c${"1".repeat(32)}`, `u${"z".repeat(32)}`]) {
    expect(() => encodeCallVideoFrame({ ...frame, sourceMid })).toThrow();
  }
  packet[8] = 99;
  expect(() => decodeCallVideoFrame(packet)).toThrow();
  expect(() => decodeCallVideoFrame(packet.slice(0, 41))).toThrow();
});
