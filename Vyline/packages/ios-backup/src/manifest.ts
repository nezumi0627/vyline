import { createDecipheriv, pbkdf2 } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { parseKeybag, unlockClassKeys, unwrapKeyForClass, type ParsedKeybag } from "./keybag.js";

export const DEFAULT_MAX_MANIFEST_PLIST_BYTES = 8 * 1024 * 1024;

function maxManifestPlistBytes(): number {
  const configured = Number(Reflect.get(process.env, "VYLINE_IOS_MAX_MANIFEST_PLIST_BYTES"));
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_MANIFEST_PLIST_BYTES;
}

export interface ManifestPlist {
  IsEncrypted: boolean;
  WasPasscodeSet: boolean;
  Lockdown: {
    DeviceName: string;
    ProductVersion: string;
    ProductType: string;
    SerialNumber: string;
  };
  BackupKeyBag: Uint8Array;
  ManifestKey?: Uint8Array;
  DPSL?: Uint8Array;
  DPIC?: number;
  SALT?: Uint8Array;
  ITER?: number;
  Applications?: Record<string, unknown>;
}

export interface BackupManifest {
  manifest: ManifestPlist;
  keybag: ParsedKeybag;
  manifestDbPath: string;
  backupRoot: string;
  udid: string;
}

function isOlderThanIOS10_2(version: string): boolean {
  const parts = version.split(".").map(Number);
  const major = parts[0] ?? 0;
  if (major < 10) return true;
  if (major > 10) return false;
  if (parts.length < 2) return true;
  return (parts[1] ?? 0) < 2;
}

function pbkdf2Async(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLength: number,
  digest: string,
): Promise<Uint8Array> {
  return new Promise((resolvePromise, rejectPromise) => {
    pbkdf2(password, salt, iterations, keyLength, digest, (error, key) => {
      if (error) rejectPromise(error);
      else resolvePromise(new Uint8Array(key));
    });
  });
}

async function deriveKeyFromPassword(
  password: Uint8Array,
  attrs: Map<string, Uint8Array>,
  iOSVersion: string,
): Promise<Uint8Array> {
  let temp: Uint8Array;
  if (isOlderThanIOS10_2(iOSVersion)) {
    temp = password;
  } else {
    const dpsl = attrs.get("DPSL");
    const dpic = attrs.get("DPIC");
    const dpicNum = dpic ? readUInt32BE(dpic, 0) : 0;
    if (!dpsl) throw new Error("Missing DPSL attribute");
    temp = await pbkdf2Async(password, dpsl, dpicNum, 32, "sha256");
  }

  const salt = attrs.get("SALT");
  const iter = attrs.get("ITER");
  const iterNum = iter ? readUInt32BE(iter, 0) : 0;
  if (!salt) throw new Error("Missing SALT attribute");

  return pbkdf2Async(temp, salt, iterNum, 32, "sha1");
}

function readUInt32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) << 24) |
    ((buf[offset + 1] ?? 0) << 16) |
    ((buf[offset + 2] ?? 0) << 8) |
    (buf[offset + 3] ?? 0)
  );
}

function resolveClassNumber(buf: Uint8Array, classKeys: Map<number, unknown>): number {
  const bigEndian = readUInt32BE(buf, 0);
  if (classKeys.has(bigEndian)) return bigEndian;
  const littleEndian =
    (buf[0] ?? 0) | ((buf[1] ?? 0) << 8) | ((buf[2] ?? 0) << 16) | ((buf[3] ?? 0) << 24);
  if (classKeys.has(littleEndian)) return littleEndian;
  throw new Error(`No key for protection class ${bigEndian}`);
}

async function decryptAesCbcFile(
  sourcePath: string,
  targetPath: string,
  key: Uint8Array,
  iv: Uint8Array = new Uint8Array(16),
): Promise<void> {
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  await pipeline(
    createReadStream(sourcePath),
    decipher,
    createWriteStream(targetPath, { mode: 0o600 }),
  );
}

export async function openBackup(
  backupRoot: string,
  udid: string,
  password: string,
  outputDir: string,
  maxManifestDbBytes = Number.MAX_SAFE_INTEGER,
  onWorkBytes?: (bytes: number) => Promise<void>,
): Promise<BackupManifest> {
  const manifestPath = join(backupRoot, udid, "Manifest.plist");
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest.plist not found at ${manifestPath}`);
  }

  const manifestPlistBytes = (await stat(manifestPath)).size;
  const manifestPlistLimit = maxManifestPlistBytes();
  if (manifestPlistBytes > manifestPlistLimit) {
    throw new Error(`Manifest.plist exceeds the ${manifestPlistLimit} byte safety limit`);
  }

  // Plist decoding requires random access to its object table. Manifest.plist is
  // the only intentionally whole-buffer input; large Manifest.db/files stream.
  const manifestData = await readFile(manifestPath);
  const manifest = parsePlist(manifestData) as ManifestPlist;

  const keybag = parseKeybag(manifest.BackupKeyBag);

  const passwordBytes = new TextEncoder().encode(password);
  const decryptionKey = await deriveKeyFromPassword(
    passwordBytes,
    keybag.attrs,
    manifest.Lockdown.ProductVersion,
  );

  unlockClassKeys(keybag.classKeys, decryptionKey);

  const manifestDbPath = await decryptManifestDb(
    backupRoot,
    udid,
    manifest,
    keybag,
    outputDir,
    maxManifestDbBytes,
    onWorkBytes,
  );

  return {
    manifest,
    keybag,
    manifestDbPath,
    backupRoot,
    udid,
  };
}

async function decryptManifestDb(
  backupRoot: string,
  udid: string,
  manifest: ManifestPlist,
  keybag: ParsedKeybag,
  outputDir: string,
  maxBytes: number,
  onWorkBytes?: (bytes: number) => Promise<void>,
): Promise<string> {
  const manifestDbPath = join(backupRoot, udid, "Manifest.db");
  if (!existsSync(manifestDbPath)) throw new Error(`Manifest.db not found at ${manifestDbPath}`);
  const sourceBytes = (await stat(manifestDbPath)).size;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || sourceBytes > maxBytes) {
    throw new Error(`Manifest.db exceeds the extraction limit (${sourceBytes} bytes)`);
  }
  await onWorkBytes?.(sourceBytes);
  const outputPath = join(outputDir, "manifest", "Manifest.db");
  const partialPath = `${outputPath}.partial`;
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await rm(partialPath, { force: true });
  try {
    if (isOlderThanIOS10_2(manifest.Lockdown.ProductVersion)) {
      await copyFile(manifestDbPath, partialPath);
    } else {
      if (!manifest.ManifestKey) {
        throw new Error("ManifestKey missing from Manifest.plist");
      }
      const manifestClass = resolveClassNumber(manifest.ManifestKey, keybag.classKeys);
      const manifestKey = manifest.ManifestKey.slice(4);
      const key = unwrapKeyForClass(keybag.classKeys, manifestClass, manifestKey);
      await decryptAesCbcFile(manifestDbPath, partialPath, key);
    }
    await rename(partialPath, outputPath);
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return outputPath;
}

function parsePlist(data: Uint8Array): unknown {
  if (new TextDecoder().decode(data.subarray(0, 8)) === "bplist00") {
    return parseBplist(data);
  }
  const str = new TextDecoder().decode(data);
  if (str.trim().startsWith("<?xml") || str.trim().startsWith("<")) {
    return parseXmlPlist(str);
  }
  return parseBplist(data);
}

function parseXmlPlist(xml: string): unknown {
  // Simple XML plist parser without DOMParser
  let index = 0;
  const len = xml.length;

  function malformed(message: string): never {
    throw new Error(`Malformed XML plist: ${message} at offset ${index}`);
  }

  function skipWhitespace(): void {
    while (index < len && /\s/.test(xml[index] ?? "")) index++;
  }

  function skipUntil(marker: string, message: string): void {
    const end = xml.indexOf(marker, index);
    if (end < 0) malformed(message);
    index = end + marker.length;
  }

  function readUntil(marker: string, message: string): string {
    const end = xml.indexOf(marker, index);
    if (end < 0) malformed(message);
    const value = xml.slice(index, end);
    index = end + marker.length;
    return value;
  }

  function parseValue(): unknown {
    skipWhitespace();
    if (index >= len) malformed("unexpected end of input");
    if (xml.startsWith("<dict>", index)) return parseDict();
    if (xml.startsWith("<array>", index)) return parseArray();
    if (xml.startsWith("<string>", index)) return parseString();
    if (xml.startsWith("<integer>", index)) return parseInteger();
    if (xml.startsWith("<real>", index)) return parseReal();
    if (xml.startsWith("<true/>", index) || xml.startsWith("<true>", index)) return parseTrue();
    if (xml.startsWith("<false/>", index) || xml.startsWith("<false>", index)) return parseFalse();
    if (xml.startsWith("<data>", index)) return parseData();
    if (xml.startsWith("<date>", index)) return parseDate();
    malformed("unsupported or unterminated value");
  }

  function parseDict(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    index += 6; // <dict>
    skipWhitespace();
    for (;;) {
      skipWhitespace();
      if (xml.startsWith("</dict>", index)) {
        index += 7;
        return result;
      }
      if (index >= len) malformed("unterminated dict");
      if (!xml.startsWith("<key>", index)) malformed("dict key expected");
      index += 5; // <key>
      const key = readUntil("</key>", "unterminated key");
      skipWhitespace();
      const value = parseValue();
      result[key] = value;
    }
  }

  function parseArray(): unknown[] {
    const result: unknown[] = [];
    index += 7; // <array>
    skipWhitespace();
    for (;;) {
      skipWhitespace();
      if (xml.startsWith("</array>", index)) {
        index += 8;
        return result;
      }
      if (index >= len) malformed("unterminated array");
      result.push(parseValue());
    }
  }

  function parseString(): string {
    index += 8; // <string>
    return readUntil("</string>", "unterminated string");
  }

  function parseInteger(): number {
    index += 9; // <integer>
    return Number.parseInt(readUntil("</integer>", "unterminated integer"), 10);
  }

  function parseReal(): number {
    index += 6; // <real>
    return Number.parseFloat(readUntil("</real>", "unterminated real"));
  }

  function parseTrue(): boolean {
    if (xml.startsWith("<true/>", index)) index += 7;
    else {
      index += 6; // <true>
      if (!xml.startsWith("</true>", index)) malformed("unterminated true");
      index += 7;
    }
    return true;
  }

  function parseFalse(): boolean {
    if (xml.startsWith("<false/>", index)) index += 8;
    else {
      index += 7; // <false>
      if (!xml.startsWith("</false>", index)) malformed("unterminated false");
      index += 8;
    }
    return false;
  }

  function parseData(): Uint8Array {
    index += 6; // <data>
    const b64 = readUntil("</data>", "unterminated data").replace(/\s/g, "");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  function parseDate(): Date {
    index += 6; // <date>
    return new Date(readUntil("</date>", "unterminated date"));
  }
  skipWhitespace();
  while (xml.startsWith("<?", index)) {
    skipUntil("?>", "unterminated processing instruction");
    skipWhitespace();
  }
  if (xml.startsWith("<!DOCTYPE", index)) {
    skipUntil(">", "unterminated doctype");
    skipWhitespace();
  }
  let wrapped = false;
  if (xml.startsWith("<plist", index)) {
    wrapped = true;
    skipUntil(">", "unterminated plist tag");
    skipWhitespace();
  }
  const value = parseValue();
  skipWhitespace();
  if (wrapped) {
    if (!xml.startsWith("</plist>", index)) malformed("unterminated plist");
    index += 8;
  }
  return value;
}

import { parseBplist } from "./bplist.js";
