/**
 * キック済みなどで一覧から完全除外したチャット mid を永続化する。
 * 非表示タブにも出さない。
 */
import { getPersistedValue, setPersistedValue } from "../lib/indexedDbStorage.js";

const STORAGE_KEY = "vyline:dismissedChatsByAccount";
const RESTORED_KEY = "vyline:restoredChatMidsByAccount";
let dismissedCache: Record<string, string[]> | undefined;
let restoredCache: Record<string, string[]> | undefined;

function load(): Record<string, string[]> {
  if (dismissedCache) return dismissedCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    dismissedCache = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return dismissedCache;
  } catch {
    return {};
  }
}

function save(data: Record<string, string[]>): void {
  dismissedCache = data;
  void setPersistedValue(STORAGE_KEY, data);
}

export async function hydrateDismissedChatState(): Promise<void> {
  try {
    const [dismissed, restored] = await Promise.all([
      getPersistedValue<Record<string, string[]>>(STORAGE_KEY),
      getPersistedValue<Record<string, string[]>>(RESTORED_KEY),
    ]);
    if (dismissed) dismissedCache = dismissed;
    if (restored) restoredCache = restored;
  } catch { /* Keep the localStorage fallback available. */ }
}

export function getDismissedChatMids(accountId: string): Set<string> {
  return new Set(load()[accountId] ?? []);
}

export function dismissChatMid(accountId: string, chatMid: string): void {
  const data = load();
  const set = new Set(data[accountId] ?? []);
  set.add(chatMid);
  data[accountId] = [...set];
  save(data);
}

export function restoreDismissedChatMid(accountId: string, chatMid: string): void {
  const data = load();
  const next = (data[accountId] ?? []).filter((mid) => mid !== chatMid);
  if (next.length === (data[accountId] ?? []).length) return;
  if (next.length > 0) data[accountId] = next;
  else delete data[accountId];
  save(data);
}

export function markRestoredChatMids(accountId: string, chatMids: string[]): void {
  if (chatMids.length === 0) return;
  try {
    const raw = restoredCache ? null : localStorage.getItem(RESTORED_KEY);
    const data = restoredCache ?? (raw ? (JSON.parse(raw) as Record<string, string[]>) : {});
    data[accountId] = [...new Set([...(data[accountId] ?? []), ...chatMids])];
    restoredCache = data;
    void setPersistedValue(RESTORED_KEY, data);
  } catch {
    /* localStorage may be unavailable in a restricted browser context */
  }
}

export function getRestoredChatMids(accountId: string): string[] {
  try {
    if (restoredCache) return restoredCache[accountId] ?? [];
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RESTORED_KEY);
    restoredCache = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return restoredCache[accountId] ?? [];
  } catch {
    return [];
  }
}

export function isChatDismissed(accountId: string, chatMid: string): boolean {
  return getDismissedChatMids(accountId).has(chatMid);
}
