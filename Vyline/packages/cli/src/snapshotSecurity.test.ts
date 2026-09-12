import { describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import {
  MAX_SNAPSHOT_FILES,
  measureSnapshotTree,
  validateSnapshotArchiveEntries,
} from "./snapshotSecurity.js";

describe("snapshot restore safety", () => {
  it("rejects absolute and traversal paths", () => {
    for (const entry of ["../escape", "/tmp/escape", "C:/escape", "payload/../escape"]) {
      expect(() => validateSnapshotArchiveEntries([entry])).toThrow();
    }
  });

  it("allows only the snapshot payload and manifest", () => {
    expect(() =>
      validateSnapshotArchiveEntries(["payload/", "payload/accounts/data.json", "manifest.json"]),
    ).not.toThrow();
    expect(() => validateSnapshotArchiveEntries(["README.md"])).toThrow();
  });

  it("rejects archives with too many entries before extraction", () => {
    expect(() =>
      validateSnapshotArchiveEntries(
        Array.from({ length: MAX_SNAPSHOT_FILES + 1 }, (_, index) => `payload/${index}`),
      ),
    ).toThrow("too many files");
  });

  it("counts extracted files without following symlinks", async () => {
    const root = `/tmp/vyline-snapshot-test-${crypto.randomUUID()}`;
    await mkdir(`${root}/payload`, { recursive: true });
    await Bun.write(`${root}/payload/message.json`, "{}");
    await expect(measureSnapshotTree(root)).resolves.toEqual({ files: 1, bytes: 2 });
    await rm(root, { recursive: true, force: true });
  });
});
