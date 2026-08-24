export interface BplistValue {
  $version?: number;
  $objects?: unknown[];
  $top?: { root: number };
  [key: string]: unknown;
}

export function parseBplist(data: Uint8Array): unknown {
  if (data.length < 40) throw new Error("Invalid bplist: too short");
  const header = new TextDecoder().decode(data.slice(0, 8));
  if (!header.startsWith("bplist")) throw new Error("Not a binary plist");

  const trailerOffset = data.length - 32;
  const offsetSize = data[trailerOffset + 6] ?? 0;
  const objectRefSize = data[trailerOffset + 7] ?? 0;
  const numObjects = readUIntBE(data, trailerOffset + 8, 8);
  const topObject = readUIntBE(data, trailerOffset + 16, 8);
  const offsetTableOffset = readUIntBE(data, trailerOffset + 24, 8);

  if (!offsetSize || !objectRefSize || !numObjects) throw new Error("Invalid bplist trailer");
  if (numObjects > Number.MAX_SAFE_INTEGER || topObject >= numObjects) {
    throw new Error("Invalid bplist object table");
  }

  const offsets = new Array<number>(numObjects);
  for (let i = 0; i < numObjects; i++) {
    const off = offsetTableOffset + i * offsetSize;
    offsets[i] = readUIntBE(data, off, offsetSize);
  }

  const objects: unknown[] = new Array(numObjects);
  const resolving = new Set<number>();
  const resolve = (ref: number): unknown => {
    if (!Number.isInteger(ref) || ref < 0 || ref >= numObjects) {
      throw new Error(`Invalid bplist object reference: ${ref}`);
    }
    if (objects[ref] !== undefined) return objects[ref];
    if (resolving.has(ref)) throw new Error(`Cyclic bplist object reference: ${ref}`);
    const objectOffset = offsets[ref];
    if (objectOffset === undefined) throw new Error(`Missing object offset: ${ref}`);
    resolving.add(ref);
    const value = parseBplistObject(data, objectOffset, objectRefSize, resolve);
    resolving.delete(ref);
    objects[ref] = value;
    return value;
  };

  return resolve(topObject);
}

function readUIntBE(buf: Uint8Array, offset: number, size: number): number {
  if (size < 1 || size > 8 || offset < 0 || offset + size > buf.length) {
    throw new Error("Invalid bplist integer");
  }
  let result = 0;
  for (let i = 0; i < size; i++) {
    result = result * 256 + (buf[offset + i] ?? 0);
  }
  if (!Number.isSafeInteger(result)) throw new Error("Unsupported bplist integer size");
  return result;
}

function parseBplistObject(
  data: Uint8Array,
  offset: number,
  objectRefSize: number,
  resolve: (ref: number) => unknown,
): unknown {
  const marker = data[offset];
  if (marker === undefined) throw new Error(`Missing bplist marker at offset ${offset}`);
  const type = marker & 0xf0;
  const info = marker & 0x0f;

  switch (type) {
    case 0x00: // null / false / true / fill
      if (marker === 0x08) return false;
      if (marker === 0x09) return true;
      return null;
    case 0x10: // int
      return readInt(data, offset + 1, 1 << info);
    case 0x20: // real
      return readFloat(data, offset + 1, 1 << info);
    case 0x30: // date
      return readDate(data, offset + 1, info);
    case 0x40: // data
      return readData(data, offset, info);
    case 0x50: // ascii string
      return readAsciiString(data, offset, info);
    case 0x60: // unicode string (utf-16be)
      return readUnicodeString(data, offset, info);
    case 0x80: // uid
      return readInt(data, offset + 1, info + 1);
    case 0xa0: // array
    case 0xb0: // ordered set
    case 0xc0: // set
      return readArray(data, offset, info, objectRefSize, resolve);
    case 0xd0: // dict
      return readDict(data, offset, info, objectRefSize, resolve);
    default:
      throw new Error(`Unknown bplist type: 0x${type.toString(16)} at offset ${offset}`);
  }
}

function readInt(data: Uint8Array, offset: number, size: number): number {
  return readUIntBE(data, offset, size);
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

function readDate(data: Uint8Array, offset: number, info: number): Date {
  if (info !== 3) throw new Error(`Date must be 8 bytes (marker info=${info})`);
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  const timestamp = view.getFloat64(0, false);
  const APPLE_2001_EPOCH = 978307200;
  return new Date((timestamp + APPLE_2001_EPOCH) * 1000);
}

interface BplistCount {
  count: number;
  payloadOffset: number;
}

function readCount(data: Uint8Array, offset: number, info: number): BplistCount {
  if (info < 0x0f) return { count: info, payloadOffset: offset + 1 };
  const marker = data[offset + 1];
  if (marker === undefined || (marker & 0xf0) !== 0x10) {
    throw new Error("Invalid extended bplist count");
  }
  const integerSize = 1 << (marker & 0x0f);
  return {
    count: readUIntBE(data, offset + 2, integerSize),
    payloadOffset: offset + 2 + integerSize,
  };
}

function readData(data: Uint8Array, offset: number, info: number): Uint8Array {
  const { count, payloadOffset } = readCount(data, offset, info);
  return data.slice(payloadOffset, payloadOffset + count);
}

function readAsciiString(data: Uint8Array, offset: number, info: number): string {
  const { count, payloadOffset } = readCount(data, offset, info);
  return Buffer.from(data.slice(payloadOffset, payloadOffset + count)).toString("ascii");
}

function readUnicodeString(data: Uint8Array, offset: number, info: number): string {
  const { count, payloadOffset } = readCount(data, offset, info);
  const bytes = data.slice(payloadOffset, payloadOffset + count * 2);
  return Buffer.from(bytes).swap16().toString("utf16le");
}

function readArray(
  data: Uint8Array,
  offset: number,
  info: number,
  objectRefSize: number,
  resolve: (ref: number) => unknown,
): unknown[] {
  const { count, payloadOffset } = readCount(data, offset, info);
  const result: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const ref = readUIntBE(data, payloadOffset + i * objectRefSize, objectRefSize);
    result.push(resolve(ref));
  }
  return result;
}

function readDict(
  data: Uint8Array,
  offset: number,
  info: number,
  objectRefSize: number,
  resolve: (ref: number) => unknown,
): Record<string, unknown> {
  const { count, payloadOffset } = readCount(data, offset, info);
  const result: Record<string, unknown> = {};
  const valuesOffset = payloadOffset + count * objectRefSize;
  for (let i = 0; i < count; i++) {
    const keyRef = readUIntBE(data, payloadOffset + i * objectRefSize, objectRefSize);
    const valueRef = readUIntBE(data, valuesOffset + i * objectRefSize, objectRefSize);
    const key = resolve(keyRef);
    if (typeof key !== "string") throw new Error("Invalid bplist dictionary key");
    result[key] = resolve(valueRef);
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
