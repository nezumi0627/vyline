import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

// mediaStorage owns a process-wide SQLite connection and path constants. Keep the
// integration cases in a child so neither another suite nor a developer data dir
// can be reused accidentally; the parent removes the fixture after the DB closes.
if (process.env.VYLINE_MEDIA_STORAGE_TEST_CHILD !== "1") {
  test("media storage/index/range integration in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-media-storage-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_MEDIA_STORAGE_TEST_CHILD: "1",
          VYLINE_MEDIA_STORAGE_TEST_ROOT: root,
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
      const measurement = stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("MEDIA_SPARSE_RSS "));
      if (measurement) console.info(measurement);
      expect(code).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
} else {
  const root = process.env.VYLINE_MEDIA_STORAGE_TEST_ROOT!;
  const dataRoot = join(root, "data");
  const storageRoot = join(root, "storage");
  const mediaRoot = join(storageRoot, "saved-media");
  const indexPath = join(storageRoot, "media-index.sqlite");
  process.env.VYLINE_DATA_DIR = dataRoot;
  process.env.VYLINE_STORAGE_DIR = storageRoot;
  process.env.VYLINE_MEDIA_STORAGE_DIR = mediaRoot;
  process.env.VYLINE_MEDIA_INDEX_PATH = indexPath;
  await fs.mkdir(mediaRoot, { recursive: true });

  const accountId = "media-owner";
  const legacyChatMid = "c-legacy";
  const legacyMessageId = "100";
  const storageHash = (chatMid: string, messageId: string) =>
    createHash("sha256").update(`${accountId}:${chatMid}:${messageId}`).digest("hex");

  // A file and chat row that predate media-index.sqlite exercise the one-time,
  // low-memory rebuild and ownership attribution path.
  await fs.mkdir(join(dataRoot, "accounts", accountId), { recursive: true });
  await fs.writeFile(
    join(dataRoot, "accounts.json"),
    JSON.stringify({
      accounts: [{ accountId, dirName: accountId, registeredAt: new Date(0).toISOString() }],
    }),
  );
  const chatDb = new Database(join(dataRoot, "accounts", accountId, "chatdb.sqlite"), {
    create: true,
  });
  chatDb.exec("CREATE TABLE messages (chat_mid TEXT NOT NULL, id TEXT NOT NULL)");
  chatDb
    .query("INSERT INTO messages(chat_mid, id) VALUES (?, ?)")
    .run(legacyChatMid, legacyMessageId);
  chatDb.close();
  const legacyBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const legacyHash = storageHash(legacyChatMid, legacyMessageId);
  const legacyPath = join(mediaRoot, "videos", legacyHash.slice(0, 2), `${legacyHash}.mp4`);
  await fs.mkdir(dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, legacyBytes);

  const mediaStorage = await import("./mediaStorage.js");

  afterAll(async () => {
    mock.restore();
    await mediaStorage.closeMediaStorage();
  });

  describe("persistent media index", () => {
    test("rebuilds existing media once and attributes it without materializing messages", async () => {
      expect(
        await mediaStorage.statMediaStorage(accountId, legacyChatMid, legacyMessageId),
      ).toMatchObject({
        path: legacyPath,
        sizeBytes: legacyBytes.byteLength,
        contentType: "video/mp4",
        mediaType: "video",
      });
      expect(await mediaStorage.getAccountMediaStorageSize(accountId)).toBeGreaterThanOrEqual(
        legacyBytes.byteLength,
      );
      expect((await mediaStorage.getMediaStorageIndexedTotals()).video).toBeGreaterThanOrEqual(
        legacyBytes.byteLength,
      );

      const index = new Database(indexPath, { readonly: true });
      expect(index.query("SELECT value FROM media_index_meta WHERE key = 'version'").get()).toEqual(
        {
          value: "1",
        },
      );
      index.close();
    });

    test("streams safe account rows and filters selected chats", async () => {
      await mediaStorage.writeMediaStorage(
        accountId,
        "c-selected",
        "201",
        new Uint8Array([1, 2, 3]),
        "application/pdf",
      );
      await mediaStorage.writeMediaStorage(
        accountId,
        "c-other",
        "202",
        new Uint8Array([4, 5]),
        "application/pdf",
      );

      const outsidePath = join(root, "outside-secret.bin");
      await fs.writeFile(outsidePath, "must not be yielded");
      const index = new Database(indexPath);
      index
        .query(`
          INSERT INTO media_index (
            path, storage_hash, account_id, chat_mid, message_id,
            size_bytes, content_type, media_type, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          outsidePath,
          "f".repeat(64),
          accountId,
          "c-selected",
          "malicious",
          19,
          "application/octet-stream",
          "file",
          Date.now(),
        );
      index.close();

      const found = [];
      for await (const item of mediaStorage.iterateAccountMediaStorage(
        accountId,
        new Set(["c-selected"]),
      )) {
        found.push(item);
      }
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        chatMid: "c-selected",
        messageId: "201",
        sizeBytes: 3,
        contentType: "application/pdf",
      });

      const verify = new Database(indexPath, { readonly: true });
      expect(
        verify.query("SELECT path FROM media_index WHERE path = ?").get(outsidePath),
      ).toBeNull();
      verify.close();
    });

    test("writes a response stream atomically without retaining it in memory cache", async () => {
      const chunks = [
        Uint8Array.from([1, 2, 3]),
        Uint8Array.from([4, 5]),
        Uint8Array.from([6, 7, 8, 9]),
      ];
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
      });
      const before = mediaStorage.getMediaMemoryCacheStats();
      const stored = await mediaStorage.writeMediaStorageStream(
        accountId,
        "c-stream",
        "streamed",
        body,
        "video/mp4",
        9,
      );
      expect(stored).toMatchObject({ sizeBytes: 9, contentType: "video/mp4", mediaType: "video" });
      expect(new Uint8Array(await Bun.file(stored.path).arrayBuffer())).toEqual(
        Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      );
      expect(mediaStorage.getMediaMemoryCacheStats()).toEqual(before);
      expect(
        (await fs.readdir(dirname(stored.path))).some((name) => name.endsWith(".partial")),
      ).toBe(false);
    });

    test("imports a 500 MiB sparse file disk-to-disk with bounded RSS", async () => {
      const sparseBytes = 500 * 1024 * 1024;
      const markerOffset = sparseBytes - 64;
      const marker = Uint8Array.from({ length: 64 }, (_, index) => (index * 17) & 0xff);
      const sourcePath = join(root, "sparse-500m.mp4");
      const handle = await fs.open(sourcePath, "w", 0o600);
      try {
        await handle.truncate(sparseBytes);
        await handle.write(marker, 0, marker.byteLength, markerOffset);
      } finally {
        await handle.close();
      }

      Bun.gc(true);
      const rssBefore = process.memoryUsage().rss;
      expect(
        await mediaStorage.importMediaStorageFile(
          accountId,
          "c-sparse",
          "sparse-500m",
          sourcePath,
          "video/mp4",
        ),
      ).toBe(true);
      Bun.gc(true);
      const rssAfterImport = process.memoryUsage().rss;
      const rssDelta = Math.max(0, rssAfterImport - rssBefore);
      // The threshold allows allocator/runtime noise while still detecting a
      // 500 MiB readFile/arrayBuffer regression.
      expect(rssDelta).toBeLessThan(192 * 1024 * 1024);

      const stored = await mediaStorage.statMediaStorage(accountId, "c-sparse", "sparse-500m");
      expect(stored).toMatchObject({ sizeBytes: sparseBytes, contentType: "video/mp4" });

      const { lineRouter } = await import("../api/line.js");
      const rangeStart = markerOffset + 16;
      const rangeEnd = rangeStart + 31;
      const response = await lineRouter.request(
        `http://localhost/${accountId}/media/c-sparse/sparse-500m?preview=0`,
        { headers: { Range: `bytes=${rangeStart}-${rangeEnd}` } },
      );
      expect(response.status).toBe(206);
      expect(response.headers.get("content-length")).toBe("32");
      expect(response.headers.get("content-range")).toBe(
        `bytes ${rangeStart}-${rangeEnd}/${sparseBytes}`,
      );
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(marker.slice(16, 48));
      Bun.gc(true);
      const rssAfterRange = process.memoryUsage().rss;
      const totalRssDelta = Math.max(0, rssAfterRange - rssBefore);
      expect(totalRssDelta).toBeLessThan(192 * 1024 * 1024);
      console.info(
        `MEDIA_SPARSE_RSS ${JSON.stringify({
          bytes: sparseBytes,
          importDeltaBytes: rssDelta,
          rangeDeltaBytes: totalRssDelta,
          rangeBytes: 32,
        })}`,
      );
    }, 30_000);
  });

  describe("byte-budget LRU", () => {
    test("caps retained bytes at 16 MiB and never caches items above 4 MiB", async () => {
      const fourMiB = 4 * 1024 * 1024;
      const paths = new Map<string, string>();
      for (let index = 0; index < 5; index++) {
        const id = `lru-${index}`;
        await mediaStorage.writeMediaStorage(
          accountId,
          "c-lru",
          id,
          new Uint8Array(fourMiB).fill(index),
          "image/png",
        );
        paths.set(id, (await mediaStorage.statMediaStorage(accountId, "c-lru", id))!.path);
      }

      // lru-1 is older than lru-2, but this hit promotes it before the next insertion.
      expect(await mediaStorage.readMediaStorage(accountId, "c-lru", "lru-1")).not.toBeNull();
      await mediaStorage.writeMediaStorage(
        accountId,
        "c-lru",
        "lru-5",
        new Uint8Array(fourMiB).fill(5),
        "image/png",
      );
      expect(mediaStorage.getMediaMemoryCacheStats()).toEqual({
        entries: 4,
        bytes: 16 * 1024 * 1024,
        budgetBytes: 16 * 1024 * 1024,
        maxItemBytes: 4 * 1024 * 1024,
      });

      await fs.rm(paths.get("lru-1")!);
      await fs.rm(paths.get("lru-2")!);
      expect(await mediaStorage.readMediaStorage(accountId, "c-lru", "lru-1")).not.toBeNull();
      expect(await mediaStorage.readMediaStorage(accountId, "c-lru", "lru-2")).toBeNull();

      const bigId = "never-cache-large";
      await mediaStorage.writeMediaStorage(
        accountId,
        "c-lru",
        bigId,
        new Uint8Array(fourMiB + 1),
        "video/mp4",
      );
      const big = await mediaStorage.statMediaStorage(accountId, "c-lru", bigId);
      expect(big).not.toBeNull();
      await fs.rm(big!.path);
      expect(await mediaStorage.readMediaStorage(accountId, "c-lru", bigId)).toBeNull();
      expect(mediaStorage.getMediaMemoryCacheStats().bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    });
  });

  describe("media HTTP delivery", () => {
    test("streams saved files with 200/206/416 byte-range semantics", async () => {
      const bytes = Uint8Array.from({ length: 10 }, (_, index) => index);
      await mediaStorage.writeMediaStorage(accountId, "c-range", "300", bytes, "video/mp4");
      const { lineRouter } = await import("../api/line.js");
      const url = `http://localhost/${accountId}/media/c-range/300?preview=0`;

      const full = await lineRouter.request(url);
      expect(full.status).toBe(200);
      expect(full.headers.get("accept-ranges")).toBe("bytes");
      expect(full.headers.get("content-length")).toBe("10");
      expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);

      const partial = await lineRouter.request(url, { headers: { Range: "bytes=2-5" } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(partial.headers.get("content-length")).toBe("4");
      expect(new Uint8Array(await partial.arrayBuffer())).toEqual(Uint8Array.from([2, 3, 4, 5]));

      const suffix = await lineRouter.request(url, { headers: { Range: "bytes=-3" } });
      expect(suffix.status).toBe(206);
      expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
      expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(Uint8Array.from([7, 8, 9]));

      const openEnded = await lineRouter.request(url, { headers: { Range: "bytes=8-" } });
      expect(openEnded.status).toBe(206);
      expect(openEnded.headers.get("content-range")).toBe("bytes 8-9/10");
      expect(new Uint8Array(await openEnded.arrayBuffer())).toEqual(Uint8Array.from([8, 9]));

      for (const range of ["bytes=10-", "bytes=4-3", "bytes=0-1,4-5"]) {
        const invalid = await lineRouter.request(url, { headers: { Range: range } });
        expect(invalid.status).toBe(416);
        expect(invalid.headers.get("content-range")).toBe("bytes */10");
        expect(invalid.headers.get("content-length")).toBe("0");
      }
    });

    test("does not persist a preview under the original media key", async () => {
      const lineService = await import("../service/lineService.js");
      const previewBytes = Uint8Array.from([9, 9]);
      const originalBytes = Uint8Array.from([1, 2, 3, 4]);
      const fetchSpy = spyOn(lineService, "fetchMessageMedia").mockImplementation(
        async (_accountId, _chatMid, _messageId, preview) => ({
          bytes: preview ? previewBytes : originalBytes,
          contentType: "image/jpeg",
        }),
      );
      const { lineRouter } = await import("../api/line.js");
      const base = `http://localhost/${accountId}/media/c-preview/400`;

      const preview = await lineRouter.request(base);
      expect(preview.status).toBe(200);
      expect(new Uint8Array(await preview.arrayBuffer())).toEqual(previewBytes);
      expect(await mediaStorage.statMediaStorage(accountId, "c-preview", "400")).toBeNull();

      const original = await lineRouter.request(`${base}?preview=0`);
      expect(original.status).toBe(200);
      expect(new Uint8Array(await original.arrayBuffer())).toEqual(originalBytes);
      expect(await mediaStorage.statMediaStorage(accountId, "c-preview", "400")).toMatchObject({
        sizeBytes: originalBytes.byteLength,
        contentType: "image/jpeg",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });

    test("keeps a large saved original available to offline preview through Range", async () => {
      const lineService = await import("../service/lineService.js");
      await mediaStorage.writeMediaStorage(
        accountId,
        "c-preview-large",
        "401",
        new Uint8Array(4 * 1024 * 1024 + 1),
        "video/mp4",
      );
      const previewBytes = Uint8Array.from([7, 8, 9]);
      const fetchSpy = spyOn(lineService, "fetchMessageMedia").mockResolvedValue({
        bytes: previewBytes,
        contentType: "image/jpeg",
      });
      const { lineRouter } = await import("../api/line.js");
      const response = await lineRouter.request(
        `http://localhost/${accountId}/media/c-preview-large/401`,
        { headers: { Range: "bytes=1-2" } },
      );
      expect(response.status).toBe(206);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(0, 0));
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  test("keeps one logical media object and clear removes unindexed physical files", async () => {
    await mediaStorage.writeMediaStorage(
      accountId,
      "c-logical",
      "500",
      Uint8Array.from([1, 2, 3]),
      "image/png",
    );
    await mediaStorage.writeMediaStorage(
      accountId,
      "c-logical",
      "500",
      Uint8Array.from([4, 5, 6, 7]),
      "image/jpeg",
    );
    const logicalRows = [];
    for await (const row of mediaStorage.iterateAccountMediaStorage(
      accountId,
      new Set(["c-logical"]),
    )) {
      logicalRows.push(row);
    }
    expect(logicalRows).toHaveLength(1);
    expect(logicalRows[0]).toMatchObject({ contentType: "image/jpeg", sizeBytes: 4 });

    const orphanHash = "a".repeat(64);
    const orphanPath = join(mediaRoot, "images", "aa", `${orphanHash}.png`);
    await fs.mkdir(dirname(orphanPath), { recursive: true });
    await fs.writeFile(orphanPath, Uint8Array.of(99));
    await mediaStorage.clearMediaStorage();
    expect(await fs.stat(orphanPath).catch(() => null)).toBeNull();
    expect((await mediaStorage.getMediaStorageIndexedTotals()).total).toBe(0);
  });
}
