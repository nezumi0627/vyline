import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_MANIFEST_PLIST_BYTES, openBackup } from "./manifest.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("rejects an unterminated XML Manifest.plist without scanning past EOF", async () => {
  const root = await mkdtemp(join(tmpdir(), "vyline-ios-manifest-xml-"));
  tempDirs.push(root);
  const udid = "device";
  const deviceRoot = join(root, udid);
  await mkdir(deviceRoot, { recursive: true });
  await writeFile(
    join(deviceRoot, "Manifest.plist"),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>unterminated',
  );

  await expect(openBackup(root, udid, "password", join(root, "output"))).rejects.toThrow(
    "Malformed XML plist: unterminated key",
  );
}, 1_000);

test("uses an 8 MiB default Manifest.plist cap and permits an environment override", async () => {
  expect(DEFAULT_MAX_MANIFEST_PLIST_BYTES).toBe(8 * 1024 * 1024);
  const root = await mkdtemp(join(tmpdir(), "vyline-ios-manifest-limit-"));
  tempDirs.push(root);
  const udid = "device";
  const deviceRoot = join(root, udid);
  await mkdir(deviceRoot, { recursive: true });
  await writeFile(join(deviceRoot, "Manifest.plist"), new Uint8Array(17));
  const previous = Reflect.get(process.env, "VYLINE_IOS_MAX_MANIFEST_PLIST_BYTES") as
    | string
    | undefined;
  Reflect.set(process.env, "VYLINE_IOS_MAX_MANIFEST_PLIST_BYTES", "16");
  try {
    await expect(openBackup(root, udid, "password", join(root, "output"))).rejects.toThrow(
      "Manifest.plist exceeds the 16 byte safety limit",
    );
  } finally {
    if (previous === undefined)
      Reflect.deleteProperty(process.env, "VYLINE_IOS_MAX_MANIFEST_PLIST_BYTES");
    else Reflect.set(process.env, "VYLINE_IOS_MAX_MANIFEST_PLIST_BYTES", previous);
  }
});
