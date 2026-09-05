import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBplist } from "./bplist.js";
import { findLineDatabases, iosTimestampToIso, parseLineDatabases } from "./parse.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function testDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function plistAscii(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length < 15) return concat([new Uint8Array([0x50 | bytes.length]), bytes]);
  return concat([new Uint8Array([0x5f, 0x10, bytes.length]), bytes]);
}

function plistInteger(value: number): Uint8Array {
  return new Uint8Array([
    0x12,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function writeUInt64(target: Uint8Array, offset: number, value: number): void {
  let remaining = BigInt(value);
  for (let index = 7; index >= 0; index--) {
    target[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function mediaMetadataFixture(): Uint8Array {
  const objects = [
    new Uint8Array([0xd3, 1, 2, 3, 4, 5, 6]),
    plistAscii("OID"),
    plistAscii("WIDTH"),
    plistAscii("TYPE"),
    plistAscii("abcdefgh12345678"),
    plistInteger(1080),
    plistInteger(1),
  ];
  const header = new TextEncoder().encode("bplist00");
  const body = concat(objects);
  const offsets: number[] = [];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  const trailer = new Uint8Array(32);
  trailer[6] = 1;
  trailer[7] = 1;
  writeUInt64(trailer, 8, objects.length);
  writeUInt64(trailer, 16, 0);
  writeUInt64(trailer, 24, header.length + body.length);
  return concat([header, body, Uint8Array.from(offsets), trailer]);
}

function createLineDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    CREATE TABLE ZUSER (
      Z_PK INTEGER PRIMARY KEY,
      ZMID TEXT,
      ZNAME TEXT,
      ZCUSTOMNAME TEXT,
      ZADDRESSBOOKNAME TEXT
    );
    CREATE TABLE ZCHAT (
      Z_PK INTEGER PRIMARY KEY,
      ZMID TEXT,
      ZTYPE INTEGER NOT NULL,
      ZLASTUPDATED INTEGER
    );
    CREATE TABLE ZMESSAGE (
      Z_PK INTEGER PRIMARY KEY,
      ZCONTENTTYPE INTEGER NOT NULL,
      ZSENDSTATUS INTEGER NOT NULL,
      ZTIMESTAMP INTEGER NOT NULL,
      ZSENDER INTEGER,
      ZID INTEGER,
      ZTEXT TEXT,
      ZCONTENTMETADATA BLOB,
      ZCHAT INTEGER NOT NULL
    );
  `);
  return db;
}

function createGroupDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    CREATE TABLE ZUNIFIEDGROUP (
      Z_PK INTEGER PRIMARY KEY,
      ZID TEXT,
      ZNAME TEXT
    );
  `);
  return db;
}

describe("iosTimestampToIso", () => {
  test("keeps the Unix millisecond instant", () => {
    expect(iosTimestampToIso(Date.parse("2026-08-24T00:00:00.000Z"))).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });

  test("returns null for invalid timestamps", () => {
    expect(iosTimestampToIso(Number.NaN)).toBeNull();
  });

  test("reads a binary plist date object from an iOS-style trailer", () => {
    const data = new Uint8Array(50);
    data.set(new TextEncoder().encode("bplist00"), 0);
    data[8] = 0x33;
    new DataView(data.buffer).setFloat64(9, 0, false);
    data[17] = 8;
    const trailer = new DataView(data.buffer, 18, 32);
    data[24] = 1;
    data[25] = 1;
    trailer.setBigUint64(8, 1n, false);
    trailer.setBigUint64(16, 0n, false);
    trailer.setBigUint64(24, 17n, false);

    expect(parseBplist(data)).toEqual(new Date("2001-01-01T00:00:00.000Z"));
  });
});

describe("iOS normalized staging", () => {
  test("writes chats, messages, and media references without JSONL history", async () => {
    const dir = await testDir("vyline-ios-staging-");
    const linePath = join(dir, "Line.sqlite");
    const groupsPath = join(dir, "UnifiedGroup.sqlite");
    const stagingPath = join(dir, "ios-import.sqlite");
    const line = createLineDatabase(linePath);
    const groups = createGroupDatabase(groupsPath);
    try {
      line.query("INSERT INTO ZUSER VALUES (?, ?, ?, ?, ?)").run(1, "u-self", "Self", "Me", null);
      line.query("INSERT INTO ZUSER VALUES (?, ?, ?, ?, ?)").run(2, "u-peer", "Peer", null, null);
      line.query("INSERT INTO ZCHAT VALUES (?, ?, ?, ?)").run(1, "C-GROUP", 2, 1_787_977_000_000);
      line.query("INSERT INTO ZCHAT VALUES (?, ?, ?, ?)").run(2, "u-peer", 0, 1_787_977_000_100);
      const insert = line.query("INSERT INTO ZMESSAGE VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      insert.run(1, 0, 2, 1_787_977_000_001, null, "101", "sent", null, 1);
      insert.run(
        2,
        1,
        2,
        1_787_977_000_002,
        2,
        9_007_199_254_740_993n,
        null,
        mediaMetadataFixture(),
        2,
      );
      insert.run(3, 0, 2, 1_787_977_000_003, 2, "103", "latest", null, 1);
      insert.run(4, 0, 2, 1_787_976_000_001, 999, "104", "missing direct sender", null, 2);
      insert.run(5, 0, 2, 1_787_976_000_002, 998, "105", "missing group sender", null, 1);
      groups.query("INSERT INTO ZUNIFIEDGROUP VALUES (?, ?, ?)").run(1, "c-group", "Group name");
    } finally {
      groups.close();
      line.close();
    }

    const stages: string[] = [];
    const result = await parseLineDatabases({
      lineDbPath: linePath,
      unifiedGroupDbPath: groupsPath,
      stagingPath,
      myMid: "u-self",
      batchSize: 2,
      onProgress: (progress) => stages.push(progress.stage),
    });
    expect(result).toMatchObject({
      account: "u-self",
      stagingPath,
      chats: 2,
      totalMessages: 5,
      mediaRefs: 1,
    });
    expect(new Set(stages)).toEqual(
      new Set(["groups", "chats", "messages", "finalizing", "complete"]),
    );

    const staged = new Database(stagingPath, { readonly: true, strict: true });
    try {
      expect(
        staged
          .query("SELECT name, kind, last_message_id FROM staged_chats WHERE mid = ?")
          .get("c-group"),
      ).toEqual({ name: "Group name", kind: "group", last_message_id: "103" });
      expect(
        staged
          .query(`
            SELECT from_mid, to_mid, content_type, is_my_message
            FROM staged_messages WHERE chat_mid = ? AND id = ?
          `)
          .get("u-peer", "9007199254740993"),
      ).toEqual({
        from_mid: "u-peer",
        to_mid: "u-self",
        content_type: "IMAGE",
        is_my_message: 0,
      });
      expect(
        staged
          .query(`
            SELECT from_mid, to_mid, is_my_message
            FROM staged_messages WHERE chat_mid = ? AND id = ?
          `)
          .get("u-peer", "104"),
      ).toEqual({ from_mid: "u-peer", to_mid: "u-self", is_my_message: 0 });
      expect(
        staged
          .query(`
            SELECT from_mid, to_mid, is_my_message
            FROM staged_messages WHERE chat_mid = ? AND id = ?
          `)
          .get("c-group", "105"),
      ).toEqual({ from_mid: "unknown:ios:998", to_mid: "c-group", is_my_message: 0 });
      expect(
        staged.query("SELECT token_lower FROM staged_ios_media_tokens ORDER BY token_lower").all(),
      ).toEqual([{ token_lower: "9007199254740993" }, { token_lower: "abcdefgh12345678" }]);
      const columns = (
        staged.query("PRAGMA table_info(staged_messages)").all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(columns).not.toContain("data");
      expect(columns).toContain("content_metadata");
    } finally {
      staged.close();
    }
  });

  test("stops staging when the disk-backed work limit is exceeded", async () => {
    const dir = await testDir("vyline-ios-staging-limit-");
    const linePath = join(dir, "Line.sqlite");
    const groupsPath = join(dir, "UnifiedGroup.sqlite");
    const stagingPath = join(dir, "ios-import.sqlite");
    createLineDatabase(linePath).close();
    createGroupDatabase(groupsPath).close();

    await expect(
      parseLineDatabases({
        lineDbPath: linePath,
        unifiedGroupDbPath: groupsPath,
        stagingPath,
        myMid: "u-self",
        maxStagingBytes: 1,
      }),
    ).rejects.toThrow("staging exceeds");
  });

  test("finds extracted LINE databases from the disk-backed file index", async () => {
    const dir = await testDir("vyline-ios-index-");
    const indexPath = join(dir, "extracted-files.sqlite");
    const db = new Database(indexPath, { create: true, strict: true });
    try {
      db.exec(`
        CREATE TABLE extracted_files (
          file_id TEXT PRIMARY KEY, domain TEXT, relative_path TEXT, relative_lower TEXT,
          basename_lower TEXT, stem_lower TEXT, size_bytes INTEGER, local_path TEXT,
          is_database INTEGER, is_directory INTEGER
        );
      `);
      const insert = db.query("INSERT INTO extracted_files VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      insert.run(
        "a",
        "line",
        "db/Line.sqlite",
        "db/line.sqlite",
        "line.sqlite",
        "line",
        1,
        "line-path",
        1,
        0,
      );
      insert.run(
        "b",
        "line",
        "db/UnifiedGroup.sqlite",
        "db/unifiedgroup.sqlite",
        "unifiedgroup.sqlite",
        "unifiedgroup",
        1,
        "group-path",
        1,
        0,
      );
    } finally {
      db.close();
    }
    expect(findLineDatabases(indexPath)).toEqual({
      lineDb: "line-path",
      unifiedGroupDb: "group-path",
    });
  });

  test("stages 200k messages with bounded RSS and event-loop progress", async () => {
    const dir = await testDir("vyline-ios-staging-200k-");
    const linePath = join(dir, "Line.sqlite");
    const groupsPath = join(dir, "UnifiedGroup.sqlite");
    const stagingPath = join(dir, "ios-import.sqlite");
    const line = createLineDatabase(linePath);
    const groups = createGroupDatabase(groupsPath);
    const total = 200_000;
    try {
      line.query("INSERT INTO ZUSER VALUES (?, ?, ?, ?, ?)").run(1, "u-self", "Self", "Me", null);
      line.query("INSERT INTO ZUSER VALUES (?, ?, ?, ?, ?)").run(2, "u-peer", "Peer", null, null);
      line.query("INSERT INTO ZCHAT VALUES (?, ?, ?, ?)").run(1, "c-large", 2, 1_787_977_000_000);
      const insert = line.query("INSERT INTO ZMESSAGE VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const payload = "x".repeat(256);
      line.exec("BEGIN");
      for (let index = 1; index <= total; index++) {
        insert.run(
          index,
          0,
          2,
          1_787_977_000_000 + index,
          2,
          String(700_000_000_000_000n + BigInt(index)),
          payload,
          null,
          1,
        );
      }
      line.exec("COMMIT");
    } finally {
      groups.close();
      line.close();
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
    let result;
    try {
      result = await parseLineDatabases({
        lineDbPath: linePath,
        unifiedGroupDbPath: groupsPath,
        stagingPath,
        myMid: "u-self",
        onProgress: (progress) => {
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
          if (progress.stage === "messages" && progress.current > 0) messageProgressUpdates++;
        },
      });
    } finally {
      clearInterval(heartbeat);
    }
    const rssGrowth = Math.max(0, peakRss - rssBefore);
    console.info("[ios-staging-200k]", {
      rssGrowth,
      heartbeats,
      messageProgressUpdates,
    });
    expect(result.totalMessages).toBe(total);
    expect(messageProgressUpdates).toBeGreaterThanOrEqual(total / 500);
    expect(heartbeats).toBeGreaterThan(10);
    expect(rssGrowth).toBeLessThan(128 * 1024 * 1024);
  }, 120_000);
});
