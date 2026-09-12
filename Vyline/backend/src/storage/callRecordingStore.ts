import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import type { CallRecording, RecordingKind } from "@vyline/types";
import { VYLINE_STORAGE_DIR } from "./vylineStorageInfo.js";

export const RECORDING_CHUNK_BYTES = 512 * 1024;
export const RECORDING_MAX_BYTES = 2 * 1024 ** 3;
export const RECORDING_IDLE_MS = 2 * 60_000;
const MIME = new Set([
  "audio/webm;codecs=opus",
  "audio/webm",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "audio/mp4",
  "video/mp4",
]);
type Start = {
  sessionId: string;
  chatMid: string;
  title: string;
  kind: RecordingKind;
  mimeType: string;
  retentionDays: number;
};
type Stored = CallRecording & { owner: string; localPath: string; lastCallAt: number };
export class RecordingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 | 429 | 507 = 400,
  ) {
    super(message);
  }
}
const publicRow = ({
  owner: _owner,
  localPath: _path,
  lastCallAt: _lastCall,
  ...row
}: Stored): CallRecording => row;
function assertId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
    throw new RecordingError("記録が見つかりません", 404);
}
async function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** A small durable index; media stays on disk. Each mutation is serialized per recording. */
export class CallRecordingStore {
  readonly db: Database;
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const path = join(root, "index.sqlite");
    this.db = new Database(path, { create: true, strict: true });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA cache_size = -2048;
      CREATE TABLE IF NOT EXISTS recordings(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS recording_owner ON recordings(owner, created_at DESC, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS recording_active ON recordings(owner) WHERE state = 'recording';`);
  }
  close() {
    this.db.close();
  }
  private write(row: Stored) {
    this.db
      .query("UPDATE recordings SET state = ?, data = ? WHERE id = ? AND owner = ?")
      .run(row.state, JSON.stringify(row), row.id, row.owner);
  }
  private row(owner: string, id: string): Stored {
    assertId(id);
    const value = this.db
      .query("SELECT data FROM recordings WHERE id = ? AND owner = ?")
      .get(id, owner) as { data: string } | null;
    if (!value) throw new RecordingError("記録が見つかりません", 404);
    return JSON.parse(value.data);
  }
  async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  get(owner: string, id: string): CallRecording {
    return publicRow(this.row(owner, id));
  }
  file(owner: string, id: string): string {
    return this.row(owner, id).localPath;
  }
  list(owner: string, cursor?: string) {
    let before = Number.MAX_SAFE_INTEGER;
    let beforeId = "~";
    if (cursor) {
      const row = this.row(owner, cursor);
      before = row.createdAt;
      beforeId = row.id;
    }
    const rows = this.db
      .query(
        "SELECT data FROM recordings WHERE owner = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 51",
      )
      .all(owner, before, before, beforeId) as { data: string }[];
    return {
      items: rows.slice(0, 50).map((row) => publicRow(JSON.parse(row.data))),
      nextCursor: rows.length > 50 ? (JSON.parse(rows[49]!.data) as Stored).id : null,
    };
  }
  usage(owner: string) {
    return this.db
      .query(`SELECT COALESCE(SUM(json_extract(data, '$.bytes')), 0) AS recordingBytes,
      COALESCE(SUM(CASE WHEN state = 'recording' THEN json_extract(data, '$.maxBytes') - json_extract(data, '$.bytes') ELSE 0 END), 0) AS recordingReservedBytes FROM recordings WHERE owner = ?`)
      .get(owner) as { recordingBytes: number; recordingReservedBytes: number };
  }
  async create(
    owner: string,
    input: Start,
    maxBytes: number,
    target?: { id: string; directory?: string },
    now = Date.now(),
  ): Promise<CallRecording> {
    if (
      !MIME.has(input.mimeType) ||
      !input.mimeType.startsWith(`${input.kind}/`) ||
      !["audio", "video"].includes(input.kind)
    )
      throw new RecordingError("対応していない記録形式です");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > RECORDING_MAX_BYTES)
      throw new RecordingError("録画の保存容量が不足しています", 507);
    if (
      !Number.isInteger(input.retentionDays) ||
      input.retentionDays < 0 ||
      input.retentionDays > 3650 ||
      !input.sessionId ||
      input.sessionId.length > 128 ||
      !/^[ucr][0-9a-f]{32}$/.test(input.chatMid) ||
      typeof input.title !== "string" ||
      input.title.length > 200
    )
      throw new RecordingError("記録の開始条件が正しくありません");
    return this.locked(`owner:${owner}`, async () => {
      if (
        this.db.query("SELECT 1 FROM recordings WHERE owner = ? AND state = 'recording'").get(owner)
      )
        throw new RecordingError("このアカウントは既に記録中です", 409);
      const base = resolve(target?.directory ?? this.root);
      await mkdir(base, { recursive: true, mode: 0o700 });
      if ((await realpath(base)) !== base)
        throw new RecordingError("保存先のリンクは使用できません");
      const directory = join(base, createHash("sha256").update(owner).digest("hex"));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await lstat(directory)).isSymbolicLink() || (await realpath(directory)) !== directory)
        throw new RecordingError("保存先のリンクは使用できません");
      // Persist the new owner-directory entry before any file can be acknowledged.
      await syncDirectory(base);
      const id = randomUUID();
      const path = join(directory, `${id}.${input.mimeType.includes("mp4") ? "mp4" : "webm"}`);
      try {
        const file = await open(path, "wx", 0o600);
        try {
          await file.sync();
        } finally {
          await file.close();
        }
        await syncDirectory(directory);
        const row: Stored = {
          id,
          owner,
          localPath: path,
          lastCallAt: now,
          sessionId: input.sessionId,
          chatMid: input.chatMid,
          title: input.title,
          kind: input.kind,
          mimeType: input.mimeType,
          state: "recording",
          bytes: 0,
          maxBytes,
          durationMs: 0,
          createdAt: now,
          updatedAt: now,
          expiresAt: input.retentionDays ? now + input.retentionDays * 86400000 : null,
          targetId: target?.id ?? null,
          transfer: target && !target.directory ? "pending" : null,
        };
        this.db
          .query("INSERT INTO recordings VALUES (?, ?, ?, ?, ?)")
          .run(id, owner, row.state, now, JSON.stringify(row));
        return publicRow(row);
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      } finally {
        /* file creation is already atomic */
      }
    });
  }
  private async openFile(row: Stored) {
    if (
      (await realpath(row.localPath)) !== resolve(row.localPath) ||
      (await lstat(row.localPath)).isSymbolicLink()
    )
      throw new RecordingError("記録ファイルの場所が変わっています", 409);
    return open(row.localPath, "r+");
  }
  async append(
    owner: string,
    id: string,
    offset: number,
    bytes: Uint8Array,
    callActive = true,
  ): Promise<CallRecording> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      bytes.length < 1 ||
      bytes.length > RECORDING_CHUNK_BYTES
    )
      throw new RecordingError("記録チャンクの範囲が正しくありません", 413);
    return this.locked(id, async () => {
      const row = this.row(owner, id);
      if (row.state !== "recording" || offset > row.bytes)
        throw new RecordingError("記録の順序または状態が変わっています", 409);
      if (!callActive && Date.now() - row.lastCallAt > RECORDING_IDLE_MS)
        throw new RecordingError("通話終了後の保存猶予を過ぎています", 409);
      if (offset + bytes.length > row.maxBytes)
        throw new RecordingError("記録の保存上限に達しました", 507);
      const file = await this.openFile(row);
      try {
        const actual = (await file.stat()).size;
        if (actual < row.bytes) throw new RecordingError("保存済みの記録が欠けています", 409);
        if (actual > row.bytes) {
          await file.truncate(row.bytes);
          await file.sync();
        }
        if (offset < row.bytes) {
          if (offset + bytes.length > row.bytes)
            throw new RecordingError("再送チャンクの範囲が重なっています", 409);
          const existing = Buffer.alloc(bytes.length);
          const read = await file.read(existing, 0, existing.length, offset);
          if (read.bytesRead !== bytes.length || !existing.equals(Buffer.from(bytes)))
            throw new RecordingError("再送チャンクの内容が一致しません", 409);
          return publicRow(row);
        }
        let written = 0;
        while (written < bytes.length) {
          const result = await file.write(bytes, written, bytes.length - written, offset + written);
          if (result.bytesWritten === 0) throw new RecordingError("記録を書き込めません", 507);
          written += result.bytesWritten;
        }
        await file.sync();
        row.bytes += bytes.length;
        row.updatedAt = Date.now();
        if (callActive) row.lastCallAt = row.updatedAt;
        this.write(row);
        return publicRow(row);
      } finally {
        await file.close();
      }
    });
  }
  async finish(
    owner: string,
    id: string,
    durationMs: number,
    interrupted = false,
    staleBefore?: number,
  ): Promise<CallRecording> {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 7 * 86400000)
      throw new RecordingError("記録時間が正しくありません");
    return this.locked(id, async () => {
      let wasInterrupted = interrupted;
      const row = this.row(owner, id);
      if (row.state !== "recording") return publicRow(row);
      if (staleBefore !== undefined && row.updatedAt >= staleBefore) return publicRow(row);
      try {
        const file = await this.openFile(row);
        try {
          const actual = (await file.stat()).size;
          if (actual < row.bytes) {
            wasInterrupted = true;
            row.error = "保存済みデータの一部が欠けています";
          } else if (actual > row.bytes) await file.truncate(row.bytes);
          await file.sync();
        } finally {
          await file.close();
        }
      } catch (error) {
        if (staleBefore === undefined) throw error;
        wasInterrupted = true;
        row.error = "記録ファイルを回復できませんでした";
      }
      row.state = wasInterrupted || row.bytes === 0 ? "interrupted" : "ready";
      row.durationMs = durationMs;
      row.updatedAt = Date.now();
      this.write(row);
      return publicRow(row);
    });
  }
  async remove(owner: string, id: string, removeExternal?: (row: CallRecording) => Promise<void>) {
    assertId(id);
    return this.locked(id, async () => {
      let row: Stored;
      try {
        row = this.row(owner, id);
      } catch (error) {
        if (error instanceof RecordingError && error.status === 404) return;
        throw error;
      }
      if (row.transfer && removeExternal) await removeExternal(publicRow(row));
      else if (row.transfer) throw new RecordingError("外部保存先からの削除が必要です", 409);
      // Delete the index last: a failed unlink remains discoverable and retryable.
      await rm(row.localPath, { force: true });
      this.db.query("DELETE FROM recordings WHERE id = ? AND owner = ?").run(id, owner);
    });
  }
  async transfer(
    owner: string,
    id: string,
    upload: (path: string, row: CallRecording) => Promise<void>,
  ) {
    return this.locked(id, async () => {
      const row = this.row(owner, id);
      if (!row.transfer || row.transfer === "complete") return publicRow(row);
      if (row.state === "recording" || !row.bytes)
        throw new RecordingError("記録を停止してから転送してください", 409);
      row.transfer = "pending";
      this.write(row);
      try {
        const file = await this.openFile(row);
        await file.close();
        await upload(row.localPath, publicRow(row));
        row.transfer = "complete";
        this.write(row);
      } catch {
        row.transfer = "error";
        this.write(row);
        throw new RecordingError(
          "WebDAVへの転送を確認できません。サーバー内の記録は保持されています",
          409,
        );
      }
      await rm(row.localPath, { force: true });
      return publicRow(row);
    });
  }
  async checkedFile(owner: string, id: string) {
    const row = this.row(owner, id);
    const file = await this.openFile(row);
    try {
      return { path: row.localPath, size: Math.min(row.bytes, (await file.stat()).size) };
    } finally {
      await file.close();
    }
  }
  async recover(staleBefore = Number.MAX_SAFE_INTEGER) {
    const rows = this.db
      .query("SELECT data FROM recordings WHERE state = 'recording'")
      .iterate() as Iterable<{ data: string }>;
    for (const value of rows) {
      const row: Stored = JSON.parse(value.data);
      if (row.updatedAt >= staleBefore) continue;
      try {
        await this.finish(row.owner, row.id, row.durationMs, true, staleBefore);
      } catch (error) {
        if (!(error instanceof RecordingError && error.status === 404)) throw error;
      }
    }
  }
  async prune(now = Date.now()) {
    const rows = this.db
      .query(
        "SELECT data FROM recordings WHERE state != 'recording' AND json_extract(data, '$.expiresAt') <= ?",
      )
      .iterate(now) as Iterable<{ data: string }>;
    for (const value of rows) {
      const row: Stored = JSON.parse(value.data);
      await this.remove(row.owner, row.id);
    }
  }
}

let shared: CallRecordingStore | undefined;
export function getCallRecordingStorageUsage(owner: string) {
  // Reading the existing backup quota must not create/open a recording DB on accounts
  // that have never recorded anything (also keeps other storage lifecycles independent).
  if (!shared && !existsSync(join(VYLINE_STORAGE_DIR, "call-recordings", "index.sqlite"))) {
    return { recordingBytes: 0, recordingReservedBytes: 0 };
  }
  return getCallRecordingStore().usage(owner);
}
export const getCallRecordingStore = () =>
  (shared ??= new CallRecordingStore(join(VYLINE_STORAGE_DIR, "call-recordings")));
