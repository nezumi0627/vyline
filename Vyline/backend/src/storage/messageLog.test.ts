import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "vyline-message-log-"));
process.env.VYLINE_DATA_DIR = dataDir;
process.env.VYLINE_LOG_DIR = join(dataDir, "logs");
const logs = await import("./messageLog.js");

test("flushes and releases an account message log stream", async () => {
  try {
    logs.appendMessageLog({
      ts: new Date().toISOString(),
      tsMillis: Date.now(),
      accountId: "account-a",
      kind: "message",
      direction: "in",
      chatMid: "chat-a",
      senderMid: "user-a",
      contentType: "text",
      text: "hello",
    });
    await Bun.sleep(25);
    await expect(logs.releaseAccountMessageLog("account-a")).resolves.toBeUndefined();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
