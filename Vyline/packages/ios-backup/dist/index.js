var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// Vyline/packages/ios-backup/src/keybag.ts
import { createDecipheriv } from "node:crypto";
function readUInt32BE(buf, offset) {
  return (buf[offset] ?? 0) << 24 | (buf[offset + 1] ?? 0) << 16 | (buf[offset + 2] ?? 0) << 8 | (buf[offset + 3] ?? 0);
}
function* loopTLVBlocks(blob) {
  let i = 0;
  while (i + 8 <= blob.length) {
    const tag = blob.slice(i, i + 4);
    const length = readUInt32BE(blob, i + 4);
    const data = blob.slice(i + 8, i + 8 + length);
    yield [tag, data];
    i += 8 + length;
  }
}
function parseKeybag(backupKeyBag) {
  const result = {
    type: 0,
    uuid: new Uint8Array(0),
    wrap: 0,
    classKeys: new Map,
    attrs: new Map
  };
  let currentClassKey = null;
  for (const [tag, data] of loopTLVBlocks(backupKeyBag)) {
    const tagStr = Buffer.from(tag).toString("ascii");
    if (data.length === 4) {
      if (currentClassKey && CLASSKEY_TAGS.some((t) => t.equals(tag))) {
        currentClassKey[tagStr.toLowerCase()] = data;
        continue;
      }
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
      if (currentClassKey) {
        const clas = currentClassKey.clas;
        if (clas) result.classKeys.set(readUInt32BE(clas, 0), currentClassKey);
      }
      currentClassKey = { uuid: data };
    } else if (CLASSKEY_TAGS.some((t) => t.equals(tag))) {
      if (!currentClassKey)
        continue;
      const key = tagStr.toLowerCase();
      currentClassKey[key] = data;
    } else {
      result.attrs.set(tagStr, data);
    }
  }
  if (currentClassKey) {
    const clas = currentClassKey.clas;
    if (clas) result.classKeys.set(readUInt32BE(clas, 0), currentClassKey);
  }
  return result;
}
function unpack64bit(s) {
  if (s.length !== 8)
    throw new Error("Invalid 64-bit input");
  let result = 0n;
  for (let i = 0;i < 8; i++) {
    result = result << 8n | BigInt(s[i] ?? 0);
  }
  return result;
}
function pack64bit(n) {
  const result = new Uint8Array(8);
  let value = n;
  for (let i = 7;i >= 0; i--) {
    result[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return result;
}
function aesUnwrap(kek, wrapped) {
  if (wrapped.length % 8 !== 0)
    throw new Error("Wrapped data length must be multiple of 8");
  if (kek.length !== 16 && kek.length !== 24 && kek.length !== 32) {
    throw new Error("KEK must be 16, 24, or 32 bytes");
  }
  const n = wrapped.length / 8 - 1;
  const C = [];
  for (let i = 0;i <= n; i++) {
    C.push(unpack64bit(wrapped.slice(i * 8, i * 8 + 8)));
  }
  const R = new Array(n + 1).fill(0n);
  let A = C[0];
  if (A === undefined)
    throw new Error("Wrapped data is empty");
  for (let i = 1;i <= n; i++) {
    const block = C[i];
    if (block === undefined)
      throw new Error("Invalid wrapped data");
    R[i] = block;
  }
  const cipher = (block) => {
    const decipher = createDecipheriv("aes-256-ecb", kek, "");
    decipher.setAutoPadding(false);
    return decipher.update(block);
  };
  for (let j = 5;j >= 0; j--) {
    for (let i = n;i >= 1; i--) {
      const toDec = new Uint8Array(16);
      const aXor = A ^ BigInt(n * j + i);
      toDec.set(pack64bit(aXor), 0);
      const block = R[i];
      if (block === undefined)
        throw new Error("Invalid unwrap state");
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
  for (let i = 1;i <= n; i++) {
    const block = R[i];
    if (block === undefined)
      throw new Error("Invalid unwrap result");
    result.set(pack64bit(block), (i - 1) * 8);
  }
  return result;
}
function unwrapKeyForClass(classKeys, protectionClass, persistentKey) {
  if (persistentKey.length !== 40) {
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
function unlockClassKeys(classKeys, decryptionKey) {
  for (const classKey of classKeys.values()) {
    if (!classKey.wpky)
      continue;
    if ((readUInt32BE(classKey.wrap, 0) & WRAP_PASSCODE) !== 0) {
      const unwrapped = aesUnwrap(decryptionKey, classKey.wpky);
      if (!unwrapped) {
        throw new Error("Failed to decrypt backup keybag - wrong password?");
      }
      classKey.key = unwrapped;
    }
  }
}
var CLASSKEY_TAGS, WRAP_PASSCODE = 2;
var init_keybag = __esm(() => {
  CLASSKEY_TAGS = [
    Buffer.from("CLAS"),
    Buffer.from("WRAP"),
    Buffer.from("WPKY"),
    Buffer.from("KTYP"),
    Buffer.from("PBKY")
  ];
});

// Vyline/packages/ios-backup/src/bplist.ts
function parseBplist(data) {
  if (data.length < 8)
    throw new Error("Invalid bplist: too short");
  const header = new TextDecoder().decode(data.slice(0, 8));
  if (!header.startsWith("bplist"))
    throw new Error("Not a binary plist");
  const trailerOffset = data.length - 32;
  const trailer = data.slice(trailerOffset);
  const offsetSize = trailer[6] ?? 1;
  const objectRefSize = trailer[7] ?? 1;
  const numObjects = readUInt64BE(trailer, 8);
  const topObject = readUInt64BE(trailer, 16);
  const offsetTableOffset = readUInt64BE(trailer, 24);
  const offsets = new Array(numObjects);
  for (let i = 0;i < numObjects; i++) {
    const off = offsetTableOffset + i * offsetSize;
    offsets[i] = readUIntBE(data, off, offsetSize);
  }
  const objects = new Array(numObjects);
  const resolveObject = (index) => {
    if (objects[index] !== undefined) return objects[index];
    const objectOffset = offsets[index];
    if (objectOffset === undefined) throw new Error(`Missing object offset: ${index}`);
    objects[index] = parseBplistObject(data, objectOffset, offsets, objectRefSize, objects);
    return objects[index];
  };
  activeObjectResolver = resolveObject;
  try {
    return resolveObject(topObject);
  } finally {
    activeObjectResolver = undefined;
  }
}
var activeObjectResolver;
function readUInt64BE(buf, offset) {
  let result = 0;
  for (let i = 0;i < 8; i++) {
    result = result << 8 | (buf[offset + i] ?? 0);
  }
  return result;
}
function readUIntBE(buf, offset, size) {
  let result = 0;
  for (let i = 0;i < size; i++) {
    result = result << 8 | (buf[offset + i] ?? 0);
  }
  return result;
}
function inlineObjectSize(data, offset) {
  const marker = data[offset] ?? 0;
  const info = marker & 15;
  if (info < 15) return (marker & 240) === 16 ? 1 + (1 << info) : 1;
  const lengthMarker = data[offset + 1] ?? 0;
  return (lengthMarker & 240) === 16 ? 2 + (1 << (lengthMarker & 15)) : 2;
}
function parseBplistObject(data, offset, offsets, objectRefSize, objects) {
  const marker = data[offset];
  if (marker === undefined)
    throw new Error(`Missing bplist marker at offset ${offset}`);
  const type = marker & 240;
  const info = marker & 15;
  switch (type) {
    case 0:
      return info === 8 ? true : info === 9 ? false : null;
    case 16:
      return readInt(data, offset + 1, 1 << info);
    case 32:
      return readFloat(data, offset + 1, 1 << info);
    case 48:
      return readDate(data, offset + 1, 8);
    case 64:
      return readData(data, offset, info, offsets, objectRefSize, objects);
    case 80:
      return readAsciiString(data, offset, info, offsets, objectRefSize, objects);
    case 96:
      return readUnicodeString(data, offset, info, offsets, objectRefSize, objects);
    case 112:
      return null;
    case 128:
      return readInt(data, offset + 1, info + 1);
    case 144:
      return readInt(data, offset + 1, 1 << info);
    case 160:
      return readArray(data, offset, info, offsets, objectRefSize, objects);
    case 192:
      return readArray(data, offset, info, offsets, objectRefSize, objects);
    case 208:
      return readDict(data, offset, info, offsets, objectRefSize, objects);
    default:
      throw new Error(`Unknown bplist type: 0x${type.toString(16)} at offset ${offset}`);
  }
}
function readInt(data, offset, size) {
  let result = 0;
  for (let i = 0;i < size; i++) {
    result = result << 8 | (data[offset + i] ?? 0);
  }
  return result;
}
function readFloat(data, offset, size) {
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
function readDate(data, offset, size) {
  if (size !== 8)
    throw new Error("Date must be 8 bytes");
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  const timestamp = view.getFloat64(0, false);
  const APPLE_2001_EPOCH = 978307200;
  return new Date((timestamp + APPLE_2001_EPOCH) * 1000);
}
function readData(data, offset, info, offsets, objectRefSize, objects) {
  let length;
  let dataOffset;
  if (info < 15) {
    length = info;
    dataOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    length = parseBplistObject(data, intOffset, offsets, objectRefSize, objects);
    dataOffset = intOffset + inlineObjectSize(data, intOffset);
  }
  return data.slice(dataOffset, dataOffset + length);
}
function readAsciiString(data, offset, info, offsets, objectRefSize, objects) {
  let length;
  let dataOffset;
  if (info < 15) {
    length = info;
    dataOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    length = parseBplistObject(data, intOffset, offsets, objectRefSize, objects);
    dataOffset = intOffset + inlineObjectSize(data, intOffset);
  }
  return Buffer.from(data.slice(dataOffset, dataOffset + length)).toString("ascii");
}
function readUnicodeString(data, offset, info, offsets, objectRefSize, objects) {
  let length;
  let dataOffset;
  if (info < 15) {
    length = info;
    dataOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    length = parseBplistObject(data, intOffset, offsets, objectRefSize, objects);
    dataOffset = intOffset + inlineObjectSize(data, intOffset);
  }
  const bytes = data.slice(dataOffset, dataOffset + length * 2);
  return Buffer.from(bytes).swap16().toString("utf16le");
}
function readArray(data, offset, info, offsets, objectRefSize, objects) {
  let count;
  let refOffset;
  if (info < 15) {
    count = info;
    refOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    count = parseBplistObject(data, intOffset, offsets, objectRefSize, objects);
    refOffset = intOffset + inlineObjectSize(data, intOffset);
  }
  const result = [];
  for (let i = 0;i < count; i++) {
    const ref = readUIntBE(data, refOffset + i * objectRefSize, objectRefSize);
    result.push(activeObjectResolver?.(ref) ?? objects[ref]);
  }
  return result;
}
function readDict(data, offset, info, offsets, objectRefSize, objects) {
  let count;
  let refOffset;
  if (info < 15) {
    count = info;
    refOffset = offset + 1;
  } else {
    const intOffset = offset + 1;
    count = parseBplistObject(data, intOffset, offsets, objectRefSize, objects);
    refOffset = intOffset + inlineObjectSize(data, intOffset);
  }
  const result = {};
  const keyRefs = [];
  const valueRefs = [];
  for (let i = 0;i < count; i++) {
    keyRefs.push(readUIntBE(data, refOffset + i * objectRefSize, objectRefSize));
  }
  for (let i = 0;i < count; i++) {
    valueRefs.push(readUIntBE(data, refOffset + count * objectRefSize + i * objectRefSize, objectRefSize));
  }
  for (let i = 0;i < count; i++) {
    const keyRef = keyRefs[i];
    const valueRef = valueRefs[i];
    if (keyRef === undefined || valueRef === undefined)
      throw new Error("Invalid dict reference");
    const key = activeObjectResolver?.(keyRef) ?? objects[keyRef];
    result[key] = activeObjectResolver?.(valueRef) ?? objects[valueRef];
  }
  return result;
}
function bplistToJson(obj) {
  if (obj === null || obj === undefined)
    return null;
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean")
    return obj;
  if (obj instanceof Date)
    return obj.toISOString();
  if (obj instanceof Uint8Array)
    return { _b64: Buffer.from(obj).toString("base64") };
  if (Array.isArray(obj))
    return obj.map(bplistToJson);
  if (typeof obj === "object") {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = bplistToJson(v);
    }
    return result;
  }
  return String(obj);
}
function parseContentMetadata(data) {
  try {
    const parsed = parseBplist(data);
    return bplistToJson(parsed);
  } catch (e) {
    return { _b64: Buffer.from(data).toString("base64"), _error: String(e) };
  }
}

// Vyline/packages/ios-backup/src/manifest.ts
import { createDecipheriv as createDecipheriv2, pbkdf2Sync } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
function isOlderThanIOS10_2(version) {
  const parts = version.split(".").map(Number);
  const major = parts[0] ?? 0;
  if (major < 10)
    return true;
  if (major > 10)
    return false;
  if (parts.length < 2)
    return true;
  return (parts[1] ?? 0) < 2;
}
function deriveKeyFromPassword(password, attrs, iOSVersion) {
  let temp;
  if (isOlderThanIOS10_2(iOSVersion)) {
    temp = password;
  } else {
    const dpsl = attrs.get("DPSL");
    const dpic = attrs.get("DPIC");
    const dpicNum = dpic ? readUInt32BE2(dpic, 0) : 0;
    if (!dpsl)
      throw new Error("Missing DPSL attribute");
    temp = pbkdf2Sync(password, dpsl, dpicNum, 32, "sha256");
  }
  const salt = attrs.get("SALT");
  const iter = attrs.get("ITER");
  const iterNum = iter ? readUInt32BE2(iter, 0) : 0;
  if (!salt)
    throw new Error("Missing SALT attribute");
  return pbkdf2Sync(temp, salt, iterNum, 32, "sha1");
}
function readUInt32BE2(buf, offset) {
  return (buf[offset] ?? 0) << 24 | (buf[offset + 1] ?? 0) << 16 | (buf[offset + 2] ?? 0) << 8 | (buf[offset + 3] ?? 0);
}
function aesDecryptCBC(data, key, iv = new Uint8Array(16)) {
  const decipher = createDecipheriv2("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return new Uint8Array(decrypted);
}
async function openBackup(backupRoot, udid, password) {
  const manifestPath = join(backupRoot, udid, "Manifest.plist");
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest.plist not found at ${manifestPath}`);
  }
  const manifestData = readFileSync(manifestPath);
  const manifest = parsePlist(manifestData);
  const keybag = parseKeybag(manifest.BackupKeyBag);
  const passwordBytes = new TextEncoder().encode(password);
  const decryptionKey = deriveKeyFromPassword(passwordBytes, keybag.attrs, manifest.Lockdown.ProductVersion);
  unlockClassKeys(keybag.classKeys, decryptionKey);
  const manifestDbPath = await decryptManifestDb(backupRoot, udid, manifest, keybag, decryptionKey);
  return {
    manifest,
    keybag,
    decryptionKey,
    manifestDbPath,
    backupRoot,
    udid
  };
}
async function decryptManifestDb(backupRoot, udid, manifest, keybag, decryptionKey) {
  const manifestDbPath = join(backupRoot, udid, "Manifest.db");
  const encryptedDb = readFileSync(manifestDbPath);
  let decryptedData;
  if (isOlderThanIOS10_2(manifest.Lockdown.ProductVersion)) {
    decryptedData = encryptedDb;
  } else {
    if (!manifest.ManifestKey) {
      throw new Error("ManifestKey missing from Manifest.plist");
    }
    const manifestClass = manifest.ManifestKey[0] | manifest.ManifestKey[1] << 8 | manifest.ManifestKey[2] << 16 | manifest.ManifestKey[3] << 24;
    const manifestKey = manifest.ManifestKey.slice(4);
    const key = unwrapKeyForClass(keybag.classKeys, manifestClass, manifestKey);
    decryptedData = aesDecryptCBC(encryptedDb, key);
  }
  const tempDir = mkdtempSync(join(tmpdir(), "vyline-ios-backup-"));
  const outputPath = join(tempDir, "Manifest.db");
  writeFileSync(outputPath, decryptedData);
  return outputPath;
}
function parsePlist(data) {
  const str = new TextDecoder().decode(data);
  if (str.trim().startsWith("<?xml") || str.trim().startsWith("<")) {
    return parseXmlPlist(str);
  }
  return parseBplist(data);
}
function parseXmlPlist(xml) {
  let index = 0;
  const len = xml.length;
  function skipWhitespace() {
    while (index < len && /\s/.test(xml[index] ?? ""))
      index++;
  }
  function parseValue() {
    skipWhitespace();
    if (xml.startsWith("<dict>", index))
      return parseDict();
    if (xml.startsWith("<array>", index))
      return parseArray();
    if (xml.startsWith("<string>", index))
      return parseString();
    if (xml.startsWith("<integer>", index))
      return parseInteger();
    if (xml.startsWith("<real>", index))
      return parseReal();
    if (xml.startsWith("<true/>", index) || xml.startsWith("<true>", index))
      return parseTrue();
    if (xml.startsWith("<false/>", index) || xml.startsWith("<false>", index))
      return parseFalse();
    if (xml.startsWith("<data>", index))
      return parseData();
    if (xml.startsWith("<date>", index))
      return parseDate();
    return null;
  }
  function parseDict() {
    const result = {};
    index += 6;
    skipWhitespace();
    while (!xml.startsWith("</dict>", index)) {
      skipWhitespace();
      if (!xml.startsWith("<key>", index))
        break;
      index += 5;
      const keyStart = index;
      while (!xml.startsWith("</key>", index))
        index++;
      const key = xml.slice(keyStart, index);
      index += 6;
      skipWhitespace();
      const value = parseValue();
      result[key] = value;
      skipWhitespace();
    }
    index += 7;
    return result;
  }
  function parseArray() {
    const result = [];
    index += 7;
    skipWhitespace();
    while (!xml.startsWith("</array>", index)) {
      result.push(parseValue());
      skipWhitespace();
    }
    index += 8;
    return result;
  }
  function parseString() {
    index += 8;
    const start = index;
    while (!xml.startsWith("</string>", index))
      index++;
    const value = xml.slice(start, index);
    index += 9;
    return value;
  }
  function parseInteger() {
    index += 9;
    const start = index;
    while (!xml.startsWith("</integer>", index))
      index++;
    const value = Number.parseInt(xml.slice(start, index), 10);
    index += 10;
    return value;
  }
  function parseReal() {
    index += 6;
    const start = index;
    while (!xml.startsWith("</real>", index))
      index++;
    const value = Number.parseFloat(xml.slice(start, index));
    index += 7;
    return value;
  }
  function parseTrue() {
    if (xml.startsWith("<true/>", index))
      index += 7;
    else {
      index += 5;
      index += 6;
    }
    return true;
  }
  function parseFalse() {
    if (xml.startsWith("<false/>", index))
      index += 8;
    else {
      index += 6;
      index += 7;
    }
    return false;
  }
  function parseData() {
    index += 6;
    const start = index;
    while (!xml.startsWith("</data>", index))
      index++;
    const b64 = xml.slice(start, index).replace(/\s/g, "");
    index += 7;
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  function parseDate() {
    index += 6;
    const start = index;
    while (!xml.startsWith("</date>", index))
      index++;
    const value = new Date(xml.slice(start, index));
    index += 7;
    return value;
  }
  skipWhitespace();
  if (xml.startsWith("<plist", index)) {
    while (index < len && xml[index] !== ">")
      index++;
    index++;
    skipWhitespace();
  }
  return parseValue();
}
function closeBackup(manifestDbPath) {
  try {
    rmSync(manifestDbPath, { force: true });
    rmSync(dirname(manifestDbPath), { recursive: true, force: true });
  } catch {}
}
var init_manifest = __esm(() => {
  init_keybag();
});

// Vyline/packages/ios-backup/src/extract.ts
var exports_extract = {};
__export(exports_extract, {
  extractBackup: () => extractBackup,
  getFileDecryptedCopy: () => getFileDecryptedCopy,
  getFileManifestDBEntry: () => getFileManifestDBEntry
});
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync as writeFileSync2, existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2, dirname as dirname2 } from "node:path";
async function extractBackup(options) {
  const { backupRoot, udid, password, outputDir, domains = ["%line%"], onProgress } = options;
  onProgress?.({ stage: "unlocking", current: 0, total: 3, message: "Unlocking backup..." });
  const backup = await openBackup(backupRoot, udid, password);
  try {
    onProgress?.({ stage: "listing", current: 1, total: 3, message: "Scanning for LINE files..." });
    const db = new Database(backup.manifestDbPath, { readonly: true });
    let whereClause = "";
    const params = [];
    for (const domain of domains) {
      if (whereClause)
        whereClause += " OR ";
      whereClause += "domain LIKE ?";
      params.push(domain);
    }
    const rows = db.prepare(`SELECT fileID, domain, relativePath, flags, file FROM Files WHERE ${whereClause} ORDER BY domain, relativePath`).all(...params);
    const lineFiles = rows.filter((r) => r.domain.toLowerCase().includes("line"));
    const databases = lineFiles.filter((r) => [".sqlite", ".db", ".storedata"].some((ext) => r.relativePath.toLowerCase().endsWith(ext)));
    onProgress?.({
      stage: "extracting",
      current: 2,
      total: 3,
      message: `Found ${lineFiles.length} LINE files, ${databases.length} databases`
    });
    mkdirSync(outputDir, { recursive: true });
    const extractedFiles = [];
    const extractedLineFiles = [];
    const extractedDatabases = [];
    for (let i = 0;i < lineFiles.length; i++) {
      const row = lineFiles[i];
      if (!row)
        continue;
      onProgress?.({
        stage: "extracting",
        current: 2,
        total: 3,
        message: `Extracting ${row.relativePath} (${i + 1}/${lineFiles.length})`,
        file: row.relativePath
      });
      try {
        const manifestEntry = getFileManifestDBEntry(backup.manifestDbPath, row.fileID);
        const safeName = row.relativePath.replace(/[\\/:]/g, "__");
        const targetName = `${row.domain}__${safeName}`;
        const targetPath = join2(outputDir, targetName);
        const result = getFileDecryptedCopy(backup, manifestEntry, targetPath);
        const extracted = {
          fileID: row.fileID,
          domain: row.domain,
          relativePath: row.relativePath,
          size: result.size,
          localPath: targetPath,
          manifest: manifestEntry
        };
        extractedFiles.push(extracted);
        extractedLineFiles.push(extracted);
        if (databases.some((d) => d.fileID === row.fileID)) {
          extractedDatabases.push(extracted);
        }
      } catch (e) {
        console.error(`Failed to extract ${row.relativePath}:`, e);
      }
    }
    onProgress?.({ stage: "complete", current: 3, total: 3, message: "Extraction complete" });
    return {
      manifestDbPath: backup.manifestDbPath,
      backupRoot: backup.backupRoot,
      udid: backup.udid,
      files: extractedFiles,
      lineFiles: extractedLineFiles,
      databases: extractedDatabases
    };
  } finally {
    closeBackup(backup.manifestDbPath);
  }
}
function getFileManifestDBEntry(manifestDbPath, fileID) {
  const db = new Database(manifestDbPath, { readonly: true });
  const row = db.prepare("SELECT fileID, domain, relativePath, file FROM Files WHERE fileID = ? LIMIT 1").get(fileID);
  db.close();
  if (!row) {
    throw new Error(`File not found in manifest: ${fileID}`);
  }
  return {
    fileID: row.fileID,
    domain: row.domain,
    relativePath: row.relativePath,
    file: row.file
  };
}
function getFileDecryptedCopy(backup, manifestEntry, targetPath) {
  const manifest = parseBplist(manifestEntry.file);
  const fileData = manifest;
  const root = fileData.$top?.root;
  const fileObject = root === undefined ? undefined : fileData.$objects?.[root];
  const entry = fileObject ?? fileData;
  const isEncrypted = "EncryptionKey" in entry;
  const isFolder = entry.Size === 0 && !isEncrypted;
  if (isFolder) {
    mkdirSync(targetPath, { recursive: true });
    return { size: 0 };
  }
  const sourcePath = join2(backup.backupRoot, backup.udid, manifestEntry.fileID.slice(0, 2), manifestEntry.fileID);
  if (!existsSync2(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }
  if (isEncrypted) {
    const keyObject = fileData.$objects?.[entry.EncryptionKey];
    const wrapped = keyObject?.["NS.data"] ?? keyObject;
    if (!wrapped || typeof wrapped.length !== "number") throw new Error("Encrypted file key is missing");
    const protectionClass = Number(entry.ProtectionClass);
    const fileKey = unwrapKeyForClass(backup.keybag.classKeys, protectionClass, Buffer.from(wrapped).subarray(4));
    const decrypted = aesDecryptCBC(readFileSync2(sourcePath), fileKey);
    const data = decrypted.subarray(0, Number(entry.Size));
    mkdirSync2(dirname2(targetPath), { recursive: true });
    writeFileSync2(targetPath, data);
    return { size: data.length };
  }
  const data = readFileSync2(sourcePath);
  mkdirSync(dirname2(targetPath), { recursive: true });
  writeFileSync2(targetPath, data);
  return { size: data.length };
}
var init_extract = __esm(() => {
  init_manifest();
});

// Vyline/packages/ios-backup/src/parse.ts
var exports_parse = {};
__export(exports_parse, {
  detectMyMid: () => detectMyMid,
  findLineDatabases: () => findLineDatabases,
  parseLineDatabases: () => parseLineDatabases
});
import { Database as Database2 } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { writeFileSync as writeFileSync3, mkdirSync as mkdirSync2 } from "node:fs";
import { join as join3 } from "node:path";
function toIso(ms) {
  try {
    return new Date(ms + JST_OFFSET).toISOString().replace("Z", "+09:00");
  } catch {
    return null;
  }
}
async function parseLineDatabases(options) {
  const { lineDbPath, unifiedGroupDbPath, outputDir, myMid, onProgress } = options;
  const lineDb = new Database2(lineDbPath, { readonly: true });
  const ugDb = new Database2(unifiedGroupDbPath, { readonly: true });
  try {
    onProgress?.({ stage: "users", current: 0, total: 5, message: "Loading users..." });
    const users = new Map;
    for (const row of lineDb.prepare("SELECT Z_PK, ZMID, ZNAME, ZCUSTOMNAME, ZADDRESSBOOKNAME FROM ZUSER").iterate()) {
      users.set(row.Z_PK, {
        mid: row.ZMID,
        name: row.ZCUSTOMNAME || row.ZADDRESSBOOKNAME || row.ZNAME || "Unknown"
      });
    }
    onProgress?.({ stage: "groups", current: 1, total: 5, message: "Loading group names..." });
    const groupNames = new Map;
    for (const row of ugDb.prepare("SELECT ZID, ZNAME FROM ZUNIFIEDGROUP").iterate()) {
      if (row.ZID) {
        groupNames.set(row.ZID.toLowerCase(), row.ZNAME);
      }
    }
    onProgress?.({ stage: "chats", current: 2, total: 5, message: "Loading chats..." });
    const chats = new Map;
    for (const row of lineDb.prepare("SELECT Z_PK, ZMID, ZTYPE FROM ZCHAT").iterate()) {
      const mid = (row.ZMID || "").toLowerCase();
      const kind = row.ZTYPE === 2 ? "group" : row.ZTYPE === 0 ? "dm" : `type${row.ZTYPE}`;
      chats.set(row.Z_PK, {
        chatMid: mid || `chat${row.Z_PK}`,
        kind,
        name: groupNames.get(mid) || null
      });
    }
    onProgress?.({ stage: "messages", current: 3, total: 5, message: "Parsing messages..." });
    const messages = new Map;
    const chatInfos = [];
    let totalMessages = 0;
    const chatRows = lineDb.prepare("SELECT Z_PK, ZMID, ZTYPE, ZLASTUPDATED FROM ZCHAT ORDER BY ZLASTUPDATED DESC").all();
    for (let i = 0;i < chatRows.length; i++) {
      const cr = chatRows[i];
      if (!cr)
        continue;
      const chat = chats.get(cr.Z_PK);
      if (!chat)
        continue;
      onProgress?.({
        stage: "messages",
        current: 3,
        total: 5,
        message: `Parsing ${chat.chatMid} (${i + 1}/${chatRows.length})`,
        chatMid: chat.chatMid
      });
      const msgs = lineDb.prepare(`SELECT Z_PK, ZCONTENTTYPE, ZSENDSTATUS, ZTIMESTAMP, ZSENDER, ZID, ZTEXT, ZCONTENTMETADATA
           FROM ZMESSAGE WHERE ZCHAT = ? ORDER BY ZTIMESTAMP, Z_PK`).all(cr.Z_PK);
      if (msgs.length === 0)
        continue;
      const chatMessages = [];
      let firstTs = null;
      let lastTs = null;
      for (const m of msgs) {
        let meta = null;
        if (m.ZCONTENTMETADATA) {
          meta = parseContentMetadata(m.ZCONTENTMETADATA);
        }
        let fromMid = null;
        let fromName = "?";
        if (m.ZSENDER === null) {
          fromMid = myMid;
          fromName = "me";
        } else {
          const u = users.get(m.ZSENDER);
          fromMid = u?.mid || null;
          fromName = u?.name || "?";
        }
        const record = {
          id: m.ZID,
          ts: m.ZTIMESTAMP,
          iso: toIso(m.ZTIMESTAMP),
          contentType: m.ZCONTENTTYPE,
          sendStatus: m.ZSENDSTATUS,
          fromMid,
          fromName,
          text: m.ZTEXT,
          contentMetadata: meta
        };
        chatMessages.push(record);
        totalMessages++;
        if (firstTs === null)
          firstTs = m.ZTIMESTAMP;
        lastTs = m.ZTIMESTAMP;
      }
      messages.set(chat.chatMid, chatMessages);
      chatInfos.push({
        chatMid: chat.chatMid,
        kind: chat.kind,
        name: chat.name,
        count: chatMessages.length,
        firstIso: firstTs ? toIso(firstTs) : null,
        lastIso: lastTs ? toIso(lastTs) : null,
        file: `${chat.chatMid}.jsonl`
      });
    }
    onProgress?.({ stage: "writing", current: 4, total: 5, message: "Writing output files..." });
    mkdirSync2(outputDir, { recursive: true });
    for (const [chatMid, msgs] of messages) {
      const fname = `${chatMid}.jsonl`;
      const lines = msgs.map((m) => JSON.stringify(m)).join(`
`);
      writeFileSync3(join3(outputDir, fname), `${lines}
`, "utf-8");
    }
    chatInfos.sort((a, b) => b.count - a.count);
    const index = {
      account: myMid,
      exportedAt: new Date().toISOString(),
      chats: chatInfos
    };
    writeFileSync3(join3(outputDir, "index.json"), JSON.stringify(index, null, 1), "utf-8");
    onProgress?.({ stage: "complete", current: 5, total: 5, message: "Parse complete" });
    const groups = chatInfos.filter((c) => c.kind === "group").length;
    const dms = chatInfos.filter((c) => c.kind === "dm").length;
    console.log(`[parse] messages=${totalMessages.toLocaleString()} chats=${chatInfos.length} (group=${groups}, dm=${dms}) -> ${outputDir}`);
    return {
      account: myMid,
      exportedAt: index.exportedAt,
      chats: chatInfos,
      messages
    };
  } finally {
    lineDb.close();
    ugDb.close();
  }
}
function findLineDatabases(extractedDir) {
  const files = readdirSync(extractedDir);
  const lineDb = files.find((f) => f.includes("Line.sqlite") && !f.includes("UnifiedGroup"));
  const unifiedGroupDb = files.find((f) => f.includes("UnifiedGroup.sqlite"));
  if (!lineDb || !unifiedGroupDb)
    return null;
  return {
    lineDb: join3(extractedDir, lineDb),
    unifiedGroupDb: join3(extractedDir, unifiedGroupDb)
  };
}
function detectMyMid(lineDbPath) {
  const db = new Database2(lineDbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT ZMID FROM ZUSER WHERE ZCUSTOMNAME IS NOT NULL OR ZADDRESSBOOKNAME IS NOT NULL LIMIT 1").get();
    return row?.ZMID || "";
  } finally {
    db.close();
  }
}
var JST_OFFSET;
var init_parse = __esm(() => {
  JST_OFFSET = 9 * 60 * 60 * 1000;
});

// Vyline/packages/ios-backup/src/index.ts
init_keybag();
init_manifest();
init_extract();
init_parse();
import { join as join4 } from "node:path";
async function extractAndParseLineHistory(backupRoot, udid, password, outputDir, onProgress) {
  const { extractBackup: extractBackup2 } = await Promise.resolve().then(() => (init_extract(), exports_extract));
  const { parseLineDatabases: parseLineDatabases2, findLineDatabases: findLineDatabases2, detectMyMid: detectMyMid2 } = await Promise.resolve().then(() => (init_parse(), exports_parse));
  const extracted = await extractBackup2({
    backupRoot,
    udid,
    password,
    outputDir,
    onProgress: onProgress ? (p) => onProgress(p.stage, p.current, p.total, p.message) : undefined
  });
  const dbs = findLineDatabases2(outputDir);
  if (!dbs) {
    throw new Error("LINE databases not found in extracted backup");
  }
  const myMid = detectMyMid2(dbs.lineDb);
  const parsed = await parseLineDatabases2({
    lineDbPath: dbs.lineDb,
    unifiedGroupDbPath: dbs.unifiedGroupDb,
    outputDir: join4(outputDir, "dump"),
    myMid,
    onProgress: onProgress ? (p) => onProgress(p.stage, p.current, p.total, p.message) : undefined
  });
  return { extracted, parsed };
}
export {
  aesUnwrap,
  bplistToJson,
  closeBackup,
  detectMyMid,
  extractAndParseLineHistory,
  extractBackup,
  findLineDatabases,
  getFileDecryptedCopy,
  getFileManifestDBEntry,
  loopTLVBlocks,
  openBackup,
  parseBplist,
  parseContentMetadata,
  parseKeybag,
  parseLineDatabases,
  unlockClassKeys,
  unwrapKeyForClass
};
