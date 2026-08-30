/**
 * キック済みなどで一覧から完全除外したチャット mid を永続化する。
 * 非表示タブにも出さない。
 */

const STORAGE_KEY = "vyline:dismissedChatsByAccount";
const RESTORED_KEY = "vyline:restoredChatMidsByAccount";

function load(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function save(data: Record<string, string[]>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    const raw = localStorage.getItem(RESTORED_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    data[accountId] = [...new Set([...(data[accountId] ?? []), ...chatMids])];
    localStorage.setItem(RESTORED_KEY, JSON.stringify(data));
  } catch {
    /* localStorage may be unavailable in a restricted browser context */
  }
}

export function getRestoredChatMids(accountId: string): string[] {
  try {
    const raw = localStorage.getItem(RESTORED_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return data[accountId] ?? [];
  } catch {
    return [];
  }
}

export function isChatDismissed(accountId: string, chatMid: string): boolean {
  return getDismissedChatMids(accountId).has(chatMid);
}
