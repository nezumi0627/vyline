const SECRET_KEY = /token|cookie|authorization|csrf|crumb|password|secret|session/i;
const SECRET_VALUE =
  /(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*|(?:access[_-]?token|auth[_-]?token|refresh[_-]?token|csrf|crumb|cookie|password)\s*[:=]\s*["']?[^\s,"'};]+/gi;

export function redactSupportValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    let safeValue = value;
    if (/proxyurl/i.test(key) && value) {
      try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.pathname = "/";
        url.search = "";
        url.hash = "";
        safeValue = url.toString();
      } catch {
        return "[REDACTED_PROXY_URL]";
      }
    }
    return safeValue
      .replace(/(?:set-cookie|cookie)\s*[:=]\s*[^\r\n]*/gi, "[REDACTED_COOKIE]")
      .replace(SECRET_VALUE, "[REDACTED]")
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]");
  }
  if (Array.isArray(value)) return value.map((item) => redactSupportValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactSupportValue(child, childKey),
      ]),
    );
  }
  return value;
}

type BundleFile = { name: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function put16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function put32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

export function createSupportZip(files: BundleFile[]): Blob {
  const totalBytes = files.reduce((total, file) => total + file.data.byteLength, 0);
  if (files.length > 256 || totalBytes > 40 * 1024 * 1024) {
    throw new Error("サポートZIPは256ファイル・40MBまでです");
  }
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120));
    const data = file.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    put32(lv, 0, 0x04034b50);
    put16(lv, 4, 20);
    put16(lv, 6, 0x0800);
    put16(lv, 8, 0);
    put32(lv, 14, crc);
    put32(lv, 18, data.length);
    put32(lv, 22, data.length);
    put16(lv, 26, name.length);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    put32(cv, 0, 0x02014b50);
    put16(cv, 4, 20);
    put16(cv, 6, 20);
    put16(cv, 8, 0x0800);
    put16(cv, 10, 0);
    put32(cv, 16, crc);
    put32(cv, 20, data.length);
    put32(cv, 24, data.length);
    put16(cv, 28, name.length);
    put32(cv, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  put32(ev, 0, 0x06054b50);
  put16(ev, 8, files.length);
  put16(ev, 10, files.length);
  put32(ev, 12, centralSize);
  put32(ev, 16, localOffset);
  const parts = [...localParts, ...centralParts, end].map(
    (part) => new Uint8Array(part).buffer as ArrayBuffer,
  );
  return new Blob(parts, { type: "application/zip" });
}
