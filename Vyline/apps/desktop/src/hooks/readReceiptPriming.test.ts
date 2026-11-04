import { expect, test } from "bun:test";
import { createReadReceiptPrimer } from "./readReceiptPriming.js";

test("retries receipt priming when the page becomes visible", () => {
  let refreshes = 0;
  const prime = createReadReceiptPrimer(() => {
    refreshes += 1;
  });

  prime(true, false);
  expect(refreshes).toBe(0);
  prime(true, true);
  prime(true, true);
  expect(refreshes).toBe(1);
});
