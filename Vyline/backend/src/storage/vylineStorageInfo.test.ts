import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

if (process.env.VYLINE_STORAGE_INFO_TEST_CHILD !== "1") {
  test("storage info uses indexed backup/cache totals in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-storage-info-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_STORAGE_INFO_TEST_CHILD: "1",
          VYLINE_STORAGE_INFO_TEST_ROOT: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(code).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
} else {
  const root = process.env.VYLINE_STORAGE_INFO_TEST_ROOT!;
  const dataRoot = join(root, "data");
  const storageRoot = join(root, "storage");
  const backupRoot = join(dataRoot, "backups");
  process.env.VYLINE_DATA_DIR = dataRoot;
  process.env.VYLINE_STORAGE_DIR = storageRoot;
  process.env.VYLINE_BACKUP_DIR = backupRoot;
  process.env.VYLINE_MEDIA_STORAGE_DIR = join(storageRoot, "saved-media");
  process.env.VYLINE_MEDIA_INDEX_PATH = join(storageRoot, "media-index.sqlite");
  Reflect.deleteProperty(process.env, "VYLINE_CDN_CACHE_DIR");
  Reflect.deleteProperty(process.env, "VYLINE_ICON_CACHE_DIR");

  await fs.mkdir(join(backupRoot, "owner", "snapshot.media"), { recursive: true });
  const largeUnindexedSidecar = join(backupRoot, "owner", "snapshot.media", "large.bin");
  const sidecar = await fs.open(largeUnindexedSidecar, "w", 0o600);
  await sidecar.truncate(32 * 1024 * 1024);
  await sidecar.close();

  const backupIndex = new Database(join(backupRoot, "backup-index.sqlite"), { create: true });
  backupIndex.exec(`
    CREATE TABLE backup_index (
      account_id TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      chat_count INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      media_count INTEGER NOT NULL,
      include_media INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      PRIMARY KEY(account_id, id)
    )
  `);
  backupIndex
    .query(`
      INSERT INTO backup_index (
        account_id, id, created_at, chat_count, message_count,
        media_count, include_media, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run("owner", "vyline-backup-test", new Date(0).toISOString(), 1, 1, 1, 1, 321);
  backupIndex.close();

  await fs.mkdir(join(storageRoot, "cache", "cdn-cache"), { recursive: true });
  await fs.mkdir(join(storageRoot, "cache", "icons"), { recursive: true });
  await fs.writeFile(join(storageRoot, "cache", "cdn-cache", "asset.bin"), new Uint8Array(5));
  await fs.writeFile(join(storageRoot, "cache", "icons", "icon.bin"), new Uint8Array(7));

  const storageInfo = await import("./vylineStorageInfo.js");
  const info = await storageInfo.getVylineStorageInfo();
  expect(info.dataSize).toBe(321);
  expect(info.cacheSize).toBe(12);
  expect(info.cache).toEqual({ cdn: 5, icons: 7 });
  expect(info.savedMediaSize).toBe(0);
  expect(info.vylineTotal).toBe(info.dataSize + info.storageSize);

  const backupService = await import("../service/backupService.js");
  const mediaStorage = await import("./mediaStorage.js");
  await backupService.closeBackupStorage();
  await mediaStorage.closeMediaStorage();
}
