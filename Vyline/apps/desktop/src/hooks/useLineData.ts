/**
 * hooks/useLineData.ts
 *
 * Desktop 準拠 local-first:
 * 1. bootstrap（ディスクキャッシュ）で即時表示
 * 2. バックグラウンドで RPC 同期
 *
 * 注意: accountId 変更時だけフルリセット。loadChats の identity 変更で
 * useEffect が回り chats=[] になるループは禁止。
 */

import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import type { Chat, LineProfile, Message } from "../types/index.js";
import { looksLikeMid, type ContactInfo } from "../lib/mappers.js";
import {
  vylineClientPut,
  vylineClientPutMany,
  vylineClientToContactMap,
} from "../lib/vyline-cache.js";
import { useStore } from "../lib/store.js";

interface UseLineDataOptions {
  accountId: string | null;
}

const PAGE_SIZE = 100;

export function useLineData({ accountId }: UseLineDataOptions) {
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatMid, setSelectedChatMid] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [fromLocalCache, setFromLocalCache] = useState(false);

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [contactCache, setContactCache] = useState<Map<string, ContactInfo>>(new Map());
  const contactCacheRef = useRef(contactCache);
  contactCacheRef.current = contactCache;
  const contactFetching = useRef<Set<string>>(new Set());
  const inFlight = useRef({
    profile: false,
    chats: false,
    bootstrap: false,
  });
  const bootstrapMessages = useRef<Map<string, Message[]>>(new Map());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const selectedChatMidRef = useRef(selectedChatMid);
  selectedChatMidRef.current = selectedChatMid;
  const messagesGen = useRef(0);
  const olderInFlight = useRef(false);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  const mergeContact = useCallback(
    (mid: string, info: ContactInfo) => {
      setContactCache((prev) => {
        const cur = prev.get(mid) ?? {};
        const nextInfo: ContactInfo = {
          name: info.name && !looksLikeMid(info.name) ? info.name : cur.name,
          thumbnailUrl: info.thumbnailUrl || cur.thumbnailUrl,
        };
        if (nextInfo.name === cur.name && nextInfo.thumbnailUrl === cur.thumbnailUrl) {
          return prev;
        }
        const next = new Map(prev);
        next.set(mid, nextInfo);
        return next;
      });
      if (accountId && info.name) {
        vylineClientPut(accountId, {
          mid,
          displayName: info.name,
          thumbnailUrl: info.thumbnailUrl,
        });
      }
    },
    [accountId],
  );

  const applyChatsToContactCache = useCallback((list: Chat[]) => {
    setContactCache((prev) => {
      const next = new Map(prev);
      for (const c of list) {
        const cur = next.get(c.mid) ?? {};
        next.set(c.mid, {
          name: c.name && !looksLikeMid(c.name) && c.name !== "(No Name)" ? c.name : cur.name,
          thumbnailUrl: c.thumbnailUrl || cur.thumbnailUrl,
        });
      }
      return next;
    });
  }, []);

  const fetchContact = useCallback(
    (mid: string) => {
      if (!accountId || !mid) return;
      if (contactFetching.current.has(mid)) return;
      const cached = contactCacheRef.current.get(mid);
      if (cached?.thumbnailUrl && cached.name && !looksLikeMid(cached.name)) return;

      contactFetching.current.add(mid);
      api.line
        .contactProfile(accountId, mid)
        .then((res) => {
          if (!res.ok || !res.profile) return;
          mergeContact(mid, {
            name: res.profile.displayName || undefined,
            thumbnailUrl: res.profile.thumbnailUrl || undefined,
          });
        })
        .catch(() => {})
        .finally(() => {
          contactFetching.current.delete(mid);
        });
    },
    [accountId, mergeContact],
  );

  const fetchAvatar = fetchContact;

  const prefetchContacts = useCallback(
    (mids: string[], immediateCount = 8) => {
      if (!accountId || mids.length === 0) return;
      const unique = [...new Set(mids.filter(Boolean))];
      if (unique.length === 0) return;
      const head = unique.slice(0, immediateCount);
      const tail = unique.slice(immediateCount);
      for (const mid of head) fetchContact(mid);
      if (tail.length === 0) return;
      window.setTimeout(() => {
        for (const mid of tail) fetchContact(mid);
      }, 250);
    },
    [accountId, fetchContact],
  );

  const loadProfile = useCallback(async () => {
    if (!accountId || inFlight.current.profile) return;
    inFlight.current.profile = true;
    setLoadingProfile(true);
    try {
      const res = await api.line.profile(accountId);
      if (accountIdRef.current !== accountId) return;
      if (res.ok && res.profile) setProfile(res.profile);
    } finally {
      setLoadingProfile(false);
      inFlight.current.profile = false;
    }
  }, [accountId]);

  const loadChats = useCallback(
    async (opts?: { light?: boolean; refresh?: boolean; force?: boolean }) => {
      if (!accountId || inFlight.current.chats) return;
      inFlight.current.chats = true;
      // 既に一覧があるときはローディングスピナーを出さない
      setLoadingChats((prev) => prev || false);
      try {
        const res = await api.line.chats(accountId, opts);
        if (accountIdRef.current !== accountId) return;
        if (res.ok && res.chats?.length) {
          setChats(res.chats);
          setSelectedChatMid((prev) => prev || res.chats?.[0]?.mid || "");
          applyChatsToContactCache(res.chats);
          setFromLocalCache(Boolean(res.fromCache));
          const warmTargets = res.chats
            .slice(0, 80)
            .filter(
              (c) => !c.thumbnailUrl || !c.name || looksLikeMid(c.name) || c.name === "(No Name)",
            )
            .map((c) => c.mid);
          prefetchContacts(warmTargets, 10);
        }
      } finally {
        setLoadingChats(false);
        inFlight.current.chats = false;
      }
    },
    [accountId, applyChatsToContactCache, prefetchContacts],
  );

  const resolveMessageAuthors = useCallback(
    (list: Message[]) => {
      const mids = new Set<string>();
      for (const m of list) {
        if (!m.isMyMessage && m.from) mids.add(m.from);
      }
      prefetchContacts([...mids], 6);
    },
    [prefetchContacts],
  );

  const loadMessages = useCallback(
    async (chatMid: string, limit = PAGE_SIZE, opts?: { force?: boolean }) => {
      if (!accountId || !chatMid) return;
      const gen = ++messagesGen.current;

      const boot = bootstrapMessages.current.get(chatMid);
      if (boot && boot.length > 0 && !opts?.force) {
        fetchContact(chatMid);
        const asc = [...boot].reverse();
        setMessages(asc);
        setHasMoreMessages(boot.length >= limit);
        setFromLocalCache(true);
        resolveMessageAuthors(asc);
      } else if (!opts?.force) {
        // chatdb ローカルを先に描画（ネットワーク待ちを避ける）
        try {
          const local = await api.line.messages(accountId, chatMid, limit, { local: true });
          if (gen === messagesGen.current && selectedChatMidRef.current === chatMid) {
            if (local.ok && local.messages && local.messages.length > 0) {
              fetchContact(chatMid);
              const asc = [...local.messages].reverse();
              setMessages(asc);
              setHasMoreMessages(local.hasMore ?? local.messages.length >= limit);
              setFromLocalCache(true);
              resolveMessageAuthors(asc);
            } else {
              setLoadingMessages(true);
            }
          }
        } catch {
          setLoadingMessages(true);
        }
      } else {
        setLoadingMessages(true);
      }

      try {
        fetchContact(chatMid);
        const res = await api.line.messages(accountId, chatMid, limit, opts);
        if (gen !== messagesGen.current) return;
        if (selectedChatMidRef.current !== chatMid) return;
        if (res.ok && res.messages) {
          const asc = [...res.messages].reverse();
          setMessages(asc);
          setHasMoreMessages(res.hasMore ?? res.messages.length >= limit);
          if (res.fromCache) setFromLocalCache(true);
          resolveMessageAuthors(asc);
        }
      } finally {
        if (gen === messagesGen.current) setLoadingMessages(false);
      }
    },
    [accountId, resolveMessageAuthors, fetchContact],
  );

  const loadOlderMessages = useCallback(
    async (chatMid: string) => {
      if (!accountId || !chatMid) return;
      if (!hasMoreMessages) return;
      if (selectedChatMidRef.current !== chatMid) return;
      if (olderInFlight.current) return;

      const current = messagesRef.current;
      const oldest = current[0];
      if (!oldest) return;

      const gen = messagesGen.current;
      let shouldContinue = false;
      olderInFlight.current = true;
      setLoadingOlder(true);
      try {
        const res = await api.line.messages(accountId, chatMid, PAGE_SIZE, {
          beforeMessageId: oldest.id,
          beforeDeliveredTime: oldest.createdTime,
          local: true,
        });
        if (gen !== messagesGen.current) return;
        if (selectedChatMidRef.current !== chatMid) return;
        if (!res.ok || !res.messages) {
          setHasMoreMessages(false);
          return;
        }
        const olderAsc = [...res.messages].reverse();
        const existing = new Set(messagesRef.current.map((m) => m.id));
        const fresh = olderAsc.filter((m) => !existing.has(m.id));
        if (fresh.length === 0) {
          setHasMoreMessages(false);
          return;
        }
        setMessages((prev) => [...fresh, ...prev]);
        shouldContinue = res.hasMore ?? res.messages.length >= PAGE_SIZE;
        setHasMoreMessages(shouldContinue);
        resolveMessageAuthors(fresh);
      } finally {
        olderInFlight.current = false;
        if (gen === messagesGen.current) setLoadingOlder(false);
      }
      if (shouldContinue && gen === messagesGen.current && selectedChatMidRef.current === chatMid) {
        window.requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent("vyline:older-messages-loaded", { detail: { chatMid } }),
          );
        });
      }
    },
    [accountId, hasMoreMessages, resolveMessageAuthors],
  );

  // ChatArea の仮想スクロールが先頭に到達したら、古い履歴を追加取得する。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLoadOlder = (event: Event) => {
      const chatMid = (event as CustomEvent<{ chatMid?: string }>).detail?.chatMid;
      if (chatMid) void loadOlderMessages(chatMid);
    };
    window.addEventListener("vyline:load-older-messages", onLoadOlder);
    return () => window.removeEventListener("vyline:load-older-messages", onLoadOlder);
  }, [loadOlderMessages]);

  // 先頭のUIは残件・読み込み中を正しく表示する。
  useEffect(() => {
    if (!selectedChatMid || typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("vyline:older-messages-state", {
        detail: { chatMid: selectedChatMid, hasMore: hasMoreMessages, loading: loadingOlder },
      }),
    );
  }, [hasMoreMessages, loadingOlder, selectedChatMid]);

  const loadBootstrap = useCallback(async () => {
    if (!accountId || inFlight.current.bootstrap) return;
    inFlight.current.bootstrap = true;
    try {
      const res = await api.line.bootstrap(accountId);
      if (accountIdRef.current !== accountId) return;
      if (!res.ok) return;

      bootstrapMessages.current.clear();
      for (const [mid, msgs] of Object.entries(res.messagesByChat ?? {})) {
        bootstrapMessages.current.set(mid, msgs);
      }

      if (res.chats?.length) {
        setChats(res.chats);
        setFromLocalCache(true);
        applyChatsToContactCache(res.chats);
        setSelectedChatMid((prev) => prev || res.chats[0]?.mid || "");
      }
    } catch {
      /* bootstrap optional */
    } finally {
      inFlight.current.bootstrap = false;
    }
  }, [accountId, applyChatsToContactCache]);

  // iOS復元完了後は、ネットワーク同期で上書きせず、書き込み済みのローカルDBを即表示する。
  useEffect(() => {
    if (!accountId || typeof window === "undefined") return;
    const onRestore = (event: Event) => {
      const restoredAccountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId;
      if (restoredAccountId !== accountId) return;
      const restoredChatMids =
        (event as CustomEvent<{ chatMids?: string[] }>).detail?.chatMids ?? [];
      const restoreTarget = restoredChatMids[0];
      if (restoreTarget) {
        setSelectedChatMid(restoreTarget);
        useStore.setState({ activeChatId: restoreTarget, screen: "chat" });
      }
      void (async () => {
        await loadBootstrap();
        const chatMid = restoreTarget ?? selectedChatMidRef.current;
        if (!chatMid) return;
        const res = await api.line.messages(accountId, chatMid, PAGE_SIZE, { local: true });
        if (res.ok && res.messages) {
          const messages = [...res.messages].reverse();
          setMessages(messages);
          setHasMoreMessages(res.hasMore ?? res.messages.length >= PAGE_SIZE);
          setFromLocalCache(true);
          resolveMessageAuthors(messages);
        }
      })();
    };
    window.addEventListener("vyline:ios-backup-restored", onRestore);
    return () => window.removeEventListener("vyline:ios-backup-restored", onRestore);
  }, [accountId, loadBootstrap, resolveMessageAuthors]);

  // accountId 変更時だけフルリセット（loadChats 再生成で回さない）
  useEffect(() => {
    messagesGen.current += 1;
    setProfile(null);
    setChats([]);
    setSelectedChatMid("");
    setMessages([]);
    setHasMoreMessages(true);
    setFromLocalCache(false);
    contactFetching.current.clear();
    bootstrapMessages.current.clear();
    if (!accountId) {
      setContactCache(new Map());
      return;
    }
    // Vyline ローカルキャッシュを即 hydrate（mid 生出し回避）
    setContactCache(vylineClientToContactMap(accountId));

    void (async () => {
      // サーバ VylineCache を取り込んでから UI を温める
      try {
        const cache = await api.line.vylineCache(accountId);
        if (accountIdRef.current !== accountId) return;
        if (cache.ok && cache.profiles) {
          const entries = Object.values(cache.profiles).map((p) => ({
            mid: p.mid,
            displayName: p.displayName,
            thumbnailUrl: p.thumbnailUrl,
            statusMessage: p.statusMessage,
            musicProfile: p.musicProfile,
            birthday: p.birthday,
            backgroundUrl: p.backgroundUrl,
          }));
          vylineClientPutMany(accountId, entries);
          setContactCache(vylineClientToContactMap(accountId));
        }
      } catch {
        /* optional */
      }

      await loadBootstrap();
      if (accountIdRef.current !== accountId) return;
      void loadProfile();
      await loadChats({ refresh: true, light: true });
      if (accountIdRef.current !== accountId) return;

      // 初回インデックス: 過去メッセージ等を chatdb に先読み（1アカウント1回）
      const indexKey = `vyline:indexed:${accountId}`;
      const needIndex = typeof localStorage !== "undefined" && !localStorage.getItem(indexKey);
      if (needIndex) {
        useStore.getState().setIndexing({
          active: true,
          label: "初回インデックス中… 過去のメッセージをキャッシュしています",
        });
        try {
          const idx = await api.line.runIndex(accountId);
          if (idx.ok) localStorage.setItem(indexKey, "1");
        } catch {
          /* バックエンド warm でも走っているので失敗は無視 */
        } finally {
          useStore.getState().setIndexing(null);
        }
      }

      window.setTimeout(() => {
        if (accountIdRef.current === accountId) void loadChats({ light: true });
      }, 4_000);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountId のみ
  }, [accountId]);

  useEffect(() => {
    if (!selectedChatMid) return;
    messagesGen.current += 1;
    setHasMoreMessages(true);
    void loadMessages(selectedChatMid);
  }, [selectedChatMid, loadMessages]);

  const avatarCache = useMemo(() => {
    const m = new Map<string, string>();
    for (const [mid, info] of contactCache) {
      if (info.thumbnailUrl) m.set(mid, info.thumbnailUrl);
    }
    return m;
  }, [contactCache]);

  return {
    profile,
    chats,
    selectedChatMid,
    messages,
    hasMoreMessages,
    fromLocalCache,
    avatarCache,
    contactCache,
    loadingProfile,
    loadingChats,
    loadingMessages,
    loadingOlder,
    setSelectedChatMid,
    setMessages,
    loadProfile,
    loadChats,
    loadMessages,
    loadOlderMessages,
    fetchAvatar,
    fetchContact,
  };
}
