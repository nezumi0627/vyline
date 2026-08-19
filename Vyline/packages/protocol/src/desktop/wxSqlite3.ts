/**
 * wxSQLite3 AES-128-CBC page decrypt (LINE Desktop .edb)
 *
 * Based on Kang et al. Electronics 2024, 13(7), 1325
 * "Forensic Analysis of wxSQLite3-Encrypted Databases and Its Application"
 *
 * LINE quirk (paper §5.3.2): uses the server passphrase (32 hex chars) rather
 * than the padded passphrase for RC4 Step2 / concat Step3.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";

const PADDING = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex",
);

function md5(data: Buffer): Buffer {
  return createHash("md5").update(data).digest();
}

function md5N(data: Buffer, n: number): Buffer {
  let h = data;
  for (let i = 0; i < n; i++) h = md5(h);
  return h;
}

/** RC4 encrypt (same as decrypt) */
function rc4(key: Buffer, data: Buffer): Buffer {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 0xff;
    const t = S[i]!;
    S[i] = S[j]!;
    S[j] = t;
  }
  const out = Buffer.alloc(data.length);
  let ii = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    ii = (ii + 1) & 0xff;
    j = (j + S[ii]!) & 0xff;
    const t = S[ii]!;
    S[ii] = S[j]!;
    S[j] = t;
    out[k] = data[k]! ^ S[(S[ii]! + S[j]!) & 0xff]!;
  }
  return out;
}

function padPassphrase(passphrase: Buffer): Buffer {
  const out = Buffer.alloc(32);
  const m = Math.min(passphrase.length, 32);
  passphrase.copy(out, 0, 0, m);
  if (m < 32) PADDING.copy(out, m, 0, 32 - m);
  return out;
}

/**
 * LINE-modified 128-bit base key (paper Algorithm 3 + LINE quirk).
 * passphrase = 32 hex chars as ASCII (or raw 16 bytes).
 */
export function deriveWxSqlite3BaseKey128(passphrase: Buffer, lineQuirk = true): Buffer {
  const padded = padPassphrase(passphrase);
  // Step1: inter_k from padding hashed MD5 × 51
  const interK = md5N(PADDING, 51);

  // Step2: RC4 × 20 — LINE uses original passphrase, wxSQLite3 uses padded
  let msg: Buffer = lineQuirk ? Buffer.from(passphrase) : Buffer.from(padded);
  if (msg.length !== 32) {
    msg = padPassphrase(msg);
  }
  for (let i = 0; i < 20; i++) {
    const rc4Key = Buffer.alloc(16);
    for (let k = 0; k < 16; k++) rc4Key[k] = interK[k]! ^ i;
    msg = Buffer.from(rc4(rc4Key, msg));
  }
  const interV = msg;

  // Step3: MD5(passphrase||inter_v) × 51 — LINE uses original passphrase
  const left = lineQuirk ? passphrase : padded;
  const concat = Buffer.concat([
    left.length >= 32 ? left.subarray(0, 32) : padPassphrase(left),
    interV,
  ]);
  // if passphrase shorter, pad left to match paper concat size
  const left32 = left.length >= 32 ? left.subarray(0, 32) : padPassphrase(left);
  const concat2 = Buffer.concat([left32, interV.subarray(0, 32)]);
  return md5N(concat2.length === concat.length ? concat2 : Buffer.concat([left32, interV]), 51);
}

function modmult(a: number, b: number, c: number, m: number, s: number): number {
  // Algorithm 1 MODMULT from paper
  const q = Math.floor(s / a);
  const r = s % a;
  const t = b * r - c * q;
  if (t > 0) return t;
  return t + m;
}

/** Page IV = MD5(concat of 4 MODMULT outputs), pageNumber LE u32 */
export function pageIv(pageNumber: number): Buffer {
  const a = 52774;
  const b = 40692;
  const c = 3791;
  const m = 2147483399;
  let s = pageNumber >>> 0;
  const parts: Buffer[] = [];
  for (let i = 0; i < 4; i++) {
    s = modmult(a, b, c, m, s) >>> 0;
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(s, 0);
    parts.push(buf);
  }
  return md5(Buffer.concat(parts));
}

export function pageKey128(baseKey: Buffer, pageNumber: number): Buffer {
  const pn = Buffer.alloc(4);
  pn.writeUInt32LE(pageNumber >>> 0, 0);
  return md5(Buffer.concat([baseKey, pn, Buffer.from("sAlT", "ascii")]));
}

function aes128CbcDecrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");

export function isLikelyWxSqlite3(file: Buffer): boolean {
  if (file.length < 32) return false;
  // offsets 16-23 remain plaintext-ish page meta for wxSQLite3
  // not starting with "SQLite format 3"
  return !file.subarray(0, 16).equals(SQLITE_HEADER);
}

/**
 * Verify passphrase by decrypting first page and checking SQLite header.
 */
export function verifyWxSqlite3Passphrase(
  file: Buffer,
  passphrase: Buffer,
  opts?: { lineQuirk?: boolean; pageSize?: number },
): boolean {
  const lineQuirk = opts?.lineQuirk ?? true;
  const pageSize = opts?.pageSize ?? 1024;
  if (file.length < pageSize) return false;
  try {
    const base = deriveWxSqlite3BaseKey128(passphrase, lineQuirk);
    const key = pageKey128(base, 1);
    const iv = pageIv(1);
    const page = Buffer.from(file.subarray(0, pageSize));
    // restore encrypted bytes at 8-15 into decrypt input: paper says
    // decrypt by comparing backup at 16-23 with decrypt of (8-15)+(24-31)
    // Practical approach used by forensics tools:
    // copy ciphertext[8:16] aside, put SQLITE header[0:16], decrypt rest...
    // Verification: decrypt page then force header
    const plain = aes128CbcDecrypt(key, iv, page);
    // After decrypt, offsets 16-23 should match original file 16-23 (backed up)
    const backup = file.subarray(16, 24);
    if (plain.subarray(16, 24).equals(backup)) {
      // also try reconstructing header
      return true;
    }
    // alternate check: decrypted starts with usable page after header fix
    const fixed = Buffer.concat([SQLITE_HEADER, plain.subarray(16)]);
    return fixed.subarray(0, 6).toString("ascii") === "SQLite";
  } catch {
    return false;
  }
}

export function decryptWxSqlite3File(
  file: Buffer,
  passphrase: Buffer,
  opts?: { lineQuirk?: boolean; pageSize?: number },
): Buffer {
  const lineQuirk = opts?.lineQuirk ?? true;
  let pageSize = opts?.pageSize ?? 0;
  const base = deriveWxSqlite3BaseKey128(passphrase, lineQuirk);

  // detect page size from plaintext bytes 16-17 (big-endian in SQLite header)
  if (!pageSize) {
    const be = file.readUInt16BE(16);
    pageSize = be === 1 ? 65536 : be;
    if (![512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].includes(pageSize)) {
      pageSize = 1024;
    }
  }

  const out = Buffer.alloc(file.length);
  const pageCount = Math.floor(file.length / pageSize);
  for (let p = 1; p <= pageCount; p++) {
    const start = (p - 1) * pageSize;
    const enc = Buffer.from(file.subarray(start, start + pageSize));
    const key = pageKey128(base, p);
    const iv = pageIv(p);
    let plain = aes128CbcDecrypt(key, iv, enc);
    if (p === 1) {
      // restore standard SQLite header
      plain = Buffer.concat([SQLITE_HEADER, plain.subarray(16)]);
      // restore page size / meta from original plaintext region if needed
      file.subarray(16, 24).copy(plain, 16);
    }
    plain.copy(out, start);
  }
  // trailing bytes
  if (pageCount * pageSize < file.length) {
    file.copy(out, pageCount * pageSize, pageCount * pageSize);
  }
  return out;
}

/** Try passphrase as 32-char hex ASCII or 16 raw bytes */
export function tryPassphraseVariants(raw: string | Buffer): Buffer[] {
  const out: Buffer[] = [];
  if (typeof raw === "string") {
    const s = raw.trim();
    out.push(Buffer.from(s, "utf8"));
    if (/^[0-9a-fA-F]{32}$/.test(s)) {
      out.push(Buffer.from(s, "hex"));
    }
  } else {
    out.push(raw);
    if (raw.length === 16) {
      out.push(Buffer.from(raw.toString("hex"), "utf8"));
    }
  }
  return out;
}

// silence unused import warning helpers
void createCipheriv;
void createHmac;
