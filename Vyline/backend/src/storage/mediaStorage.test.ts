import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const storageRoot = await mkdtemp(join(tmpdir(), "vyline-media-storage-test-"));
process.env.VYLINE_MEDIA_STORAGE_DIR = storageRoot;

const { clearMediaStorageType, readMediaStorage, writeMediaStorage } = await import(
  "./mediaStorage.js"
);

beforeAll(async () => {
  await clearMediaStorageType("image");
  await clearMediaStorageType("file");
});

afterAll(async () => {
  // biome-ignore lint/performance/noDelete: the storage override must be absent after this test.
  delete process.env.VYLINE_MEDIA_STORAGE_DIR;
  await rm(storageRoot, { recursive: true, force: true });
});

describe("media storage", () => {
  it("reads media written to the current type layout", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await writeMediaStorage("account", "chat", "current", bytes, "image/png");

    expect(await readMediaStorage("account", "chat", "current")).toEqual({
      buf: bytes,
      contentType: "image/png",
    });
  });

  it("keeps reading files migrated into the legacy root layout", async () => {
    const hash = createHash("sha256").update("account:chat:migrated").digest("hex");
    const dir = join(storageRoot, hash.slice(0, 2));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${hash}.pdf`), new Uint8Array([4, 5, 6]));

    expect(await readMediaStorage("account", "chat", "migrated")).toEqual({
      buf: new Uint8Array([4, 5, 6]),
      contentType: "application/pdf",
    });
  });
});
