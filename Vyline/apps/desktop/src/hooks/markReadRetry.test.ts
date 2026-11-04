import { expect, test } from "bun:test";
import { createMarkReadRetry } from "./markReadRetry.js";

test("retries mark-read after a failed request", async () => {
  let attempts = 0;
  const retry = createMarkReadRetry(
    () => true,
    async () => {
      attempts += 1;
      return attempts > 1;
    },
    0,
  );

  await retry();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(attempts).toBe(2);
  retry.cancel();
});

test("retries a message received while hidden when visibility returns", async () => {
  let visible = false;
  let attempts = 0;
  const retry = createMarkReadRetry(
    () => visible,
    async () => {
      attempts += 1;
      return true;
    },
  );
  const onVisibility = () => {
    if (visible) void retry();
  };

  await retry();
  visible = true;
  onVisibility();
  await Promise.resolve();

  expect(attempts).toBe(1);
});

test("does not schedule another attempt when the effect is cancelled in flight", async () => {
  let attempts = 0;
  let finishRequest!: (succeeded: boolean) => void;
  const retry = createMarkReadRetry(
    () => true,
    async () => {
      attempts += 1;
      return await new Promise<boolean>((resolve) => {
        finishRequest = resolve;
      });
    },
    0,
  );

  const pending = retry();
  retry.cancel();
  finishRequest(false);
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(attempts).toBe(1);
});
