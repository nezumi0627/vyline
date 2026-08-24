/**
 * hooks/useHiddenChats.ts
 *
 * アカウントごとの「非表示チャット」を localStorage で管理するフック。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "vyline:hiddenChatsByAccount";
const CHANGE_EVENT = "vyline:hidden-chats-changed";

export function loadHiddenChats(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function saveHiddenChats(data: Record<string, string[]>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setHiddenForAccount(accountId: string, chatMid: string, hidden: boolean): void {
  const data = loadHiddenChats();
  const current = new Set(data[accountId] ?? []);
  if (hidden) current.add(chatMid);
  else current.delete(chatMid);
  saveHiddenChats({ ...data, [accountId]: [...current] });
}

export function useHiddenChats(accountId: string | null) {
  const [hiddenByAccount, setHiddenByAccount] = useState<Record<string, string[]>>(loadHiddenChats);

  // 別タブ/ウィンドウと同一タブ内のストア変更を同期
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHiddenByAccount(loadHiddenChats());
    };
    const localHandler = () => setHiddenByAccount(loadHiddenChats());
    window.addEventListener("storage", handler);
    window.addEventListener(CHANGE_EVENT, localHandler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(CHANGE_EVENT, localHandler);
    };
  }, []);

  const hiddenSet = useMemo<Set<string>>(() => {
    if (!accountId) return new Set();
    return new Set(hiddenByAccount[accountId] ?? []);
  }, [accountId, hiddenByAccount]);

  const hide = useCallback(
    (chatMid: string) => {
      if (!accountId) return;
      setHiddenByAccount((prev) => {
        const current = new Set(prev[accountId] ?? []);
        current.add(chatMid);
        const next = { ...prev, [accountId]: [...current] };
        saveHiddenChats(next);
        return next;
      });
    },
    [accountId],
  );

  const unhide = useCallback(
    (chatMid: string) => {
      if (!accountId) return;
      setHiddenByAccount((prev) => {
        const current = new Set(prev[accountId] ?? []);
        current.delete(chatMid);
        const next = { ...prev, [accountId]: [...current] };
        saveHiddenChats(next);
        return next;
      });
    },
    [accountId],
  );

  const isHidden = useCallback((chatMid: string) => hiddenSet.has(chatMid), [hiddenSet]);

  return { hiddenSet, hide, unhide, isHidden };
}
