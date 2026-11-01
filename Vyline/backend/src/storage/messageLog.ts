/** SQLite-backed, bounded message and announcement diagnostics. */

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { accountDir, ensureAccount } from "./accountDirs.js";
import { sqlite } from "./sqlite.js";

const log = childLogger("message-log");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
const LOG_DIR = process.env.VYLINE_LOG_DIR ?? join(DATA_DIR, "logs");
const LEGACY_ROTATION_BYTES = Number(process.env.VYLINE_MESSAGE_LOG_MAX_BYTES ?? 10 * 1024 * 1024);
const DEFAULT_RETENTION_BYTES = LEGACY_ROTATION_BYTES * 3;
const IMPORT_BATCH_SIZE = 500;
const MAX_IMPORT_CACHE_ACCOUNTS = 32;

function maxLogBytes(): number {
  const configured = Number(
    process.env.VYLINE_MESSAGE_LOG_RETENTION_BYTES ?? DEFAULT_RETENTION_BYTES,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_BYTES;
}

export interface MessageLogEntry {
  ts: string;
  tsMillis: number;
  accountId: string;
  kind: "message" | "announcement";
  direction: "in" | "out";
  chatMid: string;
  chatName?: string;
  senderMid: string;
  senderName?: string;
  contentType: string;
  text?: string | null;
  messageId?: string;
  media?: {
    contentType: string;
    mediaId?: string;
    imageSetId?: string;
    attachmentName?: string;
    durationMillis?: number;
    fileSize?: number;
    stickerId?: string;
    packageId?: string;
  };
  /** イベント（参加/退出/名前変更など）の LOC_KEY */
  locKey?: string;
}

type LogRow = {
  id: number;
  ts: string;
  tsMillis: number;
  accountId: string;
  kind: MessageLogEntry["kind"];
  direction: MessageLogEntry["direction"];
  chatMid: string;
  chatName: string | null;
  chatNamePresent: number;
  senderMid: string;
  senderName: string | null;
  senderNamePresent: number;
  contentType: string;
  text: string | null;
  textPresent: number;
  messageId: string | null;
  mediaPresent: number;
  mediaContentType: string | null;
  mediaId: string | null;
  mediaIdPresent: number;
  imageSetId: string | null;
  imageSetIdPresent: number;
  attachmentName: string | null;
  attachmentNamePresent: number;
  durationMillis: number | null;
  durationMillisPresent: number;
  fileSize: number | null;
  fileSizePresent: number;
  stickerId: string | null;
  stickerIdPresent: number;
  packageId: string | null;
  packageIdPresent: number;
  locKey: string | null;
  locKeyPresent: number;
};

let schemaReady = false;
const imports = new Map<string, Promise<void>>();
const importedAccounts = new Map<string, true>();

function rememberImportedAccount(accountId: string): void {
  importedAccounts.delete(accountId);
  importedAccounts.set(accountId, true);
  while (importedAccounts.size > MAX_IMPORT_CACHE_ACCOUNTS) {
    importedAccounts.delete(importedAccounts.keys().next().value!);
  }
}

function ensureSchema(): void {
  if (schemaReady) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL, ts TEXT NOT NULL, ts_millis INTEGER NOT NULL,
      kind TEXT NOT NULL, direction TEXT NOT NULL, chat_mid TEXT NOT NULL,
      chat_name TEXT, chat_name_present INTEGER NOT NULL,
      sender_mid TEXT NOT NULL, sender_name TEXT, sender_name_present INTEGER NOT NULL,
      content_type TEXT NOT NULL, text TEXT, text_present INTEGER NOT NULL,
      message_id TEXT, media_present INTEGER NOT NULL, media_content_type TEXT,
      media_id TEXT, media_id_present INTEGER NOT NULL, image_set_id TEXT,
      image_set_id_present INTEGER NOT NULL, attachment_name TEXT,
      attachment_name_present INTEGER NOT NULL, duration_millis REAL,
      duration_millis_present INTEGER NOT NULL, file_size REAL,
      file_size_present INTEGER NOT NULL, sticker_id TEXT, sticker_id_present INTEGER NOT NULL,
      package_id TEXT, package_id_present INTEGER NOT NULL, loc_key TEXT,
      loc_key_present INTEGER NOT NULL, entry_bytes INTEGER NOT NULL,
      legacy_key TEXT, UNIQUE(account_id, legacy_key)
    );
    CREATE INDEX IF NOT EXISTS message_logs_account_order_idx
      ON message_logs(account_id, id DESC);
    CREATE INDEX IF NOT EXISTS message_logs_account_message_idx
      ON message_logs(account_id, message_id);
    CREATE TABLE IF NOT EXISTS message_log_state (
      account_id TEXT PRIMARY KEY, total_bytes INTEGER NOT NULL DEFAULT 0
    );
  `);
  schemaReady = true;
}

function legacyLogPath(accountId: string): string {
  ensureAccount(accountId);
  const currentPath = join(accountDir(accountId), "message-log.jsonl");
  return existsSync(currentPath) ? currentPath : join(LOG_DIR, `message-log-${accountId}.jsonl`);
}

type SqlValue = string | number | bigint | null | boolean | Uint8Array;

function entryValues(
  entry: MessageLogEntry,
  entryBytes: number,
  legacyKey: string | null,
): SqlValue[] {
  const media = entry.media;
  return [
    entry.accountId,
    entry.ts,
    entry.tsMillis,
    entry.kind,
    entry.direction,
    entry.chatMid,
    entry.chatName ?? null,
    Number(Object.hasOwn(entry, "chatName")),
    entry.senderMid,
    entry.senderName ?? null,
    Number(Object.hasOwn(entry, "senderName")),
    entry.contentType,
    entry.text ?? null,
    Number(Object.hasOwn(entry, "text")),
    entry.messageId ?? null,
    Number(media != null),
    media?.contentType ?? null,
    media?.mediaId ?? null,
    Number(media != null && Object.hasOwn(media, "mediaId")),
    media?.imageSetId ?? null,
    Number(media != null && Object.hasOwn(media, "imageSetId")),
    media?.attachmentName ?? null,
    Number(media != null && Object.hasOwn(media, "attachmentName")),
    media?.durationMillis ?? null,
    Number(media != null && Object.hasOwn(media, "durationMillis")),
    media?.fileSize ?? null,
    Number(media != null && Object.hasOwn(media, "fileSize")),
    media?.stickerId ?? null,
    Number(media != null && Object.hasOwn(media, "stickerId")),
    media?.packageId ?? null,
    Number(media != null && Object.hasOwn(media, "packageId")),
    entry.locKey ?? null,
    Number(Object.hasOwn(entry, "locKey")),
    entryBytes,
    legacyKey,
  ];
}

const INSERT_SQL = `INSERT OR IGNORE INTO message_logs (
  account_id,ts,ts_millis,kind,direction,chat_mid,chat_name,chat_name_present,
  sender_mid,sender_name,sender_name_present,content_type,text,text_present,message_id,
  media_present,media_content_type,media_id,media_id_present,image_set_id,image_set_id_present,
  attachment_name,attachment_name_present,duration_millis,duration_millis_present,
  file_size,file_size_present,sticker_id,sticker_id_present,package_id,package_id_present,
  loc_key,loc_key_present,entry_bytes,legacy_key
) VALUES (${Array.from({ length: 35 }, () => "?").join(",")})`;

function trimLog(accountId: string): void {
  const state = sqlite
    .query("SELECT total_bytes FROM message_log_state WHERE account_id=?")
    .get(accountId) as { total_bytes: number } | null;
  const total = state?.total_bytes ?? 0;
  const byteLimit = maxLogBytes();
  if (total <= byteLimit) return;

  sqlite
    .query(`WITH cumulative AS (
      SELECT id, SUM(entry_bytes) OVER (ORDER BY id DESC) AS bytes_from_newest
      FROM message_logs WHERE account_id=?
    )
    DELETE FROM message_logs WHERE account_id=? AND id IN (
      SELECT id FROM cumulative WHERE bytes_from_newest > ?
    )`)
    .run(accountId, accountId, byteLimit);
  const remaining = sqlite
    .query("SELECT COALESCE(SUM(entry_bytes),0) AS total FROM message_logs WHERE account_id=?")
    .get(accountId) as { total: number };
  sqlite
    .query(`INSERT INTO message_log_state(account_id,total_bytes) VALUES(?,?)
    ON CONFLICT(account_id) DO UPDATE SET total_bytes=excluded.total_bytes`)
    .run(accountId, remaining.total);
}

function insertBatch(
  rows: Array<{ entry: MessageLogEntry; bytes: number; legacyKey: string | null }>,
): void {
  if (!rows.length) return;
  const firstAccount = rows[0]!.entry.accountId;
  let insertedBytes = 0;
  sqlite
    .transaction(() => {
      const insert = sqlite.query(INSERT_SQL);
      for (const row of rows) {
        const result = insert.run(...entryValues(row.entry, row.bytes, row.legacyKey));
        if (result.changes) insertedBytes += row.bytes;
      }
      if (insertedBytes) {
        sqlite
          .query(`INSERT INTO message_log_state(account_id,total_bytes) VALUES(?,?)
        ON CONFLICT(account_id) DO UPDATE SET total_bytes=total_bytes+excluded.total_bytes`)
          .run(firstAccount, insertedBytes);
      }
      trimLog(firstAccount);
    })
    .immediate();
}

async function importLegacyLog(accountId: string): Promise<void> {
  ensureSchema();
  const migrationName = `message-log-jsonl-v1:${accountId}`;
  if (sqlite.query("SELECT 1 FROM app_migrations WHERE name=?").get(migrationName)) return;

  const path = legacyLogPath(accountId);
  let batch: Array<{ entry: MessageLogEntry; bytes: number; legacyKey: string | null }> = [];
  if (existsSync(path)) {
    const input = createReadStream(path);
    const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
    let lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber++;
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as MessageLogEntry;
          if (
            !parsed ||
            typeof parsed !== "object" ||
            typeof parsed.tsMillis !== "number" ||
            typeof parsed.chatMid !== "string" ||
            typeof parsed.senderMid !== "string"
          )
            continue;
          const entry = { ...parsed, accountId };
          batch.push({
            entry,
            bytes: Buffer.byteLength(line, "utf8") + 1,
            legacyKey: `${path}:${lineNumber}`,
          });
        } catch {
          /* skip malformed legacy lines while retaining the source file */
        }
        if (batch.length >= IMPORT_BATCH_SIZE) {
          insertBatch(batch);
          batch = [];
        }
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }
  insertBatch(batch);
  sqlite
    .transaction(() => {
      sqlite
        .query("INSERT OR IGNORE INTO app_migrations(name,applied_at) VALUES(?,?)")
        .run(migrationName, new Date().toISOString());
    })
    .immediate();
}

async function ensureImported(accountId: string): Promise<void> {
  ensureSchema();
  if (importedAccounts.has(accountId)) {
    rememberImportedAccount(accountId);
    return;
  }
  const active = imports.get(accountId);
  if (active) return active;
  const task = importLegacyLog(accountId)
    .then(() => {
      rememberImportedAccount(accountId);
    })
    .finally(() => imports.delete(accountId));
  imports.set(accountId, task);
  return task;
}

function fromRow(row: LogRow): MessageLogEntry {
  const entry: MessageLogEntry = {
    ts: row.ts,
    tsMillis: row.tsMillis,
    accountId: row.accountId,
    kind: row.kind,
    direction: row.direction,
    chatMid: row.chatMid,
    senderMid: row.senderMid,
    contentType: row.contentType,
  };
  if (row.chatNamePresent) entry.chatName = row.chatName ?? "";
  if (row.senderNamePresent) entry.senderName = row.senderName ?? "";
  if (row.textPresent) entry.text = row.text;
  if (row.messageId != null) entry.messageId = row.messageId;
  if (row.locKeyPresent) entry.locKey = row.locKey ?? "";
  if (row.mediaPresent) {
    const media: NonNullable<MessageLogEntry["media"]> = {
      contentType: row.mediaContentType ?? "",
    };
    if (row.mediaIdPresent) media.mediaId = row.mediaId ?? "";
    if (row.imageSetIdPresent) media.imageSetId = row.imageSetId ?? "";
    if (row.attachmentNamePresent) media.attachmentName = row.attachmentName ?? "";
    if (row.durationMillisPresent) media.durationMillis = row.durationMillis ?? 0;
    if (row.fileSizePresent) media.fileSize = row.fileSize ?? 0;
    if (row.stickerIdPresent) media.stickerId = row.stickerId ?? "";
    if (row.packageIdPresent) media.packageId = row.packageId ?? "";
    entry.media = media;
  }
  return entry;
}

/** SQLiteに1件追記（旧JSONLを先に一度だけ取り込み、失敗しても全体は止めない） */
export async function appendMessageLog(entry: MessageLogEntry): Promise<void> {
  try {
    await ensureImported(entry.accountId);
    const bytes = Buffer.byteLength(JSON.stringify(entry), "utf8") + 1;
    insertBatch([{ entry, bytes, legacyKey: null }]);
  } catch (err) {
    log.debug({ accountId: entry.accountId, err }, "message log append failed");
  }
}

/** 直近N件をSQLiteの順序インデックスから取得する（デバッグ・復元用） */
export async function readRecentMessageLog(
  accountId: string,
  limit = 200,
): Promise<MessageLogEntry[]> {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (!boundedLimit) return [];
  try {
    await ensureImported(accountId);
    const rows = sqlite
      .query(`SELECT id,ts,ts_millis AS tsMillis,account_id AS accountId,kind,direction,
      chat_mid AS chatMid,chat_name AS chatName,chat_name_present AS chatNamePresent,
      sender_mid AS senderMid,sender_name AS senderName,sender_name_present AS senderNamePresent,
      content_type AS contentType,text,text_present AS textPresent,message_id AS messageId,
      media_present AS mediaPresent,media_content_type AS mediaContentType,media_id AS mediaId,
      media_id_present AS mediaIdPresent,image_set_id AS imageSetId,image_set_id_present AS imageSetIdPresent,
      attachment_name AS attachmentName,attachment_name_present AS attachmentNamePresent,
      duration_millis AS durationMillis,duration_millis_present AS durationMillisPresent,
      file_size AS fileSize,file_size_present AS fileSizePresent,sticker_id AS stickerId,
      sticker_id_present AS stickerIdPresent,package_id AS packageId,package_id_present AS packageIdPresent,
      loc_key AS locKey,loc_key_present AS locKeyPresent FROM message_logs
      WHERE account_id=? ORDER BY id DESC LIMIT ?`)
      .all(accountId, boundedLimit) as LogRow[];
    return rows.reverse().map(fromRow);
  } catch (err) {
    log.debug({ accountId, err }, "message log read failed");
    return [];
  }
}

/** 既知のメッセージID集合へ、ログに残る未登録IDを追加する。 */
export async function replayMissingLogs(accountId: string, knownIds: Set<string>): Promise<number> {
  try {
    await ensureImported(accountId);
    const rows = sqlite
      .query(`SELECT message_id FROM message_logs
      WHERE account_id=? AND message_id IS NOT NULL ORDER BY id`)
      .all(accountId) as Array<{ message_id: string }>;
    let added = 0;
    for (const { message_id: messageId } of rows) {
      if (!knownIds.has(messageId)) {
        knownIds.add(messageId);
        added++;
      }
    }
    return added;
  } catch (err) {
    log.debug({ accountId, err }, "message log replay failed");
    return 0;
  }
}
