import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = await mkdtemp(join(tmpdir(), "vyline-backup-security-"));
process.env.VYLINE_DATA_DIR = join(testRoot, "data");
process.env.VYLINE_BACKUP_DIR = join(testRoot, "backups");

const { createBackup, deleteBackup, listBackups, readBackup, restoreBackup } = await import(
  "./backupService.js"
);
const { exportChatDb, upsertChats, upsertMessages, markStoredMessagesReadThrough } = await import(
  "../storage/chatStore.js"
);
const { closeSqlite } = await import("../storage/sqlite.js");

afterAll(async () => {
  closeSqlite();
  await rm(testRoot, { recursive: true, force: true });
});

describe("VylineBackup path safety", () => {
  test("sanitizes account IDs before using them in snapshot filenames", async () => {
    const accountId = "../../outside";
    const summary = await createBackup(accountId, { includeMedia: false });

    expect(summary.id).not.toContain("..");
    expect(summary.id).not.toMatch(/[\\/]/);
    expect(await readdir(process.env.VYLINE_BACKUP_DIR!)).toEqual([`${summary.id}.json`]);
    expect((await listBackups(accountId)).map((item) => item.id)).toContain(summary.id);
    expect(await readBackup(accountId, summary.id)).not.toBeNull();
  });

  test("writes a signed v2 snapshot and preserves meta/read/soft-delete records on merge restore", async () => {
    const accountId = "account-a";
    const chatMid = "c-group";
    const message = {
      id: "100",
      chatMid,
      from: "u1",
      to: chatMid,
      text: null,
      contentType: "UNSENT",
      createdTime: 100,
      isMyMessage: false,
      messageState: "revoked-by-other" as const,
      savedAt: new Date().toISOString(),
    };
    await upsertChats(accountId, [
      { mid: chatMid, name: "group", kind: "group", hasMessages: true, updatedAt: message.savedAt },
    ]);
    await upsertMessages(accountId, chatMid, [message]);
    expect((await exportChatDb(accountId)).messages[chatMid]?.[message.id]?.messageState).toBe(
      "revoked-by-other",
    );
    await markStoredMessagesReadThrough(accountId, chatMid, message.id);
    const created = await createBackup(accountId, { includeMedia: false });
    const rawSnapshot = JSON.parse(
      await Bun.file(join(process.env.VYLINE_BACKUP_DIR!, `${created.id}.json`)).text(),
    ) as { messages: Record<string, Record<string, { messageState?: string }>> };
    expect(rawSnapshot.messages[chatMid]?.[message.id]?.messageState).toBe("revoked-by-other");
    const snapshot = await readBackup(accountId, created.id);
    expect(snapshot?.version).toBe(2);
    expect(snapshot?.integrity?.algorithm).toBe("sha256");
    expect(snapshot?.meta).toBeDefined();
    expect(snapshot?.messages[chatMid]?.[message.id]?.messageState).toBe("revoked-by-other");

    // Existing state remains authoritative when an older snapshot is merged.
    const result = await restoreBackup(accountId, created.id, { includeMedia: false });
    expect(result.restoredMessages).toBe(0);
    const roundTrip = await readBackup(accountId, created.id);
    expect(roundTrip?.messages[chatMid]?.[message.id]?.messageState).toBe("revoked-by-other");
  });

  test("rejects a tampered v2 snapshot", async () => {
    const created = await createBackup("tamper-account", { includeMedia: false });
    const path = join(process.env.VYLINE_BACKUP_DIR!, `${created.id}.json`);
    const raw = await Bun.file(path).text();
    await Bun.write(path, raw.replace('"includeMedia":false', '"includeMedia":true'));
    expect(await readBackup("tamper-account", created.id)).toBeNull();
  });

  test("soft-deletes backups without removing the snapshot file", async () => {
    const created = await createBackup("recoverable-account", { includeMedia: false });
    const path = join(process.env.VYLINE_BACKUP_DIR!, `${created.id}.json`);

    expect(await deleteBackup("recoverable-account", created.id)).toBe(true);
    expect(await Bun.file(path).exists()).toBe(true);
    expect(await listBackups("recoverable-account")).toEqual([]);
    expect(await readBackup("recoverable-account", created.id)).toBeNull();
    expect(await Bun.file(path).text()).toContain('"deletedAt"');
  });

  test("defaults to VYLINE_DATA_DIR/backups and keeps accounts isolated", async () => {
    const backupOverride = process.env.VYLINE_BACKUP_DIR;
    Reflect.deleteProperty(process.env, "VYLINE_BACKUP_DIR");
    try {
      const accountId = "data-dir-account";
      const otherAccountId = "other-data-dir-account";
      const directory = join(process.env.VYLINE_DATA_DIR!, "backups");

      expect(await listBackups(accountId)).toEqual([]);
      expect(
        await stat(directory).then(
          (entry) => entry.isDirectory(),
          () => false,
        ),
      ).toBe(true);

      const created = await createBackup(accountId, { includeMedia: false });
      const path = join(directory, `${created.id}.json`);
      expect(await Bun.file(path).exists()).toBe(true);
      expect((await listBackups(accountId)).map((item) => item.id)).toEqual([created.id]);
      expect(await readBackup(accountId, created.id)).not.toBeNull();
      expect(await listBackups(otherAccountId)).toEqual([]);
      expect(await readBackup(otherAccountId, created.id)).toBeNull();
      expect(await deleteBackup(otherAccountId, created.id)).toBe(false);
      await expect(
        restoreBackup(otherAccountId, created.id, { includeMedia: false }),
      ).rejects.toThrow("バックアップが見つかりません");
      expect(await restoreBackup(accountId, created.id, { includeMedia: false })).toEqual({
        restoredChats: 0,
        restoredMessages: 0,
        restoredMedia: 0,
      });
      expect(await deleteBackup(accountId, created.id)).toBe(true);
      expect(await listBackups(accountId)).toEqual([]);
      expect(await Bun.file(path).exists()).toBe(true);
    } finally {
      if (backupOverride === undefined) Reflect.deleteProperty(process.env, "VYLINE_BACKUP_DIR");
      else process.env.VYLINE_BACKUP_DIR = backupOverride;
    }
  });
});
