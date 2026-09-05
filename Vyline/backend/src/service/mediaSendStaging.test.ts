import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Path constants and lineService are process-wide. Isolate the binary-route tests
// and let the parent remove the fixture after every SQLite/file handle has closed.
if (process.env.VYLINE_MEDIA_SEND_TEST_CHILD !== "1") {
  test("binary media send staging and BFF routes in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-media-send-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_MEDIA_SEND_TEST_CHILD: "1",
          VYLINE_MEDIA_SEND_TEST_ROOT: root,
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
  const root = process.env.VYLINE_MEDIA_SEND_TEST_ROOT!;
  process.env.VYLINE_DATA_DIR = join(root, "data");
  process.env.VYLINE_STORAGE_DIR = join(root, "storage");
  process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
  process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");

  const staging = await import("./mediaSendStaging.js");

  test("streams request chunks to a managed file and removes it explicitly", async () => {
    const chunks = [Uint8Array.from([1, 2]), Uint8Array.from([3, 4, 5])];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
    const upload = await staging.stageStandaloneMediaUpload(
      new Request("http://localhost/upload", { method: "POST", body }),
      { mimeType: "application/octet-stream", filename: "stream.bin", mediaType: "file" },
    );
    expect(upload.path.startsWith(process.env.VYLINE_DATA_DIR!)).toBe(true);
    expect(upload.sizeBytes).toBe(5);
    expect(new Uint8Array(await Bun.file(upload.path).arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3, 4, 5]),
    );
    await staging.removeStandaloneMediaUpload(upload);
    expect(await fs.stat(upload.path).catch(() => null)).toBeNull();
  });

  test("rejects a streamed body at the old base64 limit's equivalent raw byte count", async () => {
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted > staging.MEDIA_SEND_MAX_BYTES) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(Math.min(1024 * 1024, staging.MEDIA_SEND_MAX_BYTES + 1)));
        emitted += 1024 * 1024;
      },
    });
    await expect(
      staging.stageStandaloneMediaUpload(
        new Request("http://localhost/upload", { method: "POST", body }),
        {},
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  test("bounds active batch sessions and reclaims abandoned staging", async () => {
    const uploadIds: string[] = [];
    for (let index = 0; index < 16; index++) {
      const upload = await staging.createMediaBatchUpload("account", `chat-${index}`, 1);
      uploadIds.push(upload.uploadId);
    }
    await expect(staging.createMediaBatchUpload("account", "overflow", 1)).rejects.toMatchObject({
      status: 409,
    });
    for (const uploadId of uploadIds) {
      await staging.removeMediaBatchUpload("account", uploadId);
    }

    const abandoned = await staging.createMediaBatchUpload("account", "abandoned", 1);
    await Bun.sleep(2);
    await staging.pruneStaleMediaUploads(0);
    await expect(
      staging.stageMediaBatchItem(
        "account",
        abandoned.uploadId,
        0,
        new Request("http://localhost/upload", {
          method: "POST",
          body: Uint8Array.of(1),
        }),
        {},
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("serializes byte reservations across concurrent batch item PUTs", async () => {
    const batch = await staging.createMediaBatchUpload("parallel-account", "parallel-chat", 13);
    let releaseBodies!: () => void;
    const bodyGate = new Promise<void>((resolve) => {
      releaseBodies = resolve;
    });
    const uploads = Array.from({ length: 13 }, (_, index) => {
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await bodyGate;
          if (sent) controller.close();
          else {
            sent = true;
            controller.enqueue(Uint8Array.of(index));
          }
        },
      });
      return staging.stageMediaBatchItem(
        "parallel-account",
        batch.uploadId,
        index,
        new Request("http://localhost/upload", { method: "POST", body }),
        {},
      );
    });
    const settledPromise = Promise.allSettled(uploads);
    await Bun.sleep(100);
    releaseBodies();
    const settled = await settledPromise;
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(12);
    const rejected = settled.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 413 });
    await staging.removeMediaBatchUpload("parallel-account", batch.uploadId, true);
  });

  test("single and batch BFF routes pass disk paths to the service and clean them", async () => {
    const lineService = await import("./lineService.js");
    const clientManager = await import("../line/clientManager.js");
    const noteService = await import("./noteService.js");
    const albumService = await import("./albumService.js");
    let singlePath = "";
    const singleSpy = spyOn(lineService, "sendMedia").mockImplementation(
      async (_accountId, _chatMid, source, options) => {
        singlePath = source.path;
        expect(options).toMatchObject({
          mimeType: "image/png",
          filename: "写真.png",
          mediaType: "image",
        });
        expect(new Uint8Array(await Bun.file(source.path).arrayBuffer())).toEqual(
          Uint8Array.from([10, 11, 12]),
        );
      },
    );
    let batchPaths: string[] = [];
    const batchSpy = spyOn(lineService, "sendMediaBatch").mockImplementation(
      async (_accountId, chatMid, items) => {
        expect(chatMid).toBe("c-batch");
        batchPaths = items.map((item) => item.path);
        expect(
          await Promise.all(
            items.map(async (item) => new Uint8Array(await Bun.file(item.path).arrayBuffer())),
          ),
        ).toEqual([Uint8Array.from([1, 2]), Uint8Array.from([3, 4, 5])]);
        return items.length;
      },
    );
    const contentClientSpy = spyOn(clientManager, "getContentClient").mockImplementation(
      async () => ({}) as never,
    );
    const ancillaryPaths: string[] = [];
    const noteSpy = spyOn(noteService, "uploadNoteMedia").mockImplementation(
      async (_client, type, data) => {
        expect(type).toBe("video");
        expect(data.type).toBe("video/mp4");
        expect(data.size).toBe(4);
        ancillaryPaths.push((data as File).name);
        return { objId: "note-object", objHash: "note-hash" };
      },
    );
    const albumSpy = spyOn(albumService, "uploadAlbumMedia").mockImplementation(
      async (_client, _albumId, input) => {
        expect(input.data.type).toBe("image/jpeg");
        expect(input.data.size).toBe(3);
        ancillaryPaths.push((input.data as File).name);
        return { oid: "album-object" };
      },
    );
    const { lineRouter } = await import("../api/line.js");

    const single = await lineRouter.request("http://localhost/account/send-media", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Vyline-Chat-Mid": "c-single",
        "X-Vyline-Media-Filename": encodeURIComponent("写真.png"),
        "X-Vyline-Media-Type": "image",
      },
      body: Uint8Array.from([10, 11, 12]),
    });
    expect(single.status).toBe(200);
    expect(await single.json()).toEqual({ ok: true });
    expect(singleSpy).toHaveBeenCalledTimes(1);
    expect(await fs.stat(singlePath).catch(() => null)).toBeNull();

    const started = await lineRouter.request("http://localhost/account/send-media-batch/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatMid: "c-batch", itemCount: 2 }),
    });
    const startBody = (await started.json()) as { ok: boolean; uploadId: string };
    expect(startBody.ok).toBe(true);
    for (const [index, bytes] of [Uint8Array.from([1, 2]), Uint8Array.from([3, 4, 5])].entries()) {
      const uploaded = await lineRouter.request(
        `http://localhost/account/send-media-batch/${startBody.uploadId}/items/${index}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "image/jpeg",
            "X-Vyline-Media-Filename": encodeURIComponent(`image-${index}.jpg`),
            "X-Vyline-Media-Type": "image",
          },
          body: bytes,
        },
      );
      expect(uploaded.status).toBe(200);
    }
    const completed = await lineRouter.request(
      `http://localhost/account/send-media-batch/${startBody.uploadId}/complete`,
      { method: "POST" },
    );
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({ ok: true, count: 2 });
    expect(batchSpy).toHaveBeenCalledTimes(1);
    for (const path of batchPaths) expect(await fs.stat(path).catch(() => null)).toBeNull();

    const note = await lineRouter.request("http://localhost/account/notes/media/video", {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: Uint8Array.from([21, 22, 23, 24]),
    });
    expect(note.status).toBe(200);
    expect(await note.json()).toEqual({ objId: "note-object", objHash: "note-hash" });

    const album = await lineRouter.request(
      "http://localhost/account/albums/album-id/media?chatId=c-album",
      {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Uint8Array.from([31, 32, 33]),
      },
    );
    expect(album.status).toBe(200);
    expect(await album.json()).toEqual({ oid: "album-object" });
    expect(noteSpy).toHaveBeenCalledTimes(1);
    expect(albumSpy).toHaveBeenCalledTimes(1);
    for (const path of ancillaryPaths) expect(await fs.stat(path).catch(() => null)).toBeNull();

    singleSpy.mockRestore();
    batchSpy.mockRestore();
    contentClientSpy.mockRestore();
    noteSpy.mockRestore();
    albumSpy.mockRestore();
  });
}
