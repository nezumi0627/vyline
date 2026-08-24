import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractAndParseLineHistory,
  type MessageRecord,
  type ParsedChatHistory,
} from "@vyline/ios-backup";
import type { MessageContentMeta } from "@vyline/types";
import {
  mergeImportedChatDb,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";
import { childLogger } from "../logger.js";

const log = childLogger("ios-backup");

export interface IosBackupDevice {
  udid: string;
  name: string;
  iOSVersion: string;
  deviceType: string;
  encrypted: boolean;
  passcodeSet: boolean;
  backupRoot: string;
  modifiedAt: string;
}

export interface IosBackupProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
  file?: string;
}

export interface IosBackupSession {
  id: string;
  accountId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: IosBackupProgress | null;
  result: {
    deviceId: string;
    backupDate: string;
    extracted: { lineFiles: number; databases: number };
    parsed: { chats: number; totalMessages: number };
    merged: {
      importedChats: number;
      skippedChats: number;
      importedMessages: number;
      skippedMessages: number;
    };
  } | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

const sessions = new Map<string, IosBackupSession>();

function backupRoots(): string[] {
  const configured = process.env.IOS_BACKUP_ROOT?.trim();
  if (configured) return [configured];
  const home = homedir();
  return [
    join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Apple Computer", "MobileSync", "Backup"),
    join(home, "Apple", "MobileSync", "Backup"),
    join(home, "Library", "Application Support", "MobileSync", "Backup"),
  ];
}

async function findBackups(): Promise<IosBackupDevice[]> {
  const devices: IosBackupDevice[] = [];
  const seen = new Set<string>();
  for (const root of backupRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const backupRoot = join(root, entry.name);
      if (!existsSync(join(backupRoot, "Manifest.plist")) || !existsSync(join(backupRoot, "Manifest.db"))) {
        continue;
      }
      seen.add(entry.name);
      const info = await stat(backupRoot);
      devices.push({
        udid: entry.name,
        name: entry.name,
        iOSVersion: "不明（復元時に確認）",
        deviceType: "iPhone / iPad",
        encrypted: true,
        passcodeSet: true,
        backupRoot: root,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }
  return devices.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function listIosBackups(): Promise<IosBackupDevice[]> {
  return findBackups();
}

export async function startIosBackupRestore(
  accountId: string,
  udid: string,
  password: string,
): Promise<IosBackupSession> {
  if (!accountId) throw new Error("accountId が必要です");
  if (!password) throw new Error("暗号化バックアップのパスワードが必要です");
  const device = (await findBackups()).find((item) => item.udid === udid);
  if (!device) throw new Error("指定された iOS バックアップが見つかりません");

  const id = `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session: IosBackupSession = {
    id,
    accountId,
    status: "pending",
    progress: null,
    result: null,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
  };
  sessions.set(id, session);
  void runRestore(session, device, password);
  return session;
}

export function getIosBackupSession(accountId: string, id: string): IosBackupSession | null {
  const session = sessions.get(id);
  return session?.accountId === accountId ? session : null;
}

async function runRestore(
  session: IosBackupSession,
  device: IosBackupDevice,
  password: string,
): Promise<void> {
  session.status = "running";
  const outputDir = await mkdtemp(join(tmpdir(), `vyline-ios-${session.id}-`));
  try {
    const result = await extractAndParseLineHistory(
      device.backupRoot,
      device.udid,
      password,
      outputDir,
      (stage, current, total, message) => {
        session.progress = { stage, current, total, message };
      },
    );
    const records = historyToChatDb(result.parsed, session.accountId);
    const merged = await mergeImportedChatDb(session.accountId, records);
    const totalMessages = Array.from(result.parsed.messages.values()).reduce(
      (sum, messages) => sum + messages.length,
      0,
    );
    session.result = {
      deviceId: device.udid,
      backupDate: device.modifiedAt,
      extracted: {
        lineFiles: result.extracted.lineFiles.length,
        databases: result.extracted.databases.length,
      },
      parsed: { chats: result.parsed.chats.length, totalMessages },
      merged,
    };
    session.status = "completed";
    session.completedAt = Date.now();
  } catch (error) {
    session.status = "failed";
    session.error = error instanceof Error ? error.message : "iOSバックアップの復元に失敗しました";
    session.completedAt = Date.now();
    log.warn({ accountId: session.accountId, deviceId: device.udid, error }, "iOS backup restore failed");
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function historyToChatDb(
  history: ParsedChatHistory,
  accountId: string,
): { chats: Record<string, StoredChat>; messages: Record<string, Record<string, StoredMessage>> } {
  const myMid = history.account || accountId;
  const chats: Record<string, StoredChat> = {};
  const messages: Record<string, Record<string, StoredMessage>> = {};
  const now = new Date().toISOString();

  for (const info of history.chats) {
    const chatMessages = history.messages.get(info.chatMid) ?? [];
    const mapped = chatMessages.map((message) => mapMessage(message, info.chatMid, myMid, now));
    const last = mapped[mapped.length - 1];
    chats[info.chatMid] = {
      mid: info.chatMid,
      name: info.name || info.chatMid,
      kind: info.kind === "group" ? "group" : info.kind === "dm" ? "direct" : "unknown",
      hasMessages: mapped.length > 0,
      ...(last ? {
        lastMessageTime: last.createdTime,
        lastMessageId: last.id,
        lastMessagePreview: last.text ?? `[${last.contentType}]`,
      } : {}),
      updatedAt: now,
    };
    if (mapped.length > 0) {
      messages[info.chatMid] = Object.fromEntries(mapped.map((message) => [message.id, message]));
    }
  }
  return { chats, messages };
}

function mapMessage(
  message: MessageRecord,
  chatMid: string,
  myMid: string,
  savedAt: string,
): StoredMessage {
  const from = message.fromMid || myMid;
  const isMyMessage = from === myMid || message.fromMid === null;
  return {
    id: String(message.id),
    chatMid,
    from,
    to: isMyMessage ? chatMid : myMid,
    text: message.text,
    contentType: iosContentType(message.contentType),
    createdTime: Number.isFinite(message.ts) ? message.ts : 0,
    isMyMessage,
    ...(message.contentMetadata ? { contentMetadata: toContentMetadata(message.contentMetadata) } : {}),
    savedAt,
  };
}

function iosContentType(type: number): string {
  return ({ 0: "NONE", 1: "IMAGE", 2: "VIDEO", 3: "AUDIO", 7: "STICKER", 14: "FILE", 17: "RICH", 22: "FLEX" } as Record<number, string>)[type] ?? String(type);
}

function toContentMetadata(value: unknown): MessageContentMeta | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const output: MessageContentMeta = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") output[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") output[key] = String(item);
  }
  return Object.keys(output).length > 0 ? output : null;
}
