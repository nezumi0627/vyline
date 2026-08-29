import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  androidContentType,
  parseAndroidDatabase,
  parseAndroidParameter,
} from "./androidBackupService.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Android LINE backup import", () => {
  test("parses tab-separated LINE contentMetadata without dropping Android-only fields", () => {
    expect(
      parseAndroidParameter(
        'STKPKGID\t123\tSTKID\t456\tmessage_relation_type_code\treply\tmessage_relation_server_message_id\t999',
      ),
    ).toEqual({
      STKPKGID: "123",
      STKID: "456",
      message_relation_type_code: "reply",
      message_relation_server_message_id: "999",
    });
  });

  test("maps Android attachment and unsent types to Vyline content types", () => {
    expect(androidContentType(1, 0)).toBe("NONE");
    expect(androidContentType(1, 1)).toBe("IMAGE");
    expect(androidContentType(5, 7)).toBe("STICKER");
    expect(androidContentType(13, 18)).toBe("CHATEVENT");
    expect(androidContentType(27, 0)).toBe("UNSENT");
  });

  test("parses a naver_line SQLite DB and preserves 64-bit reaction message IDs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vyline-android-test-"));
    tempDirs.push(dir);
    const path = join(dir, "naver_line");
    const db = new Database(path, { create: true, safeIntegers: true, strict: true });
    try {
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
          parameter TEXT
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
      db.query(
        "INSERT INTO chat VALUES (?, ?, ?, ?, ?)",
      ).run("c-group", "Test group", 2, 2, 3);
      db.query(
        "INSERT INTO chat_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        10,
        "581758080913244212",
        1,
        "c-group",
        null,
        "mine",
        "1787977000000",
        1,
        0,
        "",
      );
      db.query(
        "INSERT INTO chat_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        11,
        "581758080913244213",
        1,
        "c-group",
        "u-peer",
        null,
        "1787977001000",
        0,
        1,
        "message_relation_type_code\treply\tmessage_relation_server_message_id\t581758080913244212",
      );
      db.query(
        "INSERT INTO chat_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        12,
        "581758080913244213",
        1,
        "c-group",
        "u-peer",
        "取り消しされたメッセージです",
        "1787977001000",
        0,
        0,
        "LEINsUnsend",
      );
      db.query(
        "INSERT INTO reactions VALUES (?, ?, ?, ?, ?, ?)",
      ).run(581758080913244213n, "u-reactor", "c-group", 1787977002000, "love", "");
      db.query(
        "INSERT INTO reactions VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        581758080913244213n,
        "u-paid-reactor",
        "c-group",
        1787977003000,
        "",
        '{"paidReactionType":{"productId":"test","emojiId":"001"}}',
      );
    } finally {
      db.close();
    }

    const parsed = parseAndroidDatabase(path, "u-me");
    expect(parsed.databaseVersion).toBe(164);
    expect(parsed.records.chats["c-group"]).toMatchObject({
      name: "Test group",
      kind: "group",
      hasMessages: true,
      restoredHistory: true,
    });
    expect(parsed.records.messages["c-group"]?.["581758080913244212"]).toMatchObject({
      from: "u-me",
      to: "c-group",
      text: "mine",
      contentType: "NONE",
      isMyMessage: true,
    });
    expect(parsed.records.messages["c-group"]?.["581758080913244213"]).toMatchObject({
      from: "u-peer",
      to: "u-me",
      text: null,
      contentType: "UNSENT",
      messageState: "revoked-by-other",
      relatedMessageId: "581758080913244212",
      revokedSnapshot: {
        contentType: "IMAGE",
        relatedMessageId: "581758080913244212",
      },
      reactions: [{ fromMid: "u-reactor", type: 3, atMillis: 1787977002000 }],
    });
    expect(parsed.mediaRefs).toEqual([
      {
        chatMid: "c-group",
        localId: "11",
        messageId: "581758080913244213",
        contentType: "IMAGE",
      },
    ]);
    const customReactions = JSON.parse(
      parsed.records.messages["c-group"]?.["581758080913244213"]?.contentMetadata
        ?.ANDROID_CUSTOM_REACTIONS ?? "[]",
    ) as Array<{ fromMid: string; customReaction: string }>;
    expect(customReactions).toEqual([
      expect.objectContaining({
        fromMid: "u-paid-reactor",
        customReaction: '{"paidReactionType":{"productId":"test","emojiId":"001"}}',
      }),
    ]);
    expect(parsed.reactions).toBe(1);
    expect(parsed.unsupportedReactions).toBe(1);
  });
});
