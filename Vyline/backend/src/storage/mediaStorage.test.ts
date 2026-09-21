import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";

const storageRoot = await mkdtemp(join(tmpdir(), "vyline-media-storage-test-"));
process.env.VYLINE_MEDIA_STORAGE_DIR = storageRoot;

const {
  clearMediaStorage,
  clearMediaStorageForAccount,
  clearMediaStorageType,
  readMediaStorage,
  releaseMediaStorageCache,
  restoreMediaStorage,
  writeMediaStorage,
} = await import("./mediaStorage.js");

beforeAll(async () => {
  await clearMediaStorageForAccount("account");
  await clearMediaStorageForAccount("other-account");
});

afterEach(async () => {
  await clearMediaStorageForAccount("account");
  await clearMediaStorageForAccount("other-account");
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

  it("requires an account and never clears the shared root", async () => {
    await expect(clearMediaStorage()).rejects.toThrow("accountId is required");
    await expect(clearMediaStorageType("image")).rejects.toThrow("accountId is required");
  });

  it("moves only the selected account to trash and restores it", async () => {
    const accountBytes = new Uint8Array([7, 8, 9]);
    const otherBytes = new Uint8Array([10, 11, 12]);
    await writeMediaStorage("account", "chat", "trash-me", accountBytes, "image/png");
    await writeMediaStorage("other-account", "chat", "keep-me", otherBytes, "image/png");

    expect(await clearMediaStorageForAccount("account")).toBe(1);
    expect(await readMediaStorage("account", "chat", "trash-me")).toBeNull();
    expect(await readMediaStorage("other-account", "chat", "keep-me")).toEqual({
      buf: otherBytes,
      contentType: "image/png",
    });
    expect(await restoreMediaStorage("account", "chat", "trash-me")).toBe(true);
    expect(await readMediaStorage("account", "chat", "trash-me")).toEqual({
      buf: accountBytes,
      contentType: "image/png",
    });
  });
  it("releases account memory without deleting persisted media", async () => {
    const account = "account";
    const chat = "chat";
    const message = "release-me";
    const bytes = new Uint8Array([13, 14, 15]);
    await writeMediaStorage(account, chat, message, bytes, "image/png");

    releaseMediaStorageCache(account);
    const mediaHash = createHash("sha256").update(`${account}:${chat}:${message}`).digest("hex");
    const accountHash = createHash("sha256").update(account).digest("hex");
    await rm(
      join(
        storageRoot,
        "accounts",
        accountHash,
        "images",
        mediaHash.slice(0, 2),
        `${mediaHash}.png`,
      ),
      { force: true },
    );

    expect(await readMediaStorage(account, chat, message)).toBeNull();
  });

});
