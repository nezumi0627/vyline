import { expect, test } from "bun:test";
import { createMarkReadRetry } from "./markReadRetry.js";

test("retries mark-read after a failed request", async () => {
  let attempts = 0;
  const retry = createMarkReadRetry(
    () => true,
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
    },
  );

  await retry();
  await retry();

  expect(attempts).toBe(2);
});

test("retries a message received while hidden when visibility returns", async () => {
  let visible = false;
  let attempts = 0;
  const retry = createMarkReadRetry(
    () => visible,
    async () => {
      attempts += 1;
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
