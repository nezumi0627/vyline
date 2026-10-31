import { expect, test } from "bun:test";
import { startManagedCall } from "./callManager.js";

test("reserves an account while outgoing call setup is in flight", async () => {
  const opts = {
    accountId: "offline-call-start-race",
    client: {} as never,
    to: "u-peer",
  };
  const first = startManagedCall(opts);
  const second = startManagedCall(opts);

  await expect(second).rejects.toThrow("通話の開始処理中です");
  await expect(first).rejects.toBeDefined();
});
