import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
let readRecentMessageLog: typeof import("./messageLog.js")["readRecentMessageLog"];
let replayMissingLogs: typeof import("./messageLog.js")["replayMissingLogs"];
let appendMessageLog: typeof import("./messageLog.js")["appendMessageLog"];
let closeSqlite: typeof import("./sqlite.js")["closeSqlite"];

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-message-log-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  const logDir = join(dataDir, "logs");
  await mkdir(logDir, { recursive: true });
  await writeFile(join(logDir, "message-log-offline.jsonl"), Array.from({ length: 20 }, (_, i) => JSON.stringify({
    ts: new Date(i).toISOString(), tsMillis: i, accountId: "offline", kind: "message",
    direction: "in", chatMid: "c", senderMid: "u", contentType: "TEXT", messageId: `m${i}`,
  })).join("\n") + "\n");
  ({ readRecentMessageLog, replayMissingLogs, appendMessageLog } = await import("./messageLog.js"));
  ({ closeSqlite } = await import("./sqlite.js"));
});

afterAll(async () => {
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("recent log reads the indexed tail and replays message IDs", async () => {
  const recent = await readRecentMessageLog("offline", 3);
  expect(recent.map((entry) => entry.tsMillis)).toEqual([17, 18, 19]);
  const known = new Set(["m19"]);
  expect(await replayMissingLogs("offline", known)).toBe(19);
  expect(known.has("m0")).toBe(true);
});

test("imports legacy JSONL once and stores new logs as indexed SQLite columns", async () => {
  appendMessageLog({
    ts: new Date(20).toISOString(), tsMillis: 20, accountId: "offline", kind: "message",
    direction: "in", chatMid: "c", chatName: "Chat", senderMid: "u", senderName: "User",
    contentType: "TEXT", text: "new", messageId: "m20",
    media: { contentType: "IMAGE", mediaId: "asset-1", fileSize: 42 },
  });
  const recent = await readRecentMessageLog("offline", 2);
  expect(recent.map((entry) => entry.messageId)).toEqual(["m19", "m20"]);
  expect(recent[1]?.media).toEqual({ contentType: "IMAGE", mediaId: "asset-1", fileSize: 42 });
  const { sqlite } = await import("./sqlite.js");
  const columns = sqlite.query("PRAGMA table_info(message_logs)").all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toContain("message_id");
  expect(columns.map((column) => column.name)).not.toContain("payload");
  expect(sqlite.query("SELECT message_id, text FROM message_logs WHERE account_id=? ORDER BY id DESC LIMIT 1")
    .get("offline")).toEqual({ message_id: "m20", text: "new" });
  await readRecentMessageLog("offline", 2);
  expect(sqlite.query("SELECT COUNT(*) AS count FROM message_logs WHERE account_id=?").get("offline"))
    .toEqual({ count: 21 });
  const known = new Set(["m19"]);
  expect(await replayMissingLogs("offline", known)).toBe(20);
  expect(known.has("m20")).toBe(true);
  expect((await Bun.file(join(dataDir, "logs", "message-log-offline.jsonl")).exists())).toBe(true);
});

test("retains only the newest entries inside the configured byte budget", async () => {
  process.env.VYLINE_MESSAGE_LOG_RETENTION_BYTES = "1100";
  const base = {
    ts: new Date(30).toISOString(), tsMillis: 30, accountId: "offline-retention", kind: "message" as const,
    direction: "in" as const, chatMid: "c", senderMid: "u", contentType: "TEXT", messageId: "",
  };
  for (let index = 0; index < 4; index++) {
    await appendMessageLog({ ...base, tsMillis: 30 + index, messageId: `r${index}`, text: "x".repeat(700) });
  }
  expect((await readRecentMessageLog("offline-retention", 10)).map((entry) => entry.messageId)).toEqual(["r3"]);
  const { sqlite } = await import("./sqlite.js");
  const state = sqlite.query("SELECT total_bytes FROM message_log_state WHERE account_id=?")
    .get("offline-retention") as { total_bytes: number };
  expect(state.total_bytes).toBeLessThanOrEqual(1100);

  process.env.VYLINE_MESSAGE_LOG_RETENTION_BYTES = "1000000";
  const overflowBase = { ...base, accountId: "offline-retention-overflow" };
  await Promise.all(Array.from({ length: 520 }, (_, index) => appendMessageLog({
    ...overflowBase, tsMillis: 1000 + index, messageId: `old-${index}`, text: "small",
  })));
  process.env.VYLINE_MESSAGE_LOG_RETENTION_BYTES = "1100";
  await appendMessageLog({ ...overflowBase, tsMillis: 2000, messageId: "oversized", text: "y".repeat(10_000) });
  expect(await readRecentMessageLog("offline-retention-overflow", 10)).toEqual([]);
  expect((sqlite.query("SELECT total_bytes FROM message_log_state WHERE account_id=?")
    .get("offline-retention-overflow") as { total_bytes: number }).total_bytes).toBe(0);
  delete process.env.VYLINE_MESSAGE_LOG_RETENTION_BYTES;
});
