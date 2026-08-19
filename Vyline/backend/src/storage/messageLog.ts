/**
 * storage/messageLog.ts — チャット内容・アナウンスのタイミング付き詳細ログ
 *
 * 受信（Push / 履歴同期）・送信されたメッセージを JSONL として
 * data/logs/message-log-<accountId>.jsonl に追記する。
 * 画像・動画・音声・ファイルなどのメディアも messageId / contentType を記録する。
 * ローテーション: 10MB を超えたら .1 / .2 へ shift。
 */

import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("message-log");

const _dir = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.VYLINE_LOG_DIR ?? join(_dir, "../../data/logs");
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

function logPath(accountId: string): string {
  return join(LOG_DIR, `message-log-${accountId}.jsonl`);
}

function streamFor(accountId: string): WriteStream {
  let s = streams.get(accountId);
  if (s) return s;
  if (!existsSync(LOG_DIR)) {
    // mkdir は非同期なので write 側で再試行させるため先に作成
    import("node:fs/promises").then(({ mkdir }) =>
      mkdir(LOG_DIR, { recursive: true }).catch(() => undefined),
    );
  }
  s = createWriteStream(logPath(accountId), { flags: "a", encoding: "utf8" });
  streams.set(accountId, s);
  return s;
}

async function maybeRotate(accountId: string): Promise<void> {
  const p = logPath(accountId);
  let size = 0;
  try {
    size = (await stat(p)).size;
  } catch {
    return;
  }
  if (size < ROTATE_BYTES) return;
  const last = rotatedBytes.get(accountId);
  if (last != null && size - last < ROTATE_BYTES) return; // 直前ローテ直後
  rotatedBytes.set(accountId, size);
  try {
    const s = streams.get(accountId);
    s?.end();
    streams.delete(accountId);
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
    s.write(`${JSON.stringify(entry)}\n`);
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
  const p = logPath(accountId);
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
  const p = logPath(accountId);
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
