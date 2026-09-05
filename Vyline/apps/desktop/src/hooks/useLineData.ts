/**
 * hooks/useLineData.ts
 *
 * Desktop 準拠 local-first:
 * 1. bootstrap / chatdb で即時表示
 * 2. チャットごとの履歴ウィンドウを保持し、古い履歴は必要時だけ1ページ取得
 * 3. 新着同期は push / delta 側に任せ、履歴の暗黙 prefetch は行わない
 *
 * 注意: accountId 変更時だけフルリセット。loadChats の identity 変更で
 * useEffect が回り chats=[] になるループは禁止。
 */

import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import type { Chat, LineProfile, Message } from "../types/index.js";
import { looksLikeMid, mapMessage, type ContactInfo } from "../lib/mappers.js";
import {
  vylineClientPut,
  vylineClientPutMany,
  vylineClientToContactMap,
} from "../lib/vyline-cache.js";
import { messagePreview, useStore } from "../lib/store.js";
import { emitAppEvent, onAppEvent } from "../lib/appEvents.js";
import { hydrateBootstrapChatPreviews, mergeResolvedChatPreviews } from "../lib/chatPreview.js";
import {
  HISTORY_PAGE_SIZE,
  MAX_LOCAL_HISTORY_LIMIT,
  mergeHistoryMessages,
  readHistoryDepths,
  rememberHistoryDepth,
  trimHistoryWindows,
  type ChatHistoryWindow,
} from "../lib/chatHistoryWindow.js";

interface UseLineDataOptions {
  accountId: string | null;
}

export function useLineData({ accountId }: UseLineDataOptions) {
  // State below is reset in an effect, so during the first render after an account
  // switch it still belongs to the previous account. Keep that ownership explicit
  // so useVylineSync never hydrates stale account data into the new store.
  const [dataAccountId, setDataAccountId] = useState<string | null>(accountId);
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
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
  // account 切替前の Promise が残っていても、新アカウントの初期ロードを止めない。
  // boolean だけだと account-1 の finally が account-2 の in-flight 状態まで解除してしまう。
  const inFlight = useRef({
    profile: new Set<string>(),
    chats: new Set<string>(),
    bootstrap: new Set<string>(),
  });
  const bootstrapMessages = useRef<Map<string, Message[]>>(new Map());
  const historyWindows = useRef<Map<string, ChatHistoryWindow>>(new Map());
  const historyDepths = useRef<Map<string, number>>(new Map());
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
        .getContact(accountId, mid)
        .then((res) => {
          if (accountIdRef.current !== accountId) return;
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
    if (!accountId || inFlight.current.profile.has(accountId)) return;
    inFlight.current.profile.add(accountId);
    setLoadingProfile(true);
    try {
      const res = await api.line.getProfile(accountId);
      if (accountIdRef.current !== accountId) return;
      if (res.ok && res.profile) setProfile(res.profile);
    } finally {
      inFlight.current.profile.delete(accountId);
      if (accountIdRef.current === accountId) setLoadingProfile(false);
    }
  }, [accountId]);

  const loadChats = useCallback(
    async (opts?: { light?: boolean; refresh?: boolean; force?: boolean }) => {
      if (!accountId || inFlight.current.chats.has(accountId)) return;
      inFlight.current.chats.add(accountId);
      // 既に一覧があるときはローディングスピナーを出さない
      setLoadingChats((prev) => prev || false);
      try {
        const res = await api.line.getMessageBoxes(accountId, opts);
        if (accountIdRef.current !== accountId) return;
        if (res.ok && res.chats?.length) {
          const nextChats = mergeResolvedChatPreviews(chatsRef.current, res.chats);
          setChats(nextChats);
          const requestedChatMid = useStore.getState().activeChatId;
          const initialChatMid =
            requestedChatMid && nextChats.some((chat) => chat.mid === requestedChatMid)
              ? requestedChatMid
              : "";
          setSelectedChatMid((previous) => previous || initialChatMid);
          applyChatsToContactCache(nextChats);
          setFromLocalCache(Boolean(res.fromCache));
          const warmTargets = nextChats
            .slice(0, 80)
            .filter(
              (c) => !c.thumbnailUrl || !c.name || looksLikeMid(c.name) || c.name === "(No Name)",
            )
            .map((c) => c.mid);
          prefetchContacts(warmTargets, 10);
        }
      } finally {
        inFlight.current.chats.delete(accountId);
        if (accountIdRef.current === accountId) setLoadingChats(false);
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

  const commitHistoryWindow = useCallback(
    (chatMid: string, list: Message[], hasMore: boolean) => {
      if (!accountId) return;
      const nextWindow: ChatHistoryWindow = {
        messages: list,
        hasMore,
        touchedAt: Date.now(),
      };
      historyWindows.current.set(chatMid, nextWindow);
      rememberHistoryDepth(accountId, historyDepths.current, chatMid, list.length);
      trimHistoryWindows(historyWindows.current, chatMid);

      if (selectedChatMidRef.current === chatMid) {
        setMessages(list);
        setHasMoreMessages(hasMore);
        setFromLocalCache(true);
        resolveMessageAuthors(list);
      }
    },
    [accountId, resolveMessageAuthors],
  );

  const loadMessages = useCallback(
    async (chatMid: string, limit = HISTORY_PAGE_SIZE, opts?: { force?: boolean }) => {
      if (!accountId || !chatMid) return;
      const gen = ++messagesGen.current;
      fetchContact(chatMid);

      const cachedWindow = historyWindows.current.get(chatMid);
      if (cachedWindow && !opts?.force) {
        cachedWindow.touchedAt = Date.now();
        setMessages(cachedWindow.messages);
        setHasMoreMessages(cachedWindow.hasMore);
        setFromLocalCache(true);
        setLoadingMessages(false);
        resolveMessageAuthors(cachedWindow.messages);

        // 再入室時は表示を待たせずキャッシュを出し、その後に最新1ページだけローカルDBから統合する。
        // 3,000件読んだ履歴を3,000件再取得することも、ネットワーク先読みすることもない。
        try {
          const local = await api.line.getPreviousMessagesV2WithRequest(
            accountId,
            chatMid,
            HISTORY_PAGE_SIZE,
            {
            local: true,
            },
          );
          if (gen !== messagesGen.current || selectedChatMidRef.current !== chatMid) return;
          if (local.ok && local.messages?.length) {
            const latestAsc = [...local.messages].reverse();
            const merged = mergeHistoryMessages(cachedWindow.messages, latestAsc);
            commitHistoryWindow(chatMid, merged, cachedWindow.hasMore);
          }
        } catch {
          /* ローカル差分更新は任意。既存ウィンドウをそのまま表示する。 */
        }
        return;
      }

      const rememberedDepth = historyDepths.current.get(chatMid) ?? 0;
      const localLimit = Math.min(
        MAX_LOCAL_HISTORY_LIMIT,
        Math.max(limit, rememberedDepth || HISTORY_PAGE_SIZE),
      );

      const boot = bootstrapMessages.current.get(chatMid);
      if (boot?.length && !opts?.force) {
        const bootAsc = [...boot].reverse();
        setMessages(bootAsc);
        setHasMoreMessages(true);
        setFromLocalCache(true);
        resolveMessageAuthors(bootAsc);
      } else {
        setLoadingMessages(true);
      }

      try {
        if (!opts?.force) {
          const local = await api.line.getPreviousMessagesV2WithRequest(
            accountId,
            chatMid,
            localLimit,
            { local: true },
          );
          if (gen !== messagesGen.current || selectedChatMidRef.current !== chatMid) return;
          if (local.ok && local.messages?.length) {
            const asc = [...local.messages].reverse();
            commitHistoryWindow(chatMid, asc, local.hasMore ?? local.messages.length >= localLimit);
            return;
          }
        }

        // ローカルに1件も無い新規チャットだけ、ユーザーが開いたタイミングで1ページ取得する。
        // これは明示的な foreground fetch で、連続先読みはしない。
        const res = await api.line.getPreviousMessagesV2WithRequest(accountId, chatMid, limit, {
          force: true,
        });
        if (gen !== messagesGen.current || selectedChatMidRef.current !== chatMid) return;
        if (res.ok && res.messages) {
          const asc = [...res.messages].reverse();
          commitHistoryWindow(chatMid, asc, res.hasMore ?? res.messages.length >= limit);
        }
      } finally {
        if (gen === messagesGen.current) setLoadingMessages(false);
      }
    },
    [accountId, commitHistoryWindow, fetchContact, resolveMessageAuthors],
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
      olderInFlight.current = true;
      setLoadingOlder(true);
      try {
        const res = await api.line.getPreviousMessagesV2WithRequest(
          accountId,
          chatMid,
          HISTORY_PAGE_SIZE,
          {
            beforeMessageId: oldest.id,
            beforeDeliveredTime: oldest.createdTime,
            local: true,
          },
        );
        if (gen !== messagesGen.current || selectedChatMidRef.current !== chatMid) return;
        if (!res.ok || !res.messages) {
          commitHistoryWindow(chatMid, current, false);
          return;
        }

        const olderAsc = [...res.messages].reverse();
        const merged = mergeHistoryMessages(current, olderAsc);
        const added = merged.length - current.length;
        if (added <= 0) {
          commitHistoryWindow(chatMid, current, false);
          return;
        }

        const hasMore = res.hasMore ?? res.messages.length >= HISTORY_PAGE_SIZE;
        commitHistoryWindow(chatMid, merged, hasMore);
      } finally {
        olderInFlight.current = false;
        if (gen === messagesGen.current) setLoadingOlder(false);
      }
    },
    [accountId, commitHistoryWindow, hasMoreMessages],
  );

  // ChatArea が明示的に1ページ要求した時だけ、古いローカル履歴を追加取得する。
  useEffect(
    () =>
      onAppEvent("history:load-older", ({ chatMid }) => {
        if (chatMid) void loadOlderMessages(chatMid);
      }),
    [loadOlderMessages],
  );

  // 先頭のUIは残件・読み込み中を正しく表示する。
  useEffect(() => {
    if (!selectedChatMid) return;
    emitAppEvent("history:state", {
      chatMid: selectedChatMid,
      hasMore: hasMoreMessages,
      loading: loadingOlder,
    });
  }, [hasMoreMessages, loadingOlder, selectedChatMid]);

  const loadBootstrap = useCallback(async () => {
    if (!accountId || inFlight.current.bootstrap.has(accountId)) return;
    inFlight.current.bootstrap.add(accountId);
    try {
      const res = await api.line.bootstrap(accountId);
      if (accountIdRef.current !== accountId) return;
      if (!res.ok) return;

      bootstrapMessages.current.clear();
      for (const [mid, msgs] of Object.entries(res.messagesByChat ?? {})) {
        bootstrapMessages.current.set(mid, msgs);
      }

      if (res.chats?.length) {
        const hydratedChats = hydrateBootstrapChatPreviews(
          res.chats,
          res.messagesByChat ?? {},
          (message, chat) => {
            const mapped = mapMessage(message, chat.mid, accountId, contactCacheRef.current);
            const preview = messagePreview(mapped);
            return mapped.authorId === "me" && preview ? `あなた: ${preview}` : preview;
          },
        );
        const nextChats = mergeResolvedChatPreviews(chatsRef.current, hydratedChats);
        setChats(nextChats);
        setFromLocalCache(true);
        applyChatsToContactCache(nextChats);
        const requestedChatMid = useStore.getState().activeChatId;
        const initialChatMid =
          requestedChatMid && nextChats.some((chat) => chat.mid === requestedChatMid)
            ? requestedChatMid
            : "";
        setSelectedChatMid((previous) => previous || initialChatMid);
      }
    } catch {
      /* bootstrap optional */
    } finally {
      inFlight.current.bootstrap.delete(accountId);
    }
  }, [accountId, applyChatsToContactCache]);

  // 外部バックアップ復元完了後は、ネットワーク同期で上書きせず、書き込み済みのローカルDBを即表示する。
  useEffect(() => {
    if (!accountId) return;
    return onAppEvent("backup:restored", ({ accountId: restoredAccountId, chatMids }) => {
      if (restoredAccountId !== accountId) return;
      for (const chatMid of chatMids) historyWindows.current.delete(chatMid);
      const restoreTarget = chatMids[0];
      if (restoreTarget) {
        setSelectedChatMid(restoreTarget);
        useStore.getState()._activateChat(restoreTarget);
      }
      void (async () => {
        await loadBootstrap();
        const chatMid = restoreTarget ?? selectedChatMidRef.current;
        if (chatMid) await loadMessages(chatMid);
      })();
    });
  }, [accountId, loadBootstrap, loadMessages]);

  // accountId 変更時だけフルリセット（loadChats 再生成で回さない）
  useEffect(() => {
    messagesGen.current += 1;
    setDataAccountId(accountId);
    setProfile(null);
    setChats([]);
    setSelectedChatMid("");
    setMessages([]);
    setHasMoreMessages(true);
    setFromLocalCache(false);
    contactFetching.current.clear();
    bootstrapMessages.current.clear();
    historyWindows.current.clear();
    historyDepths.current = accountId ? readHistoryDepths(accountId) : new Map();
    if (!accountId) {
      setContactCache(new Map());
      return;
    }
    // Vyline ローカルキャッシュを即 hydrate（mid 生出し回避）
    setContactCache(vylineClientToContactMap(accountId));

    void (async () => {
      // サーバ VylineCache を取り込んでから UI を温める
      try {
        const cache = await api.line.getVylineCache(accountId);
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
      // 通常起動は backend のSQLite freshness判定に任せ、毎回remote RPCを強制しない。
      await loadChats({ light: true });
      if (accountIdRef.current !== accountId) return;

      // E2EE 一覧プレビューの有限 background warm を拾う。常時 prefetch はしない。
      for (const delay of [4_000, 12_000]) {
        window.setTimeout(() => {
          if (accountIdRef.current === accountId) void loadChats({ light: true });
        }, delay);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountId のみ
  }, [accountId]);

  useEffect(() => {
    if (!selectedChatMid) return;
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
    dataAccountId,
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
