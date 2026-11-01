import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testRoot = await mkdtemp(join(tmpdir(), "vyline-ops-cursor-"));
process.env.VYLINE_DATA_DIR = join(testRoot, "data");

const {
  loadOpsRevisionCursor,
  persistOpsRevisionCursor,
  nextOpsRevisionCursor,
  processAndCommitOpsRevision,
} = await import("./clientManager.js");

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe("fetchOps revision cursor", () => {
  test("round-trips account-scoped cursors, including 64-bit revisions", async () => {
    const accountId = "account-a";
    const cursor = {
      revision: BigInt("9007199254740993"),
      globalRev: 12,
      individualRev: BigInt("9007199254740994"),
    };

    await persistOpsRevisionCursor(accountId, cursor);

    expect(await loadOpsRevisionCursor(accountId)).toEqual(cursor);
  });

  test("does not persist a cursor when operation processing fails", async () => {
    const accountId = "account-failure";
    const current = { revision: 7, globalRev: 2, individualRev: 3 };
    const response = {
      operationResponse: { operations: [{ revision: 8 }] },
    };

    await expect(
      processAndCommitOpsRevision(accountId, current, response, async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");

    expect(await loadOpsRevisionCursor(accountId)).toEqual({
      revision: 0,
      globalRev: 0,
      individualRev: 0,
    });
  });

  test("advances after processing succeeds and keeps the highest revision", async () => {
    const current = { revision: 10, globalRev: 4, individualRev: 5 };
    const response = {
      fullSyncResponse: { nextRevision: 11 },
      operationResponse: {
        globalEvents: { lastRevision: 6 },
        individualEvents: { lastRevision: 7 },
        operations: [{ revision: 12 }],
      },
    };

    expect(nextOpsRevisionCursor(current, response)).toEqual({
      revision: 12,
      globalRev: 6,
      individualRev: 7,
    });
    const accountId = "account-success";
    await processAndCommitOpsRevision(accountId, current, response, async () => undefined);
    expect(await loadOpsRevisionCursor(accountId)).toEqual({
      revision: 12,
      globalRev: 6,
      individualRev: 7,
    });
  });

  test("does not commit a response from a stopped or replaced loop", async () => {
    const accountId = "account-stopped";
    await processAndCommitOpsRevision(
      accountId,
      { revision: 20, globalRev: 8, individualRev: 9 },
      { operationResponse: { operations: [{ revision: 21 }] } },
      async () => undefined,
      () => false,
    );

    expect(await loadOpsRevisionCursor(accountId)).toEqual({
      revision: 0,
      globalRev: 0,
      individualRev: 0,
    });
  });
});
