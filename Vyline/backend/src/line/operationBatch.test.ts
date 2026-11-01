import { expect, test } from "bun:test";

test("commits an operation batch only after every operation is processed", async () => {
  const loaded = await import("./operationBatch.js").catch(() => null);
  expect(loaded).not.toBeNull();
  if (!loaded) return;

  const order: string[] = [];
  await loaded.processOperationBatch(
    ["first", "second"],
    async (value) => {
      order.push(value);
    },
    async () => {
      order.push("commit");
    },
  );
  expect(order).toEqual(["first", "second", "commit"]);
});

test("does not commit a cursor when any operation in the batch fails", async () => {
  const loaded = await import("./operationBatch.js").catch(() => null);
  expect(loaded).not.toBeNull();
  if (!loaded) return;

  let commits = 0;
  await expect(
    loaded.processOperationBatch(
      ["persisted", "fails", "not-reached"],
      async (value) => {
        if (value === "fails") throw new Error("storage unavailable");
      },
      async () => {
        commits += 1;
      },
    ),
  ).rejects.toThrow("storage unavailable");
  expect(commits).toBe(0);
});

test("publishes staged events only after persistence and cursor commit", async () => {
  const loaded = await import("./operationBatch.js");
  const order: string[] = [];
  await loaded.processOperationBatch(
    ["message"],
    async (value) => {
      order.push(`process:${value}`);
    },
    async () => {
      order.push("persist");
    },
    async () => {
      order.push("publish");
    },
  );
  expect(order).toEqual(["process:message", "persist", "publish"]);
});
