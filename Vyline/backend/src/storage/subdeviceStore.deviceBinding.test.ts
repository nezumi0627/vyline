import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDataDir = await mkdtemp(join(tmpdir(), "vyline-subdevice-device-binding-"));
process.env.VYLINE_DATA_DIR = testDataDir;

const {
  authenticateSubdevice,
  completePairing,
  createPairing,
  getSubdeviceSession,
  isSubdeviceSessionValid,
} = await import("./subdeviceStore.js");

afterAll(async () => {
  await rm(testDataDir, { force: true, recursive: true });
});

describe("subdevice installation binding", () => {
  test("accepts a session only from the installation that completed pairing", async () => {
    const installationId = crypto.randomUUID();
    const otherInstallationId = crypto.randomUUID();
    const pairing = await createPairing("main");
    const completed = await completePairing(pairing.token, "Test tablet", "web", installationId);

    expect(completed).not.toBeNull();
    expect(await authenticateSubdevice(completed!.sessionToken, installationId)).not.toBeNull();
    expect(await authenticateSubdevice(completed!.sessionToken, otherInstallationId)).toBeNull();
    expect(await isSubdeviceSessionValid(completed!.sessionToken, installationId)).toBe(true);
    expect(await isSubdeviceSessionValid(completed!.sessionToken, otherInstallationId)).toBe(false);
    expect(await getSubdeviceSession(completed!.sessionToken, installationId)).toMatchObject({
      accountId: "main",
    });
    expect(await getSubdeviceSession(completed!.sessionToken, otherInstallationId)).toBeNull();
  });
});
