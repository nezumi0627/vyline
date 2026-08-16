/**
 * キック済みなどで一覧から完全除外したチャット mid を永続化する。
 * 非表示タブにも出さない。
 */

const STORAGE_KEY = "vyline:dismissedChatsByAccount";

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

export function isChatDismissed(accountId: string, chatMid: string): boolean {
  return getDismissedChatMids(accountId).has(chatMid);
}
