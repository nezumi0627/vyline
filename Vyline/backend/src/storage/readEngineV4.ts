import { migrateOnce, sqlite } from "./sqlite.js";

export type ReadIntervalV4 = {
  readerMid: string;
  startMessageId: string;
  endMessageId: string;
  startTime?: string;
  endTime?: string | undefined;
};

export type ReadSnapshotV4 = {
  version: number;
  observedAt: string;
  attemptedAt: string;
  stale: boolean;
  failStreak: number;
  intervals: ReadIntervalV4[];
  readers: Array<{ mid: string; latestEndMessageId: string; intervalCount: number }>;
};

type ReadIntervalRow = ReadIntervalV4 & { startOrderKey: string; endOrderKey: string };
type IndexedReaderRanges = Map<string, { starts: bigint[]; prefixMaxEnds: bigint[] }>;

const MAX_INT64 = 9_223_372_036_854_775_807n;

/** Sorts positive Thrift Int64 message IDs without lossy JS number conversion. */
export function readMessageOrderKeyV4(id: string): string | undefined {
  if (!/^\d{1,19}$/.test(id)) return undefined;
  let value: bigint;
  try {
    value = BigInt(id);
  } catch {
    return undefined;
  }
  if (value < 0n || value > MAX_INT64) return undefined;
  const canonical = String(value);
  return `${String(canonical.length).padStart(2, "0")}:${canonical.padStart(19, "0")}`;
}

function messageIdField(
  row: Record<string, unknown>,
  named: string,
  index: number,
): string | undefined {
  const value = row[named] ?? row[index];
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : undefined;
}

function canonicalMessageId(id: string): string | undefined {
  const key = readMessageOrderKeyV4(id);
  return key ? String(BigInt(id)) : undefined;
}

function rangeRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  if (row.startMessageId != null || row.endMessageId != null || row[1] != null || row[2] != null)
    return [row];
  return Object.values(row).filter(
    (item): item is Record<string, unknown> => !!item && typeof item === "object",
  );
}

/** Convert only explicit LINE intervals; missing starts become a safe point, never an assumed prefix. */
export function normalizeReadIntervalsV4(
  ranges: Array<{ chatId?: string; ranges?: unknown }>,
  chatMid: string,
  selfMid: string,
): ReadIntervalV4[] | undefined {
  const chat = ranges.find((entry) => String(entry.chatId ?? "") === chatMid);
  if (!chat || chat.ranges == null) return undefined;
  const result: ReadIntervalV4[] = [];
  const add = (readerMid: string, value: unknown) => {
    if (!readerMid || readerMid === selfMid) return;
    for (const row of rangeRows(value)) {
      const endValue = messageIdField(row, "endMessageId", 2);
      const end = endValue ? canonicalMessageId(endValue) : undefined;
      if (!end) continue;
      const startValue = messageIdField(row, "startMessageId", 1) ?? end;
      const start = canonicalMessageId(startValue);
      if (!start) continue;
      const startKey = readMessageOrderKeyV4(start);
      const endKey = readMessageOrderKeyV4(end);
      if (!startKey || !endKey || startKey > endKey) continue;
      const startTime = messageIdField(row, "startTime", 3);
      const endTime = messageIdField(row, "endTime", 4);
      result.push({
        readerMid,
        startMessageId: start,
        endMessageId: end,
        ...(startTime !== undefined ? { startTime } : {}),
        ...(endTime !== undefined ? { endTime } : {}),
      });
    }
  };

  if (Array.isArray(chat.ranges)) {
    for (const row of chat.ranges) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      add(String(item.memberMid ?? ""), item);
    }
  } else if (typeof chat.ranges === "object") {
    for (const [mid, value] of Object.entries(chat.ranges as Record<string, unknown>))
      add(mid, value);
  }
  const unique = new Map<string, ReadIntervalV4>();
  for (const item of result)
    unique.set(`${item.readerMid}\0${item.startMessageId}\0${item.endMessageId}`, item);
  const sorted = [...unique.values()].sort(
    (a, b) =>
      a.readerMid.localeCompare(b.readerMid) ||
      readMessageOrderKeyV4(a.startMessageId)!.localeCompare(
        readMessageOrderKeyV4(b.startMessageId)!,
      ) ||
      readMessageOrderKeyV4(a.endMessageId)!.localeCompare(readMessageOrderKeyV4(b.endMessageId)!),
  );
  const merged: ReadIntervalV4[] = [];
  for (const item of sorted) {
    const previous = merged.at(-1);
    if (
      previous?.readerMid === item.readerMid &&
      BigInt(item.startMessageId) <= BigInt(previous.endMessageId) + 1n
    ) {
      if (BigInt(item.endMessageId) > BigInt(previous.endMessageId)) {
        previous.endMessageId = item.endMessageId;
        if (item.endTime !== undefined) previous.endTime = item.endTime;
        else previous.endTime = undefined;
      }
      continue;
    }
    merged.push({ ...item });
  }
  return merged;
}

export function indexReadIntervalsV4(intervals: ReadIntervalV4[]): IndexedReaderRanges {
  const rows = new Map<string, Array<{ start: bigint; end: bigint }>>();
  for (const interval of intervals) {
    try {
      const list = rows.get(interval.readerMid) ?? [];
      list.push({ start: BigInt(interval.startMessageId), end: BigInt(interval.endMessageId) });
      rows.set(interval.readerMid, list);
    } catch {
      /* ignore malformed intervals */
    }
  }
  const indexed: IndexedReaderRanges = new Map();
  for (const [mid, list] of rows) {
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    let maxEnd = -1n;
    const prefixMaxEnds: bigint[] = [];
    for (const item of list) {
      if (item.end > maxEnd) maxEnd = item.end;
      prefixMaxEnds.push(maxEnd);
    }
    indexed.set(mid, { starts: list.map((item) => item.start), prefixMaxEnds });
  }
  return indexed;
}

export function readersAtMessageV4(index: IndexedReaderRanges, messageId: string): string[] {
  let id: bigint;
  try {
    id = BigInt(messageId);
  } catch {
    return [];
  }
  const readers: string[] = [];
  for (const [mid, ranges] of index) {
    let low = 0;
    let high = ranges.starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges.starts[middle]! <= id) low = middle + 1;
      else high = middle;
    }
    if (low > 0 && ranges.prefixMaxEnds[low - 1]! >= id) readers.push(mid);
  }
  return readers;
}

export function ensureReadEngineV4Schema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS read_chat_v4 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL,
      state_version INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL,
      observed_at TEXT NOT NULL, attempted_at TEXT NOT NULL,
      fail_streak INTEGER NOT NULL DEFAULT 0, stale INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(account_id, chat_mid)
    );
    CREATE TABLE IF NOT EXISTS read_reader_v4 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, reader_mid TEXT NOT NULL,
      latest_end_message_id TEXT NOT NULL, latest_end_order_key TEXT NOT NULL,
      latest_end_time TEXT, interval_count INTEGER NOT NULL,
      PRIMARY KEY(account_id, chat_mid, reader_mid)
    );
    CREATE TABLE IF NOT EXISTS read_interval_v4 (
      account_id TEXT NOT NULL, chat_mid TEXT NOT NULL, reader_mid TEXT NOT NULL,
      start_message_id TEXT NOT NULL, end_message_id TEXT NOT NULL,
      start_order_key TEXT NOT NULL, end_order_key TEXT NOT NULL,
      start_time TEXT, end_time TEXT, observed_at TEXT NOT NULL,
      PRIMARY KEY(account_id, chat_mid, reader_mid, start_message_id, end_message_id)
    );
    CREATE INDEX IF NOT EXISTS read_interval_v4_message_idx
      ON read_interval_v4(account_id, chat_mid, start_order_key, end_order_key, reader_mid);
    CREATE INDEX IF NOT EXISTS read_interval_v4_reader_idx
      ON read_interval_v4(account_id, chat_mid, reader_mid, start_order_key, end_order_key);
  `);
  migrateOnce("read-engine-v4-explicit-evidence", () => {
    const insert = sqlite.query(`INSERT OR IGNORE INTO read_interval_v4
      (account_id,chat_mid,reader_mid,start_message_id,end_message_id,start_order_key,end_order_key,
       start_time,end_time,observed_at) VALUES (?,?,?,?,?,?,?,NULL,NULL,'legacy')`);
    const readers = sqlite
      .query(`SELECT r.account_id,r.chat_mid,r.reader_mid,m.message_id
      FROM chat_message_readers_v2 r JOIN chat_messages_v2 m
        ON m.account_id=r.account_id AND m.chat_mid=r.chat_mid AND m.message_id=r.message_id
      WHERE r.owner='main' AND m.message_id GLOB '[0-9]*'
        AND m.message_id NOT GLOB '*[^0-9]*'`)
      .all() as Array<{
      account_id: string;
      chat_mid: string;
      reader_mid: string;
      message_id: string;
    }>;
    for (const row of readers) {
      const key = readMessageOrderKeyV4(row.message_id);
      if (key)
        insert.run(
          row.account_id,
          row.chat_mid,
          row.reader_mid,
          row.message_id,
          row.message_id,
          key,
          key,
        );
    }
    const directSeen = sqlite
      .query(`SELECT account_id,chat_mid,message_id FROM chat_messages_v2
      WHERE is_my_message=1 AND seen=1 AND substr(chat_mid,1,1)='u'
        AND message_id GLOB '[0-9]*' AND message_id NOT GLOB '*[^0-9]*'`)
      .all() as Array<{
      account_id: string;
      chat_mid: string;
      message_id: string;
    }>;
    for (const row of directSeen) {
      const key = readMessageOrderKeyV4(row.message_id);
      if (key)
        insert.run(
          row.account_id,
          row.chat_mid,
          row.chat_mid,
          row.message_id,
          row.message_id,
          key,
          key,
        );
    }
    const kvExists = sqlite
      .query(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='vyline_kv'`)
      .get();
    if (kvExists) {
      const cachedRanges = sqlite
        .query(`SELECT account_id AS accountId,key,payload FROM vyline_kv
        WHERE namespace='readRanges'`)
        .all() as Array<{ accountId: string; key: string; payload: string }>;
      const migratedCacheRows: Array<{ accountId: string; key: string }> = [];
      for (const row of cachedRanges) {
        try {
          const entry = JSON.parse(row.payload) as { at?: number; ranges?: unknown };
          if (!Array.isArray(entry.ranges)) continue;
          const normalized = entry.ranges as Array<{ chatId?: string; ranges?: unknown }>;
          const intervals = normalizeReadIntervalsV4(normalized, row.key, "");
          if (!intervals) continue;
          const at = Number.isFinite(entry.at)
            ? new Date(entry.at!).toISOString()
            : new Date(0).toISOString();
          for (const item of intervals) {
            const startKey = readMessageOrderKeyV4(item.startMessageId);
            const endKey = readMessageOrderKeyV4(item.endMessageId);
            if (!startKey || !endKey) continue;
            insert.run(
              row.accountId,
              row.key,
              item.readerMid,
              item.startMessageId,
              item.endMessageId,
              startKey,
              endKey,
            );
          }
          sqlite
            .query(`INSERT OR IGNORE INTO read_chat_v4
            (account_id,chat_mid,state_version,source,observed_at,attempted_at,fail_streak,stale)
            VALUES (?,?,1,'legacy-range-cache',?,?,0,1)`)
            .run(row.accountId, row.key, at, at);
          migratedCacheRows.push({ accountId: row.accountId, key: row.key });
        } catch {
          // Keep malformed legacy rows available for manual recovery; do not block startup.
        }
      }
      const removeLegacy = sqlite.query(`DELETE FROM vyline_kv
        WHERE namespace='readRanges' AND account_id=? AND key=?`);
      for (const row of migratedCacheRows) removeLegacy.run(row.accountId, row.key);
    }
    const chats = new Set(
      [...readers, ...directSeen].map((row) => `${row.account_id}\0${row.chat_mid}`),
    );
    for (const value of chats) {
      const [accountId, chatMid] = value.split("\0");
      if (!accountId || !chatMid) continue;
      const at = new Date(0).toISOString();
      sqlite
        .query(`INSERT OR IGNORE INTO read_chat_v4
        (account_id,chat_mid,state_version,source,observed_at,attempted_at,fail_streak,stale)
        VALUES (?,?,1,'legacy-explicit',?,?,0,1)`)
        .run(accountId, chatMid, at, at);
    }
    const legacyReaders = sqlite
      .query("SELECT DISTINCT account_id,chat_mid,reader_mid FROM read_interval_v4")
      .all() as Array<{ account_id: string; chat_mid: string; reader_mid: string }>;
    for (const row of legacyReaders) {
      const summary = sqlite
        .query(`SELECT end_message_id AS id,end_order_key AS orderKey,end_time AS endTime,
          COUNT(*) OVER() AS intervalCount FROM read_interval_v4
        WHERE account_id=? AND chat_mid=? AND reader_mid=? ORDER BY end_order_key DESC LIMIT 1`)
        .get(row.account_id, row.chat_mid, row.reader_mid) as {
        id: string;
        orderKey: string;
        endTime: string | null;
        intervalCount: number;
      } | null;
      if (!summary) continue;
      sqlite
        .query(`INSERT OR IGNORE INTO read_reader_v4
        (account_id,chat_mid,reader_mid,latest_end_message_id,latest_end_order_key,latest_end_time,interval_count)
        VALUES (?,?,?,?,?,?,?)`)
        .run(
          row.account_id,
          row.chat_mid,
          row.reader_mid,
          summary.id,
          summary.orderKey,
          summary.endTime,
          summary.intervalCount,
        );
    }
  });
}

function asRow(item: ReadIntervalV4): ReadIntervalRow {
  return {
    ...item,
    startOrderKey: readMessageOrderKeyV4(item.startMessageId)!,
    endOrderKey: readMessageOrderKeyV4(item.endMessageId)!,
  };
}

export function replaceReadSnapshotV4(
  accountId: string,
  chatMid: string,
  intervals: ReadIntervalV4[],
  observedAt = new Date().toISOString(),
): ReadSnapshotV4 {
  ensureReadEngineV4Schema();
  const incoming = intervals.map(asRow);
  const old = sqlite
    .query(`SELECT reader_mid AS readerMid,start_message_id AS startMessageId,
      end_message_id AS endMessageId,start_time AS startTime,end_time AS endTime
    FROM read_interval_v4 WHERE account_id=? AND chat_mid=?`)
    .all(accountId, chatMid) as ReadIntervalV4[];
  const keyOf = (item: ReadIntervalV4) =>
    `${item.readerMid}\0${item.startMessageId}\0${item.endMessageId}`;
  const oldByKey = new Map(old.map((item) => [keyOf(item), item]));
  const newByKey = new Map(incoming.map((item) => [keyOf(item), item]));
  const changed =
    old.length !== incoming.length ||
    [...newByKey].some(([key, item]) => {
      const previous = oldByKey.get(key);
      return (
        !previous || previous.startTime !== item.startTime || previous.endTime !== item.endTime
      );
    });
  const state = sqlite
    .query("SELECT state_version AS version FROM read_chat_v4 WHERE account_id=? AND chat_mid=?")
    .get(accountId, chatMid) as { version: number } | null;
  const version = (state?.version ?? 0) + Number(changed);
  const upsert = sqlite.query(`INSERT INTO read_interval_v4
    (account_id,chat_mid,reader_mid,start_message_id,end_message_id,start_order_key,end_order_key,
     start_time,end_time,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,chat_mid,reader_mid,start_message_id,end_message_id) DO UPDATE SET
      start_order_key=excluded.start_order_key,end_order_key=excluded.end_order_key,
      start_time=excluded.start_time,end_time=excluded.end_time,observed_at=excluded.observed_at`);
  const readersAffected = new Set<string>();
  sqlite
    .transaction(() => {
      for (const [key, item] of oldByKey) {
        if (newByKey.has(key)) continue;
        sqlite
          .query(`DELETE FROM read_interval_v4 WHERE account_id=? AND chat_mid=? AND reader_mid=?
        AND start_message_id=? AND end_message_id=?`)
          .run(accountId, chatMid, item.readerMid, item.startMessageId, item.endMessageId);
        readersAffected.add(item.readerMid);
      }
      for (const item of incoming) {
        const oldItem = oldByKey.get(keyOf(item));
        if (!oldItem || oldItem.startTime !== item.startTime || oldItem.endTime !== item.endTime) {
          upsert.run(
            accountId,
            chatMid,
            item.readerMid,
            item.startMessageId,
            item.endMessageId,
            item.startOrderKey,
            item.endOrderKey,
            item.startTime ?? null,
            item.endTime ?? null,
            observedAt,
          );
          readersAffected.add(item.readerMid);
        }
      }
      for (const readerMid of readersAffected) {
        const summary = sqlite
          .query(`SELECT end_message_id AS id,end_order_key AS orderKey,end_time AS endTime,
          COUNT(*) OVER() AS intervalCount
        FROM read_interval_v4 WHERE account_id=? AND chat_mid=? AND reader_mid=?
        ORDER BY end_order_key DESC LIMIT 1`)
          .get(accountId, chatMid, readerMid) as {
          id: string;
          orderKey: string;
          endTime: string | null;
          intervalCount: number;
        } | null;
        if (!summary) {
          sqlite
            .query("DELETE FROM read_reader_v4 WHERE account_id=? AND chat_mid=? AND reader_mid=?")
            .run(accountId, chatMid, readerMid);
        } else {
          sqlite
            .query(`INSERT INTO read_reader_v4
          (account_id,chat_mid,reader_mid,latest_end_message_id,latest_end_order_key,latest_end_time,interval_count)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id,chat_mid,reader_mid) DO UPDATE SET
            latest_end_message_id=excluded.latest_end_message_id,latest_end_order_key=excluded.latest_end_order_key,
            latest_end_time=excluded.latest_end_time,interval_count=excluded.interval_count`)
            .run(
              accountId,
              chatMid,
              readerMid,
              summary.id,
              summary.orderKey,
              summary.endTime,
              summary.intervalCount,
            );
        }
      }
      sqlite
        .query(`INSERT INTO read_chat_v4
      (account_id,chat_mid,state_version,source,observed_at,attempted_at,fail_streak,stale)
      VALUES (?,?,?,'line-range',?,?,0,0)
      ON CONFLICT(account_id,chat_mid) DO UPDATE SET state_version=excluded.state_version,
        source=excluded.source,observed_at=excluded.observed_at,attempted_at=excluded.attempted_at,
        fail_streak=0,stale=0`)
        .run(accountId, chatMid, version, observedAt, observedAt);
    })
    .immediate();
  return getReadSnapshotV4(accountId, chatMid)!;
}

export function markReadSnapshotV4Stale(accountId: string, chatMid: string): number {
  ensureReadEngineV4Schema();
  const attemptedAt = new Date().toISOString();
  sqlite
    .query(`INSERT INTO read_chat_v4
    (account_id,chat_mid,state_version,source,observed_at,attempted_at,fail_streak,stale)
    VALUES (?, ?, 0, 'line-range', ?, ?, 1, 1)
    ON CONFLICT(account_id,chat_mid) DO UPDATE SET stale=1,attempted_at=excluded.attempted_at,
      fail_streak=read_chat_v4.fail_streak+1`)
    .run(accountId, chatMid, new Date(0).toISOString(), attemptedAt);
  const row = sqlite
    .query(`SELECT fail_streak AS failStreak FROM read_chat_v4
    WHERE account_id=? AND chat_mid=?`)
    .get(accountId, chatMid) as { failStreak: number };
  return row.failStreak;
}

export function getReadSnapshotV4(accountId: string, chatMid: string): ReadSnapshotV4 | undefined {
  ensureReadEngineV4Schema();
  const state = sqlite
    .query(`SELECT state_version AS version,observed_at AS observedAt,
      attempted_at AS attemptedAt,fail_streak AS failStreak,stale
    FROM read_chat_v4 WHERE account_id=? AND chat_mid=?`)
    .get(accountId, chatMid) as {
    version: number;
    observedAt: string;
    attemptedAt: string;
    failStreak: number;
    stale: number;
  } | null;
  if (!state) return undefined;
  const intervals = sqlite
    .query(`SELECT reader_mid AS readerMid,start_message_id AS startMessageId,
      end_message_id AS endMessageId,start_time AS startTime,end_time AS endTime
    FROM read_interval_v4 WHERE account_id=? AND chat_mid=?
    ORDER BY reader_mid,start_order_key,end_order_key`)
    .all(accountId, chatMid) as ReadIntervalV4[];
  const readers = sqlite
    .query(`SELECT reader_mid AS mid,latest_end_message_id AS latestEndMessageId,
      interval_count AS intervalCount FROM read_reader_v4 WHERE account_id=? AND chat_mid=?`)
    .all(accountId, chatMid) as Array<{
    mid: string;
    latestEndMessageId: string;
    intervalCount: number;
  }>;
  return {
    version: state.version,
    observedAt: state.observedAt,
    attemptedAt: state.attemptedAt,
    stale: state.stale === 1,
    failStreak: state.failStreak,
    intervals,
    readers,
  };
}

export function readRangesFromSnapshotV4(
  chatMid: string,
  snapshot: ReadSnapshotV4 | undefined,
): Array<{ chatId?: string; ranges?: unknown }> {
  if (!snapshot) return [];
  const ranges: Record<string, Array<Record<string, string>>> = {};
  for (const interval of snapshot.intervals) {
    const list = ranges[interval.readerMid] ?? (ranges[interval.readerMid] = []);
    list.push({
      startMessageId: interval.startMessageId,
      endMessageId: interval.endMessageId,
      ...(interval.startTime !== undefined ? { startTime: interval.startTime } : {}),
      ...(interval.endTime !== undefined ? { endTime: interval.endTime } : {}),
    });
  }
  return [{ chatId: chatMid, ranges }];
}

export function readersForMessageV4(
  accountId: string,
  chatMid: string,
  messageId: string,
): string[] {
  const key = readMessageOrderKeyV4(messageId);
  if (!key) return [];
  ensureReadEngineV4Schema();
  return (
    sqlite
      .query(`SELECT DISTINCT reader_mid FROM read_interval_v4
    WHERE account_id=? AND chat_mid=? AND start_order_key<=? AND end_order_key>=?`)
      .all(accountId, chatMid, key, key) as Array<{ reader_mid: string }>
  ).map((row) => row.reader_mid);
}
