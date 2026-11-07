import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { decryptDesktopEdbSnapshot } from "@vyline/protocol/desktop/edb";
import type { Chat } from "@vyline/types";
import { getClient } from "../line/clientManager.js";
import {
  getStoredChats,
  flushAccountChatDb,
  insertRestoredMessages,
  type StoredMessage,
  upsertChats,
} from "../storage/chatStore.js";
import {
  mapDesktopMessageRow,
  mergeRestoredDesktopChat,
  type DesktopChatDescriptor,
  type DesktopMessageRow,
} from "./desktopHistoryRestore.js";

const MESSAGE_BATCH_SIZE = 500;

export type DesktopHistoryRestoreErrorCode =
  | "DESKTOP_RESTORE_CONSENT_REQUIRED"
  | "DESKTOP_RESTORE_UNSUPPORTED_PLATFORM"
  | "DESKTOP_RESTORE_NOT_LOGGED_IN"
  | "DESKTOP_RESTORE_ACCOUNT_UNAVAILABLE"
  | "DESKTOP_RESTORE_DATABASE_NOT_FOUND"
  | "DESKTOP_RESTORE_PROCESS_NOT_RUNNING"
  | "DESKTOP_RESTORE_MULTIPLE_PROCESSES"
  | "DESKTOP_RESTORE_WRONG_PROCESS"
  | "DESKTOP_RESTORE_KEY_SCAN_FAILED"
  | "DESKTOP_RESTORE_KEY_NOT_FOUND"
  | "DESKTOP_RESTORE_SOURCE_CHANGED"
  | "DESKTOP_RESTORE_DATABASE_INVALID"
  | "DESKTOP_RESTORE_ACCOUNT_MISMATCH"
  | "DESKTOP_RESTORE_IMPORT_FAILED";

export class DesktopHistoryRestoreError extends Error {
  constructor(
    readonly code: DesktopHistoryRestoreErrorCode,
    readonly stage: string,
    message: string,
  ) {
    super(message);
    this.name = "DesktopHistoryRestoreError";
  }
}

const DESKTOP_RESTORE_FAILURES: Record<
  DesktopHistoryRestoreErrorCode,
  { stage: string; message: string }
> = {
  DESKTOP_RESTORE_CONSENT_REQUIRED: {
    stage: "consent",
    message: "復元前にプロセスメモリ走査への同意が必要です。",
  },
  DESKTOP_RESTORE_UNSUPPORTED_PLATFORM: {
    stage: "platform-check",
    message: "LINE Desktop履歴の取り込みはWindowsで利用できます。",
  },
  DESKTOP_RESTORE_NOT_LOGGED_IN: {
    stage: "session-check",
    message: "Vylineにログインしてから再試行してください。",
  },
  DESKTOP_RESTORE_ACCOUNT_UNAVAILABLE: {
    stage: "account-check",
    message: "Vylineのログインアカウントを確認できません。再ログイン後に再試行してください。",
  },
  DESKTOP_RESTORE_DATABASE_NOT_FOUND: {
    stage: "source-selection",
    message: "選択したLINE Desktopデータベースが見つかりません。再読み込みして選び直してください。",
  },
  DESKTOP_RESTORE_PROCESS_NOT_RUNNING: {
    stage: "process-scan",
    message:
      "公式LINE Desktopが見つかりません。Windows版LINE Desktopにログインして再試行してください。",
  },
  DESKTOP_RESTORE_MULTIPLE_PROCESSES: {
    stage: "process-scan",
    message: "LINE Desktopが複数起動しています。1つだけ残して再試行してください。",
  },
  DESKTOP_RESTORE_WRONG_PROCESS: {
    stage: "process-scan",
    message: "公式LINE Desktopのプロセスを確認できません。公式アプリを起動して再試行してください。",
  },
  DESKTOP_RESTORE_KEY_SCAN_FAILED: {
    stage: "key-scan",
    message:
      "LINE Desktopの復号鍵を読み取れませんでした。LINE Desktopにログインした状態で再試行してください。",
  },
  DESKTOP_RESTORE_KEY_NOT_FOUND: {
    stage: "key-match",
    message:
      "選択した履歴に対応する復号鍵が見つかりません。対象アカウントでLINE Desktopにログインし、再試行してください。",
  },
  DESKTOP_RESTORE_SOURCE_CHANGED: {
    stage: "source-read",
    message: "LINE Desktopのデータが更新中です。しばらく待ってから再試行してください。",
  },
  DESKTOP_RESTORE_DATABASE_INVALID: {
    stage: "database-validation",
    message: "復号した履歴データの整合性を確認できません。別のデータベースを選んでください。",
  },
  DESKTOP_RESTORE_ACCOUNT_MISMATCH: {
    stage: "account-validation",
    message:
      "LINE Desktopの履歴とVylineのログインアカウントが一致しません。アカウントを確認してください。",
  },
  DESKTOP_RESTORE_IMPORT_FAILED: {
    stage: "merge-and-save",
    message:
      "履歴の取り込み完了を確認できませんでした。トーク一覧を再読み込みして状態を確認してください。",
  },
};

export function classifyDesktopHistoryRestoreFailure(error: unknown): DesktopHistoryRestoreError {
  if (error instanceof DesktopHistoryRestoreError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  let code: DesktopHistoryRestoreErrorCode = "DESKTOP_RESTORE_IMPORT_FAILED";
  if (detail.includes("platform unsupported")) code = "DESKTOP_RESTORE_UNSUPPORTED_PLATFORM";
  else if (detail.includes("key scan failed: no-process"))
    code = "DESKTOP_RESTORE_PROCESS_NOT_RUNNING";
  else if (detail.includes("key scan failed: multiple-processes"))
    code = "DESKTOP_RESTORE_MULTIPLE_PROCESSES";
  else if (detail.includes("key scan failed: wrong-process"))
    code = "DESKTOP_RESTORE_WRONG_PROCESS";
  else if (detail.includes("key scan failed")) code = "DESKTOP_RESTORE_KEY_SCAN_FAILED";
  else if (detail.includes("No local Desktop key matched")) code = "DESKTOP_RESTORE_KEY_NOT_FOUND";
  else if (detail.includes("changed during the read")) code = "DESKTOP_RESTORE_SOURCE_CHANGED";
  else if (detail.includes("database was not found")) code = "DESKTOP_RESTORE_DATABASE_NOT_FOUND";
  else if (detail.includes("not logged in")) code = "DESKTOP_RESTORE_NOT_LOGGED_IN";
  else if (detail.includes("MID")) code = "DESKTOP_RESTORE_ACCOUNT_UNAVAILABLE";
  else if (detail.includes("does not match")) code = "DESKTOP_RESTORE_ACCOUNT_MISMATCH";
  else if (
    detail.includes("integrity") ||
    detail.includes("database disk image") ||
    detail.includes("not a database") ||
    detail.includes("database deserialize failed")
  )
    code = "DESKTOP_RESTORE_DATABASE_INVALID";
  const failure = DESKTOP_RESTORE_FAILURES[code];
  return new DesktopHistoryRestoreError(code, failure.stage, failure.message);
}

export interface DesktopHistoryDatabaseOption {
  id: string;
  sizeBytes: number;
  modifiedAt: string;
  walSizeBytes: number;
}

function desktopDbDirectory(): string {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(local, "LINE", "Data", "db");
}

function listDesktopDatabases(): Array<DesktopHistoryDatabaseOption & { path: string }> {
  if (process.platform !== "win32") return [];
  const directory = desktopDbDirectory();
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(
      (name) =>
        name.endsWith(".edb") &&
        !name.startsWith("album_") &&
        !name.startsWith("chatStats_") &&
        !name.startsWith("keep_"),
    )
    .map((name) => {
      const path = join(directory, name);
      const file = statSync(path);
      const walPath = `${path}-wal`;
      const walSizeBytes = existsSync(walPath) ? statSync(walPath).size : 0;
      const id = createHash("sha256").update(name).digest("hex").slice(0, 16);
      return {
        id,
        path,
        sizeBytes: file.size,
        modifiedAt: file.mtime.toISOString(),
        walSizeBytes,
      };
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

export function getDesktopHistoryDatabaseOptions(): {
  supported: boolean;
  databases: DesktopHistoryDatabaseOption[];
} {
  const databases = listDesktopDatabases();
  return {
    supported: process.platform === "win32",
    databases: databases.map(({ path: _path, ...option }) => option),
  };
}

function chatDescriptor(db: Database, mid: string): DesktopChatDescriptor {
  const row = db
    .query(
      `SELECT c._id AS mid,
        COALESCE(NULLIF(g._chatName, ''), NULLIF(p._displayNameOverridden, ''),
          NULLIF(p._displayName, ''), c._id) AS name
       FROM _chat c
       LEFT JOIN _groupChat g ON g._chatMid=c._id
       LEFT JOIN _contact p ON p._mid=c._id
       WHERE c._id=? LIMIT 1`,
    )
    .get(mid) as { mid: string; name: string } | null;
  const name = row?.name?.trim() || mid;
  const kind: Chat["kind"] = mid.startsWith("c")
    ? "group"
    : mid.startsWith("r")
      ? "room"
      : mid.startsWith("u")
        ? "direct"
        : "unknown";
  return { mid, name, kind };
}

function asMessageRow(value: unknown): DesktopMessageRow {
  return value as DesktopMessageRow;
}

export async function restoreDesktopMessages(
  accountId: string,
  databaseId: string,
  acceptedMemoryScan: boolean,
) {
  if (!acceptedMemoryScan) {
    const failure = DESKTOP_RESTORE_FAILURES.DESKTOP_RESTORE_CONSENT_REQUIRED;
    throw new DesktopHistoryRestoreError(
      "DESKTOP_RESTORE_CONSENT_REQUIRED",
      failure.stage,
      failure.message,
    );
  }
  if (process.platform !== "win32")
    throw new DesktopHistoryRestoreError(
      "DESKTOP_RESTORE_UNSUPPORTED_PLATFORM",
      DESKTOP_RESTORE_FAILURES.DESKTOP_RESTORE_UNSUPPORTED_PLATFORM.stage,
      DESKTOP_RESTORE_FAILURES.DESKTOP_RESTORE_UNSUPPORTED_PLATFORM.message,
    );
  const client = getClient(accountId);
  if (!client) throw classifyDesktopHistoryRestoreFailure(new Error("not logged in"));
  const myMid = client.base.profile?.mid;
  if (!myMid) throw classifyDesktopHistoryRestoreFailure(new Error("account MID unavailable"));

  const selected = listDesktopDatabases().find((database) => database.id === databaseId);
  if (!selected) throw classifyDesktopHistoryRestoreFailure(new Error("database was not found"));

  let decrypted: ReturnType<typeof decryptDesktopEdbSnapshot>;
  try {
    decrypted = decryptDesktopEdbSnapshot(selected.path, 0, true);
  } catch (error) {
    throw classifyDesktopHistoryRestoreFailure(error);
  }
  const snapshot = decrypted.database;
  let db: Database | undefined;
  try {
    // The source is a read-only snapshot after WAL replay. Force rollback-journal mode only
    // in this private buffer so SQLite does not try to open adjacent sidecars.
    snapshot[18] = 1;
    snapshot[19] = 1;
    try {
      db = Database.deserialize(snapshot, true);
    } catch {
      throw classifyDesktopHistoryRestoreFailure(new Error("database deserialize failed"));
    }
    const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok")
      throw classifyDesktopHistoryRestoreFailure(new Error("integrity check failed"));

    const belongsToAccount = db
      .query("SELECT 1 AS found FROM _contact WHERE _mid=? LIMIT 1")
      .get(myMid) as { found: number } | null;
    if (!belongsToAccount) {
      throw classifyDesktopHistoryRestoreFailure(new Error("account does not match"));
    }

    const existingChats = new Map(
      (await getStoredChats(accountId)).map((chat) => [chat.mid, chat]),
    );
    const chatRows = db
      .query("SELECT _chatId AS mid FROM _message WHERE _chatId IS NOT NULL GROUP BY _chatId")
      .all() as Array<{ mid: string }>;
    const now = new Date().toISOString();
    let importedMessages = 0;
    let importedChats = 0;
    let oldestCreatedTimeMs: number | null = null;
    let newestCreatedTimeMs: number | null = null;

    for (const { mid } of chatRows) {
      if (!mid) continue;
      const rangeRow = db
        .query(
          "SELECT MIN(_createdTime) AS oldest, MAX(_createdTime) AS newest FROM _message WHERE _chatId=?",
        )
        .get(mid) as { oldest: number | null; newest: number | null };
      const latestRow = db
        .query(
          `SELECT _chatId,_id,_from,_to,_createdTime,_text,_contentType,_contentMetadata
           FROM _message WHERE _chatId=? ORDER BY _createdTime DESC,_id DESC LIMIT 1`,
        )
        .get(mid) as DesktopMessageRow | null;
      const latest = latestRow ? mapDesktopMessageRow(latestRow, myMid, now) : null;
      if (!latest) continue;

      const descriptor = chatDescriptor(db, mid);
      const mergedChat = mergeRestoredDesktopChat(existingChats.get(mid), descriptor, latest, now);
      await upsertChats(accountId, [mergedChat]);
      importedChats++;
      const chatOldest = Number(rangeRow.oldest);
      oldestCreatedTimeMs =
        oldestCreatedTimeMs == null ? chatOldest : Math.min(oldestCreatedTimeMs, chatOldest);
      newestCreatedTimeMs =
        newestCreatedTimeMs == null
          ? Number(rangeRow.newest)
          : Math.max(newestCreatedTimeMs, Number(rangeRow.newest));

      const query = db.query(
        `SELECT _chatId,_id,_from,_to,_createdTime,_text,_contentType,_contentMetadata
         FROM _message WHERE _chatId=? ORDER BY _createdTime,_id`,
      );
      let batch: StoredMessage[] = [];
      for (const raw of query.iterate(mid)) {
        const message = mapDesktopMessageRow(asMessageRow(raw), myMid, now);
        if (!message) continue;
        batch.push(message);
        if (batch.length >= MESSAGE_BATCH_SIZE) {
          importedMessages += await insertRestoredMessages(accountId, mid, batch);
          batch = [];
        }
      }
      if (batch.length) {
        importedMessages += await insertRestoredMessages(accountId, mid, batch);
      }
    }

    // A concurrent chat sync may already have deferred writes in the account cache.
    // Do not report restoration complete until imported rows and chat summaries are durable.
    await flushAccountChatDb(accountId);

    return {
      ok: true as const,
      importedChats,
      importedMessages,
      oldestCreatedTimeMs,
      newestCreatedTimeMs,
      wal: decrypted.wal,
      hint: "既存の既読状態・取消し記録を保護して差分統合しました。途中で停止した場合は同じ操作を再実行できます。",
    };
  } finally {
    db?.close();
    snapshot.fill(0);
    decrypted.database.fill(0);
  }
}
