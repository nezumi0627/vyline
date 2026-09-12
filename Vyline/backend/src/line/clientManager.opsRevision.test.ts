import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const originalDataDir = process.env.VYLINE_DATA_DIR;
let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(`${tmpdir()}/vyline-ops-`);
  process.env.VYLINE_DATA_DIR = dataDir;
});

afterEach(async () => {
  if (originalDataDir === undefined) process.env.VYLINE_DATA_DIR = undefined;
  else process.env.VYLINE_DATA_DIR = originalDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe("persistent fetchOps cursor", () => {
  test("round-trips large revisions without losing precision", async () => {
    const { loadOpsRevisionCursor, persistOpsRevisionCursor } = await import("./clientManager.js");
    const cursor = {
      revision: 9_007_199_254_740_993n,
      globalRev: 12,
      individualRev: 9_007_199_254_740_994n,
    };

    await persistOpsRevisionCursor("account-a", cursor);
    const restored = await loadOpsRevisionCursor("account-a");

    expect(restored).toEqual(cursor);
    const persisted = await readFile(
      `${dataDir}/accounts/account-a/protocol.json.ops-cursor.json`,
      "utf8",
    );
    expect(persisted).toContain('"revision":"9007199254740993"');
  });

  test("uses zero on a missing or corrupt cursor so events are replayed", async () => {
    const { loadOpsRevisionCursor, persistOpsRevisionCursor } = await import("./clientManager.js");
    const missing = await loadOpsRevisionCursor("account-b");
    expect(missing).toEqual({ revision: 0, globalRev: 0, individualRev: 0 });

    await persistOpsRevisionCursor("account-b", {
      revision: 42,
      globalRev: 7,
      individualRev: 8,
    });
    const path = `${dataDir}/accounts/account-b/protocol.json.ops-cursor.json`;
    expect(existsSync(path)).toBe(true);
    await writeFile(path, "{broken", "utf8");

    expect(await loadOpsRevisionCursor("account-b")).toEqual({
      revision: 0,
      globalRev: 0,
      individualRev: 0,
    });
  });

  test("never lets a stale reconnect write move the durable cursor backwards", async () => {
    const { loadOpsRevisionCursor, persistOpsRevisionCursor } = await import("./clientManager.js");
    await persistOpsRevisionCursor("account-c", {
      revision: 100,
      globalRev: 30,
      individualRev: 40,
    });
    await Promise.all([
      persistOpsRevisionCursor("account-c", { revision: 80, globalRev: 20, individualRev: 35 }),
      persistOpsRevisionCursor("account-c", { revision: 120, globalRev: 31, individualRev: 41 }),
    ]);

    expect(await loadOpsRevisionCursor("account-c")).toEqual({
      revision: 120,
      globalRev: 31,
      individualRev: 41,
    });
  });

  test("builds a candidate cursor without mutating the committed cursor", async () => {
    const { nextOpsRevisionCursor } = await import("./clientManager.js");
    const current = { revision: 10, globalRev: 20, individualRev: 30 } as const;
    const next = nextOpsRevisionCursor(current, {
      fullSyncResponse: { nextRevision: 11 },
      operationResponse: {
        globalEvents: { lastRevision: 21 },
        individualEvents: { lastRevision: 31 },
        operations: [{ revision: 12 }],
      },
    });

    expect(current).toEqual({ revision: 10, globalRev: 20, individualRev: 30 });
    expect(next).toEqual({ revision: 12, globalRev: 21, individualRev: 31 });
  });

  test("does not persist or apply a cursor when operation processing fails", async () => {
    const { loadOpsRevisionCursor, processAndCommitOpsRevision } = await import(
      "./clientManager.js"
    );
    const current = { revision: 50, globalRev: 60, individualRev: 70 } as const;

    await expect(
      processAndCommitOpsRevision(
        "account-d",
        current,
        { operationResponse: { operations: [{ revision: 51 }] } },
        async () => {
          throw new Error("processor failed");
        },
      ),
    ).rejects.toThrow("processor failed");

    expect(await loadOpsRevisionCursor("account-d")).toEqual({
      revision: 0,
      globalRev: 0,
      individualRev: 0,
    });
  });
});
