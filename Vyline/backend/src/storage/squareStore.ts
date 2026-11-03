import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { accountFile } from "./accountDirs.js";

export type SquareEntityKind = "square" | "room" | "member" | "thread" | "note";
export type SquareRoomRecord = { id: string; name?: string; parentSquareId?: string | null };
export type SquareStoredMessage = {
  roomId: string;
  id: string;
  createdAt?: number;
  revision?: number;
  payload: unknown;
};

function serialize(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  if (typeof encoded !== "string") throw new Error("Square data is not serializable");
  return encoded;
}

const stores = new Map<string, SquareStore>();

export class SquareStore {
  private readonly db: Database;
  private generation = 0;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") chmodSync(dirname(path), 0o700);
    }
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS square_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO square_settings (id, enabled, updated_at)
        VALUES (1, 0, CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS square_room_sync_state (
        room_id TEXT PRIMARY KEY,
        sync_cursor TEXT,
        continuation_token TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS square_entities (
        kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        parent_id TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_square_entities_parent
        ON square_entities(kind, parent_id, entity_id);
      CREATE TABLE IF NOT EXISTS square_messages (
        room_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (room_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_square_messages_order
        ON square_messages(room_id, created_at DESC, message_id DESC);
      CREATE TABLE IF NOT EXISTS square_message_tombstones (
        room_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        destroyed_at INTEGER NOT NULL,
        PRIMARY KEY(room_id,message_id)
      );
      CREATE TABLE IF NOT EXISTS square_send_rate (
        room_id TEXT PRIMARY KEY,
        sent_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS square_send_operations (
        operation_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS square_search_rate (
        id INTEGER PRIMARY KEY CHECK (id=1),
        searched_at INTEGER NOT NULL
      );
    `);
    if (path !== ":memory:" && process.platform !== "win32") chmodSync(path, 0o600);
  }

  isEnabled(): boolean {
    const row = this.db.query("SELECT enabled FROM square_settings WHERE id=1").get() as {
      enabled: number;
    };
    return row.enabled === 1;
  }

  setEnabled(enabled: boolean): void {
    this.generation += 1;
    this.db
      .query("UPDATE square_settings SET enabled=?, updated_at=? WHERE id=1")
      .run(enabled ? 1 : 0, new Date().toISOString());
  }

  getGeneration(): number {
    return this.generation;
  }

  isCurrentGeneration(generation: number): boolean {
    return this.generation === generation && this.isEnabled();
  }

  getRoomSyncCursor(roomId: string): string | null {
    const row = this.db
      .query("SELECT sync_cursor FROM square_room_sync_state WHERE room_id=?")
      .get(roomId) as { sync_cursor: string | null } | null;
    return row?.sync_cursor ?? null;
  }

  getRoomContinuationToken(roomId: string): string | null {
    const row = this.db
      .query("SELECT continuation_token FROM square_room_sync_state WHERE room_id=?")
      .get(roomId) as { continuation_token: string | null } | null;
    return row?.continuation_token ?? null;
  }

  setRoomSyncCursor(roomId: string, cursor: string | null): void {
    this.db
      .query(`INSERT INTO square_room_sync_state(room_id,sync_cursor,updated_at)
      VALUES(?,?,?) ON CONFLICT(room_id) DO UPDATE SET
      sync_cursor=excluded.sync_cursor,updated_at=excluded.updated_at`)
      .run(roomId, cursor, new Date().toISOString());
  }

  setRoomSyncState(roomId: string, cursor: string | null, continuationToken: string | null): void {
    this.db
      .query(`INSERT INTO square_room_sync_state(room_id,sync_cursor,continuation_token,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET
      sync_cursor=excluded.sync_cursor,continuation_token=excluded.continuation_token,
      updated_at=excluded.updated_at`)
      .run(roomId, cursor, continuationToken, new Date().toISOString());
  }

  upsertEntity(
    kind: SquareEntityKind,
    id: string,
    payload: unknown,
    parentId?: string | null,
  ): void {
    if (!id || id.length > 512) throw new Error("invalid Square entity id");
    const encoded = serialize(payload);
    this.db
      .query(`INSERT INTO square_entities(kind,entity_id,parent_id,payload,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET
        parent_id=excluded.parent_id, payload=excluded.payload, updated_at=excluded.updated_at`)
      .run(kind, id, parentId ?? null, encoded, new Date().toISOString());
  }

  upsertRoom(room: SquareRoomRecord): void {
    this.upsertEntity("room", room.id, room, room.parentSquareId);
  }

  listEntities<T>(kind: SquareEntityKind, parentId?: string): T[] {
    const rows =
      parentId === undefined
        ? (this.db
            .query("SELECT payload FROM square_entities WHERE kind=? ORDER BY rowid")
            .all(kind) as Array<{ payload: string }>)
        : (this.db
            .query(
              "SELECT payload FROM square_entities WHERE kind=? AND parent_id=? ORDER BY rowid",
            )
            .all(kind, parentId) as Array<{ payload: string }>);
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  listRooms(): SquareRoomRecord[] {
    return this.listEntities<SquareRoomRecord>("room");
  }

  hasRoom(roomId: string): boolean {
    return Boolean(
      this.db.query("SELECT 1 FROM square_entities WHERE kind='room' AND entity_id=?").get(roomId),
    );
  }

  upsertMessages(messages: SquareStoredMessage[]): void {
    if (messages.length > 1000) throw new Error("Square message batch is too large");
    const statement = this.db.query(`INSERT INTO square_messages
      (room_id,message_id,created_at,revision,payload,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(room_id,message_id) DO UPDATE SET
      created_at=excluded.created_at, revision=excluded.revision,
      payload=excluded.payload, updated_at=excluded.updated_at
      WHERE excluded.revision >= square_messages.revision
      AND NOT EXISTS (SELECT 1 FROM square_message_tombstones t
        WHERE t.room_id=excluded.room_id AND t.message_id=excluded.message_id)`);
    const tx = this.db.transaction(() => {
      for (const message of messages) {
        if (!message.roomId || !message.id || message.id.length > 512) {
          throw new Error("invalid Square message identity");
        }
        const payload = serialize(message.payload);
        const tombstoned = this.db
          .query(`SELECT 1 FROM square_message_tombstones
          WHERE room_id=? AND message_id=?`)
          .get(message.roomId, message.id);
        if (tombstoned) continue;
        const createdAt =
          typeof message.createdAt === "number" && Number.isFinite(message.createdAt)
            ? message.createdAt
            : 0;
        const revision =
          typeof message.revision === "number" && Number.isFinite(message.revision)
            ? message.revision
            : 0;
        statement.run(
          message.roomId,
          message.id,
          createdAt,
          revision,
          payload,
          new Date().toISOString(),
        );
      }
    });
    tx.immediate();
  }

  listMessages<T>(roomId: string, limit = 50, before?: { createdAt: number; id: string }): T[] {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const rows = before
      ? (this.db
          .query(`SELECT payload FROM square_messages WHERE room_id=?
          AND (created_at < ? OR (created_at = ? AND message_id < ?))
          ORDER BY created_at DESC, message_id DESC LIMIT ?`)
          .all(roomId, before.createdAt, before.createdAt, before.id, boundedLimit) as Array<{
          payload: string;
        }>)
      : (this.db
          .query(`SELECT payload FROM square_messages WHERE room_id=?
          ORDER BY created_at DESC, message_id DESC LIMIT ?`)
          .all(roomId, boundedLimit) as Array<{ payload: string }>);
    return rows.map((row) => JSON.parse(row.payload) as T).reverse();
  }

  clearCache(): void {
    const tx = this.db.transaction(() => {
      this.db.exec(`DELETE FROM square_messages;
        DELETE FROM square_message_tombstones;
        DELETE FROM square_entities; DELETE FROM square_room_sync_state;`);
    });
    tx.immediate();
  }

  reserveRoomSend(
    roomId: string,
    operationId: string,
    now: number,
    cooldownMs: number,
  ):
    | { status: "reserved" }
    | { status: "duplicate" }
    | { status: "cooldown"; retryAfterMs: number } {
    const tx = this.db.transaction(() => {
      const duplicate = this.db
        .query("SELECT operation_id FROM square_send_operations WHERE operation_id=?")
        .get(operationId);
      if (duplicate) return { status: "duplicate" as const };
      const previous = this.db
        .query("SELECT sent_at FROM square_send_rate WHERE room_id=?")
        .get(roomId) as { sent_at: number } | null;
      const retryAfterMs = previous ? cooldownMs - (now - previous.sent_at) : 0;
      if (retryAfterMs > 0) return { status: "cooldown" as const, retryAfterMs };
      this.db
        .query(`INSERT INTO square_send_rate(room_id,sent_at) VALUES(?,?)
        ON CONFLICT(room_id) DO UPDATE SET sent_at=excluded.sent_at`)
        .run(roomId, now);
      this.db
        .query("INSERT INTO square_send_operations(operation_id,room_id,created_at) VALUES(?,?,?)")
        .run(operationId, roomId, now);
      this.db
        .query("DELETE FROM square_send_operations WHERE created_at < ?")
        .run(now - 30 * 24 * 60 * 60 * 1000);
      return { status: "reserved" as const };
    });
    return tx.immediate();
  }

  reserveSquareSearch(now: number, minimumIntervalMs: number): number {
    const tx = this.db.transaction(() => {
      const previous = this.db
        .query("SELECT searched_at FROM square_search_rate WHERE id=1")
        .get() as { searched_at: number } | null;
      const retryAfterMs = previous ? minimumIntervalMs - (now - previous.searched_at) : 0;
      if (retryAfterMs > 0) return retryAfterMs;
      this.db
        .query(`INSERT INTO square_search_rate(id,searched_at) VALUES(1,?)
        ON CONFLICT(id) DO UPDATE SET searched_at=excluded.searched_at`)
        .run(now);
      return 0;
    });
    return tx.immediate();
  }

  markMessageDestroyed(roomId: string, messageId: string, destroyedAt = Date.now()): void {
    if (!roomId || !messageId || messageId.length > 512)
      throw new Error("invalid Square tombstone identity");
    const tx = this.db.transaction(() => {
      this.db
        .query(`INSERT INTO square_message_tombstones(room_id,message_id,destroyed_at)
        VALUES(?,?,?) ON CONFLICT(room_id,message_id) DO UPDATE SET
        destroyed_at=MAX(square_message_tombstones.destroyed_at,excluded.destroyed_at)`)
        .run(roomId, messageId, destroyedAt);
      this.db
        .query("DELETE FROM square_messages WHERE room_id=? AND message_id=?")
        .run(roomId, messageId);
    });
    tx.immediate();
  }

  close(): void {
    this.db.close(true);
  }
}

export function getSquareStore(accountId: string): SquareStore {
  let store = stores.get(accountId);
  if (!store) {
    store = new SquareStore(accountFile(accountId, "square.sqlite"));
    stores.set(accountId, store);
  }
  return store;
}

export function closeSquareStore(accountId: string): void {
  stores.get(accountId)?.close();
  stores.delete(accountId);
}
