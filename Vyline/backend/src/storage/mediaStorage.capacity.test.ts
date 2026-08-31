import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const childMode = process.env.VYLINE_MEDIA_CAPACITY_TEST_CHILD;

if (!childMode) {
  async function runChild(mode: "limits" | "disk" | "concurrency"): Promise<void> {
    const root = await fs.mkdtemp(join(tmpdir(), `vyline-media-capacity-${mode}-`));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_MEDIA_CAPACITY_TEST_CHILD: mode,
          VYLINE_MEDIA_CAPACITY_TEST_ROOT: root,
          VYLINE_DATA_DIR: join(root, "data"),
          VYLINE_STORAGE_DIR: join(root, "storage"),
          VYLINE_MEDIA_STORAGE_DIR: join(root, "storage", "saved-media"),
          VYLINE_MEDIA_INDEX_PATH: join(root, "storage", "media-index.sqlite"),
          VYLINE_MEDIA_STORAGE_MAX_OBJECT_BYTES: mode === "limits" ? "8" : "1024",
          VYLINE_MEDIA_STORAGE_WRITE_CONCURRENCY: "2",
          ...(mode === "disk"
            ? { VYLINE_MEDIA_STORAGE_MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) }
            : {}),
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
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  test("rejects oversized declared and chunked media in an isolated process", async () => {
    await runChild("limits");
  });

  test("rejects writes that would violate the disk free-space floor", async () => {
    await runChild("disk");
  });

  test("bounds concurrent media writes without blocking unrelated APIs", async () => {
    await runChild("concurrency");
  });
} else {
  const root = process.env.VYLINE_MEDIA_CAPACITY_TEST_ROOT!;
  const mediaRoot = join(root, "storage", "saved-media");
  const mediaStorage = await import("./mediaStorage.js");

  afterAll(async () => {
    await mediaStorage.closeMediaStorage();
  });

  async function expectNoPartialFiles(): Promise<void> {
    const names = await fs.readdir(mediaRoot, { recursive: true }).catch((): string[] => []);
    expect(names.filter((name) => name.endsWith(".partial"))).toEqual([]);
  }

  if (childMode === "limits") {
    test("rejects an oversized Content-Length before reading the body", async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      });

      await expect(
        mediaStorage.writeMediaStorageStream("account", "chat", "declared", body, "video/mp4", 9),
      ).rejects.toBeInstanceOf(mediaStorage.MediaStorageObjectLimitError);
      expect(cancelled).toBe(true);
      expect(await mediaStorage.statMediaStorage("account", "chat", "declared")).toBeNull();
      await expectNoPartialFiles();
    });

    test("stops a chunked body before it crosses the cumulative limit", async () => {
      const chunks = [Uint8Array.of(1, 2, 3, 4, 5), Uint8Array.of(6, 7, 8, 9, 10)];
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      });

      await expect(
        mediaStorage.writeMediaStorageStream("account", "chat", "chunked", body, "video/mp4"),
      ).rejects.toBeInstanceOf(mediaStorage.MediaStorageObjectLimitError);
      expect(cancelled).toBe(true);
      expect(await mediaStorage.statMediaStorage("account", "chat", "chunked")).toBeNull();
      await expectNoPartialFiles();
    });

    test("stops a produced file before decrypted output crosses the limit", async () => {
      await expect(
        mediaStorage.writeMediaStorageProducedFile(
          "account",
          "chat",
          "produced",
          "video/mp4",
          async (path, guard) => {
            const handle = await fs.open(path, "wx", 0o600);
            let total = 0;
            try {
              for (const chunk of [Uint8Array.of(1, 2, 3, 4, 5), Uint8Array.of(6, 7, 8, 9)]) {
                await guard.beforeWrite(total + chunk.byteLength, chunk.byteLength);
                await handle.write(chunk);
                total += chunk.byteLength;
              }
              return total;
            } finally {
              await handle.close();
            }
          },
        ),
      ).rejects.toBeInstanceOf(mediaStorage.MediaStorageObjectLimitError);
      expect(await mediaStorage.statMediaStorage("account", "chat", "produced")).toBeNull();
      await expectNoPartialFiles();
    });
  } else if (childMode === "disk") {
    test("cancels the body and leaves no partial when disk capacity is insufficient", async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(Uint8Array.of(1));
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });

      await expect(
        mediaStorage.writeMediaStorageStream("account", "chat", "disk-floor", body, "image/png", 1),
      ).rejects.toBeInstanceOf(mediaStorage.MediaStorageCapacityError);
      expect(cancelled).toBe(true);
      expect(await mediaStorage.statMediaStorage("account", "chat", "disk-floor")).toBeNull();
      await expectNoPartialFiles();
    });

    test("checks planned restore bytes and imports on the saved-media filesystem", async () => {
      const source = join(root, "data", "restore-source.bin");
      await fs.mkdir(join(root, "data"), { recursive: true });
      await fs.writeFile(source, Uint8Array.of(1));

      await expect(mediaStorage.assertMediaStorageCapacity(1)).rejects.toBeInstanceOf(
        mediaStorage.MediaStorageCapacityError,
      );
      await expect(
        mediaStorage.importMediaStorageFile(
          "account",
          "chat",
          "restore-import",
          source,
          "application/octet-stream",
        ),
      ).rejects.toBeInstanceOf(mediaStorage.MediaStorageCapacityError);
      expect(await mediaStorage.statMediaStorage("account", "chat", "restore-import")).toBeNull();
      await expectNoPartialFiles();
    });
  } else {
    test("runs no more than two independent producers at once", async () => {
      let active = 0;
      let maximumActive = 0;
      let started = 0;
      let notifyStarted!: () => void;
      const twoStarted = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      let releaseProducers!: () => void;
      const producerGate = new Promise<void>((resolve) => {
        releaseProducers = resolve;
      });

      const writes = ["one", "two", "three"].map((messageId, index) =>
        mediaStorage.writeMediaStorageProducedFile(
          "account",
          "chat",
          messageId,
          "application/octet-stream",
          async (path, guard) => {
            active++;
            started++;
            maximumActive = Math.max(maximumActive, active);
            if (started === 2) notifyStarted();
            try {
              await producerGate;
              await guard.beforeWrite(1, 1);
              await fs.writeFile(path, Uint8Array.of(index + 1), { flag: "wx" });
              return 1;
            } finally {
              active--;
            }
          },
        ),
      );

      await Promise.race([
        twoStarted,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("writers did not start")), 2_000),
        ),
      ]);
      await Bun.sleep(25);
      expect(started).toBe(2);
      expect(maximumActive).toBe(2);
      releaseProducers();
      await Promise.all(writes);
      expect(started).toBe(3);
      expect(maximumActive).toBe(2);
    });
  }
}
