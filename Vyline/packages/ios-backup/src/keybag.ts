import { createDecipheriv } from "node:crypto";

export interface ClassKey {
  uuid: Uint8Array;
  clas: Uint8Array;
  wrap: number;
  wpky: Uint8Array;
  ktyp: Uint8Array;
  pbky: Uint8Array;
  key?: Uint8Array;
}

export interface ParsedKeybag {
  type: number;
  uuid: Uint8Array;
  wrap: number;
  classKeys: Map<number, ClassKey>;
  attrs: Map<string, Uint8Array>;
}

const CLASSKEY_TAGS = [
  Buffer.from("CLAS"),
  Buffer.from("WRAP"),
  Buffer.from("WPKY"),
  Buffer.from("KTYP"),
  Buffer.from("PBKY"),
];

const WRAP_PASSCODE = 2;

function readUInt32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) << 24) |
    ((buf[offset + 1] ?? 0) << 16) |
    ((buf[offset + 2] ?? 0) << 8) |
    (buf[offset + 3] ?? 0)
  );
}

export function* loopTLVBlocks(blob: Uint8Array): Generator<[Uint8Array, Uint8Array]> {
  let i = 0;
  while (i + 8 <= blob.length) {
    const tag = blob.slice(i, i + 4);
    const length = readUInt32BE(blob, i + 4);
    const data = blob.slice(i + 8, i + 8 + length);
    yield [tag, data];
    i += 8 + length;
  }
}

export function parseKeybag(backupKeyBag: Uint8Array): ParsedKeybag {
  const result: ParsedKeybag = {
    type: 0,
    uuid: new Uint8Array(0),
    wrap: 0,
    classKeys: new Map(),
    attrs: new Map(),
  };

  let currentClassKey: Partial<ClassKey> | null = null;

  for (const [tag, data] of loopTLVBlocks(backupKeyBag)) {
    const tagStr = Buffer.from(tag).toString("ascii");

    if (currentClassKey && CLASSKEY_TAGS.some((t) => t.equals(tag))) {
      if (tagStr === "CLAS") currentClassKey.clas = data;
      else if (tagStr === "WRAP") currentClassKey.wrap = readUInt32BE(data, 0);
      else {
        const key = tagStr.toLowerCase();
        (currentClassKey as Record<string, Uint8Array>)[key] = data;
      }
      continue;
    }

    if (data.length === 4) {
      const value = readUInt32BE(data, 0);

      if (tagStr === "TYPE") {
        result.type = value;
        if (value > 3) {
          throw new Error(`Keybag type > 3: ${value}`);
        }
      } else if (tagStr === "WRAP" && result.wrap === 0) {
        result.wrap = value;
      } else if (tagStr === "UUID" && result.uuid.length === 0) {
        result.uuid = data;
      } else {
        result.attrs.set(tagStr, data);
      }
      continue;
    }

    if (tagStr === "UUID") {
      if (!currentClassKey && result.uuid.length === 0) {
        result.uuid = data;
        continue;
      }
      if (currentClassKey) {
        const clas = currentClassKey.clas;
        if (!clas) throw new Error("Class key is missing CLAS");
        result.classKeys.set(readUInt32BE(clas, 0), currentClassKey as ClassKey);
      }
      currentClassKey = { uuid: data };
    } else {
      result.attrs.set(tagStr, data);
    }
  }

  if (currentClassKey) {
    const clas = currentClassKey.clas;
    if (!clas) throw new Error("Class key is missing CLAS");
    result.classKeys.set(readUInt32BE(clas, 0), currentClassKey as ClassKey);
  }

  return result;
}

function unpack64bit(s: Uint8Array): bigint {
  if (s.length !== 8) throw new Error("Invalid 64-bit input");
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result = (result << 8n) | BigInt(s[i] ?? 0);
  }
  return result;
}

function pack64bit(n: bigint): Uint8Array {
  const result = new Uint8Array(8);
  let value = n;
  for (let i = 7; i >= 0; i--) {
    result[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return result;
}

export function aesUnwrap(kek: Uint8Array, wrapped: Uint8Array): Uint8Array | null {
  if (wrapped.length % 8 !== 0) throw new Error("Wrapped data length must be multiple of 8");
  if (kek.length !== 16 && kek.length !== 24 && kek.length !== 32) {
    throw new Error("KEK must be 16, 24, or 32 bytes");
  }

  const n = wrapped.length / 8 - 1;
  const C: bigint[] = [];
  for (let i = 0; i <= n; i++) {
    C.push(unpack64bit(wrapped.slice(i * 8, i * 8 + 8)));
  }

  const R: bigint[] = new Array(n + 1).fill(0n);
  let A = C[0];
  if (A === undefined) throw new Error("Wrapped data is empty");
  for (let i = 1; i <= n; i++) {
    const block = C[i];
    if (block === undefined) throw new Error("Invalid wrapped data");
    R[i] = block;
  }

  const cipher = (block: Uint8Array) => {
    const decipher = createDecipheriv("aes-256-ecb", kek, "");
    decipher.setAutoPadding(false);
    return decipher.update(block);
  };

  for (let j = 5; j >= 0; j--) {
    for (let i = n; i >= 1; i--) {
      const toDec = new Uint8Array(16);
      const aXor = A ^ BigInt(n * j + i);
      toDec.set(pack64bit(aXor), 0);
      const block = R[i];
      if (block === undefined) throw new Error("Invalid unwrap state");
      toDec.set(pack64bit(block), 8);

      const B = cipher(toDec);
      A = unpack64bit(B.slice(0, 8));
      R[i] = unpack64bit(B.slice(8, 16));
    }
  }

  if (A !== 0xa6a6a6a6a6a6a6a6n) {
    return null;
  }

  const result = new Uint8Array(n * 8);
  for (let i = 1; i <= n; i++) {
    const block = R[i];
    if (block === undefined) throw new Error("Invalid unwrap result");
    result.set(pack64bit(block), (i - 1) * 8);
  }
  return result;
}

export function unwrapKeyForClass(
  classKeys: Map<number, ClassKey>,
  protectionClass: number,
  persistentKey: Uint8Array,
): Uint8Array {
  if (persistentKey.length !== 0x28) {
    throw new Error("Invalid key length");
  }

  const classKey = classKeys.get(protectionClass);
  if (!classKey || !classKey.key) {
    throw new Error(`No key for protection class ${protectionClass}`);
  }

  const unwrapped = aesUnwrap(classKey.key, persistentKey);
  if (!unwrapped) {
    throw new Error("AES unwrap failed - wrong password?");
  }
  return unwrapped;
}

export function unlockClassKeys(classKeys: Map<number, ClassKey>, decryptionKey: Uint8Array): void {
  for (const classKey of classKeys.values()) {
    if (!classKey.wpky) continue;
    if ((classKey.wrap & WRAP_PASSCODE) !== 0) {
      const unwrapped = aesUnwrap(decryptionKey, classKey.wpky);
      if (!unwrapped) {
        throw new Error("Failed to decrypt backup keybag - wrong password?");
      }
      classKey.key = unwrapped;
    }
  }
}
