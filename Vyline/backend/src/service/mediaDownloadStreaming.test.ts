import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VYLINE_MEDIA_DOWNLOAD_TEST_CHILD !== "1") {
  test("plain media MISS streaming integration in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-media-download-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_MEDIA_DOWNLOAD_TEST_CHILD: "1",
          VYLINE_MEDIA_DOWNLOAD_TEST_ROOT: root,
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
  const root = process.env.VYLINE_MEDIA_DOWNLOAD_TEST_ROOT!;
  process.env.VYLINE_DATA_DIR = join(root, "data");
  process.env.VYLINE_STORAGE_DIR = join(root, "storage");
  process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
  process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");
  process.env.VYLINE_BACKUP_DIR = join(root, "data", "backups");
  process.env.VYLINE_MEDIA_STORAGE_MAX_OBJECT_BYTES = "128";

  const accountId = "stream-account";
  const chatMid = "c-stream";
  const chatStore = await import("../storage/chatStore.js");
  const mediaStorage = await import("../storage/mediaStorage.js");
  const clientManager = await import("../line/clientManager.js");
  let obsFetches = 0;
  let e2eeFileDownloads = 0;
  let e2eeMaxBytes = 0;
  let e2eeProgressCalls = 0;
  const obsBytes = Uint8Array.from({ length: 96 }, (_, index) => (index * 13) & 0xff);
  const decryptedBytes = Uint8Array.from([201, 202, 203, 204]);
  const getClientSpy = spyOn(clientManager, "getClient").mockImplementation(
    () =>
      ({
        base: {
          authToken: "test-token",
          request: { systemType: "TEST" },
          fetch: async () => {
            obsFetches++;
            let offset = 0;
            return new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  if (offset >= obsBytes.byteLength) {
                    controller.close();
                    return;
                  }
                  const end = Math.min(offset + 7, obsBytes.byteLength);
                  controller.enqueue(obsBytes.slice(offset, end));
                  offset = end;
                },
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "video/mp4",
                  "Content-Length": String(obsBytes.byteLength),
                },
              },
            );
          },
          obs: {
            downloadMediaByE2EEToFile: async (
              _message: unknown,
              path: string,
              maxBytes: number,
              _signal: AbortSignal,
              beforeWrite: (nextTotalBytes: number, pendingBytes: number) => Promise<void>,
            ) => {
              e2eeFileDownloads++;
              e2eeMaxBytes = maxBytes;
              await beforeWrite(decryptedBytes.byteLength, decryptedBytes.byteLength);
              e2eeProgressCalls++;
              await fs.writeFile(path, decryptedBytes);
              return { size: decryptedBytes.byteLength };
            },
          },
        },
      }) as never,
  );
  const { lineRouter } = await import("../api/line.js");

  const storedMessage = (
    id: string,
    contentMetadata: Record<string, string> | null,
  ): Parameters<typeof chatStore.upsertMessages>[2][number] => ({
    id,
    chatMid,
    from: "u-sender",
    to: chatMid,
    text: null,
    contentType: "VIDEO",
    createdTime: Date.now(),
    isMyMessage: false,
    contentMetadata,
    savedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    await chatStore.upsertMessages(accountId, chatMid, [storedMessage("plain-video", null)]);
    await chatStore.upsertMessages(accountId, chatMid, [
      storedMessage("encrypted-video", {
        e2eeVersion: "2",
        keyMaterial: "encrypted-media-key",
        OID: "encrypted-video",
        SID: "talk",
      }),
    ]);
  });

  afterAll(async () => {
    getClientSpy.mockRestore();
    await chatStore.closeAccountChatDb(accountId);
    await mediaStorage.closeMediaStorage();
  });

  test("streams a plain OBS original to disk, then serves only the requested range", async () => {
    const response = await lineRouter.request(
      `http://localhost/${accountId}/media/${chatMid}/plain-video?preview=0`,
      { headers: { Range: "bytes=11-26" } },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("16");
    expect(response.headers.get("content-range")).toBe("bytes 11-26/96");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(obsBytes.slice(11, 27));
    expect(obsFetches).toBe(1);
    expect(await mediaStorage.statMediaStorage(accountId, chatMid, "plain-video")).toMatchObject({
      sizeBytes: obsBytes.byteLength,
      contentType: "video/mp4",
    });
  });

  test("decrypts E2EE media into a file and serves it without a full-body buffer", async () => {
    const response = await lineRouter.request(
      `http://localhost/${accountId}/media/${chatMid}/encrypted-video?preview=0`,
      { headers: { Range: "bytes=1-2" } },
    );
    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(decryptedBytes.slice(1, 3));
    expect(obsFetches).toBe(1);
    expect(e2eeFileDownloads).toBe(1);
    expect(e2eeMaxBytes).toBe(128);
    expect(e2eeProgressCalls).toBe(1);
    expect(
      await mediaStorage.statMediaStorage(accountId, chatMid, "encrypted-video"),
    ).toMatchObject({
      sizeBytes: decryptedBytes.byteLength,
      contentType: "video/mp4",
    });
  });
}
