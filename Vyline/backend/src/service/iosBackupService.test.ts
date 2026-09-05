import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

if (process.env.VYLINE_IOS_MEDIA_PLAN_TEST_CHILD !== "1") {
  test("iOS media planning uses the extracted-file substring index", async () => {
    const root = join(tmpdir(), `vyline-ios-media-plan-${crypto.randomUUID()}`);
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        VYLINE_IOS_MEDIA_PLAN_TEST_CHILD: "1",
        VYLINE_DATA_DIR: join(root, "data"),
        VYLINE_STORAGE_DIR: join(root, "storage"),
        VYLINE_MEDIA_STORAGE_DIR: join(root, "media"),
        VYLINE_BACKUP_DIR: join(root, "backups"),
        IOS_BACKUP_ROOT: join(root, "ios-source"),
        VYLINE_BACKUP_HEAVY_MAX_ITEMS: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${output}\n${errors}`);
    expect(code).toBe(0);
  });
} else {
  test("plans a substring match through FTS5 trigram lookup", async () => {
    const root = resolve(process.env.VYLINE_DATA_DIR!, "..");
    await mkdir(root, { recursive: true });
    const stagingPath = join(root, "staging.sqlite");
    const fileIndexPath = join(root, "files.sqlite");
    const localPath = join(root, "prefix-abcdefgh12345678-suffix.bin");
    const decoyPath = join(root, "other-abcdefgh12345678-copy.bin");
    const { AndroidBackupStaging } = await import("./androidBackupStaging.js");
    const { planIosMediaFromStaging } = await import("./iosBackupService.js");
    const { closeMediaStorage } = await import("../storage/mediaStorage.js");
    const staging = new AndroidBackupStaging(stagingPath);
    try {
      const writeStage = new Database(stagingPath, { strict: true });
      try {
        writeStage.exec(`
          CREATE TABLE staged_ios_media_tokens (
            chat_mid TEXT NOT NULL,
            message_id TEXT NOT NULL,
            token_lower TEXT NOT NULL,
            PRIMARY KEY (chat_mid, message_id, token_lower)
          ) WITHOUT ROWID;
          INSERT INTO staged_media_refs VALUES ('c-test', 'm-test', 'm-test', 'IMAGE');
          INSERT INTO staged_ios_media_tokens VALUES ('c-test', 'm-test', 'abcdefgh12345678');
        `);
      } finally {
        writeStage.close();
      }

      await writeFile(localPath, new Uint8Array([1, 2, 3, 4]));
      const index = new Database(fileIndexPath, { create: true, strict: true });
      try {
        index.exec(`
          CREATE TABLE extracted_files (
            file_id TEXT PRIMARY KEY,
            domain TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            relative_lower TEXT NOT NULL,
            basename_lower TEXT NOT NULL,
            stem_lower TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            local_path TEXT NOT NULL,
            is_database INTEGER NOT NULL,
            is_directory INTEGER NOT NULL
          );
          CREATE VIRTUAL TABLE extracted_files_fts USING fts5(
            file_id UNINDEXED,
            relative_lower,
            tokenize = 'trigram'
          );
        `);
        index
          .query("INSERT INTO extracted_files VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)")
          .run(
            "file-1",
            "AppDomain-jp.naver.line",
            "Library/prefix-abcdefgh12345678-suffix.bin",
            "library/prefix-abcdefgh12345678-suffix.bin",
            "prefix-abcdefgh12345678-suffix.bin",
            "prefix-abcdefgh12345678-suffix",
            4,
            localPath,
          );
        index
          .query("INSERT INTO extracted_files_fts VALUES (?, ?)")
          .run("file-1", "library/prefix-abcdefgh12345678-suffix.bin");
      } finally {
        index.close();
      }

      await planIosMediaFromStaging("account", fileIndexPath, staging);
      expect(staging.mediaPlanStats()).toEqual({ count: 1, sizeBytes: 4 });
      expect(staging.mediaPlanPage(null, 1)[0]?.path).toBe(localPath);

      // The same strong token resolving to two files is ambiguous. Never pick
      // the first row by lexical order, as that can silently attach a decoy.
      await writeFile(decoyPath, new Uint8Array([5, 6, 7, 8]));
      const ambiguous = new Database(fileIndexPath, { strict: true });
      try {
        ambiguous
          .query("INSERT INTO extracted_files VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)")
          .run(
            "file-2",
            "AppDomain-jp.naver.line",
            "Library/other-abcdefgh12345678-copy.bin",
            "library/other-abcdefgh12345678-copy.bin",
            "other-abcdefgh12345678-copy.bin",
            "other-abcdefgh12345678-copy",
            4,
            decoyPath,
          );
        ambiguous
          .query("INSERT INTO extracted_files_fts VALUES (?, ?)")
          .run("file-2", "library/other-abcdefgh12345678-copy.bin");
      } finally {
        ambiguous.close();
      }
      const clearPlan = new Database(stagingPath, { strict: true });
      try {
        clearPlan.exec("DELETE FROM staged_media_plan");
      } finally {
        clearPlan.close();
      }
      await planIosMediaFromStaging("account", fileIndexPath, staging);
      expect(staging.mediaPlanStats()).toEqual({ count: 0, sizeBytes: 0 });
    } finally {
      staging.close();
      await closeMediaStorage();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("marks the session failed when the bounded heavy queue is full", async () => {
    const root = resolve(process.env.VYLINE_DATA_DIR!, "..");
    const deviceId = "device-full-queue";
    const deviceRoot = join(process.env.IOS_BACKUP_ROOT!, deviceId);
    await mkdir(deviceRoot, { recursive: true });
    await writeFile(join(deviceRoot, "Manifest.plist"), "placeholder");
    await writeFile(join(deviceRoot, "Manifest.db"), "placeholder");
    const { reserveHeavyBackupWork } = await import("./diskBackedWorkQueue.js");
    const { startIosBackupRestore } = await import("./iosBackupService.js");
    const holder = reserveHeavyBackupWork("holder");
    try {
      const session = await startIosBackupRestore("account", deviceId, "password");
      for (let attempt = 0; attempt < 20 && session.status === "pending"; attempt++) {
        await Bun.sleep(0);
      }
      expect(session.status).toBe("failed");
      expect(session.error).toContain("混雑");
    } finally {
      holder.release();
      await rm(root, { recursive: true, force: true });
    }
  });
}
