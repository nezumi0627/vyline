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
  if (!acceptedMemoryScan) throw new Error("メモリ走査への明示同意が必要です");
  if (process.platform !== "win32")
    throw new Error("LINE Desktop履歴の取り込みはWindowsで利用できます");
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");
  const myMid = client.base.profile?.mid;
  if (!myMid) throw new Error("ログイン中アカウントのMIDを確認できません");

  const selected = listDesktopDatabases().find((database) => database.id === databaseId);
  if (!selected)
    throw new Error("選択したLINE Desktopデータベースが見つかりません。再読み込みしてください");

  const decrypted = decryptDesktopEdbSnapshot(selected.path, 0, true);
  const snapshot = decrypted.database;
  let db: Database | undefined;
  try {
    // The source is a read-only snapshot after WAL replay. Force rollback-journal mode only
    // in this private buffer so SQLite does not try to open adjacent sidecars.
    snapshot[18] = 1;
    snapshot[19] = 1;
    db = Database.deserialize(snapshot, true);
    const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok")
      throw new Error("復号したDesktopデータの整合性を確認できません");

    const belongsToAccount = db
      .query("SELECT 1 AS found FROM _contact WHERE _mid=? LIMIT 1")
      .get(myMid) as { found: number } | null;
    if (!belongsToAccount) {
      throw new Error("選択したDesktopデータとログイン中のLINEアカウントが一致しません");
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
