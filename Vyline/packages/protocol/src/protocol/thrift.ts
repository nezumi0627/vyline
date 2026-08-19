/**
 * Thrift Binary / Compact Protocol — 自前実装
 *
 * LINE の Legy API は Apache Thrift の2種のワイヤフォーマットを使う:
 *   - protocolType 3: TBinaryProtocol (旧: /api/v3/TalkService.do, /api/v3p/rs)
 *   - protocolType 4: TCompactProtocol (現行: /S4, /V4 など)
 *
 * どちらも公開仕様 (Apache Thrift) のバイナリフォーマットであり、
 * LINE 固有のものではない。フィールドはネストした配列 [type, fieldId, value]
 * で表現し、既存の patchLogin.ts / patchTransport.ts で使われている形式と
 * 揃えてある (そのまま置き換えて使える)。
 */

// ── Thrift TType ────────────────────────────────────────────
export const TType = {
  STOP: 0,
  BOOL: 2,
  BYTE: 3,
  DOUBLE: 4,
  I16: 6,
  I32: 8,
  I64: 10,
  STRING: 11,
  STRUCT: 12,
  MAP: 13,
  SET: 14,
  LIST: 15,
} as const;
export type TTypeValue = (typeof TType)[keyof typeof TType];

export interface ThriftList {
  type: number;
  values: ThriftValue[];
}
export interface ThriftMap {
  keyType: number;
  valType: number;
  entries: Array<[ThriftValue, ThriftValue]>;
}
export type ThriftField = [number, number, ThriftValue];
export type ThriftValue =
  | boolean
  | number
  | bigint
  | string
  | Buffer
  | ThriftField[]
  | ThriftList
  | ThriftMap
  | null
  | undefined;

export interface DecodedStruct {
  [fieldId: number]: DecodedValue;
}
export type DecodedValue =
  | boolean
  | number
  | bigint
  | Buffer
  | DecodedStruct
  | DecodedValue[]
  | Map<DecodedValue, DecodedValue>
  | null;

// ── 書き込みバッファ (可変長) ──────────────────────────────
class GrowableWriter {
  private chunks: Buffer[] = [];
  private len = 0;
  push(buf: Buffer): void {
    this.chunks.push(buf);
    this.len += buf.length;
  }
  byte(n: number): void {
    this.push(Buffer.from([n & 0xff]));
  }
  concat(): Buffer {
    return Buffer.concat(this.chunks, this.len);
  }
}

// ── 読み込みカーソル ────────────────────────────────────────
class Reader {
  constructor(
    public buf: Buffer,
    public pos = 0,
  ) {}
  byte(): number {
    return this.buf[this.pos++] as number;
  }
  bytes(n: number): Buffer {
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(b);
  }
  get remaining(): number {
    return this.buf.length - this.pos;
  }
}

function zigzag32(n: number): number {
  return (n << 1) ^ (n >> 31);
}
function unzigzag32(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}
function zigzag64(n: bigint): bigint {
  return (n << 1n) ^ (n >> 63n);
}
function unzigzag64(n: bigint): bigint {
  return (n >> 1n) ^ -(n & 1n);
}

function writeVarint32(w: GrowableWriter, value: number): void {
  let v = value >>> 0;
  const bytes: number[] = [];
  for (;;) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v);
      break;
    }
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  w.push(Buffer.from(bytes));
}
function readVarint32(r: Reader): number {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = r.byte();
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return result >>> 0;
}
function writeVarint64(w: GrowableWriter, value: bigint): void {
  let v = BigInt.asUintN(64, value);
  const bytes: number[] = [];
  for (;;) {
    if ((v & ~0x7fn) === 0n) {
      bytes.push(Number(v));
      break;
    }
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  w.push(Buffer.from(bytes));
}
function readVarint64(r: Reader): bigint {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    const b = r.byte();
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return BigInt.asIntN(64, result);
}

function bufOf(v: ThriftValue): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "string") return Buffer.from(v, "utf8");
  if (v == null) return Buffer.alloc(0);
  return Buffer.from(String(v), "utf8");
}

// ══════════════════════════════════════════════════════════
// Compact Protocol (protocolType 4)
// ══════════════════════════════════════════════════════════
const CT = {
  STOP: 0,
  BOOLEAN_TRUE: 1,
  BOOLEAN_FALSE: 2,
  BYTE: 3,
  I16: 4,
  I32: 5,
  I64: 6,
  DOUBLE: 7,
  BINARY: 8,
  LIST: 9,
  SET: 10,
  MAP: 11,
  STRUCT: 12,
} as const;

function ttypeToCompact(t: number, boolValue?: boolean): number {
  switch (t) {
    case TType.STOP:
      return CT.STOP;
    case TType.BOOL:
      return boolValue ? CT.BOOLEAN_TRUE : CT.BOOLEAN_FALSE;
    case TType.BYTE:
      return CT.BYTE;
    case TType.I16:
      return CT.I16;
    case TType.I32:
      return CT.I32;
    case TType.I64:
      return CT.I64;
    case TType.DOUBLE:
      return CT.DOUBLE;
    case TType.STRING:
      return CT.BINARY;
    case TType.STRUCT:
      return CT.STRUCT;
    case TType.MAP:
      return CT.MAP;
    case TType.SET:
      return CT.SET;
    case TType.LIST:
      return CT.LIST;
    default:
      throw new Error(`unknown TType ${t}`);
  }
}
function compactToTtype(c: number): number {
  switch (c) {
    case CT.STOP:
      return TType.STOP;
    case CT.BOOLEAN_TRUE:
    case CT.BOOLEAN_FALSE:
      return TType.BOOL;
    case CT.BYTE:
      return TType.BYTE;
    case CT.I16:
      return TType.I16;
    case CT.I32:
      return TType.I32;
    case CT.I64:
      return TType.I64;
    case CT.DOUBLE:
      return TType.DOUBLE;
    case CT.BINARY:
      return TType.STRING;
    case CT.STRUCT:
      return TType.STRUCT;
    case CT.MAP:
      return TType.MAP;
    case CT.SET:
      return TType.SET;
    case CT.LIST:
      return TType.LIST;
    default:
      throw new Error(`unknown compact type ${c}`);
  }
}

function writeCompactDouble(w: GrowableWriter, value: number): void {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value, 0);
  w.push(b);
}
function readCompactDouble(r: Reader): number {
  return r.bytes(8).readDoubleLE(0);
}

function writeCompactValue(w: GrowableWriter, type: number, value: ThriftValue): void {
  switch (type) {
    case TType.BOOL:
      w.byte(value ? CT.BOOLEAN_TRUE : CT.BOOLEAN_FALSE);
      break;
    case TType.BYTE:
      w.byte(Number(value) & 0xff);
      break;
    case TType.I16:
    case TType.I32:
      writeVarint32(w, zigzag32(Number(value)));
      break;
    case TType.I64:
      writeVarint64(
        w,
        zigzag64(typeof value === "bigint" ? value : BigInt(Math.trunc(Number(value)))),
      );
      break;
    case TType.DOUBLE:
      writeCompactDouble(w, Number(value));
      break;
    case TType.STRING: {
      const b = bufOf(value);
      writeVarint32(w, b.length);
      w.push(b);
      break;
    }
    case TType.STRUCT:
      writeCompactStruct(w, (value as ThriftField[]) ?? []);
      break;
    case TType.LIST:
    case TType.SET: {
      const list = value as ThriftList;
      writeCompactCollectionHeader(w, list.values.length, list.type);
      for (const v of list.values) writeCompactValue(w, list.type, v);
      break;
    }
    case TType.MAP: {
      const map = value as ThriftMap;
      if (map.entries.length === 0) {
        w.byte(0);
        break;
      }
      writeVarint32(w, map.entries.length);
      w.byte(((ttypeToCompact(map.keyType) << 4) | ttypeToCompact(map.valType)) & 0xff);
      for (const [k, v] of map.entries) {
        writeCompactValue(w, map.keyType, k);
        writeCompactValue(w, map.valType, v);
      }
      break;
    }
    default:
      throw new Error(`compact write: unsupported TType ${type}`);
  }
}

function writeCompactCollectionHeader(w: GrowableWriter, size: number, elemType: number): void {
  const ct = ttypeToCompact(elemType);
  if (size <= 14) {
    w.byte(((size << 4) | ct) & 0xff);
  } else {
    w.byte((0xf0 | ct) & 0xff);
    writeVarint32(w, size);
  }
}

function writeCompactStruct(w: GrowableWriter, fields: ThriftField[]): void {
  let lastId = 0;
  for (const [type, id, value] of fields) {
    if (value === undefined) continue;
    const isBool = type === TType.BOOL;
    const delta = id - lastId;
    const ct = ttypeToCompact(type, isBool ? Boolean(value) : undefined);
    if (delta > 0 && delta <= 15) {
      w.byte(((delta << 4) | ct) & 0xff);
    } else {
      w.byte(ct & 0xff);
      writeVarint32(w, zigzag32(id));
    }
    lastId = id;
    if (!isBool) writeCompactValue(w, type, value);
  }
  w.byte(CT.STOP);
}

export function encodeCompact(fields: ThriftField[]): Buffer {
  const w = new GrowableWriter();
  writeCompactStruct(w, fields);
  return w.concat();
}

function readCompactValue(r: Reader, type: number): DecodedValue {
  switch (type) {
    case TType.BOOL:
      // フィールド経路では呼ばれない (ヘッダのニブルで確定済み)。要素/値としてのみ。
      return r.byte() === CT.BOOLEAN_TRUE;
    case TType.BYTE:
      return r.byte();
    case TType.I16:
    case TType.I32:
      return unzigzag32(readVarint32(r));
    case TType.I64:
      return unzigzag64(readVarint64(r));
    case TType.DOUBLE:
      return readCompactDouble(r);
    case TType.STRING: {
      const len = readVarint32(r);
      return r.bytes(len);
    }
    case TType.STRUCT:
      return readCompactStruct(r);
    case TType.LIST:
    case TType.SET: {
      const header = r.byte();
      let size = (header >>> 4) & 0x0f;
      const ct = header & 0x0f;
      if (size === 15) size = readVarint32(r);
      const elemType = compactToTtype(ct);
      const values: DecodedValue[] = [];
      for (let i = 0; i < size; i++) values.push(readCompactValue(r, elemType));
      return values;
    }
    case TType.MAP: {
      const size = readVarint32(r);
      if (size === 0) return new Map();
      const kv = r.byte();
      const keyType = compactToTtype((kv >>> 4) & 0x0f);
      const valType = compactToTtype(kv & 0x0f);
      const map = new Map<DecodedValue, DecodedValue>();
      for (let i = 0; i < size; i++) {
        const k = readCompactValue(r, keyType);
        const v = readCompactValue(r, valType);
        map.set(k, v);
      }
      return map;
    }
    default:
      throw new Error(`compact read: unsupported TType ${type}`);
  }
}

function readCompactStruct(r: Reader): DecodedStruct {
  const out: DecodedStruct = {};
  let lastId = 0;
  for (;;) {
    if (r.remaining <= 0) break;
    const header = r.byte();
    if (header === CT.STOP) break;
    const delta = (header >>> 4) & 0x0f;
    const ct = header & 0x0f;
    const id = delta === 0 ? unzigzag32(readVarint32(r)) : lastId + delta;
    lastId = id;
    if (ct === CT.BOOLEAN_TRUE) {
      out[id] = true;
    } else if (ct === CT.BOOLEAN_FALSE) {
      out[id] = false;
    } else {
      out[id] = readCompactValue(r, compactToTtype(ct));
    }
  }
  return out;
}

export function decodeCompact(buf: Buffer): DecodedStruct {
  return readCompactStruct(new Reader(buf));
}

// ══════════════════════════════════════════════════════════
// Binary Protocol (protocolType 3)
// ══════════════════════════════════════════════════════════
function writeBinaryValue(w: GrowableWriter, type: number, value: ThriftValue): void {
  switch (type) {
    case TType.BOOL:
      w.byte(value ? 1 : 0);
      break;
    case TType.BYTE:
      w.byte(Number(value) & 0xff);
      break;
    case TType.I16: {
      const b = Buffer.alloc(2);
      b.writeInt16BE(Number(value), 0);
      w.push(b);
      break;
    }
    case TType.I32: {
      const b = Buffer.alloc(4);
      b.writeInt32BE(Number(value), 0);
      w.push(b);
      break;
    }
    case TType.I64: {
      const b = Buffer.alloc(8);
      b.writeBigInt64BE(typeof value === "bigint" ? value : BigInt(Math.trunc(Number(value))), 0);
      w.push(b);
      break;
    }
    case TType.DOUBLE: {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(Number(value), 0);
      w.push(b);
      break;
    }
    case TType.STRING: {
      const b = bufOf(value);
      const len = Buffer.alloc(4);
      len.writeInt32BE(b.length, 0);
      w.push(len);
      w.push(b);
      break;
    }
    case TType.STRUCT:
      writeBinaryStruct(w, (value as ThriftField[]) ?? []);
      break;
    case TType.LIST:
    case TType.SET: {
      const list = value as ThriftList;
      w.byte(list.type & 0xff);
      const sizeBuf = Buffer.alloc(4);
      sizeBuf.writeInt32BE(list.values.length, 0);
      w.push(sizeBuf);
      for (const v of list.values) writeBinaryValue(w, list.type, v);
      break;
    }
    case TType.MAP: {
      const map = value as ThriftMap;
      w.byte(map.keyType & 0xff);
      w.byte(map.valType & 0xff);
      const sizeBuf = Buffer.alloc(4);
      sizeBuf.writeInt32BE(map.entries.length, 0);
      w.push(sizeBuf);
      for (const [k, v] of map.entries) {
        writeBinaryValue(w, map.keyType, k);
        writeBinaryValue(w, map.valType, v);
      }
      break;
    }
    default:
      throw new Error(`binary write: unsupported TType ${type}`);
  }
}

function writeBinaryStruct(w: GrowableWriter, fields: ThriftField[]): void {
  for (const [type, id, value] of fields) {
    if (value === undefined) continue;
    w.byte(type & 0xff);
    const idBuf = Buffer.alloc(2);
    idBuf.writeInt16BE(id, 0);
    w.push(idBuf);
    writeBinaryValue(w, type, value);
  }
  w.byte(TType.STOP);
}

export function encodeBinary(fields: ThriftField[]): Buffer {
  const w = new GrowableWriter();
  writeBinaryStruct(w, fields);
  return w.concat();
}

function readBinaryValue(r: Reader, type: number): DecodedValue {
  switch (type) {
    case TType.BOOL:
      return r.byte() !== 0;
    case TType.BYTE:
      return r.byte();
    case TType.I16:
      return r.bytes(2).readInt16BE(0);
    case TType.I32:
      return r.bytes(4).readInt32BE(0);
    case TType.I64:
      return r.bytes(8).readBigInt64BE(0);
    case TType.DOUBLE:
      return r.bytes(8).readDoubleBE(0);
    case TType.STRING: {
      const len = r.bytes(4).readInt32BE(0);
      return r.bytes(len);
    }
    case TType.STRUCT:
      return readBinaryStruct(r);
    case TType.LIST:
    case TType.SET: {
      const elemType = r.byte();
      const size = r.bytes(4).readInt32BE(0);
      const values: DecodedValue[] = [];
      for (let i = 0; i < size; i++) values.push(readBinaryValue(r, elemType));
      return values;
    }
    case TType.MAP: {
      const keyType = r.byte();
      const valType = r.byte();
      const size = r.bytes(4).readInt32BE(0);
      const map = new Map<DecodedValue, DecodedValue>();
      for (let i = 0; i < size; i++) {
        const k = readBinaryValue(r, keyType);
        const v = readBinaryValue(r, valType);
        map.set(k, v);
      }
      return map;
    }
    default:
      throw new Error(`binary read: unsupported TType ${type}`);
  }
}

function readBinaryStruct(r: Reader): DecodedStruct {
  const out: DecodedStruct = {};
  for (;;) {
    if (r.remaining <= 0) break;
    const type = r.byte();
    if (type === TType.STOP) break;
    const id = r.bytes(2).readInt16BE(0);
    out[id] = readBinaryValue(r, type);
  }
  return out;
}

export function decodeBinary(buf: Buffer): DecodedStruct {
  return readBinaryStruct(new Reader(buf));
}

// ── protocolType 切り替えヘルパー ──────────────────────────
export function encodeThrift(fields: ThriftField[], protocolType: number): Buffer {
  return protocolType === 3 ? encodeBinary(fields) : encodeCompact(fields);
}
export function decodeThrift(buf: Buffer, protocolType: number): DecodedStruct {
  return protocolType === 3 ? decodeBinary(buf) : decodeCompact(buf);
}

// ── decode 結果を JS で扱いやすい形に変換するユーティリティ ──
export function structField<T = DecodedValue>(
  s: DecodedStruct | undefined,
  id: number,
): T | undefined {
  return s?.[id] as T | undefined;
}
export function bufToStr(v: DecodedValue | undefined): string | undefined {
  if (v == null) return undefined;
  return Buffer.isBuffer(v) ? v.toString("utf8") : String(v);
}
