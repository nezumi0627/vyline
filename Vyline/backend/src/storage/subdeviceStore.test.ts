import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

if (process.env.VYLINE_SUBDEVICE_STORE_TEST_CHILD !== "1") {
  test("subdevice store integration runs in an isolated process", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-subdevice-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_SUBDEVICE_STORE_TEST_CHILD: "1",
          VYLINE_SUBDEVICE_STORE_TEST_ROOT: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(code).toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("0 fail");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
} else {
  const dataDir = process.env.VYLINE_SUBDEVICE_STORE_TEST_ROOT!;
  process.env.VYLINE_DATA_DIR = dataDir;
  const store = await import("./subdeviceStore.js");

  describe("subdevice pairing", () => {
    test("consumes a pairing token and blocks the resulting session", async () => {
      const installationId = crypto.randomUUID();
      const pairing = await store.createPairing("account-1");
      expect(await store.getPairing(pairing.token)).not.toBeNull();

      const completed = await store.completePairing(pairing.token, "iPhone", "ios", installationId);
      expect(completed?.device.accountId).toBe("account-1");
      expect(await store.getPairing(pairing.token)).toBeNull();
      expect(await store.isSubdeviceSessionValid(completed!.sessionToken, installationId)).toBe(
        true,
      );

      await store.setSubdeviceBlocked(completed!.device.id, true);
      expect(await store.isSubdeviceSessionValid(completed!.sessionToken, installationId)).toBe(
        false,
      );
    });

    test("consumes a persisted pairing token only once under concurrent completion", async () => {
      const coldDataDir = await mkdtemp(join(tmpdir(), "vyline-subdevice-cold-"));
      const previousDataDir = process.env.VYLINE_DATA_DIR;
      const rawToken = "vyp_concurrent-test-token";
      await writeFile(
        join(coldDataDir, "subdevices.json"),
        JSON.stringify({
          devices: [],
          pairings: [
            {
              id: "pairing-1",
              tokenHash: createHash("sha256").update(rawToken).digest("hex"),
              expiresAt: Date.now() + 60_000,
              accountId: "account-1",
            },
          ],
        }),
      );
      process.env.VYLINE_DATA_DIR = coldDataDir;

      try {
        const coldStore = await import(`./subdeviceStore.ts?cold=${crypto.randomUUID()}`);
        const completed = await Promise.all([
          coldStore.completePairing(rawToken, "first", "web", crypto.randomUUID()),
          coldStore.completePairing(rawToken, "second", "web", crypto.randomUUID()),
        ]);

        expect(completed.filter(Boolean)).toHaveLength(1);
        expect(await coldStore.getPairing(rawToken)).toBeNull();
      } finally {
        if (previousDataDir == null) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
        else process.env.VYLINE_DATA_DIR = previousDataDir;
        await rm(coldDataDir, { recursive: true, force: true });
      }
    });

    test("does not consume a pairing in memory when atomic persistence fails", async () => {
      const pairing = await store.createPairing("account-write-failure");
      const installationId = crypto.randomUUID();
      const file = join(dataDir, "subdevices.json");
      await rm(file, { force: true });
      await mkdir(file);

      try {
        await expect(
          store.completePairing(pairing.token, "Browser", "web", installationId),
        ).rejects.toThrow();
        expect(await store.getPairing(pairing.token)).not.toBeNull();
      } finally {
        await rm(file, { recursive: true, force: true });
      }

      const completed = await store.completePairing(
        pairing.token,
        "Browser",
        "web",
        installationId,
      );
      expect(completed).not.toBeNull();
    });

    test("does not revoke a session in memory when atomic persistence fails", async () => {
      const installationId = crypto.randomUUID();
      const pairing = await store.createPairing("account-session-write-failure");
      const completed = await store.completePairing(
        pairing.token,
        "Browser",
        "web",
        installationId,
      );
      const file = join(dataDir, "subdevices.json");
      await rm(file, { force: true });
      await mkdir(file);

      try {
        await expect(store.setSubdeviceBlocked(completed!.device.id, true)).rejects.toThrow();
        expect(await store.isSubdeviceSessionValid(completed!.sessionToken, installationId)).toBe(
          true,
        );
      } finally {
        await rm(file, { recursive: true, force: true });
      }
    });
  });
}
