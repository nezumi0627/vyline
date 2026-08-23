/**

 * LINE API ↔ Vyline store ブリッジ

 */

import { useEffect, useRef } from "react";

import { useAuthStore } from "../stores/authStore.js";

import { useLineData } from "../hooks/useLineData.js";

import { useHiddenChats } from "../hooks/useHiddenChats.js";

import { useStore } from "../lib/store.js";
import { api } from "../api/client.js";

function eventsPollIntervalMs(): number {
  if (typeof document === "undefined") return 2_000;

  if (document.visibilityState === "hidden") return 60_000;

  if (!document.hasFocus()) return 8_000;

  return 2_000;
}

function chatsPollIntervalMs(): number {
  if (typeof document === "undefined") return 120_000;

  if (document.visibilityState === "hidden") return 0;

  return 120_000;
}

/** @param enabled bootstrap 完了かつログイン済みのときだけ同期 */

export function useVylineSync(enabled = true) {
  const accountId = useAuthStore((s) => s.activeAccountId);

  const setAccountId = useStore((s) => s.setAccountId);

  const hydrateLineData = useStore((s) => s.hydrateLineData);

  const storeChatId = useStore((s) => s.activeChatId);

  const setScreen = useStore((s) => s.setScreen);

  const showUpdateNote = useStore((s) => s.showUpdateNote);
  const betaBlockCheckAuto = useStore((s) => s.settings.betaBlockCheckAuto);

  const line = useLineData({ accountId: enabled ? accountId : null });

  const { hiddenSet } = useHiddenChats(enabled ? accountId : null);

  // Beta: one authoritative friend/block-list check at most every two minutes.
  useEffect(() => {
    if (!enabled || !accountId || !betaBlockCheckAuto) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void api.line.verifyFriendBlockStatus(accountId).catch(() => undefined);
    };
    run();
    const timer = window.setInterval(run, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId, betaBlockCheckAuto, enabled]);

  const syncingChat = useRef(false);
  const lastHydrateAt = useRef(0);
  const hydrateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshReadReceipts = useStore((s) => s.refreshReadReceipts);

  const pollIncoming = useStore((s) => s.pollIncoming);

  const pollMessagesDelta = useStore((s) => s.pollMessagesDelta);

  const refreshChatsSilently = useStore((s) => s.refreshChatsSilently);

  const activeChatId = useStore((s) => s.activeChatId);

  const readReceiptsEnabled = useStore((s) => s.settings.readReceipts);

  useEffect(() => {
    if (!enabled || !accountId) return;

    let eventsTimer: ReturnType<typeof setTimeout> | undefined;

    let chatsTimer: ReturnType<typeof setTimeout> | undefined;

    let cancelled = false;

    const scheduleEventsPoll = () => {
      if (cancelled) return;

      const ms = eventsPollIntervalMs();

      // pollIncoming は単一フライト（pollIncomingInflight）で重複実行されない。
      // 遅い delta RPC を待たずに次をスケジュールし、実効ポーリング間隔を一定に保つ。
      eventsTimer = setTimeout(() => {
        scheduleEventsPoll();
        if (document.visibilityState !== "hidden") {
          void pollIncoming();
        }
      }, ms);
    };

    const scheduleChatsPoll = () => {
      if (cancelled) return;

      const ms = chatsPollIntervalMs();

      if (ms <= 0) {
        chatsTimer = setTimeout(scheduleChatsPoll, 60_000);

        return;
      }

      chatsTimer = setTimeout(
        async () => {
          if (document.visibilityState !== "hidden") {
            await refreshChatsSilently();
          }

          scheduleChatsPoll();
        },
        ms + Math.random() * 25_000,
      );
    };

    void pollIncoming();

    scheduleEventsPoll();

    scheduleChatsPoll();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pollIncoming();
        // アクティブチャットの差分も即時取得
        const { activeChatId: aid } = useStore.getState();
        if (aid) void pollMessagesDelta(aid);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;

      if (eventsTimer) clearTimeout(eventsTimer);

      if (chatsTimer) clearTimeout(chatsTimer);

      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, accountId, pollIncoming, pollMessagesDelta, refreshChatsSilently]);

  useEffect(() => {
    if (!enabled || !accountId || !activeChatId || !readReceiptsEnabled) return;

    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    // 既読者一覧を追い続けるため、既読済みでも直近 15 分の自分のメッセージがあればポーリングする
    const shouldPoll = () => {
      const messages = useStore.getState().messages;

      const now = Date.now();

      return messages.some(
        (m) =>
          m.chatId === activeChatId &&
          m.authorId === "me" &&
          m.id &&
          !m.id.startsWith("pending_") &&
          !m.messageState.startsWith("revoked") &&
          now - m.createdAt < 15 * 60_000,
      );
    };

    const tick = () => {
      if (document.visibilityState === "hidden") return;

      if (shouldPoll()) void refreshReadReceipts(activeChatId);
    };

    tick();

    const t = setInterval(tick, 10_000);

    return () => clearInterval(t);
  }, [enabled, accountId, activeChatId, readReceiptsEnabled, refreshReadReceipts]);

  useEffect(() => {
    if (!enabled) return;

    setAccountId(accountId);

    if (accountId && !showUpdateNote) {
      const screen = useStore.getState().screen;

      if (screen === "home") setScreen("chat");
    }
  }, [enabled, accountId, setAccountId, setScreen, showUpdateNote]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    useStore.getState().resetAccountData();
  }, [enabled, accountId]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    if (!line.chats.length && useStore.getState().chats.length > 0) return;

    // contactCache の逐次解決など連続更新を 1 回の hydrate にまとめる
    // （連鎖する全チャット再マップ → 長タスク・ヒープ膨張を抑止）
    const run = () => {
      lastHydrateAt.current = Date.now();
      hydrateLineData({
        profile: line.profile
          ? {
              displayName: line.profile.displayName,
              phoneticName: line.profile.phoneticName,
              pictureStatus: line.profile.pictureStatus,
              statusMessage: line.profile.statusMessage,
              thumbnailUrl: line.profile.thumbnailUrl,
              musicProfile: line.profile.musicProfile,
              birthday: line.profile.birthday,
              backgroundUrl: line.profile.backgroundUrl,
              profileId: line.profile.profileId,
              premium: line.profile.premium ?? null,
            }
          : null,
        chats: line.chats,
        messages: line.messages,
        hiddenMids: hiddenSet,
        contactCache: line.contactCache,
      });
    };

    const wait = Math.max(0, 300 - (Date.now() - lastHydrateAt.current));
    if (wait === 0) {
      run();
      return;
    }
    clearTimeout(hydrateTimer.current);
    hydrateTimer.current = setTimeout(run, wait);
    return () => clearTimeout(hydrateTimer.current);
  }, [
    enabled,

    accountId,

    line.profile,

    line.chats,

    line.messages,

    line.contactCache,

    hiddenSet,

    hydrateLineData,
  ]);

  useEffect(() => {
    if (!enabled || !storeChatId || syncingChat.current) return;

    if (storeChatId !== line.selectedChatMid) {
      syncingChat.current = true;

      line.setSelectedChatMid(storeChatId);

      syncingChat.current = false;
    }
  }, [enabled, storeChatId, line.selectedChatMid, line.setSelectedChatMid]);
}
