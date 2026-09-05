import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getFileDecryptedCopy, IosBackupExtractionLimitError } from "./extract.js";
import type { BackupManifest } from "./manifest.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(Array.from(value, (item) => item.charCodeAt(0)));
  if (bytes.length < 15) return concat([new Uint8Array([0x50 | bytes.length]), bytes]);
  return concat([new Uint8Array([0x5f, 0x10, bytes.length]), bytes]);
}

function integer(value: number): Uint8Array {
  return new Uint8Array([
    0x12,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function writeUInt64(target: Uint8Array, offset: number, value: number): void {
  let remaining = BigInt(value);
  for (let index = 7; index >= 0; index--) {
    target[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function finishPlist(objects: Uint8Array[]): Uint8Array {
  const header = new TextEncoder().encode("bplist00");
  const body = concat(objects);
  const offsets: number[] = [];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  const trailer = new Uint8Array(32);
  trailer[6] = 1;
  trailer[7] = 1;
  writeUInt64(trailer, 8, objects.length);
  writeUInt64(trailer, 16, 0);
  writeUInt64(trailer, 24, header.length + body.length);
  return concat([header, body, Uint8Array.from(offsets), trailer]);
}

function plainFileManifest(size: number): Uint8Array {
  return finishPlist([
    new Uint8Array([0xd2, 1, 2, 3, 4]),
    ascii("Size"),
    ascii("Mode"),
    integer(size),
    integer(0x81a4),
  ]);
}

function binaryData(value: Uint8Array): Uint8Array {
  if (value.length < 15) return concat([new Uint8Array([0x40 | value.length]), value]);
  if (value.length > 0xff) throw new Error("test plist data is too large");
  return concat([new Uint8Array([0x4f, 0x10, value.length]), value]);
}

function packUInt64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index--) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function unpackUInt64(value: Uint8Array): bigint {
  let result = 0n;
  for (const byte of value) result = (result << 8n) | BigInt(byte);
  return result;
}

function aesWrap(kek: Uint8Array, key: Uint8Array): Uint8Array {
  const blocks = Array.from({ length: key.length / 8 }, (_, index) =>
    key.slice(index * 8, index * 8 + 8),
  );
  let a = 0xa6a6a6a6a6a6a6a6n;
  for (let round = 0; round < 6; round++) {
    for (let index = 0; index < blocks.length; index++) {
      const cipher = createCipheriv("aes-256-ecb", kek, null);
      cipher.setAutoPadding(false);
      const encrypted = new Uint8Array(cipher.update(concat([packUInt64(a), blocks[index]!])));
      a = unpackUInt64(encrypted.subarray(0, 8)) ^ BigInt(blocks.length * round + index + 1);
      blocks[index] = encrypted.slice(8, 16);
    }
  }
  return concat([packUInt64(a), ...blocks]);
}

function encryptedFileManifest(size: number, wrappedKey: Uint8Array): Uint8Array {
  const keyData = concat([new Uint8Array(4), wrappedKey]);
  return finishPlist([
    new Uint8Array([0xd4, 1, 2, 3, 4, 5, 6, 7, 8]),
    ascii("Size"),
    ascii("Mode"),
    ascii("EncryptionKey"),
    ascii("ProtectionClass"),
    integer(size),
    integer(0x81a4),
    binaryData(keyData),
    integer(1),
  ]);
}

describe("iOS backup file extraction", () => {
  test("rejects a plain file before copy when it exceeds the work limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-ios-extract-limit-"));
    tempDirs.push(root);
    const udid = "device";
    const fileID = "bb00000000000000000000000000000000000000";
    const sourcePath = join(root, udid, fileID.slice(0, 2), fileID);
    const targetPath = join(root, "output", "too-large.bin");
    await mkdir(dirname(sourcePath), { recursive: true });
    const size = 1024 * 1024;
    const source = await open(sourcePath, "w");
    try {
      await source.truncate(size);
    } finally {
      await source.close();
    }
    const backup = {
      backupRoot: root,
      udid,
      keybag: { classKeys: new Map() },
    } as unknown as BackupManifest;

    await expect(
      getFileDecryptedCopy(
        backup,
        {
          fileID,
          domain: "AppDomain-jp.naver.line",
          relativePath: "Library/too-large.bin",
          file: plainFileManifest(size),
        },
        targetPath,
        size - 1,
      ),
    ).rejects.toBeInstanceOf(IosBackupExtractionLimitError);
    expect(existsSync(targetPath)).toBe(false);
    expect(existsSync(`${targetPath}.partial`)).toBe(false);
  });

  test("rejects a truncated encrypted file when decrypted bytes are below declared size", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-ios-extract-truncated-"));
    tempDirs.push(root);
    const udid = "device";
    const fileID = "cc00000000000000000000000000000000000000";
    const sourcePath = join(root, udid, fileID.slice(0, 2), fileID);
    const targetPath = join(root, "output", "truncated.bin");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, new Uint8Array(16));
    const classKey = new Uint8Array(32).fill(0x11);
    const fileKey = new Uint8Array(32).fill(0x22);
    const backup = {
      backupRoot: root,
      udid,
      keybag: {
        classKeys: new Map([
          [
            1,
            {
              uuid: new Uint8Array(),
              clas: new Uint8Array([0, 0, 0, 1]),
              wrap: 0,
              wpky: new Uint8Array(),
              ktyp: new Uint8Array(),
              pbky: new Uint8Array(),
              key: classKey,
            },
          ],
        ]),
      },
    } as unknown as BackupManifest;

    await expect(
      getFileDecryptedCopy(
        backup,
        {
          fileID,
          domain: "AppDomain-jp.naver.line",
          relativePath: "Library/truncated.bin",
          file: encryptedFileManifest(32, aesWrap(classKey, fileKey)),
        },
        targetPath,
      ),
    ).rejects.toThrow("does not match declared size 32");
    expect(existsSync(targetPath)).toBe(false);
    expect(existsSync(`${targetPath}.partial`)).toBe(false);
  });

  test("copies a 64 MiB plain file disk-to-disk with bounded RSS", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-ios-extract-"));
    tempDirs.push(root);
    const udid = "device";
    const fileID = "aa00000000000000000000000000000000000000";
    const sourcePath = join(root, udid, fileID.slice(0, 2), fileID);
    const targetPath = join(root, "output", "large.bin");
    await mkdir(dirname(sourcePath), { recursive: true });
    const source = await open(sourcePath, "w");
    const size = 64 * 1024 * 1024;
    try {
      await source.truncate(size);
    } finally {
      await source.close();
    }
    const backup = {
      backupRoot: root,
      udid,
      keybag: { classKeys: new Map() },
    } as unknown as BackupManifest;

    Bun.gc(true);
    const rssBefore = process.memoryUsage().rss;
    let peakRss = rssBefore;
    let heartbeats = 0;
    const heartbeat = setInterval(() => {
      heartbeats++;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 1);
    try {
      const result = await getFileDecryptedCopy(
        backup,
        {
          fileID,
          domain: "AppDomain-jp.naver.line",
          relativePath: "Library/large.bin",
          file: plainFileManifest(size),
        },
        targetPath,
      );
      expect(result).toEqual({ size, isDirectory: false });
    } finally {
      clearInterval(heartbeat);
    }
    const rssGrowth = Math.max(0, peakRss - rssBefore);
    console.info("[ios-extract-plain-64m]", { rssGrowth, heartbeats });
    expect((await stat(targetPath)).size).toBe(size);
    expect(existsSync(`${targetPath}.partial`)).toBe(false);
    expect(rssGrowth).toBeLessThan(32 * 1024 * 1024);
    expect(heartbeats).toBeGreaterThan(0);
    await expect(
      getFileDecryptedCopy(
        backup,
        {
          fileID,
          domain: "AppDomain-jp.naver.line",
          relativePath: "Library/large.bin",
          file: plainFileManifest(size),
        },
        targetPath,
      ),
    ).rejects.toThrow("Refusing to replace extracted file");
  }, 30_000);
});
