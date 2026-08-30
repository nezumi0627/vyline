import { afterAll, afterEach, describe, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = await mkdtemp(join(tmpdir(), "vyline-backup-security-"));
const oldEnv = {
  data: process.env.VYLINE_DATA_DIR,
  backups: process.env.VYLINE_BACKUP_DIR,
  media: process.env.VYLINE_MEDIA_STORAGE_DIR,
  storage: process.env.VYLINE_STORAGE_DIR,
};
process.env.VYLINE_DATA_DIR = join(testRoot, "data");
process.env.VYLINE_BACKUP_DIR = join(testRoot, "backups");
process.env.VYLINE_STORAGE_DIR = join(testRoot, "storage");
process.env.VYLINE_MEDIA_STORAGE_DIR = join(testRoot, "media");
await mkdir(process.env.VYLINE_MEDIA_STORAGE_DIR, { recursive: true });

const {
  createBackup,
  listBackups,
  readBackup,
  restoreBackup,
  deleteBackup,
  getBackupStorageUsage,
  BACKUP_STORAGE_LIMIT_BYTES,
} = await import("./backupService.js");
const { exportChatDb, importChatDb, flushAccountChatDb } = await import("../storage/chatStore.js");
const { readMediaStorage, writeMediaStorage } = await import("../storage/mediaStorage.js");
const { accountFile, readAccountJson } = await import("../storage/accountDirs.js");

function backupDir(accountId: string) {
  return join(process.env.VYLINE_BACKUP_DIR!, createHash("sha256").update(accountId).digest("hex"));
}
async function seed(accountId: string, text: string) {
  const date = new Date().toISOString();
  await importChatDb(accountId, {
    meta: {},
    chats: {
      shared: {
        mid: "shared",
        name: "shared chat",
        kind: "direct",
        hasMessages: true,
        updatedAt: date,
      },
    },
    messages: {
      shared: {
        "1": {
          id: "1",
          chatMid: "shared",
          from: "sender",
          to: "shared",
          text,
          contentType: "IMAGE",
          createdTime: 1,
          isMyMessage: false,
          savedAt: date,
        },
      },
    },
  });
  await flushAccountChatDb(accountId);
}

// Simulate occupied disk bytes without creating a physical 10GB test file.
const realStat = fs.stat;
async function occupy(accountId: string, bytes: number) {
  const path = join(backupDir(accountId), "reserved-test-bytes.bin");
  await mkdir(backupDir(accountId), { recursive: true });
  await writeFile(path, "x");
  spyOn(fs, "stat").mockImplementation((async (target) => {
    const result = await realStat(target);
    if (String(target) === path) result.size = bytes;
    return result;
  }) as typeof fs.stat);
}

afterEach(() => {
  mock.restore();
  setSystemTime();
});

afterAll(async () => {
  for (const [name, value] of Object.entries({
    VYLINE_DATA_DIR: oldEnv.data,
    VYLINE_BACKUP_DIR: oldEnv.backups,
    VYLINE_MEDIA_STORAGE_DIR: oldEnv.media,
    VYLINE_STORAGE_DIR: oldEnv.storage,
  })) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  if (testRoot.startsWith(join(tmpdir(), "vyline-backup-security-")))
    await rm(testRoot, { recursive: true, force: true });
});

describe("VylineBackup path safety", () => {
  test("does not use a crafted account ID to read another account's legacy history", async () => {
    const legacyPath = join(process.env.VYLINE_DATA_DIR!, "chatdb-victim.json");
    await mkdir(process.env.VYLINE_DATA_DIR!, { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ owner: "victim" }));
    expect(await readAccountJson("ignored/../chatdb-victim", "chatdb.json", legacyPath)).toBeNull();
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual({ owner: "victim" });
  });
  test("sanitizes account IDs before using them in snapshot filenames", async () => {
    const accountId = "../../outside";
    const summary = await createBackup(accountId, { includeMedia: false });

    expect(summary.id).not.toContain("..");
    expect(summary.id).not.toMatch(/[\\/]/);
    expect((await readdir(backupDir(accountId))).sort()).toEqual([
      `${summary.id}.json`,
      `${summary.id}.json.meta`,
    ]);
    expect((await listBackups(accountId)).map((item) => item.id)).toContain(summary.id);
    expect(await readBackup(accountId, summary.id)).not.toBeNull();
  });

  test("separates messages, media, listing, restore and deletion across accounts with similar IDs", async () => {
    const first = "same.a";
    const second = "samea";
    await seed(first, "日本語の履歴 A");
    await seed(second, "別アカウント B");
    await writeMediaStorage(first, "shared", "1", new TextEncoder().encode("image A"), "image/png");
    await writeMediaStorage(
      second,
      "shared",
      "1",
      new TextEncoder().encode("image B"),
      "image/png",
    );
    const [a, b] = await Promise.all([
      createBackup(first, { includeMedia: true }),
      createBackup(second, { includeMedia: true }),
    ]);
    expect(accountFile(first, "chatdb.json")).not.toBe(accountFile(second, "chatdb.json"));
    expect(
      JSON.parse(await readFile(accountFile(first, "chatdb.json"), "utf8")).messages.shared["1"]
        .text,
    ).toContain(" A");
    expect((await readBackup(first, a.id))!.messages.shared!["1"]!.text).toContain(" A");
    expect((await readBackup(second, b.id))!.messages.shared!["1"]!.text).toContain(" B");
    expect((await listBackups(first)).map((entry) => entry.id)).toEqual([a.id]);
    expect(await readBackup(first, b.id)).toBeNull();
    expect(await deleteBackup(first, b.id)).toBe(false);
    await expect(restoreBackup(first, b.id, { includeMedia: true })).rejects.toThrow(
      "見つかりません",
    );
    expect(new TextDecoder().decode((await readMediaStorage(second, "shared", "1"))!.buf)).toBe(
      "image B",
    );
    const bytes = await readFile(join(backupDir(first), `${a.id}.json`));
    expect(a.sizeBytes).toBe(bytes.byteLength);
    expect(a.sizeBytes).toBeGreaterThan(bytes.toString("utf8").length);
  });

  test("does not duplicate restored messages or overwrite newer text and media", async () => {
    const accountId = "repeat-restore";
    await seed(accountId, "old text");
    await writeMediaStorage(
      accountId,
      "shared",
      "1",
      new TextEncoder().encode("old image"),
      "image/png",
    );
    const snapshot = await createBackup(accountId, { includeMedia: true });
    await seed(accountId, "new text");
    await writeMediaStorage(
      accountId,
      "shared",
      "1",
      new TextEncoder().encode("new image"),
      "image/png",
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await restoreBackup(accountId, snapshot.id, { includeMedia: true })).toMatchObject({
        restoredMessages: 0,
        restoredMedia: 0,
      });
    }
    const db = await exportChatDb(accountId);
    expect(Object.keys(db.messages.shared!)).toHaveLength(1);
    expect(db.messages.shared!["1"]!.text).toBe("new text");
    expect(new TextDecoder().decode((await readMediaStorage(accountId, "shared", "1"))!.buf)).toBe(
      "new image",
    );
  });

  test("restores selected messages and media from disk in a fresh process", async () => {
    const accountId = "streamed-restore";
    const text = "日本語の長いメッセージ".repeat(8000);
    await seed(accountId, text);
    await importChatDb(accountId, {
      meta: {},
      chats: {
        excluded: {
          mid: "excluded",
          name: "not selected",
          kind: "direct",
          hasMessages: true,
          updatedAt: new Date().toISOString(),
        },
      },
      messages: {
        excluded: {
          "2": {
            id: "2",
            chatMid: "excluded",
            from: "sender",
            to: "excluded",
            text: "not selected",
            contentType: "TEXT",
            createdTime: 2,
            isMyMessage: false,
            savedAt: new Date().toISOString(),
          },
        },
      },
    });
    await flushAccountChatDb(accountId);
    const media = new Uint8Array(128 * 1024).fill(42);
    await writeMediaStorage(accountId, "shared", "1", media, "image/png");
    const snapshot = await createBackup(accountId, { includeMedia: true });
    const hash = createHash("sha256").update(`${accountId}:shared:1`).digest("hex");
    const mediaPath = join(
      process.env.VYLINE_MEDIA_STORAGE_DIR!,
      "images",
      hash.slice(0, 2),
      `${hash}.png`,
    );
    await rm(accountFile(accountId, "chatdb.json"));
    await rm(mediaPath);
    const script = `import { restoreBackup } from ${JSON.stringify(new URL("./backupService.ts", import.meta.url).href)};
      console.log(JSON.stringify(await restoreBackup(${JSON.stringify(accountId)}, ${JSON.stringify(snapshot.id)}, {chatMids:["shared"],includeMedia:true})));`;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      env: { ...process.env, LOG_LEVEL: "silent" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, errors }).toEqual({ code: 0, errors: "" });
    expect(JSON.parse(output)).toEqual({ restoredChats: 1, restoredMessages: 1, restoredMedia: 1 });
    const restored = JSON.parse(await readFile(accountFile(accountId, "chatdb.json"), "utf8"));
    expect(Object.keys(restored.messages)).toEqual(["shared"]);
    expect(restored.messages.shared["1"].text).toBe(text);
    expect(new Uint8Array(await readFile(mediaPath))).toEqual(media);
  });

  test("never overwrites snapshots created at the same instant", async () => {
    setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    const snapshots = await Promise.all(
      Array.from({ length: 3 }, () => createBackup("simultaneous", { includeMedia: false })),
    );
    expect(new Set(snapshots.map((entry) => entry.id)).size).toBe(3);
    expect(await listBackups("simultaneous")).toHaveLength(3);
  });

  test("enforces 10GB per account even for concurrent creation and preserves old snapshots", async () => {
    expect(BACKUP_STORAGE_LIMIT_BYTES).toBe(10 * 1024 ** 3);
    const accountId = "quota-concurrent";
    const first = await createBackup(accountId, { includeMedia: false });
    const before = await readFile(join(backupDir(accountId), `${first.id}.json`));
    const firstUsage = (await getBackupStorageUsage(accountId)).usedBytes;
    await occupy(accountId, BACKUP_STORAGE_LIMIT_BYTES - 2 * firstUsage);
    const results = await Promise.allSettled([
      createBackup(accountId, { includeMedia: false }),
      createBackup(accountId, { includeMedia: false }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.message).toContain("10GB");
    expect((await getBackupStorageUsage(accountId)).usedBytes).toBe(BACKUP_STORAGE_LIMIT_BYTES);
    expect(await readFile(join(backupDir(accountId), `${first.id}.json`))).toEqual(before);
    expect(await createBackup("independent-quota", { includeMedia: false })).toBeTruthy();
    expect((await getBackupStorageUsage("independent-quota")).remainingBytes).toBeGreaterThan(0);
    expect(await deleteBackup(accountId, first.id)).toBe(true);
    expect((await getBackupStorageUsage(accountId)).remainingBytes).toBe(firstUsage);
  });

  test("cleans up a rejected partial backup and counts base64 and metadata bytes", async () => {
    const accountId = "quota-media";
    await seed(accountId, "text");
    await writeMediaStorage(accountId, "shared", "1", new Uint8Array(1024), "image/png");
    await occupy(accountId, BACKUP_STORAGE_LIMIT_BYTES - 1000);
    await expect(createBackup(accountId, { includeMedia: true })).rejects.toThrow("10GB");
    expect(await readdir(backupDir(accountId))).toEqual(["reserved-test-bytes.bin"]);
    expect(await listBackups(accountId)).toEqual([]);
  });

  test("keeps legacy backups readable but never lists or counts a different prefix-sharing account", async () => {
    const id = "vyline-backup-legacy-owner-2026-08-30";
    const snapshot = {
      schema: "vyline-backup",
      version: 1,
      accountId: "legacy-owner",
      createdAt: new Date().toISOString(),
      includeMedia: false,
      chatMids: null,
      chats: {},
      messages: {},
      media: [],
    };
    const path = join(process.env.VYLINE_BACKUP_DIR!, `${id}.json`);
    await writeFile(path, JSON.stringify(snapshot));
    expect(await listBackups("legacy")).toEqual([]);
    expect((await getBackupStorageUsage("legacy")).usedBytes).toBe(0);
    expect(await readBackup("legacy", id)).toBeNull();
    expect(await readBackup("legacy-owner", id)).not.toBeNull();
    expect((await getBackupStorageUsage("legacy-owner")).usedBytes).toBe((await stat(path)).size);
    expect(await deleteBackup("legacy", id)).toBe(false);
    expect(await deleteBackup("legacy-owner", id)).toBe(true);
  });

  test("recovers a completed snapshot if its small listing metadata was lost", async () => {
    const accountId = "missing-metadata";
    const backup = await createBackup(accountId, { includeMedia: false });
    await rm(join(backupDir(accountId), `${backup.id}.json.meta`));
    expect((await listBackups(accountId)).map((entry) => entry.id)).toEqual([backup.id]);
    expect(await readBackup(accountId, backup.id)).not.toBeNull();
    expect(await deleteBackup(accountId, backup.id)).toBe(true);
  });

  test("uses VYLINE_DATA_DIR for the default backup location", async () => {
    const dataDir = join(testRoot, "default-location");
    const env = { ...process.env, VYLINE_DATA_DIR: dataDir, LOG_LEVEL: "silent" };
    Reflect.deleteProperty(env, "VYLINE_BACKUP_DIR");
    const script = `import { createBackup } from ${JSON.stringify(new URL("./backupService.ts", import.meta.url).href)};
      console.log(JSON.stringify(await createBackup("default-location-test", {includeMedia:false})));`;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, errors }).toEqual({ code: 0, errors: "" });
    const id = JSON.parse(output).id;
    const directory = createHash("sha256").update("default-location-test").digest("hex");
    expect((await stat(join(dataDir, "backups", directory, `${id}.json`))).size).toBeGreaterThan(0);
  });

  test("migrates an unambiguous legacy account directory without assigning it to another account", async () => {
    const registryPath = join(process.env.VYLINE_DATA_DIR!, "accounts.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    registry.accounts.push({
      accountId: "CaseTest",
      dirName: "casetest",
      registeredAt: new Date().toISOString(),
    });
    await writeFile(registryPath, JSON.stringify(registry));
    const oldPath = join(process.env.VYLINE_DATA_DIR!, "accounts", "casetest", "chatdb.json");
    await mkdir(join(process.env.VYLINE_DATA_DIR!, "accounts", "casetest"), { recursive: true });
    await writeFile(oldPath, JSON.stringify({ owner: "CaseTest" }));
    expect(
      await readAccountJson<{ owner: string }>(
        "CaseTest",
        "chatdb.json",
        join(process.env.VYLINE_DATA_DIR!, "missing.json"),
      ),
    ).toEqual({ owner: "CaseTest" });
    await expect(
      readAccountJson(
        "casetest",
        "chatdb.json",
        join(process.env.VYLINE_DATA_DIR!, "missing.json"),
      ),
    ).rejects.toThrow("重複");
    expect(JSON.parse(await readFile(oldPath, "utf8"))).toEqual({ owner: "CaseTest" });
  });
});
