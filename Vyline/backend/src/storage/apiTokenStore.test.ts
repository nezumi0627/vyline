import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "vyline-api-token-store-"));
process.env.VYLINE_DATA_DIR = dataDir;
const apiTokenStore = await import(`./apiTokenStore.ts?test=${crypto.randomUUID()}`);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("apiTokenStore account scoping", () => {
  test("normalizes account allowlists and never persists plaintext tokens", async () => {
    const created = await apiTokenStore.createToken(
      "scoped-client",
      [" account-a ", "account-a", "account-b"],
      ["read"],
    );

    expect(created.accountIds).toEqual(["account-a", "account-b"]);
    expect(apiTokenStore.tokenAllowsAccount(created, "account-a")).toBe(true);
    expect(apiTokenStore.tokenAllowsAccount(created, "account-c")).toBe(false);

    const raw = await readFile(join(dataDir, "api-tokens.json"), "utf8");
    expect(raw).not.toContain(created.token ?? "");
    expect(JSON.parse(raw)[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("migrates legacy plaintext tokens without granting account access", async () => {
    const legacyToken = "vyl_legacy-plaintext-token";
    await writeFile(
      join(dataDir, "api-tokens.json"),
      JSON.stringify([
        {
          token: legacyToken,
          name: "legacy-client",
          scopes: ["read", "write"],
          createdAt: "2026-08-31T00:00:00.000Z",
        },
      ]),
      "utf8",
    );

    const freshStore = await import(`./apiTokenStore.ts?legacy=${crypto.randomUUID()}`);
    const [legacy] = await freshStore.listTokens();

    expect(legacy?.accountIds).toEqual([]);
    expect(freshStore.tokenAllowsAccount(legacy!, "account-a")).toBe(false);
    expect((await freshStore.validateToken(legacyToken))?.accountIds).toEqual([]);

    const migrated = await readFile(join(dataDir, "api-tokens.json"), "utf8");
    expect(migrated).not.toContain(legacyToken);
    expect(JSON.parse(migrated)[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("keeps persisted token metadata parseable during usage updates", async () => {
    const created = await apiTokenStore.createToken("concurrent-client", ["account-a"], ["read"]);
    const rawToken = created.token!;

    await Promise.all(Array.from({ length: 32 }, () => apiTokenStore.validateToken(rawToken)));

    for (let i = 0; i < 32; i += 1) {
      const raw = await readFile(join(dataDir, "api-tokens.json"), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });
});
