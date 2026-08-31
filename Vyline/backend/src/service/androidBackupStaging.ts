import { Database } from "bun:sqlite";
import type { Message, MessageReaction, MessageSnapshot } from "@vyline/types";
import type { StoredChat, StoredMessage } from "../storage/chatStore.js";

export interface AndroidChatSeed {
  chatName: string;
  messageCount: number;
  readMessageCount: number;
  type: number;
}

export interface UnsupportedAndroidReaction {
  fromMid: string;
  atMillis: number;
  reactionType: string;
  customReaction: string;
}

export interface StagedAndroidReaction {
  messageId: string;
  supported: MessageReaction | null;
  unsupported: UnsupportedAndroidReaction | null;
}

export interface StagedAndroidMessage {
  message: StoredMessage;
  localId: string;
  mediaContentType: string | null;
}

export interface StagedMediaRef {
  chatMid: string;
  messageId: string;
  localId: string;
  contentType: string;
}

export interface PlannedAndroidMedia extends StagedMediaRef {
  path: string;
  sizeBytes: number;
}

interface MediaCursor {
  chatMid: string;
  messageId: string;
}

interface MessageRow {
  id: string;
  chat_mid: string;
  from_mid: string;
  to_mid: string;
  text: string | null;
  content_type: string;
  created_time: number;
  is_my_message: number;
  content_metadata: string | null;
  read_count: number | null;
  read_by: string | null;
  seen: number | null;
  related_message_id: string | null;
  sticker_animated: number | null;
  sticker_sticky: number | null;
  reactions: string | null;
  saved_at: string;
  message_state: string | null;
  history: string | null;
  revoked_snapshot: string | null;
}

const MESSAGE_COLUMNS = `
  id, chat_mid, from_mid, to_mid, text, content_type, created_time,
  is_my_message, content_metadata, read_count, read_by, seen,
  related_message_id, sticker_animated, sticker_sticky, reactions,
  saved_at, message_state, history, revoked_snapshot
`;

function withTransaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function boolOrNull(value: boolean | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

function fromMessageRow(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    chatMid: row.chat_mid,
    from: row.from_mid,
    to: row.to_mid,
    text: row.text,
    contentType: row.content_type,
    createdTime: row.created_time,
    isMyMessage: row.is_my_message !== 0,
    ...(row.content_metadata != null
      ? { contentMetadata: parseJson(row.content_metadata) ?? null }
      : {}),
    ...(row.read_count != null ? { readCount: row.read_count } : {}),
    ...(row.read_by != null ? { readBy: parseJson<string[]>(row.read_by) ?? [] } : {}),
    ...(row.seen != null ? { seen: row.seen !== 0 } : {}),
    ...(row.related_message_id != null ? { relatedMessageId: row.related_message_id } : {}),
    ...(row.sticker_animated != null ? { stickerAnimated: row.sticker_animated !== 0 } : {}),
    ...(row.sticker_sticky != null ? { stickerSticky: row.sticker_sticky !== 0 } : {}),
    ...(row.reactions != null
      ? { reactions: parseJson<StoredMessage["reactions"]>(row.reactions) ?? [] }
      : {}),
    savedAt: row.saved_at,
    ...(row.message_state != null
      ? { messageState: row.message_state as Message["messageState"] }
      : {}),
    ...(row.history != null ? { history: parseJson<Message["history"]>(row.history) } : {}),
    ...(row.revoked_snapshot != null
      ? { revokedSnapshot: parseJson<MessageSnapshot>(row.revoked_snapshot) }
      : {}),
  };
}

/**
 * Disk-backed intermediate store for Android imports. The two core staging
 * tables mirror chatStore's normalized schema, allowing a set-based ATTACH
 * merge without materializing StoredChat/StoredMessage JSON rows.
 */
export class AndroidBackupStaging {
  readonly path: string;
  private readonly db: Database;

  constructor(path: string) {
    this.path = path;
    this.db = new Database(path, { create: true, strict: true });
    this.initialize();
  }

  private initialize(): void {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA wal_autocheckpoint = 256");
    this.db.exec("PRAGMA journal_size_limit = 8388608");
    this.db.exec("PRAGMA cache_size = -2048");
    this.db.exec("PRAGMA mmap_size = 0");
    this.db.exec("PRAGMA temp_store = FILE");
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS staged_android_chat_rows (
        mid TEXT PRIMARY KEY,
        chat_name TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        read_message_count INTEGER NOT NULL,
        chat_type INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staged_android_names (
        mid TEXT NOT NULL,
        priority INTEGER NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (mid, priority)
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS staged_android_reactions (
        seq INTEGER PRIMARY KEY,
        message_id TEXT NOT NULL,
        from_mid TEXT NOT NULL,
        at_millis INTEGER NOT NULL,
        reaction_type INTEGER,
        unsupported_reaction_type TEXT,
        custom_reaction TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_staged_android_reactions_message
        ON staged_android_reactions (message_id, seq);

      CREATE TABLE IF NOT EXISTS staged_media_plan (
        chat_mid TEXT NOT NULL,
        message_id TEXT NOT NULL,
        local_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        source_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        PRIMARY KEY (chat_mid, message_id)
      ) WITHOUT ROWID;
    `);
  }

  setMeta(key: string, value: string | number): void {
    this.db
      .query(
        "INSERT INTO staged_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, String(value));
  }

  getMetaNumber(key: string): number {
    const row = this.db.query("SELECT value FROM staged_meta WHERE key = ?").get(key) as {
      value: string;
    } | null;
    const value = Number(row?.value ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  writeNames(rows: Array<{ mid: string; name: string; priority: number }>): void {
    if (rows.length === 0) return;
    const statement = this.db.query(`
      INSERT INTO staged_android_names(mid, priority, name) VALUES (?, ?, ?)
      ON CONFLICT(mid, priority) DO UPDATE SET name = excluded.name
    `);
    withTransaction(this.db, () => {
      for (const row of rows) statement.run(row.mid, row.priority, row.name);
    });
  }

  writeChatSeeds(rows: Array<{ mid: string; seed: AndroidChatSeed }>): void {
    if (rows.length === 0) return;
    const statement = this.db.query(`
      INSERT INTO staged_android_chat_rows(
        mid, chat_name, message_count, read_message_count, chat_type
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(mid) DO UPDATE SET
        chat_name = excluded.chat_name,
        message_count = excluded.message_count,
        read_message_count = excluded.read_message_count,
        chat_type = excluded.chat_type
    `);
    withTransaction(this.db, () => {
      for (const { mid, seed } of rows) {
        statement.run(mid, seed.chatName, seed.messageCount, seed.readMessageCount, seed.type);
      }
    });
  }

  writeReactions(rows: StagedAndroidReaction[]): void {
    if (rows.length === 0) return;
    const statement = this.db.query(`
      INSERT INTO staged_android_reactions(
        message_id, from_mid, at_millis, reaction_type,
        unsupported_reaction_type, custom_reaction
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    withTransaction(this.db, () => {
      for (const row of rows) {
        const reaction = row.supported ?? row.unsupported;
        if (!reaction) continue;
        statement.run(
          row.messageId,
          reaction.fromMid,
          reaction.atMillis,
          row.supported?.type ?? null,
          row.unsupported?.reactionType ?? null,
          row.unsupported?.customReaction ?? null,
        );
      }
    });
  }

  reactionsForMessages(
    messageIds: string[],
  ): Map<string, { supported: MessageReaction[]; unsupported: UnsupportedAndroidReaction[] }> {
    const uniqueIds = [...new Set(messageIds.filter(Boolean))];
    const byMessage = new Map<
      string,
      { supported: MessageReaction[]; unsupported: UnsupportedAndroidReaction[] }
    >();
    if (uniqueIds.length === 0) return byMessage;
    const placeholders = uniqueIds.map(() => "?").join(",");
    const rows = this.db
      .query(`
        SELECT message_id, from_mid, at_millis, reaction_type,
          unsupported_reaction_type, custom_reaction
        FROM staged_android_reactions
        WHERE message_id IN (${placeholders})
        ORDER BY message_id, seq
      `)
      .all(...uniqueIds) as Array<{
      message_id: string;
      from_mid: string;
      at_millis: number;
      reaction_type: number | null;
      unsupported_reaction_type: string | null;
      custom_reaction: string | null;
    }>;
    for (const row of rows) {
      const entry = byMessage.get(row.message_id) ?? { supported: [], unsupported: [] };
      if (row.reaction_type != null) {
        entry.supported.push({
          fromMid: row.from_mid,
          atMillis: row.at_millis,
          type: row.reaction_type,
        });
      } else {
        entry.unsupported.push({
          fromMid: row.from_mid,
          atMillis: row.at_millis,
          reactionType: row.unsupported_reaction_type ?? "",
          customReaction: row.custom_reaction ?? "",
        });
      }
      byMessage.set(row.message_id, entry);
    }
    return byMessage;
  }

  writeMessages(
    rows: StagedAndroidMessage[],
    mergeDuplicate: (previous: StoredMessage | undefined, incoming: StoredMessage) => StoredMessage,
  ): void {
    if (rows.length === 0) return;
    const read = this.db.query(
      `SELECT ${MESSAGE_COLUMNS} FROM staged_messages WHERE chat_mid = ? AND id = ?`,
    );
    const insert = this.db.query(`
      INSERT INTO staged_messages (
        id, chat_mid, from_mid, to_mid, text, content_type, created_time,
        is_my_message, content_metadata, read_count, read_by, seen,
        related_message_id, sticker_animated, sticker_sticky, reactions,
        saved_at, message_state, history, revoked_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_mid, id) DO NOTHING
    `);
    const write = this.db.query(`
      INSERT INTO staged_messages (
        id, chat_mid, from_mid, to_mid, text, content_type, created_time,
        is_my_message, content_metadata, read_count, read_by, seen,
        related_message_id, sticker_animated, sticker_sticky, reactions,
        saved_at, message_state, history, revoked_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_mid, id) DO UPDATE SET
        from_mid = excluded.from_mid,
        to_mid = excluded.to_mid,
        text = excluded.text,
        content_type = excluded.content_type,
        created_time = excluded.created_time,
        is_my_message = excluded.is_my_message,
        content_metadata = excluded.content_metadata,
        read_count = excluded.read_count,
        read_by = excluded.read_by,
        seen = excluded.seen,
        related_message_id = excluded.related_message_id,
        sticker_animated = excluded.sticker_animated,
        sticker_sticky = excluded.sticker_sticky,
        reactions = excluded.reactions,
        saved_at = excluded.saved_at,
        message_state = excluded.message_state,
        history = excluded.history,
        revoked_snapshot = excluded.revoked_snapshot
    `);
    const values = (message: StoredMessage): Array<string | number | null> => [
      message.id,
      message.chatMid,
      message.from,
      message.to,
      message.text,
      message.contentType,
      message.createdTime,
      message.isMyMessage ? 1 : 0,
      jsonOrNull(message.contentMetadata),
      message.readCount ?? null,
      jsonOrNull(message.readBy),
      boolOrNull(message.seen),
      message.relatedMessageId ?? null,
      boolOrNull(message.stickerAnimated),
      boolOrNull(message.stickerSticky),
      jsonOrNull(message.reactions),
      message.savedAt,
      message.messageState ?? null,
      jsonOrNull(message.history),
      jsonOrNull(message.revokedSnapshot),
    ];
    const media = this.db.query(`
      INSERT INTO staged_media_refs(chat_mid, message_id, local_id, content_type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_mid, message_id) DO UPDATE SET
        local_id = excluded.local_id,
        content_type = excluded.content_type
    `);
    withTransaction(this.db, () => {
      for (const row of rows) {
        let merged = row.message;
        const inserted = insert.run(...values(row.message));
        if (Number(inserted.changes) === 0) {
          const previousRow = read.get(row.message.chatMid, row.message.id) as MessageRow | null;
          merged = mergeDuplicate(
            previousRow ? fromMessageRow(previousRow) : undefined,
            row.message,
          );
          write.run(...values(merged));
        }
        if (row.mediaContentType) {
          media.run(merged.chatMid, merged.id, row.localId, row.mediaContentType);
        }
      }
    });
  }

  chatMidPage(afterMid: string, limit: number): string[] {
    const rows = this.db
      .query(`
        SELECT mid FROM (
          SELECT mid FROM staged_android_chat_rows
          UNION
          SELECT chat_mid AS mid FROM staged_messages
        )
        WHERE mid > ?
        ORDER BY mid
        LIMIT ?
      `)
      .all(afterMid, limit) as Array<{ mid: string }>;
    return rows.map((row) => row.mid);
  }

  chatCandidateCount(): number {
    const row = this.db
      .query(`
        SELECT count(*) AS count FROM (
          SELECT mid FROM staged_android_chat_rows
          UNION
          SELECT chat_mid AS mid FROM staged_messages
        )
      `)
      .get() as { count: number };
    return Number(row.count);
  }

  chatSeed(mid: string): AndroidChatSeed | null {
    const row = this.db
      .query(`
        SELECT chat_name, message_count, read_message_count, chat_type
        FROM staged_android_chat_rows WHERE mid = ?
      `)
      .get(mid) as {
      chat_name: string;
      message_count: number;
      read_message_count: number;
      chat_type: number;
    } | null;
    return row
      ? {
          chatName: row.chat_name,
          messageCount: row.message_count,
          readMessageCount: row.read_message_count,
          type: row.chat_type,
        }
      : null;
  }

  displayName(mid: string): string | null {
    const row = this.db
      .query("SELECT name FROM staged_android_names WHERE mid = ? ORDER BY priority LIMIT 1")
      .get(mid) as { name: string } | null;
    return row?.name ?? null;
  }

  messageCount(mid: string): number {
    const row = this.db
      .query("SELECT count(*) AS count FROM staged_messages WHERE chat_mid = ?")
      .get(mid) as { count: number };
    return Number(row.count);
  }

  latestMessage(mid: string): StoredMessage | null {
    const row = this.db
      .query(`
        SELECT ${MESSAGE_COLUMNS}
        FROM staged_messages
        WHERE chat_mid = ?
        ORDER BY created_time DESC,
          CASE WHEN id NOT GLOB '*[^0-9]*' THEN length(id) ELSE 0 END DESC,
          id DESC
        LIMIT 1
      `)
      .get(mid) as MessageRow | null;
    return row ? fromMessageRow(row) : null;
  }

  writeChats(chats: StoredChat[]): void {
    if (chats.length === 0) return;
    const write = this.db.query(`
      INSERT INTO staged_chats (
        mid, name, kind, has_messages, last_message_time, last_message_id,
        last_message_preview, thumbnail_url, unread_count, is_official,
        restored_history, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mid) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        has_messages = excluded.has_messages,
        last_message_time = excluded.last_message_time,
        last_message_id = excluded.last_message_id,
        last_message_preview = excluded.last_message_preview,
        thumbnail_url = excluded.thumbnail_url,
        unread_count = excluded.unread_count,
        is_official = excluded.is_official,
        restored_history = excluded.restored_history,
        updated_at = excluded.updated_at
    `);
    withTransaction(this.db, () => {
      for (const chat of chats) {
        write.run(
          chat.mid,
          chat.name,
          chat.kind,
          chat.hasMessages ? 1 : 0,
          chat.lastMessageTime ?? null,
          chat.lastMessageId ?? null,
          chat.lastMessagePreview ?? null,
          chat.thumbnailUrl ?? null,
          chat.unreadCount ?? null,
          boolOrNull(chat.isOfficial),
          boolOrNull(chat.restoredHistory),
          chat.updatedAt,
        );
      }
    });
  }

  counts(): { chats: number; messages: number; mediaRefs: number } {
    const row = this.db
      .query(`
        SELECT
          (SELECT count(*) FROM staged_chats) AS chats,
          (SELECT count(*) FROM staged_messages) AS messages,
          (SELECT count(*) FROM staged_media_refs) AS mediaRefs
      `)
      .get() as { chats: number; messages: number; mediaRefs: number };
    return {
      chats: Number(row.chats),
      messages: Number(row.messages),
      mediaRefs: Number(row.mediaRefs),
    };
  }

  restoredChatMids(): string[] {
    const mids: string[] = [];
    const rows = this.db
      .query(`
      SELECT mid
      FROM staged_chats
      WHERE has_messages = 1
      ORDER BY coalesce(last_message_time, 0) DESC, mid
    `)
      .iterate() as IterableIterator<{ mid: string }>;
    for (const row of rows) mids.push(row.mid);
    return mids;
  }

  mediaRefPage(cursor: MediaCursor | null, limit: number): StagedMediaRef[] {
    const afterChat = cursor?.chatMid ?? "";
    const afterMessage = cursor?.messageId ?? "";
    const rows = this.db
      .query(`
        SELECT chat_mid, message_id, local_id, content_type
        FROM staged_media_refs
        WHERE chat_mid > ? OR (chat_mid = ? AND message_id > ?)
        ORDER BY chat_mid, message_id
        LIMIT ?
      `)
      .all(afterChat, afterChat, afterMessage, limit) as Array<{
      chat_mid: string;
      message_id: string;
      local_id: string;
      content_type: string;
    }>;
    return rows.map((row) => ({
      chatMid: row.chat_mid,
      messageId: row.message_id,
      localId: row.local_id,
      contentType: row.content_type,
    }));
  }

  writeMediaPlan(rows: PlannedAndroidMedia[]): void {
    if (rows.length === 0) return;
    const statement = this.db.query(`
      INSERT INTO staged_media_plan(
        chat_mid, message_id, local_id, content_type, source_path, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_mid, message_id) DO UPDATE SET
        local_id = excluded.local_id,
        content_type = excluded.content_type,
        source_path = excluded.source_path,
        size_bytes = excluded.size_bytes
    `);
    withTransaction(this.db, () => {
      for (const row of rows) {
        statement.run(
          row.chatMid,
          row.messageId,
          row.localId,
          row.contentType,
          row.path,
          row.sizeBytes,
        );
      }
    });
  }

  mediaPlanPage(cursor: MediaCursor | null, limit: number): PlannedAndroidMedia[] {
    const afterChat = cursor?.chatMid ?? "";
    const afterMessage = cursor?.messageId ?? "";
    const rows = this.db
      .query(`
        SELECT chat_mid, message_id, local_id, content_type, source_path, size_bytes
        FROM staged_media_plan
        WHERE chat_mid > ? OR (chat_mid = ? AND message_id > ?)
        ORDER BY chat_mid, message_id
        LIMIT ?
      `)
      .all(afterChat, afterChat, afterMessage, limit) as Array<{
      chat_mid: string;
      message_id: string;
      local_id: string;
      content_type: string;
      source_path: string;
      size_bytes: number;
    }>;
    return rows.map((row) => ({
      chatMid: row.chat_mid,
      messageId: row.message_id,
      localId: row.local_id,
      contentType: row.content_type,
      path: row.source_path,
      sizeBytes: Number(row.size_bytes),
    }));
  }

  mediaPlanStats(): { count: number; sizeBytes: number } {
    const row = this.db
      .query(
        "SELECT count(*) AS count, coalesce(sum(size_bytes), 0) AS sizeBytes FROM staged_media_plan",
      )
      .get() as { count: number; sizeBytes: number };
    return { count: Number(row.count), sizeBytes: Number(row.sizeBytes) };
  }

  checkpoint(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    this.db.close();
  }
}
