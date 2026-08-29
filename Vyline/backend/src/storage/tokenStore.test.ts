import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = await mkdtemp(join(tmpdir(), "vyline-token-store-"));
process.env.VYLINE_DATA_DIR = dataDir;
const tokenStore = await import(`./tokenStore.ts?test=${crypto.randomUUID()}`);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("tokenStore account isolation and handoff", () => {
  test("stores credentials per account and migrates legacy entries", async () => {
    await tokenStore.saveToken("account-a", "auth-a", { displayName: "A" });
    await tokenStore.saveToken("account-b", "auth-b", { displayName: "B" });

    const aRaw = await readFile(join(dataDir, "accounts", "account-a", "credentials.json"), "utf8");
    const bRaw = await readFile(join(dataDir, "accounts", "account-b", "credentials.json"), "utf8");
    if (process.platform === "win32") {
      expect(aRaw).not.toContain("auth-a");
      expect(bRaw).not.toContain("auth-b");
    }
    expect((await tokenStore.getToken("account-a"))?.authToken).toBe("auth-a");
    expect((await tokenStore.getToken("account-b"))?.authToken).toBe("auth-b");

    await writeFile(
      join(dataDir, "tokens.json"),
      JSON.stringify({
        legacy: { authToken: "legacy-token", storageFile: "", savedAt: "2026-08-29T00:00:00.000Z" },
      }),
      "utf8",
    );
    expect((await tokenStore.getToken("legacy"))?.authToken).toBe("legacy-token");
    expect(
      await readFile(join(dataDir, "accounts", "legacy", "credentials.json"), "utf8"),
    ).toContain("legacy-token");
  });

  test("encrypted handoff round-trips without exposing raw credentials", async () => {
    await tokenStore.saveToken("source", "primary-secret", { deviceMode: "IOSIPAD" });
    const protocolPath = tokenStore.storagePathForAccount("source");
    await mkdir(join(dataDir, "accounts", "source"), { recursive: true });
    await writeFile(
      protocolPath,
      JSON.stringify({
        refreshToken: "refresh-secret",
        "channelToken:1": { channelAccessToken: "channel-secret" },
      }),
      "utf8",
    );

    const bundle = await tokenStore.exportCredentialHandoff("source", "passphrase-123");
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("primary-secret");
    expect(serialized).not.toContain("refresh-secret");
    expect(serialized).not.toContain("channel-secret");
    await expect(
      tokenStore.importCredentialHandoff(bundle, "wrong-passphrase", "wrong"),
    ).rejects.toThrow();

    await tokenStore.importCredentialHandoff(bundle, "passphrase-123", "restored");
    const restored = await tokenStore.getToken("restored");
    expect(restored?.authToken).toBe("primary-secret");
    expect(restored?.deviceMode).toBe("IOSIPAD");
    const restoredProtocol = await readFile(tokenStore.storagePathForAccount("restored"), "utf8");
    expect(restoredProtocol).toContain("refresh-secret");
    expect(restoredProtocol).toContain("channel-secret");
  }, 20_000);
});
