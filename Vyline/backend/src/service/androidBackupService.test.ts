import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import {
  androidContentType,
  extractAndroidZip,
  parseAndroidParameter,
  startAndroidBackupRestore,
} from "./androidBackupService.js";

describe("Android LINE backup import", () => {
  test("parses tab-separated LINE contentMetadata without dropping Android-only fields", () => {
    expect(
      parseAndroidParameter(
        "STKPKGID\t123\tSTKID\t456\tmessage_relation_type_code\treply\tmessage_relation_server_message_id\t999",
      ),
    ).toEqual({
      STKPKGID: "123",
      STKID: "456",
      message_relation_type_code: "reply",
      message_relation_server_message_id: "999",
    });
  });

  test("maps Android attachment and unsent types to Vyline content types", () => {
    expect(androidContentType(1, 0)).toBe("NONE");
    expect(androidContentType(1, 1)).toBe("IMAGE");
    expect(androidContentType(5, 7)).toBe("STICKER");
    expect(androidContentType(13, 18)).toBe("CHATEVENT");
    expect(androidContentType(27, 0)).toBe("UNSENT");
  });

  test("reserves declared ZIP output before writing the database entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-android-zip-capacity-"));
    const source = join(root, "backup.zip");
    const output = join(root, "output");
    const databaseBytes = 4 * 1024 * 1024;
    await writeFile(
      source,
      zipSync({ "database/naver_line": new Uint8Array(databaseBytes) }, { level: 6 }),
    );

    let reservedBytes = 0;
    try {
      await expect(
        extractAndroidZip(source, output, false, undefined, async (bytes) => {
          reservedBytes = bytes;
          throw new Error("capacity rejected before start");
        }),
      ).rejects.toThrow("capacity rejected before start");
      expect(reservedBytes).toBe(databaseBytes);
      const outputInfo = await stat(join(output, "database-0.sqlite")).catch(() => null);
      expect(outputInfo?.size ?? 0).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("starts ignored ZIP entries instead of retaining their compressed chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-android-zip-ignore-"));
    const source = join(root, "backup.zip");
    const output = join(root, "output");
    const archive = zipSync({
      "ignored.bin": new Uint8Array([1, 2, 3, 4]),
      "database/naver_line": new Uint8Array(16),
    });
    // An ignored entry with an unsupported method only fails when it is
    // actually started. This protects against fflate buffering it indefinitely.
    archive[8] = 99;
    archive[9] = 0;
    await writeFile(source, archive);

    try {
      await expect(extractAndroidZip(source, output, false)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
