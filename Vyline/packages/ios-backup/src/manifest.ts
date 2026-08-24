import { createHash, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { parseKeybag, unlockClassKeys, unwrapKeyForClass, type ParsedKeybag } from "./keybag.js";

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
  decryptionKey: Uint8Array;
  manifestDbPath: string;
  backupRoot: string;
  udid: string;
}

const APPLE_2001_EPOCH = 978307200;

function isOlderThanIOS10_2(version: string): boolean {
  const parts = version.split(".").map(Number);
  const major = parts[0] ?? 0;
  if (major < 10) return true;
  if (major > 10) return false;
  if (parts.length < 2) return true;
  return (parts[1] ?? 0) < 2;
}

function convertTimeSince2001(timestamp: number): Date {
  return new Date((timestamp + APPLE_2001_EPOCH) * 1000);
}

function deriveKeyFromPassword(
  password: Uint8Array,
  attrs: Map<string, Uint8Array>,
  iOSVersion: string,
): Uint8Array {
  let temp: Uint8Array;
  if (isOlderThanIOS10_2(iOSVersion)) {
    temp = password;
  } else {
    const dpsl = attrs.get("DPSL");
    const dpic = attrs.get("DPIC");
    const dpicNum = dpic ? readUInt32BE(dpic, 0) : 0;
    if (!dpsl) throw new Error("Missing DPSL attribute");
    temp = pbkdf2Sync(password, dpsl, dpicNum, 32, "sha256");
  }

  const salt = attrs.get("SALT");
  const iter = attrs.get("ITER");
  const iterNum = iter ? readUInt32BE(iter, 0) : 0;
  if (!salt) throw new Error("Missing SALT attribute");

  return pbkdf2Sync(temp, salt, iterNum, 32, "sha1");
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

function aesDecryptCBC(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array = new Uint8Array(16),
): Uint8Array {
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return new Uint8Array(decrypted);
}

export async function openBackup(
  backupRoot: string,
  udid: string,
  password: string,
): Promise<BackupManifest> {
  const manifestPath = join(backupRoot, udid, "Manifest.plist");
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest.plist not found at ${manifestPath}`);
  }

  const manifestData = readFileSync(manifestPath);
  const manifest = parsePlist(manifestData) as ManifestPlist;

  const keybag = parseKeybag(manifest.BackupKeyBag);

  const passwordBytes = new TextEncoder().encode(password);
  const decryptionKey = deriveKeyFromPassword(
    passwordBytes,
    keybag.attrs,
    manifest.Lockdown.ProductVersion,
  );

  unlockClassKeys(keybag.classKeys, decryptionKey);

  const manifestDbPath = await decryptManifestDb(backupRoot, udid, manifest, keybag, decryptionKey);

  return {
    manifest,
    keybag,
    decryptionKey,
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
  decryptionKey: Uint8Array,
): Promise<string> {
  const manifestDbPath = join(backupRoot, udid, "Manifest.db");
  const encryptedDb = readFileSync(manifestDbPath);

  let decryptedData: Uint8Array;

  if (isOlderThanIOS10_2(manifest.Lockdown.ProductVersion)) {
    decryptedData = encryptedDb;
  } else {
    if (!manifest.ManifestKey) {
      throw new Error("ManifestKey missing from Manifest.plist");
    }
    const manifestClass = resolveClassNumber(manifest.ManifestKey, keybag.classKeys);
    const manifestKey = manifest.ManifestKey.slice(4);
    const key = unwrapKeyForClass(keybag.classKeys, manifestClass, manifestKey);
    decryptedData = aesDecryptCBC(encryptedDb, key);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "vyline-ios-backup-"));
  const outputPath = join(tempDir, "Manifest.db");
  writeFileSync(outputPath, decryptedData);

  return outputPath;
}

function parsePlist(data: Uint8Array): unknown {
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

  function skipWhitespace(): void {
    while (index < len && /\s/.test(xml[index] ?? "")) index++;
  }

  function parseValue(): unknown {
    skipWhitespace();
    if (xml.startsWith("<dict>", index)) return parseDict();
    if (xml.startsWith("<array>", index)) return parseArray();
    if (xml.startsWith("<string>", index)) return parseString();
    if (xml.startsWith("<integer>", index)) return parseInteger();
    if (xml.startsWith("<real>", index)) return parseReal();
    if (xml.startsWith("<true/>", index) || xml.startsWith("<true>", index)) return parseTrue();
    if (xml.startsWith("<false/>", index) || xml.startsWith("<false>", index)) return parseFalse();
    if (xml.startsWith("<data>", index)) return parseData();
    if (xml.startsWith("<date>", index)) return parseDate();
    return null;
  }

  function parseDict(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    index += 6; // <dict>
    skipWhitespace();
    while (!xml.startsWith("</dict>", index)) {
      skipWhitespace();
      if (!xml.startsWith("<key>", index)) break;
      index += 5; // <key>
      const keyStart = index;
      while (!xml.startsWith("</key>", index)) index++;
      const key = xml.slice(keyStart, index);
      index += 6; // </key>
      skipWhitespace();
      const value = parseValue();
      result[key] = value;
      skipWhitespace();
    }
    index += 7; // </dict>
    return result;
  }

  function parseArray(): unknown[] {
    const result: unknown[] = [];
    index += 7; // <array>
    skipWhitespace();
    while (!xml.startsWith("</array>", index)) {
      result.push(parseValue());
      skipWhitespace();
    }
    index += 8; // </array>
    return result;
  }

  function parseString(): string {
    index += 8; // <string>
    const start = index;
    while (!xml.startsWith("</string>", index)) index++;
    const value = xml.slice(start, index);
    index += 9; // </string>
    return value;
  }

  function parseInteger(): number {
    index += 9; // <integer>
    const start = index;
    while (!xml.startsWith("</integer>", index)) index++;
    const value = Number.parseInt(xml.slice(start, index), 10);
    index += 10; // </integer>
    return value;
  }

  function parseReal(): number {
    index += 6; // <real>
    const start = index;
    while (!xml.startsWith("</real>", index)) index++;
    const value = Number.parseFloat(xml.slice(start, index));
    index += 7; // </real>
    return value;
  }

  function parseTrue(): boolean {
    if (xml.startsWith("<true/>", index)) index += 7;
    else {
      index += 5; // <true>
      index += 6; // </true>
    }
    return true;
  }

  function parseFalse(): boolean {
    if (xml.startsWith("<false/>", index)) index += 8;
    else {
      index += 6; // <false>
      index += 7; // </false>
    }
    return false;
  }

  function parseData(): Uint8Array {
    index += 6; // <data>
    const start = index;
    while (!xml.startsWith("</data>", index)) index++;
    const b64 = xml.slice(start, index).replace(/\s/g, "");
    index += 7; // </data>
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  function parseDate(): Date {
    index += 6; // <date>
    const start = index;
    while (!xml.startsWith("</date>", index)) index++;
    const value = new Date(xml.slice(start, index));
    index += 7; // </date>
    return value;
  }
  skipWhitespace();
  if (xml.startsWith("<plist", index)) {
    // skip plist tag
    while (index < len && xml[index] !== ">") index++;
    index++;
    skipWhitespace();
  }
  return parseValue();
}

import { parseBplist } from "./bplist.js";

export function closeBackup(manifestDbPath: string): void {
  try {
    rmSync(manifestDbPath, { force: true });
    rmSync(dirname(manifestDbPath), { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
