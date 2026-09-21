import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "vyline-chat-locks-"));
process.env.VYLINE_DATA_DIR = dataDir;
const locks = await import("./chatLockStore.js");

test("releases an account write chain without deleting lock data", async () => {
  try {
    await locks.setChatLocked("account-a", "chat-a", true);
    await locks.releaseAccountChatLocks("account-a");
    expect(await locks.isChatLocked("account-a", "chat-a")).toBe(true);
    await locks.releaseAccountChatLocks("account-a");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
