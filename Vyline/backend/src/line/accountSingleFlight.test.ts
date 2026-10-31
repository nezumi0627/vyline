import { expect, test } from "bun:test";
import { runAccountSingleFlight } from "./accountSingleFlight.js";

test("coalesces concurrent restores for one account but keeps accounts isolated", async () => {
  const pending = new Map<string, Promise<string>>();
  let resolve!: (value: string) => void;
  const work = () => new Promise<string>((done) => { resolve = done; });
  const first = runAccountSingleFlight(pending, "account-a", work);
  const duplicate = runAccountSingleFlight(pending, "account-a", work);
  const other = runAccountSingleFlight(pending, "account-b", async () => "b");

  expect(first).toBe(duplicate);
  expect(await other).toBe("b");
  resolve("a");
  expect(await first).toBe("a");
  expect(pending.size).toBe(0);
});

test("clears a failed restore so a later explicit retry can run", async () => {
  const pending = new Map<string, Promise<string>>();
  await expect(runAccountSingleFlight(pending, "account-a", async () => { throw new Error("offline"); }))
    .rejects.toThrow("offline");
  expect(await runAccountSingleFlight(pending, "account-a", async () => "restored")).toBe("restored");
});
