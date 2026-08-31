import { expect, test } from "bun:test";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const UNIT = 1024 ** 2;

if (process.env.VYLINE_WORK_QUEUE_TEST_CHILD !== "1") {
  test("disk-backed heavy queue reservations are bounded in an isolated process", async () => {
    const disk = await statfs(tmpdir());
    const available = BigInt(disk.bavail) * BigInt(disk.bsize);
    const physicalHeadroom = BigInt(80 * UNIT);
    const minFree = available > physicalHeadroom ? available - physicalHeadroom : 0n;
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        VYLINE_WORK_QUEUE_TEST_CHILD: "1",
        VYLINE_DATA_DIR: join(tmpdir(), `vyline-work-queue-${crypto.randomUUID()}`),
        VYLINE_BACKUP_HEAVY_CONCURRENCY: "1",
        VYLINE_BACKUP_HEAVY_MAX_ITEMS: "3",
        VYLINE_BACKUP_HEAVY_MAX_ITEMS_PER_ACCOUNT: "2",
        VYLINE_BACKUP_HEAVY_MAX_RESERVED_BYTES: String(100 * UNIT),
        VYLINE_BACKUP_HEAVY_MAX_RESERVED_BYTES_PER_ACCOUNT: String(60 * UNIT),
        VYLINE_BACKUP_MIN_FREE_BYTES: minFree.toString(),
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
  const { assertDiskBackedWorkFreeSpace, reserveHeavyBackupWork, withDiskBackedWorkCapacityLock } =
    await import("./diskBackedWorkQueue.js");

  test("retains count and bytes through queued work and cleanup", async () => {
    const physicalA = reserveHeavyBackupWork("physical-a", 60 * UNIT);
    await expect(
      withDiskBackedWorkCapacityLock(() =>
        assertDiskBackedWorkFreeSpace(60 * UNIT, physicalA.reservedBytes),
      ),
    ).resolves.toBeUndefined();
    const physicalB = reserveHeavyBackupWork("physical-b", 40 * UNIT);
    await expect(
      withDiskBackedWorkCapacityLock(() =>
        assertDiskBackedWorkFreeSpace(40 * UNIT, physicalB.reservedBytes),
      ),
    ).rejects.toThrow("空き容量");
    physicalB.release();
    physicalA.release();

    const account = reserveHeavyBackupWork("account", 60 * UNIT);
    expect(() => reserveHeavyBackupWork("account", 1)).toThrow("このアカウント");
    const other = reserveHeavyBackupWork("other", 40 * UNIT);
    expect(() => reserveHeavyBackupWork("third", 1)).toThrow("待機データ量");
    other.release();
    account.release();

    let finishCleanup!: () => void;
    let cleanupStarted!: () => void;
    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const started = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    const queued = reserveHeavyBackupWork("queued", 41 * UNIT);
    const work = queued.enqueue(
      async () => {
        queued.resizeReservedBytes(50 * UNIT);
        expect(queued.reservedBytes).toBe(50 * UNIT);
        expect(() => queued.resizeInputBytes(50 * UNIT)).toThrow("開始済み");
        return "done";
      },
      async () => {
        cleanupStarted();
        await cleanupGate;
      },
    );
    await started;
    expect(() => reserveHeavyBackupWork("waiting", 60 * UNIT)).toThrow("待機データ量");
    finishCleanup();
    await expect(work).resolves.toBe("done");
    const afterCleanup = reserveHeavyBackupWork("waiting", 60 * UNIT);
    afterCleanup.release();

    let cleanupAttempts = 0;
    const cleanupHolder = reserveHeavyBackupWork("cleanup-holder", 40 * UNIT);
    const retrying = reserveHeavyBackupWork("retrying", 60 * UNIT);
    await expect(
      retrying.enqueue(
        async () => undefined,
        async () => {
          cleanupAttempts++;
          if (cleanupAttempts === 1) throw new Error("temporary cleanup failure");
        },
      ),
    ).resolves.toBeUndefined();
    expect(() => retrying.release()).toThrow("開始済み");
    expect(() => reserveHeavyBackupWork("blocked", 1)).toThrow("待機データ量");
    let recovered: ReturnType<typeof reserveHeavyBackupWork> | null = null;
    for (let attempt = 0; attempt < 40 && !recovered; attempt++) {
      await Bun.sleep(50);
      try {
        recovered = reserveHeavyBackupWork("recovered", 1);
      } catch {
        // The cleanup retry has not run yet.
      }
    }
    expect(cleanupAttempts).toBe(2);
    expect(recovered).not.toBeNull();
    recovered?.release();
    cleanupHolder.release();
  });
}
