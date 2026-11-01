import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";

describe("account directory ownership", () => {
  test("does not collapse case-variant account IDs onto one directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vyline-account-dirs-"));
    process.env.VYLINE_DATA_DIR = dataDir;
    const storage = await import(`./accountDirs.js?test=${randomUUID()}`);

    expect(storage.accountDir("uABC123")).not.toBe(storage.accountDir("uabc123"));

    await rm(dataDir, { recursive: true, force: true });
  });

  test("migrates a legacy account file only after registry serialization", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vyline-account-migrate-"));
    process.env.VYLINE_DATA_DIR = dataDir;
    const storage = await import(`./accountDirs.js?test=${randomUUID()}`);
    const accountId = "uABC456";
    const legacyPath = join(dataDir, `legacy-${accountId}.json`);
    await writeFile(legacyPath, JSON.stringify({ ok: true }), "utf8");

    await expect(storage.readAccountJson(accountId, "state.json", legacyPath)).resolves.toEqual({
      ok: true,
    });
    await rm(dataDir, { recursive: true, force: true });
  });
});
