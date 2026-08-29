import type { Message } from "../types/index.js";

export const HISTORY_PAGE_SIZE = 100;
export const MAX_LOCAL_HISTORY_LIMIT = 10_000;
export const HISTORY_CACHE_MESSAGE_BUDGET = 20_000;

export type ChatHistoryWindow = {
  messages: Message[];
  hasMore: boolean;
  touchedAt: number;
};

function compareMessageIds(left: string, right: string): number {
  if (left === right) return 0;
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : 1;
  } catch {
    return left.localeCompare(right);
  }
}

export function compareHistoryMessagesOldestFirst(left: Message, right: Message): number {
  const byTime = left.createdTime - right.createdTime;
  return byTime || compareMessageIds(left.id, right.id);
}

/**
 * 履歴ウィンドウを ID で統合する。incoming を優先し、時系列は oldest-first に揃える。
 * 新着の差分マージと過去ページの prepend の両方で同じ処理を使う。
 */
export function mergeHistoryMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareHistoryMessagesOldestFirst);
}

function depthStorageKey(accountId: string): string {
  return `vyline:history-depth:${accountId}`;
}

export function readHistoryDepths(accountId: string): Map<string, number> {
  if (typeof localStorage === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(depthStorageKey(accountId));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed)
      .map(([chatMid, value]) => [chatMid, Number(value)] as const)
      .filter(([, value]) => Number.isFinite(value) && value > 0)
      .map(([chatMid, value]) => [chatMid, Math.min(MAX_LOCAL_HISTORY_LIMIT, Math.floor(value))] as const);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function rememberHistoryDepth(
  accountId: string,
  depths: Map<string, number>,
  chatMid: string,
  count: number,
): void {
  const nextCount = Math.min(MAX_LOCAL_HISTORY_LIMIT, Math.max(0, Math.floor(count)));
  const previous = depths.get(chatMid) ?? 0;
  if (nextCount <= previous) return;
  depths.set(chatMid, nextCount);
  if (typeof localStorage === "undefined") return;
  try {
    const compact = Object.fromEntries(
      [...depths.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 64),
    );
    localStorage.setItem(depthStorageKey(accountId), JSON.stringify(compact));
  } catch {
    /* persisted depth metadata is optional */
  }
}

/**
 * 複数チャットの履歴を無制限にメモリ常駐させないための LRU trim。
 * depth は別保存なので、evict 後も再入室時はローカルDBから一発で同じ深さまで戻せる。
 */
export function trimHistoryWindows(
  windows: Map<string, ChatHistoryWindow>,
  activeChatMid: string,
  budget = HISTORY_CACHE_MESSAGE_BUDGET,
): void {
  let total = 0;
  for (const window of windows.values()) total += window.messages.length;
  if (total <= budget) return;

  const candidates = [...windows.entries()]
    .filter(([chatMid]) => chatMid !== activeChatMid)
    .sort((a, b) => a[1].touchedAt - b[1].touchedAt);

  for (const [chatMid, window] of candidates) {
    if (total <= budget) break;
    windows.delete(chatMid);
    total -= window.messages.length;
  }
}
