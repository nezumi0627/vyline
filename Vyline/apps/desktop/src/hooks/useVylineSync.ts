/**

 * LINE API ↔ Vyline store ブリッジ

 */

import { useEffect, useRef } from "react";

import { useAuthStore } from "../stores/authStore.js";

import { useLineData } from "../hooks/useLineData.js";

import { useHiddenChats } from "../hooks/useHiddenChats.js";

import { useStore } from "../lib/store.js";

import { ensureNotificationPermission, onNotificationAction } from "../lib/notify.js";

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

  const pinEnabled = useStore((s) => s.settings.pinEnabled);

  const unlocked = useStore((s) => s.unlocked);

  const showUpdateNote = useStore((s) => s.showUpdateNote);

  const line = useLineData({ accountId: enabled ? accountId : null });

  const { hiddenSet } = useHiddenChats(enabled ? accountId : null);

  const syncingChat = useRef(false);

  const refreshReadReceipts = useStore((s) => s.refreshReadReceipts);

  const pollIncoming = useStore((s) => s.pollIncoming);

  const pollMessagesDelta = useStore((s) => s.pollMessagesDelta);

  const refreshChatsSilently = useStore((s) => s.refreshChatsSilently);

  const activeChatId = useStore((s) => s.activeChatId);

  const readReceiptsEnabled = useStore((s) => s.settings.readReceipts);

  useEffect(() => {
    if (!enabled || !accountId) return;

    // デスクトップ通知の許可を一度だけリクエスト（既に決定済みなら no-op）
    void ensureNotificationPermission();

    // 通知アクションボタン（既読にする/コピー）を Service Worker から受け取って実行
    const offNotificationAction = onNotificationAction((msg) => {
      if (msg.action === "mark-read" && msg.chatId) {
        void useStore.getState().markChatRead(msg.chatId);
      } else if (msg.action === "copy" && msg.text) {
        void navigator.clipboard?.writeText(msg.text).catch(() => undefined);
      } else if (msg.chatId) {
        useStore.getState().setScreen("chat");
        useStore.getState().openChat(msg.chatId);
      }
    });

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

      offNotificationAction();

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
          !m.revoked &&
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

    if (accountId && pinEnabled && !unlocked) {
      setScreen("lock");

      return;
    }

    if (accountId && unlocked && !showUpdateNote) {
      const screen = useStore.getState().screen;

      if (screen === "home") setScreen("chat");
    }
  }, [enabled, accountId, setAccountId, pinEnabled, unlocked, setScreen, showUpdateNote]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    useStore.getState().resetAccountData();
  }, [enabled, accountId]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    if (!line.chats.length && useStore.getState().chats.length > 0) return;

    hydrateLineData({
      profile: line.profile
        ? {
            displayName: line.profile.displayName,

            statusMessage: line.profile.statusMessage,

            thumbnailUrl: line.profile.thumbnailUrl,
          }
        : null,

      chats: line.chats,

      messages: line.messages,

      hiddenMids: hiddenSet,

      contactCache: line.contactCache,
    });
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
