/**
 * storage/messageLog.ts — チャット内容・アナウンスのタイミング付き詳細ログ
 *
 * 受信（Push / 履歴同期）・送信されたメッセージを JSONL として
 * data/logs/message-log-<accountId>.jsonl に追記する。
 * 画像・動画・音声・ファイルなどのメディアも messageId / contentType を記録する。
 * ローテーション: 10MB を超えたら .1 / .2 へ shift。
 */

import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { accountDir, ensureAccount } from "./accountDirs.js";

const log = childLogger("message-log");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
const LOG_DIR = process.env.VYLINE_LOG_DIR ?? join(DATA_DIR, "logs");
const ROTATE_BYTES = Number(process.env.VYLINE_MESSAGE_LOG_MAX_BYTES ?? 10 * 1024 * 1024);

export interface MessageLogEntry {
  ts: string;
  tsMillis: number;
  accountId: string;
  kind: "message" | "announcement";
  direction: "in" | "out";
  chatMid: string;
  chatName?: string;
  senderMid: string;
  senderName?: string;
  contentType: string;
  text?: string | null;
  media?: {
    contentType: string;
    mediaId?: string;
    imageSetId?: string;
    attachmentName?: string;
    durationMillis?: number;
    fileSize?: number;
    stickerId?: string;
    packageId?: string;
  };
  /** イベント（参加/退出/名前変更など）の LOC_KEY */
  locKey?: string;
}

const streams = new Map<string, WriteStream>();
const rotatedBytes = new Map<string, number>();
/** 追記バイト数カウンタ（毎回 stat() するコストを避ける） */
const writtenBytes = new Map<string, number>();

function logPath(accountId: string): string {
  ensureAccount(accountId);
  return join(accountDir(accountId), "message-log.jsonl");
}

function legacyLogPath(accountId: string): string {
  return join(LOG_DIR, `message-log-${accountId}.jsonl`);
}

function streamFor(accountId: string): WriteStream {
  const existing = streams.get(accountId);
  if (existing) return existing;

  // createWriteStream は親ディレクトリを作成しない。
  // 非同期 mkdir と open の競合を避け、ストリームを開く前に必ず作成する。
  mkdirSync(LOG_DIR, { recursive: true });
  const stream = createWriteStream(logPath(accountId), { flags: "a", encoding: "utf8" });
  streams.set(accountId, stream);
  // カウンタ初期化: 既存サイズは1回だけ取得
  stat(logPath(accountId))
    .then((s) => writtenBytes.set(accountId, s.size))
    .catch(() => writtenBytes.set(accountId, 0));
  stream.on("error", (err) => {
    if (streams.get(accountId) === stream) streams.delete(accountId);
    log.debug({ accountId, err }, "message log stream error");
  });
  return stream;
}

async function maybeRotate(accountId: string): Promise<void> {
  const size = writtenBytes.get(accountId) ?? 0;
  if (size < ROTATE_BYTES) return;
  const p = existsSync(logPath(accountId)) ? logPath(accountId) : legacyLogPath(accountId);
  const last = rotatedBytes.get(accountId);
  if (last != null && size - last < ROTATE_BYTES) return; // 直前ローテ直後
  rotatedBytes.set(accountId, size);
  try {
    const s = streams.get(accountId);
    if (s) {
      // flush を待ってから rename（バッファ中の行消失防止）
      await new Promise<void>((resolve) => s.end(() => resolve()));
    }
    streams.delete(accountId);
    writtenBytes.set(accountId, 0);
    const prev = `${p}.2`;
    if (existsSync(prev))
      await import("node:fs/promises").then(({ unlink }) => unlink(prev)).catch(() => undefined);
    if (existsSync(`${p}.1`)) await rename(`${p}.1`, prev);
    await rename(p, `${p}.1`);
  } catch (err) {
    log.debug({ accountId, err }, "message log rotate failed");
  }
}

/** JSONL に1行追記（失敗しても全体を止めない） */
export function appendMessageLog(entry: MessageLogEntry): void {
  try {
    const s = streamFor(entry.accountId);
    const line = `${JSON.stringify(entry)}\n`;
    s.write(line);
    // stat() の代わりに書き込みバイト数で追跡
    writtenBytes.set(
      entry.accountId,
      (writtenBytes.get(entry.accountId) ?? 0) + Buffer.byteLength(line, "utf8"),
    );
    void maybeRotate(entry.accountId).catch(() => undefined);
  } catch (err) {
    log.debug({ err }, "message log append failed");
  }
}

/** 直近 N 行を読み返す（デバッグ・復元用） */
export async function readRecentMessageLog(
  accountId: string,
  limit = 200,
): Promise<MessageLogEntry[]> {
  const p = existsSync(logPath(accountId)) ? logPath(accountId) : legacyLogPath(accountId);
  if (!existsSync(p)) return [];
  try {
    const raw = await readFile(p, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const out: MessageLogEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line) as MessageLogEntry);
      } catch {
        /* skip malformed */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 起動時などに未ログ分を再スキャンして追記（履歴同期の取りこぼし補填） */
export async function replayMissingLogs(accountId: string, knownIds: Set<string>): Promise<number> {
  const p = existsSync(logPath(accountId)) ? logPath(accountId) : legacyLogPath(accountId);
  if (!existsSync(p)) return 0;
  try {
    const raw = await readFile(p, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    let added = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as MessageLogEntry & { messageId?: string };
        if (entry.messageId && !knownIds.has(entry.messageId)) {
          knownIds.add(entry.messageId);
          added++;
        }
      } catch {
        /* skip */
      }
    }
    return added;
  } catch {
    return 0;
  }
}
