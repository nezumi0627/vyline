import { createHash } from "node:crypto";

export interface BplistValue {
  $version?: number;
  $objects?: unknown[];
  $top?: { root: number };
  [key: string]: unknown;
}

export function parseBplist(data: Uint8Array): unknown {
  if (data.length < 8) throw new Error("Invalid bplist: too short");
  const header = new TextDecoder().decode(data.slice(0, 8));
  if (!header.startsWith("bplist")) throw new Error("Not a binary plist");

  const trailerOffset = data.length - 32;
  const trailer = data.slice(trailerOffset);
  const offsetSize = trailer[6] ?? 1;
  const objectRefSize = trailer[7] ?? 1;
  const numObjects = readUInt64BE(trailer, 8);
  const topObject = readUInt64BE(trailer, 16);
  const offsetTableOffset = readUInt64BE(trailer, 24);

  const offsets = new Array<number>(numObjects);
  for (let i = 0; i < numObjects; i++) {
    const off = offsetTableOffset + i * offsetSize;
    offsets[i] = readUIntBE(data, off, offsetSize);
  }

  const objects: unknown[] = new Array(numObjects);
  for (let i = 0; i < numObjects; i++) {
    const objectOffset = offsets[i];
    if (objectOffset === undefined) throw new Error(`Missing object offset: ${i}`);
    objects[i] = parseBplistObject(data, objectOffset, offsets, objectRefSize, objects);
  }

  return objects[topObject];
}

function readUInt64BE(buf: Uint8Array, offset: number): number {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result = result * 256 + (buf[offset + i] ?? 0);
  }
  return result;
}

function readUIntBE(buf: Uint8Array, offset: number, size: number): number {
  let result = 0;
  for (let i = 0; i < size; i++) {
    result = result * 256 + (buf[offset + i] ?? 0);
  }
  return result;
}

function parseBplistObject(
  data: Uint8Array,
  offset: number,
  offsets: number[],
  objectRefSize: number,
  objects: unknown[],
): unknown {
  const marker = data[offset];
  if (marker === undefined) throw new Error(`Missing bplist marker at offset ${offset}`);
  const type = marker & 0xf0;
  const info = marker & 0x0f;

  switch (type) {
    case 0x00: // null / fill
      return null;
    case 0x10: // bool
      return info === 0x09;
    case 0x20: // fill
      return null;
    case 0x30: // int
      return readInt(data, offset + 1, 1 << info);
    case 0x40: // real
      return readFloat(data, offset + 1, 1 << info);
    case 0x50: // date
      return readDate(data, offset + 1, 1 << info);
    case 0x60: // data
      return readData(data, offset, info, offsets, objectRefSize, objects);
    case 0x70: // ascii string
      return readAsciiString(data, offset, info, offsets, objectRefSize, objects);
    case 0x80: // unicode string (utf-16be)
      return readUnicodeString(data, offset, info, offsets, objectRefSize, objects);
    case 0x90: // uid
      return readInt(data, offset + 1, 1 << info);
    case 0xa0: // array
      return readArray(data, offset, info, offsets, objectRefSize, objects);
    case 0xc0: // dict
      return readDict(data, offset, info, offsets, objectRefSize, objects);
    case 0xd0: // set (treat as array)
      return readArray(data, offset, info, offsets, objectRefSize, objects);
    default:
      throw new Error(`Unknown bplist type: 0x${type.toString(16)} at offset ${offset}`);
  }
}

function readInt(data: Uint8Array, offset: number, size: number): number {
  let result = 0;
  for (let i = 0; i < size; i++) {
    result = (result << 8) | (data[offset + i] ?? 0);
  }
  return result;
}

function readFloat(data: Uint8Array, offset: number, size: number): number {
  if (size === 4) {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return view.getFloat32(0, false);
  }
  if (size === 8) {
    const view = new DataView(data.buffer, data.byteOffset + offset, 8);
    return view.getFloat64(0, false);
  }
  throw new Error(`Unsupported float size: ${size}`);
}

function readDate(data: Uint8Array, offset: number, size: number): Date {
  if (size !== 8) {
    throw new Error(
      `Date must be 8 bytes (offset=${offset - 1}, marker=0x${(data[offset - 1] ?? 0).toString(16)})`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  const timestamp = view.getFloat64(0, false);
  const APPLE_2001_EPOCH = 978307200;
  return new Date((timestamp + APPLE_2001_EPOCH) * 1000);
}

function readData(
  data: Uint8Array,
  offset: number,
  info: number,
  offsets: number[],
  objectRefSize: number,
  objects: unknown[],
): Uint8Array {
  let length: number;
  let dataOffset: number;
  if (info < 0x0f) {
    length = info;
    dataOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    length = parseBplistObject(data, intOffset, offsets, objectRefSize, objects) as number;
    dataOffset =
      intOffset + (objectRefSize === 1 ? 1 : objectRefSize === 2 ? 2 : objectRefSize === 4 ? 4 : 8);
  }
  return data.slice(dataOffset, dataOffset + length);
}

function readAsciiString(
  data: Uint8Array,
  offset: number,
  info: number,
  offsets: number[],
  objectRefSize: number,
  objects: unknown[],
): string {
  let length: number;
  let dataOffset: number;
  if (info < 0x0f) {
    length = info;
    dataOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    length = parseBplistObject(data, intOffset, offsets, objectRefSize, objects) as number;
    dataOffset =
      intOffset + (objectRefSize === 1 ? 1 : objectRefSize === 2 ? 2 : objectRefSize === 4 ? 4 : 8);
  }
  return Buffer.from(data.slice(dataOffset, dataOffset + length)).toString("ascii");
}

function readUnicodeString(
  data: Uint8Array,
  offset: number,
  info: number,
  offsets: number[],
  objectRefSize: number,
  objects: unknown[],
): string {
  let length: number;
  let dataOffset: number;
  if (info < 0x0f) {
    length = info;
    dataOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    length = parseBplistObject(data, intOffset, offsets, objectRefSize, objects) as number;
    dataOffset =
      intOffset + (objectRefSize === 1 ? 1 : objectRefSize === 2 ? 2 : objectRefSize === 4 ? 4 : 8);
  }
  const bytes = data.slice(dataOffset, dataOffset + length * 2);
  return Buffer.from(bytes).swap16().toString("utf16le");
}

function readArray(
  data: Uint8Array,
  offset: number,
  info: number,
  offsets: number[],
  objectRefSize: number,
  objects: unknown[],
): unknown[] {
  let count: number;
  let refOffset: number;
  if (info < 0x0f) {
    count = info;
    refOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    count = parseBplistObject(data, intOffset, offsets, objectRefSize, objects) as number;
    refOffset =
      intOffset + (objectRefSize === 1 ? 1 : objectRefSize === 2 ? 2 : objectRefSize === 4 ? 4 : 8);
  }
  const result: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const ref = readUIntBE(data, refOffset + i * objectRefSize, objectRefSize);
    result.push(objects[ref]);
  }
  return result;
}

function readDict(
  data: Uint8Array,
  offset: number,
  info: number,
  offsets: number[],
  objectRefSize: number,
  objects: unknown[],
): Record<string, unknown> {
  let count: number;
  let refOffset: number;
  if (info < 0x0f) {
    count = info;
    refOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    count = parseBplistObject(data, intOffset, offsets, objectRefSize, objects) as number;
    refOffset =
      intOffset + (objectRefSize === 1 ? 1 : objectRefSize === 2 ? 2 : objectRefSize === 4 ? 4 : 8);
  }
  const result: Record<string, unknown> = {};
  const keyRefs: number[] = [];
  const valueRefs: number[] = [];
  for (let i = 0; i < count; i++) {
    keyRefs.push(readUIntBE(data, refOffset + i * objectRefSize, objectRefSize));
  }
  for (let i = 0; i < count; i++) {
    valueRefs.push(
      readUIntBE(data, refOffset + count * objectRefSize + i * objectRefSize, objectRefSize),
    );
  }
  for (let i = 0; i < count; i++) {
    const keyRef = keyRefs[i];
    const valueRef = valueRefs[i];
    if (keyRef === undefined || valueRef === undefined) throw new Error("Invalid dict reference");
    const key = objects[keyRef] as string;
    result[key] = objects[valueRef];
  }
  return result;
}

export function bplistToJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof Uint8Array) return { _b64: Buffer.from(obj).toString("base64") };
  if (Array.isArray(obj)) return obj.map(bplistToJson);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = bplistToJson(v);
    }
    return result;
  }
  return String(obj);
}

export function parseContentMetadata(data: Uint8Array): unknown {
  try {
    const parsed = parseBplist(data);
    return bplistToJson(parsed);
  } catch (e) {
    return { _b64: Buffer.from(data).toString("base64"), _error: String(e) };
  }
}
