import { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseBplist } from "./bplist.js";

const STAGING_BATCH_SIZE = 500;
const MAX_MEDIA_TOKENS_PER_MESSAGE = 128;
export const DEFAULT_MAX_STAGING_BYTES = 10 * 1024 ** 3;
const MEDIA_CONTENT_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "FILE", "STICKER"]);
const STRONG_MEDIA_METADATA_KEYS = new Set([
  "OID",
  "OBJECTID",
  "LOCALID",
  "FILEPATH",
  "ORIGINALPATH",
  "THUMBNAILPATH",
  "DOWNLOADURL",
]);

export interface StagedChatHistory {
  account: string;
  exportedAt: string;
  stagingPath: string;
  chats: number;
  totalMessages: number;
  mediaRefs: number;
}

export interface ParseOptions {
  lineDbPath: string;
  unifiedGroupDbPath: string;
  stagingPath: string;
  myMid: string;
  batchSize?: number;
  maxStagingBytes?: number;
  onWorkBytes?: (bytes: number) => Promise<void>;
  onProgress?: (progress: ParseProgress) => void;
}

export interface ParseProgress {
  stage: "groups" | "chats" | "messages" | "finalizing" | "complete" | "error";
  current: number;
  total: number;
  message: string;
  chatMid?: string;
}

interface GroupRow {
  row_id: number | bigint;
  group_mid: string | null;
  group_name: string | null;
}

interface ChatRow {
  chat_pk: number | bigint;
  chat_mid: string | null;
  chat_type: number | bigint;
  last_updated: number | bigint | null;
}

interface MessageRow {
  message_pk: number | bigint;
  content_type: number | bigint;
  timestamp: number | bigint;
  sender_pk: number | bigint | null;
  message_id: number | bigint | string | null;
  text: string | null;
  content_metadata: Uint8Array | null;
  chat_pk: number;
  chat_mid: string | null;
  chat_type: number | bigint;
  sender_mid: string | null;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function positiveBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return STAGING_BATCH_SIZE;
  return Math.max(1, Math.min(STAGING_BATCH_SIZE, Math.floor(value!)));
}

function configureSourceDatabase(db: Database): void {
  db.exec("PRAGMA query_only = ON");
  db.exec("PRAGMA cache_size = -2048");
  db.exec("PRAGMA mmap_size = 0");
  db.exec("PRAGMA temp_store = FILE");
  db.exec("PRAGMA busy_timeout = 5000");
}

function initializeStaging(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA wal_autocheckpoint = 256");
    db.exec("PRAGMA journal_size_limit = 8388608");
    db.exec("PRAGMA cache_size = -2048");
    db.exec("PRAGMA mmap_size = 0");
    db.exec("PRAGMA temp_store = FILE");
    db.exec(`
    DROP TABLE IF EXISTS staged_media_plan;
    DROP TABLE IF EXISTS staged_ios_chat_rows;
    DROP TABLE IF EXISTS staged_ios_group_names;
    DROP TABLE IF EXISTS staged_ios_message_order;
    DROP TABLE IF EXISTS staged_ios_media_tokens;
    DROP TABLE IF EXISTS staged_media_refs;
    DROP TABLE IF EXISTS staged_messages;
    DROP TABLE IF EXISTS staged_chats;
    DROP TABLE IF EXISTS staged_meta;

    CREATE TABLE IF NOT EXISTS staged_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staged_chats (
      mid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      has_messages INTEGER NOT NULL,
      last_message_time INTEGER,
      last_message_id TEXT,
      last_message_preview TEXT,
      thumbnail_url TEXT,
      unread_count INTEGER,
      is_official INTEGER,
      restored_history INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staged_messages (
      id TEXT NOT NULL,
      chat_mid TEXT NOT NULL,
      from_mid TEXT NOT NULL,
      to_mid TEXT NOT NULL,
      text TEXT,
      content_type TEXT NOT NULL,
      created_time INTEGER NOT NULL,
      is_my_message INTEGER NOT NULL,
      content_metadata TEXT,
      read_count INTEGER,
      read_by TEXT,
      seen INTEGER,
      related_message_id TEXT,
      sticker_animated INTEGER,
      sticker_sticky INTEGER,
      reactions TEXT,
      saved_at TEXT NOT NULL,
      message_state TEXT,
      history TEXT,
      revoked_snapshot TEXT,
      PRIMARY KEY (chat_mid, id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_staged_messages_chat_time
      ON staged_messages (chat_mid, created_time DESC, id DESC);

    CREATE TABLE IF NOT EXISTS staged_media_refs (
      chat_mid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      local_id TEXT NOT NULL,
      content_type TEXT NOT NULL,
      PRIMARY KEY (chat_mid, message_id)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS staged_ios_media_tokens (
      chat_mid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      token_lower TEXT NOT NULL,
      PRIMARY KEY (chat_mid, message_id, token_lower)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_staged_ios_media_tokens_value
      ON staged_ios_media_tokens (token_lower, chat_mid, message_id);

    CREATE TABLE IF NOT EXISTS staged_ios_message_order (
      chat_mid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      source_pk INTEGER NOT NULL,
      PRIMARY KEY (chat_mid, message_id)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS staged_ios_group_names (
      mid TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staged_ios_chat_rows (
      source_pk INTEGER PRIMARY KEY,
      mid TEXT NOT NULL,
      kind TEXT NOT NULL,
      last_updated INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_staged_ios_chat_rows_mid
      ON staged_ios_chat_rows (mid);
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function withTransaction(db: Database, work: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function countRows(db: Database, table: string): number {
  const row = db.query(`SELECT count(*) AS count FROM ${table}`).get() as {
    count?: number | bigint;
  } | null;
  return Number(row?.count ?? 0);
}

async function sqliteBundleBytes(path: string): Promise<number> {
  let total = 0;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    total += (await stat(candidate).catch(() => null))?.size ?? 0;
  }
  return total;
}

export function iosTimestampToIso(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function iosContentType(type: number): string {
  return (
    (
      {
        0: "NONE",
        1: "IMAGE",
        2: "VIDEO",
        3: "AUDIO",
        7: "STICKER",
        14: "FILE",
        17: "RICH",
        22: "FLEX",
      } as Record<number, string>
    )[type] ?? String(type)
  );
}

function chatMid(row: Pick<ChatRow, "chat_pk" | "chat_mid">): string {
  const mid = row.chat_mid?.trim().toLowerCase();
  return mid || `chat${row.chat_pk}`;
}

function chatKind(mid: string, type: number): "group" | "direct" | "unknown" {
  if (mid.startsWith("c") || mid.startsWith("r") || type === 2) return "group";
  if (mid.startsWith("u") || type === 0) return "direct";
  return "unknown";
}

function parseMetadata(data: Uint8Array | null): unknown {
  if (!data) return null;
  try {
    return parseBplist(data);
  } catch {
    // Corrupt metadata must not abort otherwise recoverable chat history. The
    // previous base64 fallback could multiply a large blob in memory and is not
    // useful to chatStore, so malformed metadata is intentionally omitted.
    return null;
  }
}

function contentMetadataJson(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") output[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") output[key] = String(item);
  }
  return Object.keys(output).length > 0 ? JSON.stringify(output) : null;
}

function addToken(tokens: Set<string>, value: string, minimumLength: number): void {
  if (tokens.size >= MAX_MEDIA_TOKENS_PER_MESSAGE) return;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 1024) return;
  const candidates = [normalized];
  try {
    const url = new URL(normalized);
    candidates.push(decodeURIComponent(url.pathname));
  } catch {
    // IDs and ordinary filesystem paths are expected to be non-URLs.
  }
  for (const candidate of candidates) {
    const name = basename(candidate.replace(/\\/g, "/"));
    const extension = extname(name);
    for (const token of [name, extension ? name.slice(0, -extension.length) : name]) {
      if (tokens.size >= MAX_MEDIA_TOKENS_PER_MESSAGE) return;
      if (
        token.length >= minimumLength &&
        token.length <= 255 &&
        /^[a-z0-9][a-z0-9._:@%+=-]*$/i.test(token)
      ) {
        tokens.add(token);
      }
    }
  }
}

function collectMediaTokens(value: unknown, initial: string): string[] {
  const tokens = new Set<string>();
  // ZMESSAGE.ZID is itself the local media key, so even a short numeric value
  // is meaningful here. Metadata values need a known identity/path key and a
  // stronger minimum length to avoid matching dimensions such as 1080 or 1.
  addToken(tokens, initial, 1);
  const pending: Array<{ key: string; value: unknown }> = [{ key: "", value }];
  while (pending.length > 0 && tokens.size < MAX_MEDIA_TOKENS_PER_MESSAGE) {
    const item = pending.pop();
    if (!item) break;
    if (typeof item.value === "string") {
      const key = item.key.replace(/[^a-z0-9]/gi, "").toUpperCase();
      if (STRONG_MEDIA_METADATA_KEYS.has(key)) addToken(tokens, item.value, 8);
    } else if (Array.isArray(item.value)) {
      for (let index = item.value.length - 1; index >= 0; index--) {
        pending.push({ key: item.key, value: item.value[index] });
      }
    } else if (
      item.value &&
      typeof item.value === "object" &&
      !(item.value instanceof Uint8Array)
    ) {
      for (const [key, nested] of Object.entries(item.value as Record<string, unknown>)) {
        pending.push({ key, value: nested });
      }
    }
  }
  return [...tokens].slice(0, MAX_MEDIA_TOKENS_PER_MESSAGE);
}

async function stageGroupNames(
  source: Database,
  staging: Database,
  batchSize: number,
  onProgress: ParseOptions["onProgress"],
  afterBatch: () => Promise<void>,
): Promise<void> {
  const total = countRows(source, "ZUNIFIEDGROUP");
  const insert = staging.query(`
    INSERT INTO staged_ios_group_names(mid, name)
    VALUES (?, ?)
    ON CONFLICT(mid) DO UPDATE SET name = excluded.name
  `);
  let after: number | bigint = 0n;
  let current = 0;
  onProgress?.({ stage: "groups", current, total, message: "Loading group names..." });
  for (;;) {
    const rows = source
      .query(`
        SELECT rowid AS row_id, ZID AS group_mid, ZNAME AS group_name
        FROM ZUNIFIEDGROUP
        WHERE rowid > ?
        ORDER BY rowid
        LIMIT ?
      `)
      .all(after, batchSize) as GroupRow[];
    if (rows.length === 0) break;
    withTransaction(staging, () => {
      for (const row of rows) {
        const mid = row.group_mid?.trim().toLowerCase();
        if (mid) insert.run(mid, row.group_name?.trim() || mid);
      }
    });
    after = rows[rows.length - 1]!.row_id;
    current += rows.length;
    onProgress?.({ stage: "groups", current, total, message: "Loading group names..." });
    await afterBatch();
    await yieldToEventLoop();
  }
}

async function stageChatRows(
  source: Database,
  staging: Database,
  batchSize: number,
  onProgress: ParseOptions["onProgress"],
  afterBatch: () => Promise<void>,
): Promise<void> {
  const total = countRows(source, "ZCHAT");
  const insert = staging.query(`
    INSERT INTO staged_ios_chat_rows(source_pk, mid, kind, last_updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_pk) DO UPDATE SET
      mid = excluded.mid,
      kind = excluded.kind,
      last_updated = excluded.last_updated
  `);
  let after: number | bigint = 0n;
  let current = 0;
  onProgress?.({ stage: "chats", current, total, message: "Loading chats..." });
  for (;;) {
    const rows = source
      .query(`
        SELECT Z_PK AS chat_pk, ZMID AS chat_mid, ZTYPE AS chat_type,
          ZLASTUPDATED AS last_updated
        FROM ZCHAT
        WHERE Z_PK > ?
        ORDER BY Z_PK
        LIMIT ?
      `)
      .all(after, batchSize) as ChatRow[];
    if (rows.length === 0) break;
    withTransaction(staging, () => {
      for (const row of rows) {
        const mid = chatMid(row);
        insert.run(
          row.chat_pk,
          mid,
          chatKind(mid, Number(row.chat_type)),
          row.last_updated ?? null,
        );
      }
    });
    after = rows[rows.length - 1]!.chat_pk;
    current += rows.length;
    onProgress?.({ stage: "chats", current, total, message: "Loading chats..." });
    await afterBatch();
    await yieldToEventLoop();
  }
}

async function stageMessages(
  source: Database,
  staging: Database,
  myMid: string,
  savedAt: string,
  batchSize: number,
  onProgress: ParseOptions["onProgress"],
  afterBatch: () => Promise<void>,
): Promise<void> {
  const total = countRows(source, "ZMESSAGE");
  const writeMessage = staging.query(`
    INSERT INTO staged_messages (
      id, chat_mid, from_mid, to_mid, text, content_type, created_time,
      is_my_message, content_metadata, read_count, read_by, seen,
      related_message_id, sticker_animated, sticker_sticky, reactions,
      saved_at, message_state, history, revoked_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL)
    ON CONFLICT(chat_mid, id) DO UPDATE SET
      from_mid = excluded.from_mid,
      to_mid = excluded.to_mid,
      text = excluded.text,
      content_type = excluded.content_type,
      created_time = excluded.created_time,
      is_my_message = excluded.is_my_message,
      content_metadata = excluded.content_metadata,
      saved_at = excluded.saved_at
  `);
  const writeMediaRef = staging.query(`
    INSERT INTO staged_media_refs(chat_mid, message_id, local_id, content_type)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_mid, message_id) DO UPDATE SET
      local_id = excluded.local_id,
      content_type = excluded.content_type
  `);
  const writeMediaToken = staging.query(`
    INSERT OR IGNORE INTO staged_ios_media_tokens(chat_mid, message_id, token_lower)
    VALUES (?, ?, ?)
  `);
  const writeMessageOrder = staging.query(`
    INSERT INTO staged_ios_message_order(chat_mid, message_id, source_pk)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_mid, message_id) DO UPDATE SET source_pk = excluded.source_pk
  `);
  let after: number | bigint = 0n;
  let current = 0;
  onProgress?.({ stage: "messages", current, total, message: "Parsing messages..." });
  for (;;) {
    const rows = source
      .query(`
        SELECT
          message.Z_PK AS message_pk,
          message.ZCONTENTTYPE AS content_type,
          message.ZTIMESTAMP AS timestamp,
          message.ZSENDER AS sender_pk,
          message.ZID AS message_id,
          message.ZTEXT AS text,
          message.ZCONTENTMETADATA AS content_metadata,
          chat.Z_PK AS chat_pk,
          chat.ZMID AS chat_mid,
          chat.ZTYPE AS chat_type,
          sender.ZMID AS sender_mid
        FROM ZMESSAGE message
        JOIN ZCHAT chat ON chat.Z_PK = message.ZCHAT
        LEFT JOIN ZUSER sender ON sender.Z_PK = message.ZSENDER
        WHERE message.Z_PK > ?
        ORDER BY message.Z_PK
        LIMIT ?
      `)
      .all(after, batchSize) as MessageRow[];
    if (rows.length === 0) break;
    withTransaction(staging, () => {
      for (const row of rows) {
        const mid = chatMid(row);
        const kind = chatKind(mid, Number(row.chat_type));
        const id = String(row.message_id ?? row.message_pk);
        const resolvedSenderMid = row.sender_mid?.trim();
        const missingReferencedSender = row.sender_pk != null && !resolvedSenderMid;
        const senderMid =
          row.sender_pk == null
            ? myMid
            : resolvedSenderMid ||
              (kind === "direct" ? mid : `unknown:ios:${String(row.sender_pk)}`);
        const isMyMessage = !missingReferencedSender && senderMid === myMid;
        const to = isMyMessage || kind === "group" ? mid : myMid;
        const type = iosContentType(Number(row.content_type));
        const metadata = parseMetadata(row.content_metadata);
        writeMessage.run(
          id,
          mid,
          senderMid,
          to,
          row.text,
          type,
          Number.isFinite(Number(row.timestamp)) ? Number(row.timestamp) : 0,
          isMyMessage ? 1 : 0,
          contentMetadataJson(metadata),
          savedAt,
        );
        writeMessageOrder.run(mid, id, row.message_pk);
        if (MEDIA_CONTENT_TYPES.has(type)) {
          writeMediaRef.run(mid, id, id, type);
          for (const token of collectMediaTokens(metadata, id)) {
            writeMediaToken.run(mid, id, token);
          }
        }
      }
    });
    after = rows[rows.length - 1]!.message_pk;
    current += rows.length;
    onProgress?.({
      stage: "messages",
      current,
      total,
      message: "Parsing messages...",
      ...(rows[rows.length - 1] ? { chatMid: chatMid(rows[rows.length - 1]!) } : {}),
    });
    await afterBatch();
    await yieldToEventLoop();
  }
}

async function finalizeChats(
  staging: Database,
  exportedAt: string,
  batchSize: number,
  onProgress: ParseOptions["onProgress"],
  afterBatch: () => Promise<void>,
): Promise<void> {
  const total = Number(
    (
      staging
        .query(`
          SELECT count(DISTINCT chat.mid) AS count
          FROM staged_ios_chat_rows chat
          WHERE EXISTS (SELECT 1 FROM staged_messages message WHERE message.chat_mid = chat.mid)
        `)
        .get() as { count?: number } | null
    )?.count ?? 0,
  );
  const write = staging.query(`
    INSERT INTO staged_chats (
      mid, name, kind, has_messages, last_message_time, last_message_id,
      last_message_preview, thumbnail_url, unread_count, is_official,
      restored_history, updated_at
    )
    SELECT
      chat.mid,
      coalesce(group_name.name, chat.mid),
      chat.kind,
      1,
      latest.created_time,
      latest.id,
      coalesce(latest.text, '[' || latest.content_type || ']'),
      NULL, NULL, NULL, 1, ?
    FROM staged_ios_chat_rows chat
    LEFT JOIN staged_ios_group_names group_name ON group_name.mid = chat.mid
    JOIN staged_messages latest ON latest.chat_mid = chat.mid
      AND latest.id = (
        SELECT candidate.id
        FROM staged_messages candidate
        JOIN staged_ios_message_order message_order
          ON message_order.chat_mid = candidate.chat_mid
          AND message_order.message_id = candidate.id
        WHERE candidate.chat_mid = chat.mid
        ORDER BY candidate.created_time DESC, message_order.source_pk DESC
        LIMIT 1
      )
    WHERE chat.mid = ?
    ORDER BY chat.last_updated DESC, chat.source_pk DESC
    LIMIT 1
    ON CONFLICT(mid) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      has_messages = excluded.has_messages,
      last_message_time = excluded.last_message_time,
      last_message_id = excluded.last_message_id,
      last_message_preview = excluded.last_message_preview,
      restored_history = excluded.restored_history,
      updated_at = excluded.updated_at
  `);
  let after = "";
  let current = 0;
  onProgress?.({ stage: "finalizing", current, total, message: "Finalizing chats..." });
  for (;;) {
    const rows = staging
      .query(`
        SELECT DISTINCT chat.mid
        FROM staged_ios_chat_rows chat
        WHERE chat.mid > ?
          AND EXISTS (SELECT 1 FROM staged_messages message WHERE message.chat_mid = chat.mid)
        ORDER BY chat.mid
        LIMIT ?
      `)
      .all(after, batchSize) as Array<{ mid: string }>;
    if (rows.length === 0) break;
    withTransaction(staging, () => {
      for (const row of rows) write.run(exportedAt, row.mid);
    });
    after = rows[rows.length - 1]!.mid;
    current += rows.length;
    onProgress?.({ stage: "finalizing", current, total, message: "Finalizing chats..." });
    await afterBatch();
    await yieldToEventLoop();
  }
}

export async function parseLineDatabases(options: ParseOptions): Promise<StagedChatHistory> {
  const { lineDbPath, unifiedGroupDbPath, stagingPath, myMid, onProgress } = options;
  const batchSize = positiveBatchSize(options.batchSize);
  const maxStagingBytes = options.maxStagingBytes ?? DEFAULT_MAX_STAGING_BYTES;
  if (!Number.isSafeInteger(maxStagingBytes) || maxStagingBytes <= 0) {
    throw new Error("maxStagingBytes must be a positive safe integer");
  }
  const exportedAt = new Date().toISOString();
  let lineDb: Database | null = null;
  let groupDb: Database | null = null;
  let staging: Database | null = null;
  try {
    lineDb = new Database(lineDbPath, {
      readonly: true,
      safeIntegers: true,
      strict: true,
    });
    groupDb = new Database(unifiedGroupDbPath, {
      readonly: true,
      safeIntegers: true,
      strict: true,
    });
    staging = initializeStaging(stagingPath);
    const assertStagingLimit = async () => {
      const bytes = await sqliteBundleBytes(stagingPath);
      await options.onWorkBytes?.(bytes);
      if (bytes > maxStagingBytes) {
        throw new Error(`iOS backup staging exceeds the ${maxStagingBytes} byte work limit`);
      }
    };
    configureSourceDatabase(lineDb);
    configureSourceDatabase(groupDb);
    await assertStagingLimit();
    await stageGroupNames(groupDb, staging, batchSize, onProgress, assertStagingLimit);
    await stageChatRows(lineDb, staging, batchSize, onProgress, assertStagingLimit);
    await stageMessages(
      lineDb,
      staging,
      myMid,
      exportedAt,
      batchSize,
      onProgress,
      assertStagingLimit,
    );
    await finalizeChats(staging, exportedAt, batchSize, onProgress, assertStagingLimit);
    const chats = countRows(staging, "staged_chats");
    const totalMessages = countRows(staging, "staged_messages");
    const mediaRefs = countRows(staging, "staged_media_refs");
    staging.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await assertStagingLimit();
    onProgress?.({
      stage: "complete",
      current: chats + totalMessages,
      total: chats + totalMessages,
      message: "Parse complete",
    });
    return { account: myMid, exportedAt, stagingPath, chats, totalMessages, mediaRefs };
  } catch (error) {
    onProgress?.({
      stage: "error",
      current: 0,
      total: 1,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    staging?.close();
    groupDb?.close();
    lineDb?.close();
  }
}

export function findLineDatabases(
  fileIndexPath: string,
): { lineDb: string; unifiedGroupDb: string } | null {
  const db = new Database(fileIndexPath, { readonly: true, strict: true });
  try {
    configureSourceDatabase(db);
    const line = db
      .query(`
        SELECT local_path
        FROM extracted_files
        WHERE is_database = 1
          AND is_directory = 0
          AND basename_lower = 'line.sqlite'
        ORDER BY relative_lower
        LIMIT 1
      `)
      .get() as { local_path: string } | null;
    const groups = db
      .query(`
        SELECT local_path
        FROM extracted_files
        WHERE is_database = 1
          AND is_directory = 0
          AND basename_lower = 'unifiedgroup.sqlite'
        ORDER BY relative_lower
        LIMIT 1
      `)
      .get() as { local_path: string } | null;
    if (!line || !groups) return null;
    return { lineDb: line.local_path, unifiedGroupDb: groups.local_path };
  } finally {
    db.close();
  }
}

export function detectMyMid(lineDbPath: string): string {
  const db = new Database(lineDbPath, { readonly: true, strict: true });
  try {
    configureSourceDatabase(db);
    const row = db
      .query(`
        SELECT ZMID AS mid
        FROM ZUSER
        WHERE ZMID IS NOT NULL
          AND (ZCUSTOMNAME IS NOT NULL OR ZADDRESSBOOKNAME IS NOT NULL)
        ORDER BY Z_PK
        LIMIT 1
      `)
      .get() as { mid: string } | null;
    return row?.mid?.trim() || "";
  } finally {
    db.close();
  }
}
