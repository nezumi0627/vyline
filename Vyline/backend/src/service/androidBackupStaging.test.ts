import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { stageAndroidDatabase } from "./androidBackupService.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function testDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

function createSource(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    PRAGMA user_version = 164;
    CREATE TABLE chat (
      chat_id TEXT PRIMARY KEY,
      chat_name TEXT,
      message_count INTEGER,
      read_message_count INTEGER,
      type INTEGER
    );
    CREATE TABLE chat_history (
      id INTEGER PRIMARY KEY,
      server_id TEXT,
      type INTEGER,
      chat_id TEXT,
      from_mid TEXT,
      content TEXT,
      created_time TEXT,
      read_count INTEGER,
      attachement_type INTEGER,
      parameter TEXT,
      delivered_time TEXT,
      attachement_local_uri TEXT,
      location_name TEXT,
      chunks BLOB
    );
    CREATE TABLE reactions (
      server_message_id INTEGER,
      member_id TEXT,
      chat_id TEXT,
      reaction_time_millis INTEGER,
      reaction_type TEXT,
      custom_reaction TEXT
    );
  `);
  return db;
}

describe("Android backup normalized staging", () => {
  test("writes normalized rows while preserving duplicate unsend, reactions, and media refs", async () => {
    const dir = await testDir("vyline-android-staging-");
    const sourcePath = join(dir, "naver_line");
    const stagingPath = join(dir, "staging.sqlite");
    const db = createSource(sourcePath);
    try {
      db.query("INSERT INTO chat VALUES (?, ?, ?, ?, ?)").run("c-group", "Test group", 2, 2, 3);
      const insert = db.query(`
        INSERT INTO chat_history (
          id, server_id, type, chat_id, from_mid, content,
          created_time, read_count, attachement_type, parameter
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        10,
        "581758080913244213",
        1,
        "c-group",
        "u-peer",
        "before unsend",
        "1787977001000",
        0,
        1,
        "message_relation_type_code\treply\tmessage_relation_server_message_id\t100",
      );
      insert.run(
        11,
        "581758080913244213",
        1,
        "c-group",
        "u-peer",
        "取り消しされたメッセージです",
        "1787977001001",
        0,
        0,
        "LEINsUnsend",
      );
      db.query("INSERT INTO reactions VALUES (?, ?, ?, ?, ?, ?)").run(
        581758080913244213n,
        "u-reactor",
        "c-group",
        1787977002000,
        "love",
        "",
      );
      db.query("INSERT INTO reactions VALUES (?, ?, ?, ?, ?, ?)").run(
        581758080913244213n,
        "u-paid",
        "c-group",
        1787977003000,
        "",
        '{"paidReactionType":{"emojiId":"001"}}',
      );
    } finally {
      db.close();
    }

    const phases: string[] = [];
    const summary = await stageAndroidDatabase(sourcePath, stagingPath, "u-self", (progress) => {
      phases.push(progress.phase);
    });
    expect(summary).toMatchObject({
      databaseVersion: 164,
      chats: 1,
      totalMessages: 1,
      mediaRefs: 1,
      reactions: 1,
      unsupportedReactions: 1,
    });
    expect(new Set(phases)).toEqual(new Set(["metadata", "reactions", "messages", "chats"]));

    const staged = new Database(stagingPath, { readonly: true, strict: true });
    try {
      const columns = (
        staged.query("PRAGMA table_info(staged_messages)").all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(columns).not.toContain("data");
      expect(columns).toContain("content_metadata");
      const message = staged
        .query(`
          SELECT text, content_type, message_state, reactions,
            content_metadata, revoked_snapshot
          FROM staged_messages
          WHERE chat_mid = ? AND id = ?
        `)
        .get("c-group", "581758080913244213") as {
        text: string | null;
        content_type: string;
        message_state: string;
        reactions: string;
        content_metadata: string;
        revoked_snapshot: string;
      };
      expect(message).toMatchObject({
        text: null,
        content_type: "UNSENT",
        message_state: "revoked-by-other",
      });
      expect(JSON.parse(message.reactions)).toEqual([
        { fromMid: "u-reactor", atMillis: 1787977002000, type: 3 },
      ]);
      expect(JSON.parse(message.content_metadata).ANDROID_CUSTOM_REACTIONS).toContain("u-paid");
      expect(JSON.parse(message.revoked_snapshot)).toMatchObject({
        text: "before unsend",
        contentType: "IMAGE",
      });
      expect(staged.query("SELECT count(*) AS count FROM staged_media_refs").get()).toEqual({
        count: 1,
      });
    } finally {
      staged.close();
    }
  });

  test("stages a large history with bounded RSS and event-loop progress", async () => {
    const requestedTotal = Number(process.env.VYLINE_ANDROID_STAGING_TEST_MESSAGES ?? 200_000);
    const total = Number.isSafeInteger(requestedTotal)
      ? Math.min(1_000_000, Math.max(1_000, requestedTotal))
      : 200_000;
    const dir = await testDir(`vyline-android-staging-${total}-`);
    const sourcePath = join(dir, "naver_line");
    const stagingPath = join(dir, "staging.sqlite");
    const db = createSource(sourcePath);
    try {
      db.query("INSERT INTO chat VALUES (?, ?, ?, ?, ?)").run(
        "c-large",
        "Large import",
        total,
        total,
        3,
      );
      const insert = db.query(`
        INSERT INTO chat_history (
          id, server_id, type, chat_id, from_mid, content,
          created_time, read_count, attachement_type, parameter
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const payload = "x".repeat(512);
      db.exec("BEGIN");
      for (let index = 1; index <= total; index++) {
        insert.run(
          index,
          String(600_000_000_000_000_000n + BigInt(index)),
          1,
          "c-large",
          "u-peer",
          payload,
          String(1_787_977_000_000 + index),
          0,
          0,
          "",
        );
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }

    Bun.gc(true);
    const rssBefore = process.memoryUsage().rss;
    let peakRss = rssBefore;
    let heartbeats = 0;
    let messageProgressUpdates = 0;
    const heartbeat = setInterval(() => {
      heartbeats++;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 10);
    let summary;
    try {
      summary = await stageAndroidDatabase(sourcePath, stagingPath, "u-self", (progress) => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        if (progress.phase === "messages" && progress.current > 0) messageProgressUpdates++;
      });
    } finally {
      clearInterval(heartbeat);
    }
    const rssGrowth = Math.max(0, peakRss - rssBefore);
    console.info("[android-staging-large]", {
      total,
      rssGrowth,
      heartbeats,
      messageProgressUpdates,
    });

    expect(summary.totalMessages).toBe(total);
    expect(messageProgressUpdates).toBeGreaterThanOrEqual(total / 500);
    expect(heartbeats).toBeGreaterThan(5);
    expect(rssGrowth).toBeLessThan(96 * 1024 * 1024);

    const staged = new Database(stagingPath, { readonly: true, strict: true });
    try {
      expect(staged.query("SELECT count(*) AS count FROM staged_messages").get()).toEqual({
        count: total,
      });
    } finally {
      staged.close();
    }
  }, 600_000);

  test("does not hydrate 64 MiB of unused chat_history blobs", async () => {
    const dir = await testDir("vyline-android-staging-unused-blob-");
    const sourcePath = join(dir, "naver_line");
    const stagingPath = join(dir, "staging.sqlite");
    const db = createSource(sourcePath);
    const total = 1_000;
    try {
      db.query("INSERT INTO chat VALUES (?, ?, ?, ?, ?)").run(
        "c-blob",
        "Projection",
        total,
        total,
        3,
      );
      const insert = db.query(`
        INSERT INTO chat_history (
          id, server_id, type, chat_id, from_mid, content,
          created_time, read_count, attachement_type, parameter, chunks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const unusedBlob = Buffer.alloc(64 * 1024, 0x61);
      db.exec("BEGIN");
      for (let index = 1; index <= total; index++) {
        insert.run(
          index,
          String(800_000_000_000_000_000n + BigInt(index)),
          1,
          "c-blob",
          "u-peer",
          "small",
          String(1_787_977_000_000 + index),
          0,
          0,
          "",
          unusedBlob,
        );
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }

    Bun.gc(true);
    const rssBefore = process.memoryUsage().rss;
    let peakRss = rssBefore;
    const summary = await stageAndroidDatabase(sourcePath, stagingPath, "u-self", () => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    });
    const rssGrowth = Math.max(0, peakRss - rssBefore);
    console.info("[android-staging-unused-blob-64m]", { rssGrowth });
    expect(summary.totalMessages).toBe(total);
    expect(rssGrowth).toBeLessThan(48 * 1024 * 1024);
  }, 30_000);
});
