/**
 * backupService.ts — VylineBackup（セルフホスト向け履歴バックアップ / 復元）
 *
 * chatdb の全チャット・メッセージ（送信タイミング・スタンプ・Flex 等の文字管理系を
 * 含む）をスナップショット JSON として data/backups/ に保存する。
 * オプションでメディア（画像/動画/音声/ファイル）を base64 で同梱できる。
 * 復元時は「すべて / チャット毎」「メディア含む / テキストのみ」を選べる。
 * 新規端末への移行はバックアップファイルを新端末でアップロード→復元で行う。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import {
  exportChatDb,
  importChatDb,
  listChatsWithCounts,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";
import { readMediaStorage, writeMediaStorage } from "../storage/mediaStorage.js";

const log = childLogger("vyline-backup");

const _dir = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = process.env.VYLINE_BACKUP_DIR ?? join(_dir, "../../data/backups");

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

function snapshotPath(id: string): string {
  return join(BACKUP_DIR, `${id}.json`);
}

function idFor(accountId: string, date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `vyline-backup-${accountId}-${stamp}`;
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
  await ensureBackupDir();
  const db = await exportChatDb(accountId);

  const pickChats =
    options.chatMids && options.chatMids.length > 0 ? new Set(options.chatMids) : null;

  const chats: Record<string, StoredChat> = {};
  const messages: Record<string, Record<string, StoredMessage>> = {};
  let messageCount = 0;

  for (const [mid, chat] of Object.entries(db.chats)) {
    if (pickChats && !pickChats.has(mid)) continue;
    chats[mid] = chat;
    const byChat = db.messages[mid] ?? {};
    const filtered: Record<string, StoredMessage> = {};
    for (const [id, msg] of Object.entries(byChat)) {
      filtered[id] = msg;
      messageCount++;
    }
    if (Object.keys(filtered).length > 0) messages[mid] = filtered;
  }

  // メディア同梱: 各メッセージの media-cache を messageId 単位で収集
  const media: Snapshot["media"] = [];
  if (options.includeMedia) {
    for (const [chatMid, byChat] of Object.entries(messages)) {
      for (const [messageId, rawMsg] of Object.entries(byChat)) {
        const msg = rawMsg as { contentType?: string };
        const ct = asString(msg.contentType);
        if (!MEDIA_CONTENT_TYPES.has(ct) && !/^[0-9]+$/.test(ct)) continue;
        const cached = await readMediaStorage(accountId, chatMid, messageId);
        if (!cached) continue;
        media.push({
          chatMid,
          messageId,
          contentType: cached.contentType,
          data: base64FromBytes(cached.buf),
        });
      }
    }
  }

  const id = idFor(accountId, new Date());
  const snapshot: Snapshot = {
    schema: SCHEMA,
    version: VERSION,
    createdAt: new Date().toISOString(),
    accountId,
    includeMedia: options.includeMedia,
    chatMids: pickChats ? [...pickChats] : null,
    chats,
    messages,
    media,
  };

  const body = JSON.stringify(snapshot);
  await writeFile(snapshotPath(id), body, "utf8");

  log.info(
    { accountId, id, chatCount: Object.keys(chats).length, messageCount, mediaCount: media.length },
    "VylineBackup created",
  );

  return {
    id,
    createdAt: snapshot.createdAt,
    accountId,
    chatCount: Object.keys(chats).length,
    messageCount,
    mediaCount: media.length,
    includeMedia: options.includeMedia,
    sizeBytes: body.length,
  };
}

export async function listBackups(accountId: string): Promise<BackupSummary[]> {
  await ensureBackupDir();
  const prefix = `vyline-backup-${accountId}-`;
  let files: string[] = [];
  try {
    files = await readdir(BACKUP_DIR);
  } catch {
    return [];
  }
  const summaries: BackupSummary[] = [];
  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    try {
      const raw = await readFile(snapshotPath(id), "utf8");
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      const sizeBytes = (await stat(snapshotPath(id))).size;
      summaries.push({
        id,
        createdAt: parsed.createdAt ?? "",
        accountId: parsed.accountId ?? accountId,
        chatCount: parsed.chats ? Object.keys(parsed.chats).length : 0,
        messageCount: parsed.messages
          ? Object.values(parsed.messages).reduce(
              (acc, byChat) => acc + Object.keys(byChat).length,
              0,
            )
          : 0,
        mediaCount: parsed.media?.length ?? 0,
        includeMedia: parsed.includeMedia ?? false,
        sizeBytes,
      });
    } catch (err) {
      log.warn({ err, id }, "VylineBackup list: unreadable snapshot");
    }
  }
  return summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function readBackup(accountId: string, id: string): Promise<Snapshot | null> {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  const path = snapshotPath(id);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Snapshot;
    if (parsed.schema !== SCHEMA || parsed.accountId !== accountId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function restoreBackup(
  accountId: string,
  id: string,
  options: RestoreOptions,
): Promise<{ restoredChats: number; restoredMessages: number; restoredMedia: number }> {
  const snapshot = await readBackup(accountId, id);
  if (!snapshot) {
    throw new Error("バックアップが見つかりません");
  }

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

  const imported = await importChatDb(accountId, {
    meta: {},
    chats,
    messages,
  });

  let restoredMedia = 0;
  if (options.includeMedia) {
    for (const entry of snapshot.media) {
      if (pickChats && !pickChats.has(entry.chatMid)) continue;
      try {
        await writeMediaStorage(
          accountId,
          entry.chatMid,
          entry.messageId,
          bytesFromBase64(entry.data),
          entry.contentType,
        );
        restoredMedia++;
      } catch (err) {
        log.debug({ err, messageId: entry.messageId }, "media restore skipped");
      }
    }
  }

  log.info(
    { accountId, id, chats: imported.chats, messages: imported.messages, restoredMedia },
    "VylineBackup restored",
  );

  return {
    restoredChats: imported.chats,
    restoredMessages: imported.messages,
    restoredMedia,
  };
}

export async function deleteBackup(accountId: string, id: string): Promise<boolean> {
  const snapshot = await readBackup(accountId, id);
  if (!snapshot) return false;
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(snapshotPath(id));
    return true;
  } catch {
    return false;
  }
}
