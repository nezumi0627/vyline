/**
 * hooks/useHiddenChats.ts
 *
 * アカウントごとの「非表示チャット」を localStorage で管理するフック。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "vyline:hiddenChatsByAccount";

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

export function useHiddenChats(accountId: string | null) {
  const [hiddenByAccount, setHiddenByAccount] = useState<Record<string, string[]>>(load);

  // 別タブ/ウィンドウの変更を同期
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHiddenByAccount(load());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
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
        save(next);
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
        save(next);
        return next;
      });
    },
    [accountId],
  );

  const isHidden = useCallback(
    (chatMid: string) => hiddenSet.has(chatMid),
    [hiddenSet],
  );

  return { hiddenSet, hide, unhide, isHidden };
}
