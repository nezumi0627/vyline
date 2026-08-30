/**
 * backupService.ts — VylineBackup（セルフホスト向け履歴バックアップ / 復元）
 *
 * chatdb の全チャット・メッセージ（送信タイミング・スタンプ・Flex 等の文字管理系を
 * 含む）をスナップショット JSON として data/backups/ に保存する。
 * オプションでメディア（画像/動画/音声/ファイル）を base64 で同梱できる。
 * 復元時は「すべて / チャット毎」「メディア含む / テキストのみ」を選べる。
 * 新規端末への移行はバックアップファイルを新端末でアップロード→復元で行う。
 */

import { createHash, randomUUID } from "node:crypto";
import type { BackupStorageUsage } from "@vyline/types";
import { existsSync } from "node:fs";
import { link, mkdir, open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import {
  exportChatDb,
  chatDbStorageBytes,
  flushAccountChatDb,
  mergeImportedChatDb,
  listChatsWithCounts,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";
import {
  getAccountMediaStorageSize,
  statMediaStorage,
  readMediaStorage,
  writeMediaStorage,
} from "../storage/mediaStorage.js";
import { safePathComponent } from "../storage/safeFile.js";
import { BACKUP_STORAGE_LIMIT_BYTES, BackupStorageLimitError } from "../storage/backupLimits.js";
export { BACKUP_STORAGE_LIMIT_BYTES, BackupStorageLimitError } from "../storage/backupLimits.js";

const log = childLogger("vyline-backup");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
const BACKUP_DIR = process.env.VYLINE_BACKUP_DIR ?? join(DATA_DIR, "backups");
// Keep snapshots made before VYLINE_DATA_DIR was respected readable in place.
const LEGACY_BACKUP_DIR = join(_dir, "../../data/backups");
const BACKUP_ROOTS = [
  ...new Set(
    [BACKUP_DIR, ...(process.env.VYLINE_BACKUP_DIR ? [] : [LEGACY_BACKUP_DIR])].map((path) =>
      resolve(path),
    ),
  ),
];

export type { BackupStorageUsage } from "@vyline/types";

// Admission, writing and deletion share the account lock. Different accounts
// have independent quotas and can create snapshots concurrently.
const writes = new Map<string, Promise<unknown>>();
export function withAccountBackupLock<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(accountId) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(accountId, next);
  return next.finally(() => {
    if (writes.get(accountId) === next) writes.delete(accountId);
  });
}

const SCHEMA = "vyline-backup";
const VERSION = 1;

/** メディアを持ち得る contentType（E2EE で text/chunks に分解される前の分類） */
const MEDIA_CONTENT_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "FILE", "RICH"]);

export interface BackupOptions {
  /** 指定時はそのチャットのみ。未指定＝全チャット */
  chatMids?: string[];
  /** メディア（画像/動画/音声/ファイル）を base64 同梱する */
  includeMedia: boolean;
}

export interface RestoreOptions {
  /** 指定時はそのチャットのみ。未指定＝全チャット */
  chatMids?: string[];
  /** true なら同梱メディアも復元 */
  includeMedia: boolean;
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  accountId: string;
  chatCount: number;
  messageCount: number;
  mediaCount: number;
  includeMedia: boolean;
  sizeBytes: number;
}

interface Snapshot {
  schema: string;
  version: number;
  createdAt: string;
  accountId: string;
  includeMedia: boolean;
  /** 作成時に絞ったチャット（未指定＝null＝全チャット） */
  chatMids: string[] | null;
  chats: Record<string, StoredChat>;
  messages: Record<string, Record<string, StoredMessage>>;
  media: Array<{ chatMid: string; messageId: string; contentType: string; data: string }>;
}

function backupAccountDir(accountId: string): string {
  // Do not normalize account IDs: case, punctuation and long common prefixes
  // must never map two accounts to the same backup directory.
  return join(BACKUP_DIR, createHash("sha256").update(accountId).digest("hex"));
}

function snapshotPath(accountId: string, id: string): string {
  return join(backupAccountDir(accountId), `${id}.json`);
}

function backupAccountComponent(accountId: string): string {
  return safePathComponent(accountId, "account").replace(/\.+/g, "_");
}

function idFor(date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `vyline-backup-${stamp}-${randomUUID()}`;
}

function validBackupId(id: string): boolean {
  return /^vyline-backup-[a-zA-Z0-9_-]+$/.test(id);
}

// New snapshots remain ordinary JSON, with one record per line so restoring a
// multi-GB snapshot does not require one giant JSON string/base64 media array.
async function* snapshotLines(path: string): AsyncGenerator<string> {
  const reader = Bun.file(path).stream().pipeThrough(new TextDecoderStream()).getReader();
  let parts: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = value.split("\n");
      parts.push(lines[0]!);
      for (let index = 1; index < lines.length; index++) {
        yield parts.join("");
        parts = [lines[index]!];
      }
    }
    if (parts.some(Boolean)) yield parts.join("");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseHeader(line: string): Pick<Snapshot, "schema" | "version" | "accountId"> {
  if (!line.endsWith(',"chats":{')) throw new Error("invalid snapshot header");
  return JSON.parse(`${line.slice(0, -10)}}`);
}

async function legacySnapshots(
  accountId: string,
): Promise<Array<{ path: string; snapshot: Snapshot }>> {
  const result: Array<{ path: string; snapshot: Snapshot }> = [];
  const prefix = `vyline-backup-${backupAccountComponent(accountId)}-`;
  for (const root of BACKUP_ROOTS) {
    const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".json"))
        continue;
      const path = join(root, entry.name);
      try {
        const snapshot = JSON.parse(await readFile(path, "utf8")) as Snapshot;
        // Filename prefixes alone overlap (e.g. account / account-2).
        if (snapshot.schema === SCHEMA && snapshot.accountId === accountId)
          result.push({ path, snapshot });
      } catch (err) {
        log.warn({ err }, "VylineBackup: unreadable legacy snapshot");
      }
    }
  }
  return result;
}

export async function getBackupStorageUsage(
  accountId: string,
  incomingMessages?: Record<string, Record<string, StoredMessage>>,
): Promise<BackupStorageUsage> {
  let backupBytes = 0;
  const dir = backupAccountDir(accountId);
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.isFile()) {
      try {
        backupBytes += (await stat(join(dir, entry.name))).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  for (const entry of await legacySnapshots(accountId))
    backupBytes += (await stat(entry.path)).size;
  const db = await exportChatDb(accountId);
  const historyBytes =
    Object.keys(db.chats).length || Object.keys(db.messages).length || Object.keys(db.meta).length
      ? chatDbStorageBytes(db)
      : 0;
  // Include saved files that regain a message reference during an import.
  for (const [mid, messages] of Object.entries(incomingMessages ?? {}))
    db.messages[mid] = { ...db.messages[mid], ...messages };
  const mediaBytes = await getAccountMediaStorageSize(accountId, db.messages);
  const usedBytes = backupBytes + historyBytes + mediaBytes;
  return {
    accountId,
    usedBytes,
    limitBytes: BACKUP_STORAGE_LIMIT_BYTES,
    remainingBytes: Math.max(0, BACKUP_STORAGE_LIMIT_BYTES - usedBytes),
    historyBytes,
    mediaBytes,
    backupBytes,
  };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function base64FromBytes(buf: Uint8Array): string {
  // Node/Bun グローバルの Buffer に依存せず self-contained に
  return Buffer.from(buf).toString("base64");
}

function bytesFromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export async function ensureBackupDir(): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true });
}

/** チャット一覧 + メッセージ件数（フロントの選択 UI 用） */
export async function getBackupChatList(
  accountId: string,
): Promise<Array<{ mid: string; name: string; messageCount: number }>> {
  return listChatsWithCounts(accountId);
}

export async function createBackup(
  accountId: string,
  options: BackupOptions,
): Promise<BackupSummary> {
  return withAccountBackupLock(accountId, () => createAccountBackup(accountId, options));
}

async function createAccountBackup(
  accountId: string,
  options: BackupOptions,
): Promise<BackupSummary> {
  const { remainingBytes } = await getBackupStorageUsage(accountId);
  if (remainingBytes === 0) throw new BackupStorageLimitError();
  const db = await exportChatDb(accountId);
  const pickChats =
    options.chatMids && options.chatMids.length > 0 ? new Set(options.chatMids) : null;
  const chatMids = Object.keys(db.chats).filter((mid) => !pickChats || pickChats.has(mid));
  const createdAt = new Date();
  const id = idFor(createdAt);
  const path = snapshotPath(accountId, id);
  const temporary = `${path}.partial`;
  const metadataPath = `${path}.meta`;
  const temporaryMetadata = `${temporary}.meta`;
  await mkdir(dirname(path), { recursive: true });
  const file = await open(temporary, "wx", 0o600);
  let published = false;
  let metadataPublished = false;
  let sizeBytes = 0;
  let messageCount = 0;
  let mediaCount = 0;
  let pending = "";
  let pendingBytes = 0;
  const flush = async () => {
    const bytes = Buffer.from(pending, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
      if (bytesWritten <= 0) throw new Error("バックアップの書き込みに失敗しました");
      offset += bytesWritten;
    }
    pending = "";
    pendingBytes = 0;
  };
  const append = async (chunk: string) => {
    const bytes = Buffer.byteLength(chunk, "utf8");
    if (sizeBytes + bytes > remainingBytes) throw new BackupStorageLimitError();
    sizeBytes += bytes;
    pending += chunk;
    pendingBytes += bytes;
    if (pendingBytes >= 256 * 1024) await flush();
  };
  try {
    const header = JSON.stringify({
      schema: SCHEMA,
      version: VERSION,
      createdAt: createdAt.toISOString(),
      accountId,
      includeMedia: options.includeMedia,
      chatMids: pickChats ? [...pickChats] : null,
    });
    await append(`${header.slice(0, -1)},"chats":{\n`);
    for (const [index, mid] of chatMids.entries()) {
      await append(`${index ? "," : ""}${JSON.stringify(mid)}:${JSON.stringify(db.chats[mid])}\n`);
    }
    await append('},"messages":{\n');
    for (const [index, mid] of chatMids.entries()) {
      await append(`${index ? "," : ""}${JSON.stringify(mid)}:{\n`);
      let count = 0;
      for (const [messageId, message] of Object.entries(db.messages[mid] ?? {})) {
        await append(
          `${count++ ? "," : ""}${JSON.stringify(messageId)}:${JSON.stringify(message)}\n`,
        );
        messageCount++;
      }
      await append("}\n");
    }
    await append('},"media":[\n');
    if (options.includeMedia) {
      for (const chatMid of chatMids) {
        for (const [messageId, message] of Object.entries(db.messages[chatMid] ?? {})) {
          const ct = asString(message.contentType);
          if (!MEDIA_CONTENT_TYPES.has(ct) && !/^[0-9]+$/.test(ct)) continue;
          const cached = await readMediaStorage(accountId, chatMid, messageId);
          if (!cached) continue;
          // Reject before allocating the expanded base64 string when it cannot fit.
          if (sizeBytes + 4 * Math.ceil(cached.buf.byteLength / 3) > remainingBytes)
            throw new BackupStorageLimitError();
          await append(
            `${mediaCount ? "," : ""}${JSON.stringify({
              chatMid,
              messageId,
              contentType: cached.contentType,
              data: base64FromBytes(cached.buf),
            })}\n`,
          );
          mediaCount++;
        }
      }
    }
    await append("]}");
    await flush();
    const summary: BackupSummary = {
      id,
      createdAt: createdAt.toISOString(),
      accountId,
      chatCount: chatMids.length,
      messageCount,
      mediaCount,
      includeMedia: options.includeMedia,
      sizeBytes,
    };
    const metadata = JSON.stringify({ ...summary, framed: true });
    if (sizeBytes + Buffer.byteLength(metadata, "utf8") > remainingBytes)
      throw new BackupStorageLimitError();
    await file.sync();
    await file.close();
    await writeFile(temporaryMetadata, metadata, { encoding: "utf8", flag: "wx", mode: 0o600 });
    // Publish complete files exclusively: even an ID collision cannot replace a backup.
    await link(temporary, path);
    published = true;
    await link(temporaryMetadata, metadataPath);
    metadataPublished = true;
    log.info({ accountId, id, messageCount, mediaCount }, "VylineBackup created");
    return summary;
  } catch (error) {
    if (published) await unlink(path).catch(() => undefined);
    if (metadataPublished) await unlink(metadataPath).catch(() => undefined);
    throw error;
  } finally {
    await file.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    await unlink(temporaryMetadata).catch(() => undefined);
  }
}

export async function listBackups(accountId: string): Promise<BackupSummary[]> {
  const summaries: BackupSummary[] = [];
  const files = await readdir(backupAccountDir(accountId)).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    if (!validBackupId(id)) continue;
    try {
      const path = snapshotPath(accountId, id);
      // A large media snapshot need not be loaded into RAM just to show its list row.
      const summary = existsSync(`${path}.meta`)
        ? (JSON.parse(await readFile(`${path}.meta`, "utf8")) as BackupSummary)
        : summarizeSnapshot(
            id,
            JSON.parse(await readFile(path, "utf8")) as Snapshot,
            (await stat(path)).size,
          );
      if (summary.accountId !== accountId || summary.id !== id) continue;
      summaries.push({ ...summary, sizeBytes: (await stat(path)).size });
    } catch (err) {
      log.warn({ err, id }, "VylineBackup list: unreadable snapshot");
    }
  }
  for (const { path, snapshot } of await legacySnapshots(accountId)) {
    const id = path
      .split(/[\\/]/)
      .pop()!
      .replace(/\.json$/, "");
    summaries.push(summarizeSnapshot(id, snapshot, (await stat(path)).size));
  }
  return summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function summarizeSnapshot(id: string, snapshot: Snapshot, sizeBytes: number): BackupSummary {
  if (snapshot.schema !== SCHEMA || snapshot.version !== VERSION) throw new Error("invalid backup");
  return {
    id,
    accountId: snapshot.accountId,
    createdAt: snapshot.createdAt,
    chatCount: Object.keys(snapshot.chats ?? {}).length,
    messageCount: Object.values(snapshot.messages ?? {}).reduce(
      (count, messages) => count + Object.keys(messages).length,
      0,
    ),
    mediaCount: snapshot.media?.length ?? 0,
    includeMedia: snapshot.includeMedia,
    sizeBytes,
  };
}

async function locateBackup(
  accountId: string,
  id: string,
): Promise<
  { path: string; framed: true } | { path: string; framed: false; snapshot: Snapshot } | null
> {
  if (!validBackupId(id)) return null;
  for (const path of [
    snapshotPath(accountId, id),
    ...BACKUP_ROOTS.map((root) => join(root, `${id}.json`)),
  ]) {
    if (!existsSync(path)) continue;
    try {
      if (path === snapshotPath(accountId, id) && existsSync(`${path}.meta`)) {
        const metadata = JSON.parse(await readFile(`${path}.meta`, "utf8"));
        if (metadata.framed === true) {
          if (
            metadata.accountId !== accountId ||
            metadata.id !== id ||
            metadata.sizeBytes !== (await stat(path)).size
          )
            continue;
          for await (const line of snapshotLines(path)) {
            const header = parseHeader(line);
            if (
              header.schema === SCHEMA &&
              header.version === VERSION &&
              header.accountId === accountId
            )
              return { path, framed: true };
            break;
          }
          continue;
        }
      }
      const snapshot = JSON.parse(await readFile(path, "utf8")) as Snapshot;
      if (
        snapshot.schema === SCHEMA &&
        snapshot.version === VERSION &&
        snapshot.accountId === accountId
      )
        return { path, framed: false, snapshot };
    } catch {
      /* Try the next legacy location without modifying its data. */
    }
  }
  return null;
}

export async function readBackup(accountId: string, id: string): Promise<Snapshot | null> {
  const found = await locateBackup(accountId, id);
  if (!found) return null;
  return found.framed
    ? (JSON.parse(await readFile(found.path, "utf8")) as Snapshot)
    : found.snapshot;
}

async function restoreFramedBackup(accountId: string, path: string, options: RestoreOptions) {
  const selected = options.chatMids?.length ? new Set(options.chatMids) : null;
  const chats: Snapshot["chats"] = Object.create(null);
  const messages: Snapshot["messages"] = Object.create(null);
  let stage: "header" | "chats" | "messages" | "media" = "header";
  let chatMid: string | null = null;
  let restoredChats = 0;
  let restoredMessages = 0;
  let restoredMedia = 0;
  let imported = false;
  let completed = false;
  let newMediaBytes = 0;
  const mediaKeys = new Set<string>();
  for await (const raw of snapshotLines(path)) {
    if (stage === "header") {
      const header = parseHeader(raw);
      if (header.accountId !== accountId || header.schema !== SCHEMA || header.version !== VERSION)
        throw new Error("バックアップのアカウントが一致しません");
      stage = "chats";
      continue;
    }
    if (raw === '},"messages":{') {
      stage = "messages";
      continue;
    }
    if (raw === '},"media":[') {
      imported = true;
      stage = "media";
      if (!options.includeMedia) {
        completed = true;
        break;
      }
      continue;
    }
    const line = raw.startsWith(",") ? raw.slice(1) : raw;
    if (stage === "chats") {
      const pair = JSON.parse(`{${line}}`) as Snapshot["chats"];
      for (const [mid, chat] of Object.entries(pair))
        if (!selected || selected.has(mid)) chats[mid] = chat;
    } else if (stage === "messages") {
      if (line === "}") {
        chatMid = null;
        continue;
      }
      if (chatMid === null) {
        chatMid = JSON.parse(line.slice(0, -2)) as string;
        continue;
      }
      if (!selected || selected.has(chatMid)) {
        messages[chatMid] ??= Object.create(null);
        Object.assign(messages[chatMid]!, JSON.parse(`{${line}}`));
      }
    } else if (stage === "media") {
      if (line === "]}") {
        completed = true;
        break;
      }
      const entry = JSON.parse(line) as Snapshot["media"][number];
      if (
        messages[entry.chatMid]?.[entry.messageId] &&
        (!selected || selected.has(entry.chatMid))
      ) {
        const key = JSON.stringify([entry.chatMid, entry.messageId]);
        if (
          !mediaKeys.has(key) &&
          !(await statMediaStorage(accountId, entry.chatMid, entry.messageId))
        ) {
          newMediaBytes += Buffer.byteLength(entry.data, "base64");
          mediaKeys.add(key);
        }
      }
    }
  }
  if (!imported || !completed) throw new Error("バックアップが途中で切れています");
  const usage = await getBackupStorageUsage(accountId, messages);
  const result = await mergeImportedChatDb(
    accountId,
    { chats, messages },
    usage.limitBytes - usage.backupBytes - usage.mediaBytes - newMediaBytes,
  );
  restoredChats = result.importedChats;
  restoredMessages = result.importedMessages;
  if (options.includeMedia && mediaKeys.size) {
    let readingMedia = false;
    for await (const raw of snapshotLines(path)) {
      if (raw === '},"media":[') {
        readingMedia = true;
        continue;
      }
      if (!readingMedia) continue;
      const line = raw.startsWith(",") ? raw.slice(1) : raw;
      if (line === "]}") break;
      const entry = JSON.parse(line) as Snapshot["media"][number];
      const key = JSON.stringify([entry.chatMid, entry.messageId]);
      if (mediaKeys.delete(key)) restoredMedia += await restoreMediaEntry(accountId, entry);
    }
  }
  await flushAccountChatDb(accountId);
  return { restoredChats, restoredMessages, restoredMedia };
}

async function restoreMediaEntry(
  accountId: string,
  entry: Snapshot["media"][number],
): Promise<number> {
  if (await statMediaStorage(accountId, entry.chatMid, entry.messageId)) return 0;
  try {
    await writeMediaStorage(
      accountId,
      entry.chatMid,
      entry.messageId,
      bytesFromBase64(entry.data),
      entry.contentType,
    );
    return (await readMediaStorage(accountId, entry.chatMid, entry.messageId)) ? 1 : 0;
  } catch (err) {
    log.debug({ err }, "media restore skipped");
    return 0;
  }
}

export async function restoreBackup(
  accountId: string,
  id: string,
  options: RestoreOptions,
): Promise<{ restoredChats: number; restoredMessages: number; restoredMedia: number }> {
  return withAccountBackupLock(accountId, () => restoreAccountBackup(accountId, id, options));
}

async function restoreAccountBackup(accountId: string, id: string, options: RestoreOptions) {
  const found = await locateBackup(accountId, id);
  if (!found) {
    throw new Error("バックアップが見つかりません");
  }
  if (found.framed) return restoreFramedBackup(accountId, found.path, options);
  const snapshot = found.snapshot;

  const pickChats =
    options.chatMids && options.chatMids.length > 0 ? new Set(options.chatMids) : null;

  const chats: Record<string, StoredChat> = {};
  const messages: Record<string, Record<string, StoredMessage>> = {};
  for (const [mid, chat] of Object.entries(snapshot.chats)) {
    if (pickChats && !pickChats.has(mid)) continue;
    chats[mid] = chat;
    const byChat = snapshot.messages[mid] ?? {};
    const filtered: Record<string, StoredMessage> = {};
    for (const [id2, msg] of Object.entries(byChat)) {
      filtered[id2] = msg;
    }
    if (Object.keys(filtered).length > 0) messages[mid] = filtered;
  }

  // Restoring the same snapshot again must not duplicate messages or replace
  // newer live messages with the old copy from the snapshot.
  const mediaToRestore: Snapshot["media"] = [];
  const mediaKeys = new Set<string>();
  if (options.includeMedia) {
    for (const entry of snapshot.media) {
      if (!messages[entry.chatMid]?.[entry.messageId]) continue;
      const key = JSON.stringify([entry.chatMid, entry.messageId]);
      if (mediaKeys.has(key) || (await statMediaStorage(accountId, entry.chatMid, entry.messageId)))
        continue;
      mediaKeys.add(key);
      mediaToRestore.push(entry);
    }
  }
  const newMediaBytes = mediaToRestore.reduce(
    (total, entry) => total + Buffer.byteLength(entry.data, "base64"),
    0,
  );
  const usage = await getBackupStorageUsage(accountId, messages);
  const imported = await mergeImportedChatDb(
    accountId,
    { chats, messages },
    usage.limitBytes - usage.backupBytes - usage.mediaBytes - newMediaBytes,
  );

  let restoredMedia = 0;
  if (options.includeMedia) {
    for (const entry of mediaToRestore) {
      restoredMedia += await restoreMediaEntry(accountId, entry);
    }
  }

  await flushAccountChatDb(accountId);

  log.info(
    {
      accountId,
      id,
      chats: imported.importedChats,
      messages: imported.importedMessages,
      restoredMedia,
    },
    "VylineBackup restored",
  );

  return {
    restoredChats: imported.importedChats,
    restoredMessages: imported.importedMessages,
    restoredMedia,
  };
}

export async function deleteBackup(accountId: string, id: string): Promise<boolean> {
  return withAccountBackupLock(accountId, async () => {
    const found = await locateBackup(accountId, id);
    if (!found) return false;
    await unlink(found.path);
    await unlink(`${found.path}.meta`).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return true;
  });
}
