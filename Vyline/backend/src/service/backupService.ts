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
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import {
  exportChatDb,
  mergeImportedChatDb,
  listChatsWithCounts,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";
import { readMediaStorage, writeMediaStorage } from "../storage/mediaStorage.js";
import { safePathComponent, writeTextAtomic } from "../storage/safeFile.js";

const log = childLogger("vyline-backup");

const _dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKUP_DIR = join(_dir, "../../data/backups");
function backupDir(): string {
  return process.env.VYLINE_BACKUP_DIR ?? DEFAULT_BACKUP_DIR;
}

const SCHEMA = "vyline-backup";
const VERSION = 2;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

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
  /** 既読位置・同期カーソルなど。旧 v1 には存在しない。 */
  meta?: Record<string, unknown>;
  /** JSON本文（integrityを除く）のsha256。v2で必須。 */
  integrity?: { algorithm: "sha256"; sha256: string; bytes: number };
  deletedAt?: string;
}

function snapshotPath(id: string): string {
  return join(backupDir(), `${id}.json`);
}

function backupAccountComponent(accountId: string): string {
  return safePathComponent(accountId, "account").replace(/\.+/g, "_");
}

function idFor(accountId: string, date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `vyline-backup-${backupAccountComponent(accountId)}-${stamp}-${randomUUID().slice(0, 8)}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digestSnapshot(snapshot: Omit<Snapshot, "integrity">): {
  body: string;
  integrity: NonNullable<Snapshot["integrity"]>;
} {
  const body = JSON.stringify(snapshot);
  return {
    body,
    integrity: {
      algorithm: "sha256",
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: Buffer.byteLength(body),
    },
  };
}

function validBase64(value: unknown): value is string {
  return (
    typeof value === "string" && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  );
}

function isSafeRecordKey(value: string): boolean {
  return value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

/** 旧形式も受け入れつつ、壊れた/別アカウントのレコードを復元対象から除外する。 */
function normalizeSnapshot(input: unknown, accountId: string): Snapshot | null {
  if (!isRecord(input) || input.schema !== SCHEMA || input.accountId !== accountId) return null;
  const version = typeof input.version === "number" ? input.version : 1;
  if (version < 1 || version > VERSION || typeof input.createdAt !== "string") return null;
  if (!isRecord(input.chats) || !isRecord(input.messages) || !Array.isArray(input.media))
    return null;

  if (version >= 2) {
    const integrity = input.integrity;
    if (
      !isRecord(integrity) ||
      integrity.algorithm !== "sha256" ||
      typeof integrity.sha256 !== "string"
    )
      return null;
    const { integrity: _ignored, ...withoutIntegrity } = input as Snapshot &
      Record<string, unknown>;
    const body = JSON.stringify(withoutIntegrity);
    if (createHash("sha256").update(body).digest("hex") !== integrity.sha256) return null;
  }

  const chats: Record<string, StoredChat> = {};
  for (const [mid, value] of Object.entries(input.chats)) {
    if (isSafeRecordKey(mid) && isRecord(value) && value.mid === mid) {
      chats[mid] = value as unknown as StoredChat;
    }
  }
  const messages: Record<string, Record<string, StoredMessage>> = {};
  for (const [chatMid, value] of Object.entries(input.messages)) {
    if (!isSafeRecordKey(chatMid) || !isRecord(value)) continue;
    const byChat: Record<string, StoredMessage> = {};
    for (const [messageId, message] of Object.entries(value)) {
      if (
        !isSafeRecordKey(messageId) ||
        !isRecord(message) ||
        message.id !== messageId ||
        message.chatMid !== chatMid
      )
        continue;
      byChat[messageId] = message as unknown as StoredMessage;
    }
    if (Object.keys(byChat).length) messages[chatMid] = byChat;
  }
  const media = input.media.filter(
    (entry): entry is Snapshot["media"][number] =>
      isRecord(entry) &&
      typeof entry.chatMid === "string" &&
      typeof entry.messageId === "string" &&
      typeof entry.contentType === "string" &&
      validBase64(entry.data) &&
      Boolean(messages[entry.chatMid]?.[entry.messageId]),
  );
  return {
    schema: SCHEMA,
    version,
    createdAt: input.createdAt,
    accountId,
    includeMedia: input.includeMedia === true,
    chatMids: Array.isArray(input.chatMids)
      ? input.chatMids.filter((v): v is string => typeof v === "string")
      : null,
    chats,
    messages,
    media,
    ...(isRecord(input.meta) ? { meta: input.meta } : {}),
    ...(isRecord(input.integrity)
      ? { integrity: input.integrity as NonNullable<Snapshot["integrity"]> }
      : {}),
    ...(typeof input.deletedAt === "string" ? { deletedAt: input.deletedAt } : {}),
  };
}

export async function ensureBackupDir(): Promise<void> {
  await mkdir(backupDir(), { recursive: true });
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

  // Keep the exported containers when taking a full backup. Re-copying every
  // message here briefly doubled the history footprint before JSON encoding.
  const chats: Record<string, StoredChat> = pickChats ? {} : db.chats;
  const messages: Record<string, Record<string, StoredMessage>> = pickChats ? {} : db.messages;
  let messageCount = 0;

  for (const [mid, chat] of Object.entries(db.chats)) {
    if (pickChats && !pickChats.has(mid)) continue;
    if (pickChats) chats[mid] = chat;
    const byChat = db.messages[mid] ?? {};
    if (pickChats) {
      const filtered: Record<string, StoredMessage> = {};
      for (const [id, msg] of Object.entries(byChat)) filtered[id] = msg;
      if (Object.keys(filtered).length > 0) messages[mid] = filtered;
    }
    messageCount += Object.keys(byChat).length;
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
  const unsigned: Omit<Snapshot, "integrity"> = {
    schema: SCHEMA,
    version: VERSION,
    createdAt: new Date().toISOString(),
    accountId,
    includeMedia: options.includeMedia,
    chatMids: pickChats ? [...pickChats] : null,
    chats,
    messages,
    media,
    meta: db.meta as unknown as Record<string, unknown>,
  };
  const signed = digestSnapshot(unsigned);
  // Append integrity to the already serialized unsigned body. This avoids a
  // second full object serialization and its duplicate temporary string.
  const body = `${signed.body.slice(0, -1)},"integrity":${JSON.stringify(signed.integrity)}}`;
  if (Buffer.byteLength(body) > MAX_BACKUP_BYTES) {
    throw new Error(`バックアップが上限 ${MAX_BACKUP_BYTES} bytes を超えます`);
  }
  await writeTextAtomic(snapshotPath(id), body);

  log.info(
    { accountId, id, chatCount: Object.keys(chats).length, messageCount, mediaCount: media.length },
    "VylineBackup created",
  );

  return {
    id,
    createdAt: unsigned.createdAt,
    accountId,
    chatCount: Object.keys(chats).length,
    messageCount,
    mediaCount: media.length,
    includeMedia: options.includeMedia,
    sizeBytes: Buffer.byteLength(body),
  };
}

export async function listBackups(accountId: string): Promise<BackupSummary[]> {
  await ensureBackupDir();
  const prefix = `vyline-backup-${backupAccountComponent(accountId)}-`;
  let files: string[] = [];
  try {
    files = await readdir(backupDir());
  } catch {
    return [];
  }
  const summaries: BackupSummary[] = [];
  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    try {
      const raw = await readFile(snapshotPath(id), "utf8");
      const parsed = normalizeSnapshot(JSON.parse(raw), accountId);
      if (!parsed || parsed.deletedAt) continue;
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
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..") || id.length > 240)
    return null;
  const path = snapshotPath(id);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw) > MAX_BACKUP_BYTES) return null;
    const snapshot = normalizeSnapshot(JSON.parse(raw), accountId);
    return snapshot && !snapshot.deletedAt ? snapshot : null;
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

  // 追加マージにより、古いバックアップで現在の既読・取消し・新着本文を
  // 巻き戻さない。新規メッセージとソフト削除フラグはそのまま保持する。
  const imported = await mergeImportedChatDb(accountId, {
    ...(snapshot.meta
      ? {
          meta: snapshot.meta as NonNullable<Parameters<typeof mergeImportedChatDb>[1]["meta"]>,
        }
      : {}),
    chats,
    messages,
  });

  let restoredMedia = 0;
  if (options.includeMedia) {
    for (const entry of snapshot.media) {
      if (pickChats && !pickChats.has(entry.chatMid)) continue;
      try {
        if (!validBase64(entry.data)) continue;
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
  const snapshot = await readBackup(accountId, id);
  if (!snapshot) return false;
  try {
    const { body, integrity } = digestSnapshot({
      ...snapshot,
      deletedAt: new Date().toISOString(),
      integrity: undefined,
    } as Omit<Snapshot, "integrity">);
    await writeTextAtomic(
      snapshotPath(id),
      JSON.stringify({
        ...JSON.parse(body),
        integrity,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
