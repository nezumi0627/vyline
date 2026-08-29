import { existsSync, mkdirSync } from "node:fs";
import { appendFile, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { Unzip, UnzipInflate } from "fflate";
import type { MessageContentMeta, MessageReaction, MessageSnapshot } from "@vyline/types";
import { childLogger } from "../logger.js";
import { getClient } from "../line/clientManager.js";
import {
  flushAccountChatDb,
  mergeImportedChatDb,
  type ChatDbRecords,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";
import { writeMediaStorage } from "../storage/mediaStorage.js";
import { getToken } from "../storage/tokenStore.js";

const log = childLogger("android-backup");

const MAX_UPLOAD_BYTES = Number(
  process.env.VYLINE_ANDROID_BACKUP_MAX_BYTES ?? 2 * 1024 * 1024 * 1024,
);
const CHUNK_UPLOAD_BYTES = Math.min(
  768 * 1024,
  Math.max(64 * 1024, Number(process.env.VYLINE_ANDROID_BACKUP_CHUNK_BYTES ?? 512 * 1024)),
);
const CHUNK_UPLOAD_TTL_MS = Number(
  process.env.VYLINE_ANDROID_BACKUP_CHUNK_TTL_MS ?? 60 * 60 * 1000,
);
const MAX_EXTRACT_BYTES = Number(
  process.env.VYLINE_ANDROID_BACKUP_MAX_EXTRACT_BYTES ?? 4 * 1024 * 1024 * 1024,
);
const SQLITE_MAGIC = "SQLite format 3\u0000";
const MEDIA_CONTENT_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "FILE"]);
const UNSENT_HISTORY_TYPES = new Set([27, 28, 38]);

export interface AndroidBackupProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
  file?: string;
}

export interface AndroidBackupSession {
  id: string;
  accountId: string;
  sourceName: string;
  includeMedia: boolean;
  status: "pending" | "running" | "completed" | "failed";
  progress: AndroidBackupProgress | null;
  result: {
    sourceName: string;
    sourceKind: "sqlite" | "zip";
    databaseVersion: number;
    restoredAt: string;
    parsed: {
      chats: number;
      totalMessages: number;
      reactions: number;
      unsupportedReactions: number;
    };
    restoredChatMids: string[];
    merged: {
      importedChats: number;
      skippedChats: number;
      importedMessages: number;
      skippedMessages: number;
    };
    media: { restored: number; skipped: number };
  } | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

type SqlValue = string | number | bigint | Uint8Array | null;
type AndroidRow = Record<string, SqlValue>;

interface AndroidMediaRef {
  chatMid: string;
  localId: string;
  messageId: string;
  contentType: string;
}

export interface ParsedAndroidDatabase {
  records: ChatDbRecords;
  mediaRefs: AndroidMediaRef[];
  databaseVersion: number;
  reactions: number;
  unsupportedReactions: number;
}

interface ExtractedAndroidZip {
  databasePath: string;
  mediaRoot: string | null;
}

const sessions = new Map<string, AndroidBackupSession>();

interface AndroidBackupChunkUpload {
  id: string;
  accountId: string;
  sourceName: string;
  includeMedia: boolean;
  expectedBytes: number;
  receivedBytes: number;
  nextIndex: number;
  workDir: string;
  sourcePath: string;
  updatedAt: number;
}

const chunkUploads = new Map<string, AndroidBackupChunkUpload>();

async function pruneStaleChunkUploads(): Promise<void> {
  const threshold = Date.now() - CHUNK_UPLOAD_TTL_MS;
  const stale = [...chunkUploads.values()].filter((upload) => upload.updatedAt < threshold);
  for (const upload of stale) {
    chunkUploads.delete(upload.id);
    await rm(upload.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function createRestoreSession(
  accountId: string,
  sourceName: string,
  includeMedia: boolean,
  totalBytes: number,
): AndroidBackupSession {
  const id = `android-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    accountId,
    sourceName: sanitizeDisplayName(sourceName),
    includeMedia,
    status: "pending",
    progress: {
      stage: "upload",
      current: 0,
      total: totalBytes > 0 ? totalBytes : 1,
      message: "Androidバックアップを受信しています",
    },
    result: null,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
  };
}

function queueRestore(
  session: AndroidBackupSession,
  sourcePath: string,
  workDir: string,
): AndroidBackupSession {
  session.progress = {
    stage: "queued",
    current: 1,
    total: 1,
    message: "復元処理を開始しています",
  };
  sessions.set(session.id, session);
  void runRestore(session, sourcePath, workDir);
  return session;
}

export async function startAndroidBackupRestore(
  accountId: string,
  sourceName: string,
  request: Request,
  includeMedia: boolean,
): Promise<AndroidBackupSession> {
  if (!accountId) throw new Error("accountId が必要です");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Androidバックアップが大きすぎます（上限 ${formatBytes(MAX_UPLOAD_BYTES)}）`);
  }

  const session = createRestoreSession(accountId, sourceName, includeMedia, contentLength);

  const workDir = await mkdtemp(join(tmpdir(), `vyline-android-${session.id}-`));
  const sourcePath = join(workDir, "source.bin");
  try {
    const written = await Bun.write(sourcePath, await request.arrayBuffer());
    if (written <= 0) throw new Error("アップロードされたファイルが空です");
    if (written > MAX_UPLOAD_BYTES) {
      throw new Error(`Androidバックアップが大きすぎます（上限 ${formatBytes(MAX_UPLOAD_BYTES)}）`);
    }
    return queueRestore(session, sourcePath, workDir);
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Reverse proxy の body size 制限を避けるための分割アップロードを開始する。
 * chunk 自体は 1 MiB を十分下回るため、Nginx の既定 client_max_body_size=1m でも通る。
 */
export async function createAndroidBackupChunkUpload(
  accountId: string,
  sourceName: string,
  includeMedia: boolean,
  expectedBytes: number,
): Promise<{ uploadId: string; chunkSize: number }> {
  if (!accountId) throw new Error("accountId が必要です");
  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    throw new Error("Androidバックアップのファイルサイズが不正です");
  }
  if (expectedBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`Androidバックアップが大きすぎます（上限 ${formatBytes(MAX_UPLOAD_BYTES)}）`);
  }

  await pruneStaleChunkUploads();
  const id = `android-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = await mkdtemp(join(tmpdir(), `vyline-${id}-`));
  const sourcePath = join(workDir, "source.bin");
  await writeFile(sourcePath, new Uint8Array());
  chunkUploads.set(id, {
    id,
    accountId,
    sourceName: sanitizeDisplayName(sourceName),
    includeMedia,
    expectedBytes,
    receivedBytes: 0,
    nextIndex: 0,
    workDir,
    sourcePath,
    updatedAt: Date.now(),
  });
  return { uploadId: id, chunkSize: CHUNK_UPLOAD_BYTES };
}

export async function appendAndroidBackupChunk(
  accountId: string,
  uploadId: string,
  index: number,
  request: Request,
): Promise<{ receivedBytes: number; expectedBytes: number; nextIndex: number }> {
  const upload = chunkUploads.get(uploadId);
  if (!upload || upload.accountId !== accountId) {
    throw new Error("Androidバックアップのアップロードセッションが見つかりません");
  }
  if (!Number.isInteger(index) || index < 0) throw new Error("chunk index が不正です");

  // 応答だけ失われて同じchunkが再送された場合は二重追記せず成功扱いにする。
  if (index < upload.nextIndex) {
    upload.updatedAt = Date.now();
    return {
      receivedBytes: upload.receivedBytes,
      expectedBytes: upload.expectedBytes,
      nextIndex: upload.nextIndex,
    };
  }
  if (index !== upload.nextIndex) {
    throw new Error(`chunk順序が不正です（expected=${upload.nextIndex}, received=${index}）`);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > CHUNK_UPLOAD_BYTES) {
    throw new Error(`chunkが大きすぎます（上限 ${formatBytes(CHUNK_UPLOAD_BYTES)}）`);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength <= 0) throw new Error("空のchunkは受け付けられません");
  if (bytes.byteLength > CHUNK_UPLOAD_BYTES) {
    throw new Error(`chunkが大きすぎます（上限 ${formatBytes(CHUNK_UPLOAD_BYTES)}）`);
  }
  if (upload.receivedBytes + bytes.byteLength > upload.expectedBytes) {
    throw new Error("アップロードサイズが宣言されたファイルサイズを超えました");
  }

  await appendFile(upload.sourcePath, bytes);
  upload.receivedBytes += bytes.byteLength;
  upload.nextIndex += 1;
  upload.updatedAt = Date.now();
  return {
    receivedBytes: upload.receivedBytes,
    expectedBytes: upload.expectedBytes,
    nextIndex: upload.nextIndex,
  };
}

export async function completeAndroidBackupChunkUpload(
  accountId: string,
  uploadId: string,
): Promise<AndroidBackupSession> {
  const upload = chunkUploads.get(uploadId);
  if (!upload || upload.accountId !== accountId) {
    throw new Error("Androidバックアップのアップロードセッションが見つかりません");
  }
  if (upload.receivedBytes !== upload.expectedBytes) {
    throw new Error(
      `アップロードが未完了です（${formatBytes(upload.receivedBytes)} / ${formatBytes(upload.expectedBytes)}）`,
    );
  }

  chunkUploads.delete(uploadId);
  const actualBytes = (await stat(upload.sourcePath)).size;
  if (actualBytes !== upload.expectedBytes) {
    await rm(upload.workDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(
      `アップロード済みファイルサイズが一致しません（${formatBytes(actualBytes)} / ${formatBytes(upload.expectedBytes)}）`,
    );
  }
  const session = createRestoreSession(
    upload.accountId,
    upload.sourceName,
    upload.includeMedia,
    actualBytes,
  );
  return queueRestore(session, upload.sourcePath, upload.workDir);
}

export function getAndroidBackupSession(
  accountId: string,
  id: string,
): AndroidBackupSession | null {
  const session = sessions.get(id);
  return session?.accountId === accountId ? session : null;
}

async function runRestore(
  session: AndroidBackupSession,
  sourcePath: string,
  workDir: string,
): Promise<void> {
  session.status = "running";
  try {
    const sourceKind = await detectBackupKind(sourcePath);
    let databasePath = sourcePath;
    let mediaRoot: string | null = null;

    if (sourceKind === "zip") {
      session.progress = {
        stage: "extract",
        current: 0,
        total: (await stat(sourcePath)).size,
        message: session.includeMedia
          ? "DBとAndroidの保存済みメディアを展開しています"
          : "AndroidバックアップからDBを取り出しています",
      };
      const extracted = await extractAndroidZip(
        sourcePath,
        join(workDir, "extracted"),
        session.includeMedia,
        (current, total, file) => {
          session.progress = {
            stage: "extract",
            current,
            total,
            message: session.includeMedia
              ? "DBとAndroidの保存済みメディアを展開しています"
              : "AndroidバックアップからDBを取り出しています",
            ...(file ? { file } : {}),
          };
        },
      );
      databasePath = extracted.databasePath;
      mediaRoot = extracted.mediaRoot;
    }

    session.progress = {
      stage: "parse",
      current: 0,
      total: 1,
      message: "naver_line DBを解析しています",
    };
    const token = await getToken(session.accountId);
    const selfMid =
      token?.mid?.trim() || String(getClient(session.accountId)?.base.profile?.mid ?? "").trim();
    if (!selfMid) {
      throw new Error("復元先LINEアカウントのMIDを確認できません。再ログインしてから実行してください");
    }
    const parsed = parseAndroidDatabase(databasePath, selfMid);

    session.progress = {
      stage: "merge",
      current: 0,
      total: 1,
      message: "Androidのトーク履歴をVylineへ統合しています",
    };
    const merged = await mergeImportedChatDb(session.accountId, parsed.records);

    let media = { restored: 0, skipped: 0 };
    if (session.includeMedia && mediaRoot) {
      session.progress = {
        stage: "media",
        current: 0,
        total: parsed.mediaRefs.length,
        message: "Androidの保存済みメディアを紐付けています",
      };
      media = await restoreAndroidMedia(
        session.accountId,
        mediaRoot,
        parsed.mediaRefs,
        (current, total) => {
          session.progress = {
            stage: "media",
            current,
            total,
            message: "Androidの保存済みメディアを紐付けています",
          };
        },
      );
    }

    session.progress = {
      stage: "save",
      current: 1,
      total: 1,
      message: "復元結果を保存しています",
    };
    await flushAccountChatDb(session.accountId);

    const totalMessages = Object.values(parsed.records.messages).reduce(
      (sum, messages) => sum + Object.keys(messages).length,
      0,
    );
    session.result = {
      sourceName: session.sourceName,
      sourceKind,
      databaseVersion: parsed.databaseVersion,
      restoredAt: new Date().toISOString(),
      parsed: {
        chats: Object.keys(parsed.records.chats).length,
        totalMessages,
        reactions: parsed.reactions,
        unsupportedReactions: parsed.unsupportedReactions,
      },
      restoredChatMids: Object.values(parsed.records.chats)
        .filter((chat) => chat.hasMessages)
        .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0))
        .map((chat) => chat.mid),
      merged,
      media,
    };
    session.status = "completed";
    session.completedAt = Date.now();
  } catch (error) {
    session.status = "failed";
    session.error =
      error instanceof Error ? error.message : "Androidバックアップの復元に失敗しました";
    session.completedAt = Date.now();
    log.warn(
      { accountId: session.accountId, sourceName: session.sourceName, error },
      "Android backup restore failed",
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function detectBackupKind(path: string): Promise<"sqlite" | "zip"> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (header.toString("latin1") === SQLITE_MAGIC) return "sqlite";
    if (header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b) return "zip";
    throw new Error("SQLiteの naver_line DB または対応バックアップZIPを選択してください");
  } finally {
    await handle.close();
  }
}

async function extractAndroidZip(
  sourcePath: string,
  outputDir: string,
  includeMedia: boolean,
  onProgress?: (current: number, total: number, file?: string) => void,
): Promise<ExtractedAndroidZip> {
  mkdirSync(outputDir, { recursive: true });
  const total = (await stat(sourcePath)).size;
  let current = 0;
  let extractedBytes = 0;
  let extractionError: Error | null = null;
  const databaseCandidates: Array<{ path: string; rank: number }> = [];
  const endTasks: Promise<unknown>[] = [];
  let dbIndex = 0;
  let extractedMedia = false;

  const unzipper = new Unzip((file) => {
    if (extractionError) return;
    const name = file.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const dbRank = androidDatabaseCandidateRank(name);
    const media = includeMedia ? parseAndroidMediaEntry(name) : null;
    if (dbRank === null && !media) return;

    const declaredSize = Number(file.originalSize ?? 0);
    if (
      Number.isFinite(declaredSize) &&
      declaredSize > 0 &&
      extractedBytes + declaredSize > MAX_EXTRACT_BYTES
    ) {
      extractionError = new Error(
        `Androidバックアップの展開サイズが上限 ${formatBytes(MAX_EXTRACT_BYTES)} を超えます`,
      );
      return;
    }

    const target = media
      ? join(outputDir, "media", media.chatMid, media.fileName)
      : join(outputDir, `database-${dbIndex++}.sqlite`);
    mkdirSync(dirname(target), { recursive: true });
    const writer = Bun.file(target).writer({ highWaterMark: 1024 * 1024 });
    let writtenForFile = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        extractionError = error instanceof Error ? error : new Error(String(error));
        try {
          file.terminate();
        } catch {
          // ignore
        }
        return;
      }
      try {
        writtenForFile += chunk.byteLength;
        extractedBytes += chunk.byteLength;
        if (extractedBytes > MAX_EXTRACT_BYTES) {
          extractionError = new Error(
            `Androidバックアップの展開サイズが上限 ${formatBytes(MAX_EXTRACT_BYTES)} を超えます`,
          );
          file.terminate();
          return;
        }
        if (chunk.byteLength > 0) writer.write(chunk);
        if (final) {
          endTasks.push(Promise.resolve(writer.end()));
          if (media) {
            extractedMedia = extractedMedia || writtenForFile > 0;
          } else {
            databaseCandidates.push({ path: target, rank: dbRank ?? 99 });
          }
        }
      } catch (writeError) {
        extractionError =
          writeError instanceof Error ? writeError : new Error(String(writeError));
        try {
          file.terminate();
        } catch {
          // ignore
        }
      }
    };
    onProgress?.(current, total, basename(name));
    file.start();
  });
  unzipper.register(UnzipInflate);

  for await (const chunk of Bun.file(sourcePath).stream()) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    current += bytes.byteLength;
    unzipper.push(bytes, false);
    if (extractionError) throw extractionError;
    onProgress?.(Math.min(current, total), total);
  }
  unzipper.push(new Uint8Array(), true);
  if (extractionError) throw extractionError;
  await Promise.all(endTasks);

  const database = databaseCandidates.sort((a, b) => a.rank - b.rank)[0];
  if (!database || !existsSync(database.path)) {
    throw new Error("ZIP内に naver_line DB が見つかりませんでした");
  }
  return {
    databasePath: database.path,
    mediaRoot: includeMedia && extractedMedia ? join(outputDir, "media") : null,
  };
}

function androidDatabaseCandidateRank(name: string): number | null {
  const lower = name.toLowerCase();
  if (/(^|\/)database\/naver_line(?:\.db)?$/.test(lower)) return 0;
  if (/(^|\/)naver_line(?:\.db)?$/.test(lower)) return 1;
  if (/(^|\/)chats\/naver_line_backup_[^/]+\.db$/.test(lower)) return 2;
  return null;
}

function parseAndroidMediaEntry(
  name: string,
): { chatMid: string; fileName: string } | null {
  const match = name.match(
    /(?:^|\/)chats\/([a-z0-9_-]{4,128})\/messages\/(\d+)(\.original|\.thumb)?$/i,
  );
  if (!match) return null;
  return { chatMid: match[1]!, fileName: `${match[2]!}${match[3] ?? ""}` };
}

export function parseAndroidDatabase(dbPath: string, selfMid: string): ParsedAndroidDatabase {
  const db = new Database(dbPath, { readonly: true, safeIntegers: true, strict: true });
  try {
    const tables = new Set(
      (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as AndroidRow[])
        .map((row) => asString(row.name))
        .filter(Boolean),
    );
    if (!tables.has("chat_history")) {
      throw new Error("chat_history テーブルがないため、LINE Androidの naver_line DB として読めません");
    }

    const databaseVersion = Number(
      (db.query("PRAGMA user_version").get() as AndroidRow | null)?.user_version ?? 0,
    );
    const chatRows = tables.has("chat")
      ? (db.query("SELECT * FROM chat").all() as AndroidRow[])
      : [];
    const historyRows = db.query("SELECT * FROM chat_history").all() as AndroidRow[];
    const groupRows = tables.has("groups")
      ? (db.query("SELECT * FROM groups").all() as AndroidRow[])
      : [];
    const contactRows = tables.has("contacts")
      ? (db.query("SELECT * FROM contacts").all() as AndroidRow[])
      : [];
    const reactionRows = tables.has("reactions")
      ? (db.query("SELECT * FROM reactions").all() as AndroidRow[])
      : [];

    const groupNames = new Map<string, string>();
    for (const row of groupRows) {
      const mid = firstString(row, ["id", "mid", "m_id"]);
      const name = firstString(row, ["name", "group_name", "display_name"]);
      if (mid && name) groupNames.set(mid, name);
    }

    const contactNames = new Map<string, string>();
    for (const row of contactRows) {
      const mid = firstString(row, ["m_id", "mid", "id"]);
      const name = firstString(row, ["custom_name", "name", "display_name", "contact_name"]);
      if (mid && name) contactNames.set(mid, name);
    }

    const {
      byMessage: reactionsByMessage,
      unsupportedByMessage,
      restored,
      unsupported,
    } = parseAndroidReactions(reactionRows);
    const savedAt = new Date().toISOString();
    const messages: Record<string, Record<string, StoredMessage>> = {};
    const mediaRefsByMessage = new Map<string, AndroidMediaRef>();

    for (const row of historyRows) {
      const chatMid = asString(row.chat_id);
      const localId = asString(row.id);
      if (!chatMid || !localId) continue;
      const rawServerId = asString(row.server_id);
      const messageId = rawServerId && rawServerId !== "0" ? rawServerId : `android-local-${localId}`;
      const rawFrom = asString(row.from_mid);
      const isMyMessage = !rawFrom || rawFrom === selfMid;
      const from = isMyMessage ? selfMid : rawFrom;
      const historyType = asNumber(row.type);
      const attachmentType = asNumber(row.attachement_type);
      const rawParameter = asNullableString(row.parameter);
      const parsedMetadata = parseAndroidParameter(rawParameter);
      const unsupportedReactionPayloads = unsupportedByMessage.get(messageId);
      const contentMetadata: MessageContentMeta | null =
        parsedMetadata || unsupportedReactionPayloads?.length
          ? {
              ...(parsedMetadata ?? {}),
              ...(unsupportedReactionPayloads?.length
                ? { ANDROID_CUSTOM_REACTIONS: JSON.stringify(unsupportedReactionPayloads) }
                : {}),
            }
          : null;
      const contentType = androidContentType(historyType, attachmentType);
      const relationType = String(contentMetadata?.message_relation_type_code ?? "").toLowerCase();
      const relationId = String(contentMetadata?.message_relation_server_message_id ?? "").trim();
      const createdTime = asNumber(row.created_time);
      const readCount = asNumber(row.read_count);
      const reactions = reactionsByMessage.get(messageId);
      const unsent = isAndroidUnsentRow(historyType, rawParameter);
      const stickerOption = String(contentMetadata?.STKOPT ?? "").toUpperCase();

      const message: StoredMessage = {
        id: messageId,
        chatMid,
        from,
        // LINE group/room messages target the chat MID even when received.
        // Using selfMid here makes the desktop-side chat filter drop every
        // restored message sent by another group member.
        to:
          isMyMessage || chatMid.startsWith("c") || chatMid.startsWith("r")
            ? chatMid
            : selfMid,
        text: unsent ? null : asNullableString(row.content),
        contentType: unsent ? "UNSENT" : contentType,
        createdTime: Number.isFinite(createdTime) ? createdTime : 0,
        isMyMessage,
        ...(contentMetadata ? { contentMetadata } : {}),
        ...(readCount > 0 ? { readCount } : {}),
        ...(relationType === "reply" && relationId ? { relatedMessageId: relationId } : {}),
        ...(stickerOption.includes("A") ? { stickerAnimated: true } : {}),
        ...(reactions?.length ? { reactions } : {}),
        ...(unsent
          ? { messageState: isMyMessage ? "revoked-by-self" : "revoked-by-other" }
          : {}),
        savedAt,
      };
      const byChat = (messages[chatMid] ??= {});
      byChat[messageId] = mergeAndroidDuplicateMessage(byChat[messageId], message);

      if (MEDIA_CONTENT_TYPES.has(contentType)) {
        mediaRefsByMessage.set(`${chatMid}:${messageId}`, {
          chatMid,
          localId,
          messageId,
          contentType,
        });
      }
    }

    const chatRowsByMid = new Map<string, AndroidRow>();
    for (const row of chatRows) {
      const chatMid = asString(row.chat_id);
      if (chatMid) chatRowsByMid.set(chatMid, row);
    }

    const chats: Record<string, StoredChat> = {};
    const allChatMids = new Set([...chatRowsByMid.keys(), ...Object.keys(messages)]);
    for (const chatMid of allChatMids) {
      const row = chatRowsByMid.get(chatMid);
      const byChat = Object.values(messages[chatMid] ?? {}).sort(
        (a, b) => a.createdTime - b.createdTime || compareId(a.id, b.id),
      );
      const latest = byChat.at(-1);
      const declaredName = row ? asString(row.chat_name) : "";
      const name = declaredName || groupNames.get(chatMid) || contactNames.get(chatMid) || chatMid;
      const messageCount = row ? asNumber(row.message_count) : byChat.length;
      const readMessageCount = row ? asNumber(row.read_message_count) : messageCount;
      const unreadCount = Math.max(0, messageCount - readMessageCount);
      chats[chatMid] = {
        mid: chatMid,
        name,
        kind: androidChatKind(chatMid, row ? asNumber(row.type) : 0),
        hasMessages: byChat.length > 0,
        restoredHistory: true,
        ...(latest
          ? {
              lastMessageTime: latest.createdTime,
              lastMessageId: latest.id,
              lastMessagePreview: previewForStoredMessage(latest),
            }
          : {}),
        ...(unreadCount > 0 ? { unreadCount } : {}),
        updatedAt: savedAt,
      };
    }

    return {
      records: { chats, messages },
      mediaRefs: [...mediaRefsByMessage.values()],
      databaseVersion,
      reactions: restored,
      unsupportedReactions: unsupported,
    };
  } finally {
    db.close();
  }
}

function isAndroidUnsentRow(historyType: number, rawParameter: string | null): boolean {
  if (UNSENT_HISTORY_TYPES.has(historyType)) return true;
  const marker = rawParameter?.trim().toLowerCase() ?? "";
  return marker === "limesunsend" || marker === "leinsunsend";
}

function isStoredUnsent(message: StoredMessage): boolean {
  return (
    message.contentType === "UNSENT" ||
    message.messageState === "revoked-by-self" ||
    message.messageState === "revoked-by-other"
  );
}

function snapshotFromAndroidMessage(message: StoredMessage): MessageSnapshot {
  const {
    chatMid: _chatMid,
    savedAt: _savedAt,
    history: _history,
    revokedSnapshot: _revokedSnapshot,
    ...snapshot
  } = message;
  return Object.fromEntries(
    Object.entries(snapshot).filter(([, value]) => value !== undefined),
  ) as MessageSnapshot;
}

function mergeAndroidDuplicateMessage(
  previous: StoredMessage | undefined,
  incoming: StoredMessage,
): StoredMessage {
  if (!previous) return incoming;
  const previousUnsent = isStoredUnsent(previous);
  const incomingUnsent = isStoredUnsent(incoming);

  if (incomingUnsent && !previousUnsent) {
    return {
      ...previous,
      contentType: "UNSENT",
      text: null,
      messageState: previous.isMyMessage ? "revoked-by-self" : "revoked-by-other",
      revokedSnapshot: previous.revokedSnapshot ?? snapshotFromAndroidMessage(previous),
      history: [
        ...(previous.history ?? []),
        {
          state: previous.messageState ?? "normal",
          text: previous.text,
          contentType: previous.contentType,
          updatedTime: incoming.createdTime || previous.createdTime,
        },
      ],
      ...(incoming.reactions?.length ? { reactions: incoming.reactions } : {}),
      savedAt: incoming.savedAt,
    };
  }

  if (previousUnsent && !incomingUnsent) {
    return {
      ...previous,
      revokedSnapshot: previous.revokedSnapshot ?? snapshotFromAndroidMessage(incoming),
      history: previous.history?.length
        ? previous.history
        : [
            {
              state: incoming.messageState ?? "normal",
              text: incoming.text,
              contentType: incoming.contentType,
              updatedTime: previous.createdTime || incoming.createdTime,
            },
          ],
      ...(incoming.reactions?.length ? { reactions: incoming.reactions } : {}),
    };
  }

  if (previousUnsent && incomingUnsent) {
    return {
      ...previous,
      ...(incoming.reactions?.length ? { reactions: incoming.reactions } : {}),
    };
  }

  return androidMessageRichness(incoming) > androidMessageRichness(previous) ? incoming : previous;
}

function androidMessageRichness(message: StoredMessage): number {
  let score = 0;
  if (message.contentType !== "NONE" && !message.contentType.startsWith("ANDROID_")) score += 4;
  if (message.text?.trim()) score += 2;
  if (message.contentMetadata && Object.keys(message.contentMetadata).length > 0) score += 2;
  if (message.relatedMessageId) score += 1;
  if (message.reactions?.length) score += 1;
  return score;
}

export function parseAndroidParameter(value: string | null): MessageContentMeta | null {
  if (!value) return null;
  const parts = value.split("\t");
  const output: MessageContentMeta = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = parts[i]?.trim();
    if (!key) continue;
    output[key] = parts[i + 1] ?? "";
  }
  if (parts.length % 2 === 1 && parts.at(-1)?.trim()) {
    output.ANDROID_PARAMETER_EXTRA = parts.at(-1) ?? "";
  }
  return Object.keys(output).length > 0 ? output : null;
}

export function androidContentType(historyType: number, attachmentType: number): string {
  if (UNSENT_HISTORY_TYPES.has(historyType)) return "UNSENT";
  switch (attachmentType) {
    case 0:
      return historyType === 1 ? "NONE" : historyType > 1 ? `ANDROID_${historyType}` : "NONE";
    case 1:
      return "IMAGE";
    case 2:
      return "VIDEO";
    case 3:
      return "AUDIO";
    case 6:
      return "CALL";
    case 7:
      return "STICKER";
    case 13:
      return "CONTACT";
    case 14:
      return "FILE";
    case 15:
      return "LOCATION";
    case 16:
      return "POSTNOTIFICATION";
    case 17:
      return "RICH";
    case 18:
      return "CHATEVENT";
    case 22:
      return "FLEX";
    default:
      return String(attachmentType);
  }
}

function parseAndroidReactions(rows: AndroidRow[]): {
  byMessage: Map<string, MessageReaction[]>;
  unsupportedByMessage: Map<
    string,
    Array<{ fromMid: string; atMillis: number; reactionType: string; customReaction: string }>
  >;
  restored: number;
  unsupported: number;
} {
  const byMessage = new Map<string, MessageReaction[]>();
  const unsupportedByMessage = new Map<
    string,
    Array<{ fromMid: string; atMillis: number; reactionType: string; customReaction: string }>
  >();
  let restored = 0;
  let unsupported = 0;
  for (const row of rows) {
    const messageId = asString(row.server_message_id);
    const fromMid = asString(row.member_id);
    const reactionType = asString(row.reaction_type);
    const customReaction = asString(row.custom_reaction);
    const type = androidReactionType(reactionType);
    if (!messageId || !fromMid || !type) {
      if (reactionType || customReaction) {
        unsupported++;
        if (messageId) {
          const list = unsupportedByMessage.get(messageId) ?? [];
          list.push({
            fromMid,
            atMillis: asNumber(row.reaction_time_millis),
            reactionType,
            customReaction,
          });
          unsupportedByMessage.set(messageId, list);
        }
      }
      continue;
    }
    const reaction: MessageReaction = {
      fromMid,
      atMillis: asNumber(row.reaction_time_millis),
      type,
    };
    const list = byMessage.get(messageId) ?? [];
    list.push(reaction);
    byMessage.set(messageId, list);
    restored++;
  }
  return { byMessage, unsupportedByMessage, restored, unsupported };
}

function androidReactionType(value: string): number | null {
  switch (value.trim().toLowerCase()) {
    case "nice":
      return 2;
    case "love":
      return 3;
    case "fun":
      return 4;
    case "amazing":
      return 5;
    case "sad":
      return 6;
    case "omg":
      return 7;
    default:
      return null;
  }
}

async function restoreAndroidMedia(
  accountId: string,
  mediaRoot: string,
  refs: AndroidMediaRef[],
  onProgress?: (current: number, total: number) => void,
): Promise<{ restored: number; skipped: number }> {
  let restored = 0;
  let skipped = 0;
  let current = 0;
  onProgress?.(0, refs.length);
  for (const ref of refs) {
    const candidates = [
      join(mediaRoot, ref.chatMid, `${ref.localId}.original`),
      join(mediaRoot, ref.chatMid, ref.localId),
      ...(ref.contentType === "IMAGE"
        ? [join(mediaRoot, ref.chatMid, `${ref.localId}.thumb`)]
        : []),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) {
      skipped++;
      current++;
      onProgress?.(current, refs.length);
      continue;
    }
    try {
      const bytes = new Uint8Array(await readFile(path));
      await writeMediaStorage(
        accountId,
        ref.chatMid,
        ref.messageId,
        bytes,
        sniffMediaMime(bytes, ref.contentType),
      );
      restored++;
    } catch {
      skipped++;
    }
    current++;
    onProgress?.(current, refs.length);
  }
  return { restored, skipped };
}

function sniffMediaMime(bytes: Uint8Array, kind: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const head = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp"
  ) {
    return kind === "AUDIO" ? "audio/mp4" : "video/mp4";
  }
  if (bytes.length >= 3 && Buffer.from(bytes.subarray(0, 3)).toString("ascii") === "ID3") {
    return "audio/mpeg";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (kind === "IMAGE") return "image/jpeg";
  if (kind === "VIDEO") return "video/mp4";
  if (kind === "AUDIO") return "audio/mp4";
  return "application/octet-stream";
}

function androidChatKind(chatMid: string, type: number): StoredChat["kind"] {
  if (chatMid.startsWith("u") || type === 1) return "direct";
  if (chatMid.startsWith("c") || chatMid.startsWith("r") || type === 2 || type === 3) {
    return "group";
  }
  return "unknown";
}

function previewForStoredMessage(message: StoredMessage): string {
  const text = message.text?.trim();
  if (text) return text.slice(0, 120);
  switch (message.contentType) {
    case "IMAGE":
      return "画像";
    case "VIDEO":
      return "動画";
    case "AUDIO":
      return "音声";
    case "FILE":
      return "ファイル";
    case "STICKER":
      return "スタンプ";
    case "UNSENT":
      return "送信を取り消したメッセージ";
    case "CHATEVENT":
      return "チャットイベント";
    case "CALL":
      return "通話";
    default:
      return message.contentType || "メッセージ";
  }
}

function compareId(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a === b ? 0 : a < b ? -1 : 1;
  } catch {
    return left.localeCompare(right);
  }
}

function firstString(row: AndroidRow, keys: string[]): string {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return "";
}

function asString(value: SqlValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Uint8Array) return "";
  return String(value);
}

function asNullableString(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined || value instanceof Uint8Array) return null;
  return String(value);
}

function asNumber(value: SqlValue | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sanitizeDisplayName(value: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  return basename(decoded.replace(/\\/g, "/")).slice(0, 180) || "naver_line";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
