import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "vyline-roster-"));
process.env.VYLINE_DATA_DIR = dataDir;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("No network in roster regressions");
}) as unknown as typeof fetch;
const mid = `c${"1".repeat(32)}`;
let joinedMids: string[] = [];
let rosterFails = false;
let boxesFail = false;
let emptyBoxes = false;
const client = {
  fetchJoinedChats: async () => {
    if (rosterFails) throw new Error("temporary roster outage");
    return joinedMids.map((chatMid) => ({ mid: chatMid, name: "Joined" }));
  },
  fetchUsers: async () => [],
  base: {
    auth: { tryRefreshToken: async () => {} },
    profile: { mid: `u${"0".repeat(32)}` },
    talk: {
      getAllChatMids: async () => {
        if (rosterFails) throw new Error("temporary roster outage");
        return { memberChatMids: joinedMids };
      },
      getChats: async () => ({ chats: [] }), // A missing profile is not evidence of exit.
      getMessageBoxes: async () => {
        if (boxesFail) throw new Error("temporary message box outage");
        return { messageBoxes: emptyBoxes ? [] : [{ id: mid }], hasNext: false };
      },
    },
  },
};
const manager = await import("../line/clientManager.js");
mock.module("../line/clientManager.js", () => ({ ...manager, getClient: () => client }));
const { fetchChats, fetchBootstrap } = await import("./lineService.js");
const { upsertChats } = await import("../storage/chatStore.js");
const row = {
  mid,
  name: "Stored group",
  kind: "group" as const,
  hasMessages: true,
  updatedAt: new Date().toISOString(),
};

afterAll(async () => {
  globalThis.fetch = originalFetch;
  mock.restore();
  const { closeSqlite } = await import("../storage/sqlite.js");
  closeSqlite();
  rmSync(dataDir, { recursive: true, force: true });
});

test("joined MID remains active when group details are missing", async () => {
  joinedMids = [mid];
  const chats = await fetchChats("offline-joined", { force: true, light: true });
  expect(chats.find((c) => c.mid === mid)?.left).not.toBe(true);
});

test("a roster RPC failure preserves stored membership instead of marking all groups left", async () => {
  await upsertChats("offline-roster-failure", [row]);
  rosterFails = true;
  try {
    const chats = await fetchChats("offline-roster-failure", { force: true, light: true });
    expect(chats.find((c) => c.mid === mid)?.left).not.toBe(true);
    expect(chats.find((c) => c.mid === mid)?.name).toBe(row.name);
  } finally {
    rosterFails = false;
  }
});

test("exited membership survives history upserts and bootstrap, and rejoining clears it", async () => {
  const account = "offline-exited";
  await upsertChats(account, [row]);
  joinedMids = [];
  expect(
    (await fetchChats(account, { force: true, light: true })).find((c) => c.mid === mid)?.left,
  ).toBe(true);
  await upsertChats(account, [row]);
  expect((await fetchBootstrap(account)).chats.find((c) => c.mid === mid)?.left).toBe(true);
  joinedMids = [mid];
  expect(
    (await fetchChats(account, { force: true, light: true })).find((c) => c.mid === mid)?.left,
  ).toBe(false);
  expect((await fetchBootstrap(account)).chats.find((c) => c.mid === mid)?.left).not.toBe(true);
});

test("an empty sync preserves the previous roster and its membership", async () => {
  const account = "offline-empty";
  await upsertChats(account, [row]);
  joinedMids = [];
  emptyBoxes = true;
  try {
    const chats = await fetchChats(account, { force: true, light: true });
    expect(chats.find((c) => c.mid === mid)?.name).toBe(row.name);
    expect(chats.find((c) => c.mid === mid)?.left).not.toBe(true);
  } finally {
    emptyBoxes = false;
  }
});

test("a failed box prefix preserves the complete stored roster", async () => {
  const account = "offline-box-failure";
  await upsertChats(account, [row]);
  boxesFail = true;
  try {
    const chats = await fetchChats(account, { force: true, light: true });
    expect(chats.find((c) => c.mid === mid)?.name).toBe(row.name);
    expect(chats.find((c) => c.mid === mid)?.left).not.toBe(true);
  } finally {
    boxesFail = false;
  }
});
