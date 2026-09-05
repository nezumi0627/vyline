import { expect, test } from "bun:test";
import { runSendRpc } from "./clientManager.js";

test("a timed-out send keeps the account queue until the underlying work settles", async () => {
  let releaseFirst!: () => void;
  const firstWork = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstResult = runSendRpc("queue-timeout", () => firstWork, { timeoutMs: 5 }).catch(
    (error) => error,
  );
  await Bun.sleep(15);
  expect(await firstResult).toBeInstanceOf(Error);

  let secondStarted = false;
  const second = runSendRpc("queue-timeout", async () => {
    secondStarted = true;
    return "second";
  });
  await Bun.sleep(10);
  expect(secondStarted).toBe(false);

  releaseFirst();
  expect(await second).toBe("second");
  expect(secondStarted).toBe(true);
});

test("abort-on-timeout waits for upload cleanup before rejecting", async () => {
  let cleaned = false;
  const result = runSendRpc(
    "queue-abort",
    async (signal) => {
      if (!signal) throw new Error("missing abort signal");
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            setTimeout(() => {
              cleaned = true;
              reject(signal.reason);
            }, 10);
          },
          { once: true },
        );
      });
    },
    { timeoutMs: 5, abortOnTimeout: true },
  );

  await expect(result).rejects.toThrow("send timed out");
  expect(cleaned).toBe(true);
});
