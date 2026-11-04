/**

 * LINE API ↔ Vyline store ブリッジ

 */

import { useEffect, useRef } from "react";

import { useAuthStore } from "../stores/authStore.js";

import { useLineData } from "../hooks/useLineData.js";

import { useHiddenChats } from "../hooks/useHiddenChats.js";

import { useStore } from "../lib/store.js";
import { createReadReceiptPrimer } from "./readReceiptPriming.js";

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

  const line = useLineData({ accountId: enabled ? accountId : null });

  const { hiddenSet } = useHiddenChats(enabled ? accountId : null);

  const syncingChat = useRef(false);
  const lastHydrateAt = useRef(0);
  const hydrateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshReadReceipts = useStore((s) => s.refreshReadReceipts);

  const pollIncoming = useStore((s) => s.pollIncoming);

  const pollMessagesDelta = useStore((s) => s.pollMessagesDelta);

  const refreshChatsSilently = useStore((s) => s.refreshChatsSilently);

  const activeChatId = useStore((s) => s.activeChatId);

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
    if (!enabled || !accountId || !activeChatId) return;

    // 既読者一覧を追い続ける。期限切れの投稿も、初回取得が失敗したときは成功するまで再試行する。
    const shouldPoll = () => {
      const messages = useStore.getState().messages;

      if (activeChatId.startsWith("u")) {
        // DM は相手が読むまで追跡する。15分を過ぎても未読なら確認を止めない。
        return messages.some(
          (m) =>
            m.chatId === activeChatId &&
            m.authorId === "me" &&
            !m.read &&
            m.id &&
            !m.id.startsWith("pending_") &&
            !m.messageState.startsWith("revoked"),
        );
      }

      return messages.some(
        (m) =>
          m.chatId === activeChatId &&
          m.authorId === "me" &&
          m.id &&
          !m.id.startsWith("pending_") &&
          !m.messageState.startsWith("revoked"),
      );
    };

    const tick = () => {
      if (document.visibilityState === "hidden") return;

      if (shouldPoll()) void refreshReadReceipts(activeChatId);
    };

    tick();

    const t = setInterval(tick, 5_000);

    // 開いた直後（再読み込みの後など）はまだ履歴が無く、最初の tick では確認しない。
    // 自分のメッセージが入った時点で一度確認し、次の tick（最大 5 秒）まで「送信済み」のまま待たせない。
    // 期限を過ぎた古い発言も、開いて最初の一回は store 側（refreshReadReceipts）で取得する。
    const prime = createReadReceiptPrimer(() => {
      // tick() は追跡の期限（グループは 15 分）で止まるので、最初の一回は直接取りに行く。
      void refreshReadReceipts(activeChatId);
    });
    const primeIfVisible = (state: ReturnType<typeof useStore.getState>) =>
      prime(
        state.messages.some((m) => m.chatId === activeChatId && m.authorId === "me"),
        document.visibilityState !== "hidden",
      );
    const unsubscribe = useStore.subscribe(primeIfVisible);
    const retryPrimeOnVisibility = () => {
      if (document.visibilityState === "visible") primeIfVisible(useStore.getState());
    };
    document.addEventListener("visibilitychange", retryPrimeOnVisibility);

    return () => {
      clearInterval(t);
      unsubscribe();
      document.removeEventListener("visibilitychange", retryPrimeOnVisibility);
    };
  }, [enabled, accountId, activeChatId, refreshReadReceipts]);

  useEffect(() => {
    if (!enabled) return;

    setAccountId(accountId);

    if (accountId && !showUpdateNote) {
      const screen = useStore.getState().screen;

      if (screen === "home") setScreen("chat");
    }
  }, [enabled, accountId, setAccountId, setScreen, showUpdateNote]);

  useEffect(() => {
    if (!enabled || !accountId || line.accountId !== accountId) return;

    if (!line.chats.length && useStore.getState().chats.length > 0) return;

    // contactCache の逐次解決など連続更新を 1 回の hydrate にまとめる
    // （連鎖する全チャット再マップ → 長タスク・ヒープ膨張を抑止）
    const run = () => {
      if (useStore.getState().accountId !== accountId) return;
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
        readyChatId: line.readyChatId,
        hiddenMids: hiddenSet,
        contactCache: line.contactCache,
      });
    };

    const resolvingInitialScroll =
      line.readyChatId === storeChatId &&
      useStore.getState().initialChatScrollPending &&
      useStore.getState().activeChatId === storeChatId;
    const wait = resolvingInitialScroll
      ? 0
      : Math.max(0, 300 - (Date.now() - lastHydrateAt.current));
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

    line.accountId,

    line.chats,

    line.messages,

    line.readyChatId,

    storeChatId,

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
