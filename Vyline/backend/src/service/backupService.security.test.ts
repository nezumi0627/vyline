import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = await mkdtemp(join(tmpdir(), "vyline-sqlite-backup-test-"));
const backupServiceUrl = new URL("./backupService.ts", import.meta.url).href;
const chatStoreUrl = new URL("../storage/chatStore.ts", import.meta.url).href;
const mediaStorageUrl = new URL("../storage/mediaStorage.ts", import.meta.url).href;
const accountDirsUrl = new URL("../storage/accountDirs.ts", import.meta.url).href;

interface ChildResult<T> {
  value: T;
  root: string;
}

function scenarioRoot(name: string): string {
  return join(testRoot, name);
}

async function runScenario<T>(
  name: string,
  body: string,
  reuseRoot = false,
): Promise<ChildResult<T>> {
  const root = scenarioRoot(name);
  if (!reuseRoot) await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const child = Bun.spawn([process.execPath, "--eval", body], {
    env: {
      ...process.env,
      LOG_LEVEL: "silent",
      VYLINE_DATA_DIR: join(root, "data"),
      VYLINE_BACKUP_DIR: join(root, "backups"),
      VYLINE_STORAGE_DIR: join(root, "storage"),
      VYLINE_MEDIA_STORAGE_DIR: join(root, "saved-media"),
      VYLINE_MEDIA_INDEX_PATH: join(root, "storage", "media-index.sqlite"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`child failed (${exitCode})\n${stderr}\n${stdout}`);
  }
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error(`child returned no result\n${stderr}`);
  return { value: JSON.parse(line) as T, root };
}

function imports(): string {
  return `
    const backup = await import(${JSON.stringify(backupServiceUrl)});
    const chat = await import(${JSON.stringify(chatStoreUrl)});
    const media = await import(${JSON.stringify(mediaStorageUrl)});
    const accounts = await import(${JSON.stringify(accountDirsUrl)});
  `;
}

function seedFunction(): string {
  return `
    async function seed(accountId, suffix = "") {
      const now = new Date().toISOString();
      await chat.importChatDb(accountId, {
        meta: {},
        chats: {
          shared: {
            mid: "shared", name: "shared chat", kind: "direct", hasMessages: true,
            lastMessageTime: 1, lastMessageId: "1", lastMessagePreview: "old" + suffix,
            updatedAt: now,
          },
        },
        messages: {
          shared: {
            "1": {
              id: "1", chatMid: "shared", from: "sender", to: "shared",
              text: "old text" + suffix, contentType: "IMAGE", createdTime: 1,
              isMyMessage: false, savedAt: now,
            },
          },
        },
      });
      await chat.flushAccountChatDb(accountId);
    }
  `;
}

afterAll(async () => {
  if (testRoot.startsWith(join(tmpdir(), "vyline-sqlite-backup-test-"))) {
    await rm(testRoot, { recursive: true, force: true });
  }
});

describe("SQLite-native VylineBackup", () => {
  test("publishes only normalized SQLite plus a disk-backed media sidecar", async () => {
    const { value, root } = await runScenario<{
      summary: { id: string; mediaCount: number; sizeBytes: number };
      listed: Array<{ id: string }>;
      usage: { backupBytes: number };
      files: string[];
      tables: string[];
      mediaColumns: string[];
      schemaVersion: number;
      mediaRows: number;
      journalMode: string;
    }>(
      "sqlite-layout",
      `
        ${imports()}
        ${seedFunction()}
        const { Database } = await import("bun:sqlite");
        const { readdir } = await import("node:fs/promises");
        const { createHash } = await import("node:crypto");
        const { join } = await import("node:path");
        const accountId = "sqlite-layout";
        await seed(accountId);
        await media.writeMediaStorage(
          accountId, "shared", "1", new TextEncoder().encode("image payload"), "image/png"
        );
        const summary = await backup.createBackup(accountId, { includeMedia: true });
        const dir = join(process.env.VYLINE_BACKUP_DIR, createHash("sha256").update(accountId).digest("hex"));
        const path = join(dir, summary.id + ".sqlite");
        const db = new Database(path, { readonly: true });
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
        const mediaColumns = db.query("PRAGMA table_info(backup_media)").all().map((row) => row.name);
        const schemaVersion = db.query("SELECT schema_version FROM backup_manifest").get().schema_version;
        const mediaRows = db.query("SELECT count(*) AS count FROM backup_media").get().count;
        const journalMode = db.query("PRAGMA journal_mode").get().journal_mode;
        db.close();
        console.log(JSON.stringify({
          summary,
          listed: await backup.listBackups(accountId),
          usage: await backup.getBackupStorageUsage(accountId),
          files: (await readdir(dir)).sort(),
          tables,
          mediaColumns,
          schemaVersion,
          mediaRows,
          journalMode,
        }));
      `,
    );

    expect(value.summary.mediaCount).toBe(1);
    expect(value.listed.map((entry) => entry.id)).toEqual([value.summary.id]);
    expect(value.usage.backupBytes).toBe(value.summary.sizeBytes);
    expect(value.files).toContain(`${value.summary.id}.sqlite`);
    expect(value.files).toContain(`${value.summary.id}.media`);
    expect(value.files.some((name) => name.endsWith(".json"))).toBe(false);
    expect(value.files.some((name) => name.includes("partial"))).toBe(false);
    expect(value.tables).toContain("staged_chats");
    expect(value.tables).toContain("staged_messages");
    expect(value.tables).toContain("backup_manifest");
    expect(value.mediaColumns).not.toContain("data");
    expect(value.schemaVersion).toBe(2);
    expect(value.mediaRows).toBe(1);
    expect(value.journalMode).toBe("delete");
    expect(root).toContain("sqlite-layout");
  });

  test("hashes account directories and never crosses account boundaries", async () => {
    const { value } = await runScenario<{
      firstId: string;
      secondId: string;
      firstList: string[];
      secondList: string[];
      crossRestoreError: string;
      crossDelete: boolean;
      directories: string[];
    }>(
      "account-boundaries",
      `
        ${imports()}
        ${seedFunction()}
        const { readdir } = await import("node:fs/promises");
        const first = "../../same.a";
        const second = "samea";
        await seed(first, " A");
        await seed(second, " B");
        const a = await backup.createBackup(first, { includeMedia: false });
        const b = await backup.createBackup(second, { includeMedia: false });
        let crossRestoreError = "";
        try { await backup.restoreBackup(first, b.id, { includeMedia: false }); }
        catch (error) { crossRestoreError = error.message; }
        console.log(JSON.stringify({
          firstId: a.id,
          secondId: b.id,
          firstList: (await backup.listBackups(first)).map((entry) => entry.id),
          secondList: (await backup.listBackups(second)).map((entry) => entry.id),
          crossRestoreError,
          crossDelete: await backup.deleteBackup(first, b.id),
          directories: (await readdir(process.env.VYLINE_BACKUP_DIR, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
        }));
      `,
    );

    expect(value.firstId).not.toContain("..");
    expect(value.firstId).not.toMatch(/[\\/]/);
    expect(value.firstList).toEqual([value.firstId]);
    expect(value.secondList).toEqual([value.secondId]);
    expect(value.crossRestoreError).toContain("見つかりません");
    expect(value.crossDelete).toBe(false);
    expect(value.directories).toHaveLength(2);
    expect(value.directories.every((name) => /^[0-9a-f]{64}$/.test(name))).toBe(true);
  });

  test("restores selected history and media idempotently without overwriting newer data", async () => {
    const { value } = await runScenario<{
      first: { restoredChats: number; restoredMessages: number; restoredMedia: number };
      second: { restoredMessages: number; restoredMedia: number };
      chats: string[];
      text: string;
      media: string;
    }>(
      "selected-idempotent",
      `
        ${imports()}
        ${seedFunction()}
        const { rm } = await import("node:fs/promises");
        const accountId = "selected-idempotent";
        await seed(accountId);
        const now = new Date().toISOString();
        await chat.importChatDb(accountId, {
          meta: {},
          chats: { excluded: { mid: "excluded", name: "excluded", kind: "direct", hasMessages: true, updatedAt: now } },
          messages: { excluded: { "2": { id: "2", chatMid: "excluded", from: "sender", to: "excluded", text: "excluded", contentType: "TEXT", createdTime: 2, isMyMessage: false, savedAt: now } } },
        });
        await media.writeMediaStorage(accountId, "shared", "1", new TextEncoder().encode("old image"), "image/png");
        const snapshot = await backup.createBackup(accountId, { includeMedia: true });
        const oldMedia = await media.statMediaStorage(accountId, "shared", "1");
        await chat.closeAccountChatDb(accountId);
        for (const suffix of ["", "-wal", "-shm"]) await rm(accounts.accountFile(accountId, "chatdb.sqlite") + suffix, { force: true });
        await rm(oldMedia.path, { force: true });
        const first = await backup.restoreBackup(accountId, snapshot.id, { chatMids: ["shared"], includeMedia: true });
        await chat.importChatDb(accountId, {
          meta: {}, chats: {},
          messages: { shared: { "1": { id: "1", chatMid: "shared", from: "sender", to: "shared", text: "new text", contentType: "IMAGE", createdTime: 1, isMyMessage: false, savedAt: new Date().toISOString() } } },
        });
        await media.writeMediaStorage(accountId, "shared", "1", new TextEncoder().encode("new image"), "image/png");
        const second = await backup.restoreBackup(accountId, snapshot.id, { chatMids: ["shared"], includeMedia: true });
        const db = await chat.exportChatDb(accountId);
        const storedMedia = await media.readMediaStorage(accountId, "shared", "1");
        console.log(JSON.stringify({
          first, second,
          chats: Object.keys(db.chats).sort(),
          text: db.messages.shared["1"].text,
          media: new TextDecoder().decode(storedMedia.buf),
        }));
      `,
    );

    expect(value.first).toEqual({ restoredChats: 1, restoredMessages: 1, restoredMedia: 1 });
    expect(value.second.restoredMessages).toBe(0);
    expect(value.second.restoredMedia).toBe(0);
    expect(value.chats).toEqual(["shared"]);
    expect(value.text).toBe("new text");
    expect(value.media).toBe("new image");
  });

  test("serializes concurrent creation and never reuses an ID", async () => {
    const { value } = await runScenario<{ ids: string[]; listed: number }>(
      "concurrent-create",
      `
        ${imports()}
        const ids = await Promise.all(
          Array.from({ length: 3 }, () => backup.createBackup("same-account", { includeMedia: false }))
        );
        console.log(JSON.stringify({
          ids: ids.map((entry) => entry.id),
          listed: (await backup.listBackups("same-account")).length,
        }));
      `,
    );
    expect(new Set(value.ids).size).toBe(3);
    expect(value.listed).toBe(3);
  });

  test("rejects quota overflow and removes every unpublished partial", async () => {
    const { value } = await runScenario<{
      error: string;
      accountFiles: string[];
      usage: { remainingBytes: number };
    }>(
      "quota-cleanup",
      `
        ${imports()}
        const { Database } = await import("bun:sqlite");
        const { readdir } = await import("node:fs/promises");
        const { createHash } = await import("node:crypto");
        const { join } = await import("node:path");
        const accountId = "quota-cleanup";
        const initial = await backup.getBackupStorageUsage(accountId);
        const index = new Database(join(process.env.VYLINE_BACKUP_DIR, "backup-index.sqlite"));
        index.query(
          "INSERT INTO backup_index(account_id,id,created_at,chat_count,message_count,media_count,include_media,size_bytes) VALUES(?,?,?,?,?,?,?,?)"
        ).run(accountId, "reserved", new Date().toISOString(), 0, 0, 0, 0, initial.limitBytes - initial.usedBytes - 1);
        index.close();
        let error = "";
        try { await backup.createBackup(accountId, { includeMedia: false }); }
        catch (caught) { error = caught.message; }
        const dir = join(process.env.VYLINE_BACKUP_DIR, createHash("sha256").update(accountId).digest("hex"));
        console.log(JSON.stringify({
          error,
          accountFiles: (await readdir(dir)).sort(),
          usage: await backup.getBackupStorageUsage(accountId),
        }));
      `,
    );
    expect(value.error).toContain("10GB");
    expect(value.accountFiles).toEqual([]);
    expect(value.usage.remainingBytes).toBe(1);
  });

  test("rejects a tampered sidecar path before changing chat history", async () => {
    const { value } = await runScenario<{ error: string; messages: number }>(
      "tampered-media-path",
      `
        ${imports()}
        ${seedFunction()}
        const { Database } = await import("bun:sqlite");
        const { rm } = await import("node:fs/promises");
        const { createHash } = await import("node:crypto");
        const { join } = await import("node:path");
        const accountId = "tampered-media-path";
        await seed(accountId);
        await media.writeMediaStorage(accountId, "shared", "1", new Uint8Array([1, 2, 3]), "image/png");
        const snapshot = await backup.createBackup(accountId, { includeMedia: true });
        const path = join(process.env.VYLINE_BACKUP_DIR, createHash("sha256").update(accountId).digest("hex"), snapshot.id + ".sqlite");
        const db = new Database(path);
        db.query("UPDATE backup_media SET relative_path = '../../outside'").run();
        db.close();
        await chat.closeAccountChatDb(accountId);
        for (const suffix of ["", "-wal", "-shm"]) await rm(accounts.accountFile(accountId, "chatdb.sqlite") + suffix, { force: true });
        let error = "";
        try { await backup.restoreBackup(accountId, snapshot.id, { includeMedia: true }); }
        catch (caught) { error = caught.message; }
        const restored = await chat.exportChatDb(accountId);
        console.log(JSON.stringify({
          error,
          messages: Object.values(restored.messages).reduce((sum, byChat) => sum + Object.keys(byChat).length, 0),
        }));
      `,
    );
    expect(value.error).toContain("メディア索引が不正");
    expect(value.messages).toBe(0);
  });

  test("rebuilds its compact index from SQLite manifests after index loss", async () => {
    const created = await runScenario<{ id: string }>(
      "index-recovery",
      `
        ${imports()}
        const summary = await backup.createBackup("recover", { includeMedia: false });
        console.log(JSON.stringify({ id: summary.id }));
      `,
    );
    const recovered = await runScenario<{ ids: string[]; backupBytes: number }>(
      "index-recovery",
      `
        const { rm } = await import("node:fs/promises");
        const { join } = await import("node:path");
        for (const suffix of ["", "-wal", "-shm"])
          await rm(join(process.env.VYLINE_BACKUP_DIR, "backup-index.sqlite" + suffix), { force: true });
        ${imports()}
        console.log(JSON.stringify({
          ids: (await backup.listBackups("recover")).map((entry) => entry.id),
          backupBytes: (await backup.getBackupStorageUsage("recover")).backupBytes,
        }));
      `,
      true,
    );
    expect(recovered.value.ids).toEqual([created.value.id]);
    expect(recovered.value.backupBytes).toBeGreaterThan(0);
  });

  test("does not read or list the removed JSON backup format", async () => {
    const { value } = await runScenario<{ listed: unknown[]; files: string[] }>(
      "json-is-not-a-backup",
      `
        const { createHash } = await import("node:crypto");
        const { mkdir, readdir, writeFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const accountId = "json-owner";
        const dir = join(process.env.VYLINE_BACKUP_DIR, createHash("sha256").update(accountId).digest("hex"));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "vyline-backup-old.json"), JSON.stringify({ schema: "vyline-backup" }));
        ${imports()}
        console.log(JSON.stringify({ listed: await backup.listBackups(accountId), files: await readdir(dir) }));
      `,
    );
    expect(value.listed).toEqual([]);
    expect(value.files).toContain("vyline-backup-old.json");
  });
});

describe("SQLite backup responsiveness", () => {
  test("backs up 100,000 generated messages with bounded RSS and event-loop yields", async () => {
    const { value } = await runScenario<{
      messageCount: number;
      elapsedMs: number;
      rssDelta: number;
      ticks: number;
      maxLagMs: number;
      snapshotBytes: number;
    }>(
      "hundred-thousand",
      `
          ${imports()}
          const accountId = "hundred-thousand";
          const now = new Date().toISOString();
          await chat.upsertChats(accountId, [{
            mid: "c-stress", name: "stress", kind: "group", hasMessages: true, updatedAt: now,
          }]);
          const text = "低メモリ履歴".repeat(40);
          for (let offset = 0; offset < 100000; offset += 500) {
            const batch = [];
            for (let index = offset; index < offset + 500; index++) {
              const id = String(index + 1).padStart(12, "0");
              batch.push({
                id, chatMid: "c-stress", from: "sender", to: "c-stress", text,
                contentType: "TEXT", createdTime: index + 1, isMyMessage: false, savedAt: now,
              });
            }
            await chat.upsertMessages(accountId, "c-stress", batch);
          }
          Bun.gc(true);
          const rssBefore = process.memoryUsage().rss;
          let peakRss = rssBefore;
          let ticks = 0;
          let maxLagMs = 0;
          let last = performance.now();
          const timer = setInterval(() => {
            const current = performance.now();
            maxLagMs = Math.max(maxLagMs, current - last);
            last = current;
            ticks++;
            peakRss = Math.max(peakRss, process.memoryUsage().rss);
          }, 5);
          const started = performance.now();
          const summary = await backup.createBackup(accountId, { includeMedia: false });
          const elapsedMs = performance.now() - started;
          clearInterval(timer);
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
          console.log(JSON.stringify({
            messageCount: summary.messageCount,
            elapsedMs,
            rssDelta: peakRss - rssBefore,
            ticks,
            maxLagMs,
            snapshotBytes: summary.sizeBytes,
          }));
        `,
    );
    expect(value.messageCount).toBe(100_000);
    expect(value.snapshotBytes).toBeGreaterThan(30 * 1024 * 1024);
    expect(value.ticks).toBeGreaterThan(20);
    expect(value.maxLagMs).toBeLessThan(1_000);
    expect(value.rssDelta).toBeLessThan(160 * 1024 * 1024);
    expect(value.elapsedMs).toBeLessThan(120_000);
    console.info("[backup-100k]", value);
  }, 180_000);
});
