import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VYLINE_FEATURE_LOCKS_TEST_CHILD !== "1") {
  test("feature safety locks in an isolated process", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vyline-feature-locks-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_FEATURE_LOCKS_TEST_CHILD: "1",
          VYLINE_DATA_DIR: dataDir,
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
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
} else {
  const dataDir = process.env.VYLINE_DATA_DIR!;
  const locks = await import("./featureLocks.js");

  test("preserves concurrent ABUSE_BLOCK bans for different accounts", async () => {
    await Promise.all([
      locks.banCreateGroup("account-a", "ABUSE_BLOCK A"),
      locks.banCreateGroup("account-b", "ABUSE_BLOCK B"),
    ]);

    expect((await locks.getFeatureLocks("account-a")).createGroupBanned).toBe(true);
    expect((await locks.getFeatureLocks("account-b")).createGroupBanned).toBe(true);
  });

  test("fails closed before createChat when the safety-lock file is corrupt", async () => {
    await writeFile(join(dataDir, "feature-locks.json"), "{broken", "utf8");
    const clientManager = await import("../line/clientManager.js");
    let createChatCalls = 0;
    const getClient = spyOn(clientManager, "getClient").mockReturnValue({
      base: {
        getReqseq: async () => 1,
        talk: {
          createChat: async () => {
            createChatCalls++;
            return { chat: { chatMid: "c-created" } };
          },
        },
      },
    } as never);

    try {
      const { createGroupChat } = await import("../service/lineService.js");
      await expect(
        createGroupChat("account-a", "unsafe", ["u11111111111111111111111111111111"]),
      ).rejects.toThrow();
      expect(createChatCalls).toBe(0);
    } finally {
      getClient.mockRestore();
    }
  });

  test("fails closed on non-ENOENT storage errors", async () => {
    const path = join(dataDir, "feature-locks.json");
    await rm(path, { force: true });
    await mkdir(path);

    await expect(locks.isCreateGroupBanned("account-a")).rejects.toThrow();
  });
}
