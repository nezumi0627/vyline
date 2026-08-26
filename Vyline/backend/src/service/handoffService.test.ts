import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("handoff archive", () => {
  test("exports a verifiable zip and rejects tampering", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vyline-handoff-"));
    process.env.VYLINE_DATA_DIR = dataDir;
    const { exportHandoff, importHandoff } = await import("./handoffService.js");
    const mid = "u1234567890abcdef1234567890abcdef";
    const exported = await exportHandoff(mid, "web");
    expect(exported.filename).toMatch(/^[0-9a-f-]+\.zip$/);
    expect(exported.manifest.account.midHash).toHaveLength(16);
    await expect(importHandoff(mid, exported.archiveBase64, "overwrite")).resolves.toMatchObject({
      imported: ["settings.json"],
    });
    const tampered = Buffer.from(exported.archiveBase64, "base64");
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 1;
    await expect(importHandoff(mid, tampered.toString("base64"), "overwrite")).rejects.toThrow();
    await rm(dataDir, { recursive: true, force: true });
  });
});
