import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let dataDir: string;
let store: typeof import("./subdeviceStore.js");

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-subdevice-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  store = await import("./subdeviceStore.js");
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("subdevice pairing", () => {
  test("consumes a pairing token and blocks the resulting session", async () => {
    const pairing = await store.createPairing("account-1");
    expect(await store.getPairing(pairing.token)).not.toBeNull();

    const completed = await store.completePairing(pairing.token, "iPhone", "ios");
    expect(completed?.device.accountId).toBe("account-1");
    expect(await store.getPairing(pairing.token)).toBeNull();
    expect(await store.isSubdeviceSessionValid(completed!.sessionToken)).toBe(true);

    await store.setSubdeviceBlocked(completed!.device.id, true);
    expect(await store.isSubdeviceSessionValid(completed!.sessionToken)).toBe(false);
  });
});
