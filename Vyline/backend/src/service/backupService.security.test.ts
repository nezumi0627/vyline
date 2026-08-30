import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = await mkdtemp(join(tmpdir(), "vyline-backup-security-"));
process.env.VYLINE_DATA_DIR = join(testRoot, "data");
process.env.VYLINE_BACKUP_DIR = join(testRoot, "backups");

const { createBackup, listBackups, readBackup } = await import("./backupService.js");

afterAll(async () => {
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
});
