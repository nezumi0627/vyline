import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { zipSync } from "fflate";

// Other test files can load storage modules first. Run these integration cases
// in a fresh process so their temporary directories can never use cached paths
// from the developer's real account data or from another test fixture.
if (process.env.VYLINE_ANDROID_STORAGE_TEST_CHILD !== "1") {
  test("Android account storage integration in an isolated process", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        VYLINE_ANDROID_STORAGE_TEST_CHILD: "1",
        VYLINE_BACKUP_HEAVY_MAX_RESERVED_BYTES: String(10 * 1024 ** 3),
        VYLINE_ANDROID_BACKUP_MAX_ENTRIES: "3",
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
  const root = await fs.mkdtemp(join(tmpdir(), "vyline-android-storage-test-"));
  const envNames = [
    "VYLINE_DATA_DIR",
    "VYLINE_STORAGE_DIR",
    "VYLINE_MEDIA_STORAGE_DIR",
    "VYLINE_BACKUP_DIR",
  ] as const;
  const oldEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) process.env[name] = join(root, name);
  await fs.mkdir(process.env.VYLINE_MEDIA_STORAGE_DIR!, { recursive: true });
  const {
    MAX_UPLOAD_BYTES,
    MAX_EXTRACT_BYTES,
    createAndroidBackupChunkUpload,
    appendAndroidBackupChunk,
    completeAndroidBackupChunkUpload,
    cancelAndroidBackupChunkUpload,
    getAndroidBackupSession,
    startAndroidBackupRestore,
  } = await import("./androidBackupService.js");
  const { closeBackupStorage, getBackupStorageUsage } = await import("./backupService.js");
  const { accountFile } = await import("../storage/accountDirs.js");
  const {
    closeAccountChatDb,
    exportChatDb,
    flushAccountChatDb,
    getChatDbLogicalStorageBytes,
    mergeImportedChatDb,
  } = await import("../storage/chatStore.js");
  const { closeMediaStorage, readMediaStorage } = await import("../storage/mediaStorage.js");
  const uploads: Array<{ accountId: string; uploadId: string }> = [];
  const accounts = new Set<string>();
  const bytesRequest = (bytes: Uint8Array) =>
    new Request("http://localhost/", { method: "POST", body: new Uint8Array(bytes) });

  async function upload(accountId: string, expectedBytes: number) {
    accounts.add(accountId);
    const result = await createAndroidBackupChunkUpload(accountId, "LEIN.zip", true, expectedBytes);
    uploads.push({ accountId, uploadId: result.uploadId });
    return result;
  }

  async function loginFixture(accountId: string) {
    accounts.add(accountId);
    const dir = join(process.env.VYLINE_DATA_DIR!, "accounts", encodeURIComponent(accountId));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, "credentials.json"),
      JSON.stringify({
        authToken: "test-only",
        mid: "u-self",
        storageFile: "",
        savedAt: new Date().toISOString(),
      }),
    );
  }

  async function archive(text: string, id = "100", extraEntries = 0, duplicateMedia = false) {
    const path = join(root, `source-${crypto.randomUUID()}.db`);
    const db = new Database(path, { create: true });
    db.exec(`CREATE TABLE chat (chat_id TEXT, chat_name TEXT, message_count INTEGER, type INTEGER);
    CREATE TABLE chat_history (id INTEGER PRIMARY KEY, server_id TEXT, type INTEGER, chat_id TEXT,
      from_mid TEXT, content TEXT, created_time TEXT, attachement_type INTEGER, parameter TEXT);`);
    db.query("INSERT INTO chat VALUES (?, ?, ?, ?)").run("c-test", "Test", 1, 3);
    db.query("INSERT INTO chat_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      1,
      id,
      1,
      "c-test",
      "u-peer",
      text,
      "1787977000000",
      1,
      "",
    );
    db.close();
    const media = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const entries: Record<string, Uint8Array> = {
      "database/naver_line": await fs.readFile(path),
      "chats/c-test/messages/1.original": media,
    };
    for (let index = 0; index < extraEntries; index++) {
      entries[`ignored/${index}.empty`] = new Uint8Array();
    }
    if (duplicateMedia) entries["chats\\c-test\\messages\\1.original"] = media;
    return {
      bytes: zipSync(entries),
      media,
    };
  }

  async function waitForRestore(accountId: string, sessionId: string) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const session = getAndroidBackupSession(accountId, sessionId);
      if (session?.status === "completed" || session?.status === "failed") return session;
      await Bun.sleep(10);
    }
    throw new Error("restore did not finish");
  }

  async function restoreZip(accountId: string, bytes: Uint8Array) {
    const active = await upload(accountId, bytes.length);
    for (let offset = 0, index = 0; offset < bytes.length; offset += active.chunkSize, index++)
      await appendAndroidBackupChunk(
        accountId,
        active.uploadId,
        index,
        bytesRequest(bytes.subarray(offset, offset + active.chunkSize)),
      );
    const session = await completeAndroidBackupChunkUpload(accountId, active.uploadId);
    return waitForRestore(accountId, session.id);
  }

  async function fillAccount(accountId: string, size: number) {
    await getBackupStorageUsage(accountId);
    const index = new Database(join(process.env.VYLINE_BACKUP_DIR!, "backup-index.sqlite"));
    index
      .query(`
        INSERT INTO backup_index (
          account_id, id, created_at, chat_count, message_count,
          media_count, include_media, size_bytes
        ) VALUES (?, 'vyline-backup-occupied-test', ?, 0, 0, 0, 0, ?)
      `)
      .run(accountId, new Date().toISOString(), size);
    index.close();
  }

  afterEach(async () => {
    mock.restore();
    for (const item of uploads.splice(0))
      await cancelAndroidBackupChunkUpload(item.accountId, item.uploadId);
  });

  afterAll(async () => {
    for (const account of accounts) {
      await flushAccountChatDb(account).catch(() => undefined);
      await closeAccountChatDb(account).catch(() => undefined);
    }
    await closeBackupStorage();
    await closeMediaStorage();
    for (const name of envNames) {
      if (oldEnv[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = oldEnv[name];
    }
    if (root.startsWith(join(tmpdir(), "vyline-android-storage-test-")))
      await fs.rm(root, { recursive: true, force: true });
  });

  describe("Android backup account storage", () => {
    test("reports account-scoped usage and Android limits through the actual BFF route", async () => {
      accounts.add("bff-empty");
      const { lineRouter } = await import("../api/line.js");
      const response = await lineRouter.request("http://localhost/bff-empty/backup/storage");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        storage: {
          accountId: string;
          usedBytes: number;
          limitBytes: number;
          historyBytes: number;
          mediaBytes: number;
          backupBytes: number;
        };
      };
      expect(body).toMatchObject({
        ok: true,
        storage: {
          accountId: "bff-empty",
          limitBytes: 10 * 1024 ** 3,
          mediaBytes: 0,
          backupBytes: 0,
        },
        android: { maxUploadBytes: 10 * 1024 ** 3, maxExtractBytes: 10 * 1024 ** 3 },
      });
      expect(body.storage.historyBytes).toBeGreaterThan(0);
      expect(body.storage.usedBytes).toBe(body.storage.historyBytes);
    });

    test("rejects a ZIP64 entry above the extraction limit before allocating its data", async () => {
      const name = Buffer.from("database/naver_line");
      const header = Buffer.alloc(30 + name.length + 20 + 1);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(45, 4);
      header.writeUInt32LE(1, 18);
      header.writeUInt32LE(0xffffffff, 22);
      header.writeUInt16LE(name.length, 26);
      header.writeUInt16LE(20, 28);
      name.copy(header, 30);
      const extra = 30 + name.length;
      header.writeUInt16LE(1, extra);
      header.writeUInt16LE(16, extra + 2);
      header.writeBigUInt64LE(BigInt(MAX_EXTRACT_BYTES + 1), extra + 4);
      header.writeBigUInt64LE(1n, extra + 12);
      const session = await restoreZip("zip64-limit", header);
      expect(session.status).toBe("failed");
      expect(session.error).toContain("展開サイズが上限 10.0 GB");
    });
    test("rejects archives with too many entries, including irrelevant zero-byte files", async () => {
      const source = await archive("entry cap", "100", 2);
      const session = await restoreZip("entry-cap", source.bytes);
      expect(session.status).toBe("failed");
      expect(session.error).toContain("ZIPエントリ数が上限 3 件");
    });
    test("rejects ZIP entries that normalize to the same media target", async () => {
      const source = await archive("target collision", "100", 0, true);
      const session = await restoreZip("target-collision", source.bytes);
      expect(session.status).toBe("failed");
      expect(session.error).toContain("複数エントリが同じ展開先");
    });
    test("admits the reported 2.1GB file and exactly 10GB, rejects 10GB + 1", async () => {
      expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 ** 3);
      expect(MAX_EXTRACT_BYTES).toBe(MAX_UPLOAD_BYTES);
      const smaller = await upload("large", Math.ceil(2.1 * 1024 ** 3));
      expect(smaller.uploadId).toBeTruthy();
      await cancelAndroidBackupChunkUpload("large", smaller.uploadId);
      expect((await upload("limit", MAX_UPLOAD_BYTES)).uploadId).toBeTruthy();
      await expect(upload("oversize", MAX_UPLOAD_BYTES + 1)).rejects.toThrow("10.0 GB");
      await expect(
        startAndroidBackupRestore(
          "oversize",
          "LEIN.zip",
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-length": String(MAX_UPLOAD_BYTES + 1) },
            body: "x",
          }),
          true,
        ),
      ).rejects.toThrow("10.0 GB");
    });

    test("bounds global and per-account reservations and releases cancelled uploads", async () => {
      const results = await Promise.allSettled([
        upload("concurrent", 7 * 1024 ** 3),
        upload("concurrent", 7 * 1024 ** 3),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const first = results.find(
        (result) => result.status === "fulfilled",
      ) as PromiseFulfilledResult<{ uploadId: string }>;
      await expect(upload("separate", MAX_UPLOAD_BYTES)).rejects.toThrow("待機データ量");
      await cancelAndroidBackupChunkUpload("concurrent", first.value.uploadId);
      const separate = await upload("separate", MAX_UPLOAD_BYTES);
      expect(separate.uploadId).toBeTruthy();
      await cancelAndroidBackupChunkUpload("separate", separate.uploadId);
      expect((await upload("concurrent", MAX_UPLOAD_BYTES)).uploadId).toBeTruthy();
    });

    test("isolates uploads and concurrent retries never append the same chunk twice", async () => {
      const active = await upload("chunks", 3);
      await expect(
        appendAndroidBackupChunk("other", active.uploadId, 0, bytesRequest(new Uint8Array([1]))),
      ).rejects.toThrow("見つかりません");
      await cancelAndroidBackupChunkUpload("other", active.uploadId);
      const results = await Promise.all([
        appendAndroidBackupChunk(
          "chunks",
          active.uploadId,
          0,
          bytesRequest(new Uint8Array([1, 2, 3])),
        ),
        appendAndroidBackupChunk(
          "chunks",
          active.uploadId,
          0,
          bytesRequest(new Uint8Array([1, 2, 3])),
        ),
      ]);
      for (const result of results)
        expect(result).toMatchObject({ receivedBytes: 3, nextIndex: 1 });
    });

    test("does not hold the capacity lock while a direct upload body stalls", async () => {
      accounts.add("direct-a");
      accounts.add("direct-b");
      let releaseFirst!: () => void;
      let markFirstPull!: () => void;
      let markSecondPull!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const firstPulled = new Promise<void>((resolve) => {
        markFirstPull = resolve;
      });
      const secondPulled = new Promise<void>((resolve) => {
        markSecondPull = resolve;
      });
      const firstBody = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            markFirstPull();
            await firstGate;
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const secondBody = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            markSecondPull();
            controller.enqueue(new Uint8Array([2]));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );

      const first = startAndroidBackupRestore(
        "direct-a",
        "naver_line",
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-length": "1" },
          body: firstBody,
        }),
        false,
      );
      await firstPulled;
      const second = startAndroidBackupRestore(
        "direct-b",
        "naver_line",
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-length": "1" },
          body: secondBody,
        }),
        false,
      );
      expect(
        await Promise.race([
          secondPulled.then(() => "pulled"),
          Bun.sleep(30).then(() => "waiting"),
        ]),
      ).toBe("pulled");
      releaseFirst();
      const [firstSession, secondSession] = await Promise.all([first, second]);
      await secondPulled;
      expect((await waitForRestore("direct-a", firstSession.id)).status).toBe("failed");
      expect((await waitForRestore("direct-b", secondSession.id)).status).toBe("failed");
    });

    test("bounds chunk streams without trusting Content-Length", async () => {
      const active = await upload("bounded-chunk", 1024 ** 2);
      await expect(
        appendAndroidBackupChunk(
          "bounded-chunk",
          active.uploadId,
          0,
          bytesRequest(new Uint8Array(active.chunkSize + 1)),
        ),
      ).rejects.toThrow("chunkが大きすぎます");
      expect(
        await appendAndroidBackupChunk(
          "bounded-chunk",
          active.uploadId,
          0,
          bytesRequest(new Uint8Array([1])),
        ),
      ).toMatchObject({ receivedBytes: 1, nextIndex: 1 });
    });

    test("restores a ZIP and reports exact per-account history/media bytes without duplicate growth", async () => {
      await loginFixture("usage-a");
      await loginFixture("usage-b");
      const source = await archive("日本語のバックアップ");
      expect((await restoreZip("usage-a", source.bytes)).status).toBe("completed");
      const usage = await getBackupStorageUsage("usage-a");
      expect(usage.accountId).toBe("usage-a");
      expect(usage.historyBytes).toBe(await getChatDbLogicalStorageBytes("usage-a"));
      expect((await fs.stat(accountFile("usage-a", "chatdb.sqlite"))).size).toBeGreaterThan(0);
      expect(usage.mediaBytes).toBe(source.media.length);
      expect(usage.usedBytes).toBe(usage.historyBytes + usage.mediaBytes);
      const emptyUsage = await getBackupStorageUsage("usage-b");
      expect(emptyUsage.historyBytes).toBeGreaterThan(0);
      expect(emptyUsage.usedBytes).toBe(emptyUsage.historyBytes);
      const second = await restoreZip("usage-a", source.bytes);
      expect(second.status).toBe("completed");
      expect(second.result?.merged.importedMessages).toBe(0);
      expect(second.result?.media.restored).toBe(0);
      // Merge may fill an empty metadata object once; subsequent imports are stable.
      const afterSecond = await getBackupStorageUsage("usage-a");
      expect((await restoreZip("usage-a", source.bytes)).status).toBe("completed");
      expect((await getBackupStorageUsage("usage-a")).usedBytes).toBe(afterSecond.usedBytes);
      expect((await readMediaStorage("usage-a", "c-test", "100"))?.buf).toEqual(source.media);
    });

    test("checks cumulative account storage before importing and leaves existing history intact", async () => {
      await loginFixture("full-account");
      await loginFixture("empty-account");
      const first = await archive("original", "100");
      expect((await restoreZip("full-account", first.bytes)).status).toBe("completed");
      const before = await exportChatDb("full-account");
      const usage = await getBackupStorageUsage("full-account");
      await fillAccount("full-account", MAX_UPLOAD_BYTES - usage.usedBytes);
      const incoming = await archive("new data", "200");
      const rejected = await restoreZip("full-account", incoming.bytes);
      expect(rejected.status).toBe("failed");
      expect(rejected.error).toContain("10GB");
      expect(await exportChatDb("full-account")).toEqual(before);
      expect((await exportChatDb("full-account")).messages["c-test"]?.["200"]).toBeUndefined();
      expect((await restoreZip("empty-account", incoming.bytes)).status).toBe("completed");
    });

    test("rolls back only newly copied media when the SQLite merge fails", async () => {
      const accountId = "media-rollback";
      await loginFixture(accountId);
      const existing = await archive("existing", "100");
      expect((await restoreZip(accountId, existing.bytes)).status).toBe("completed");
      const before = await getBackupStorageUsage(accountId);
      const incoming = await archive("must roll back", "200");
      const desiredHistoryLimit = before.historyBytes - 1;
      await fillAccount(
        accountId,
        MAX_UPLOAD_BYTES - before.mediaBytes - incoming.media.length - desiredHistoryLimit,
      );

      const rejected = await restoreZip(accountId, incoming.bytes);
      expect(rejected.status).toBe("failed");
      expect((await exportChatDb(accountId)).messages["c-test"]?.["200"]).toBeUndefined();
      expect((await readMediaStorage(accountId, "c-test", "100"))?.buf).toEqual(existing.media);
      expect(await readMediaStorage(accountId, "c-test", "200")).toBeNull();
    });

    test("accepts an exact SQLite page budget and rejects one byte less without mutation", async () => {
      accounts.add("budget-source");
      accounts.add("budget-exact");
      accounts.add("budget-small");
      const source = {
        chats: {},
        messages: {
          "u-peer": {
            "1": {
              id: "1",
              chatMid: "u-peer",
              from: "u-peer",
              to: "u-self",
              text: "日本語🙂",
              contentType: "NONE",
              createdTime: 1,
              savedAt: new Date(1).toISOString(),
              isMyMessage: false,
            },
          },
        },
      };
      await mergeImportedChatDb("budget-source", source);
      const bytes = await getChatDbLogicalStorageBytes("budget-source");
      expect(bytes).toBeGreaterThan(0);
      expect((await mergeImportedChatDb("budget-exact", source, bytes)).importedMessages).toBe(1);
      await expect(mergeImportedChatDb("budget-small", source, bytes - 1)).rejects.toThrow("10GB");
      expect((await exportChatDb("budget-small")).messages).toEqual({});
    });
  });
}
