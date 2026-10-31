/**
 * hooks/useHiddenChats.ts
 *
 * アカウントごとの「非表示チャット」をIndexedDBへ保存するフック。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getPersistedValue, setPersistedValue } from "../lib/indexedDbStorage.js";

const STORAGE_KEY = "vyline:hiddenChatsByAccount";
const CHANGE_EVENT = "vyline:hidden-chats-changed";
let hiddenCache: Record<string, string[]> | undefined;

export function loadHiddenChats(): Record<string, string[]> {
  if (hiddenCache) return hiddenCache;
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    hiddenCache = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return hiddenCache;
  } catch {
    return {};
  }
}

export function saveHiddenChats(data: Record<string, string[]>): void {
  hiddenCache = data;
  void setPersistedValue(STORAGE_KEY, data);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function hydrateHiddenChats(): Promise<void> {
  try {
    const data = await getPersistedValue<Record<string, string[]>>(STORAGE_KEY);
    if (data) hiddenCache = data;
  } catch {
    /* Keep the localStorage fallback. */
  }
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
