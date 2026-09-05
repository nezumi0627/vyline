import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = await mkdtemp(join(tmpdir(), "vyline-token-store-"));
if (process.platform !== "win32") await chmod(dataDir, 0o777);
process.env.VYLINE_DATA_DIR = dataDir;
const tokenStore = await import(`./tokenStore.ts?test=${crypto.randomUUID()}`);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("tokenStore account isolation and handoff", () => {
  const permissions = (mode: number) => mode & 0o777;

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
    if (process.platform !== "win32") {
      expect(permissions((await stat(dataDir)).mode)).toBe(0o700);
      expect(permissions((await stat(join(dataDir, "accounts"))).mode)).toBe(0o700);
      expect(permissions((await stat(join(dataDir, "accounts", "account-a"))).mode)).toBe(0o700);
      expect(
        permissions((await stat(join(dataDir, "accounts", "account-a", "credentials.json"))).mode),
      ).toBe(0o600);
    }

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
    if (process.platform !== "win32") {
      expect(permissions((await stat(join(dataDir, "tokens.json"))).mode)).toBe(0o600);
      expect(permissions((await stat(join(dataDir, "accounts", "legacy"))).mode)).toBe(0o700);
      expect(
        permissions((await stat(join(dataDir, "accounts", "legacy", "credentials.json"))).mode),
      ).toBe(0o600);
    }
  }, 20_000);

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
    if (process.platform !== "win32") {
      await chmod(join(dataDir, "accounts", "source"), 0o777);
      await chmod(protocolPath, 0o644);
    }

    const bundle = await tokenStore.exportCredentialHandoff("source", "passphrase-123");
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("primary-secret");
    expect(serialized).not.toContain("refresh-secret");
    expect(serialized).not.toContain("channel-secret");
    if (process.platform !== "win32") {
      expect(permissions((await stat(join(dataDir, "accounts", "source"))).mode)).toBe(0o700);
      expect(permissions((await stat(protocolPath)).mode)).toBe(0o600);
    }
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
    if (process.platform !== "win32") {
      const restoredDir = join(dataDir, "accounts", "restored");
      expect(permissions((await stat(restoredDir)).mode)).toBe(0o700);
      expect(permissions((await stat(join(restoredDir, "credentials.json"))).mode)).toBe(0o600);
      expect(permissions((await stat(tokenStore.storagePathForAccount("restored"))).mode)).toBe(
        0o600,
      );
    }
  }, 20_000);
});
