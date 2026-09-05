/**

 * LINE API ↔ Vyline store ブリッジ

 */

import { useEffect, useRef } from "react";

import { useAuthStore } from "../stores/authStore.js";

import { useLineData } from "../hooks/useLineData.js";

import { useHiddenChats } from "../hooks/useHiddenChats.js";

import { useStore } from "../lib/store.js";
import { api } from "../api/client.js";
import { startSerialPoll } from "../lib/serialPoll.js";

function eventsPollIntervalMs(): number {
  if (typeof document === "undefined") return 2_000;
  return document.hasFocus() ? 2_000 : 8_000;
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
    return startSerialPoll(
      async () => {
        await api.line.verifyFriendBlockStatus(accountId);
        return true;
      },
      {
        intervalMs: 120_000,
        pauseWhenHidden: true,
        onError: () => undefined,
      },
    );
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

    const stopEventsPoll = startSerialPoll(
      async () => {
        await pollIncoming();
        return true;
      },
      {
        intervalMs: eventsPollIntervalMs,
        pauseWhenHidden: true,
        onError: () => undefined,
      },
    );

    const stopChatsPoll = startSerialPoll(
      async () => {
        await refreshChatsSilently();
        return true;
      },
      {
        intervalMs: () => 120_000 + Math.random() * 25_000,
        runImmediately: false,
        pauseWhenHidden: true,
        onError: () => undefined,
      },
    );

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Serial poll itself resumes exactly once. Only the active chat delta is
      // requested separately because it is scoped to the currently open chat.
      const { activeChatId: aid } = useStore.getState();
      if (aid) void pollMessagesDelta(aid);
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopEventsPoll();
      stopChatsPoll();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, accountId, pollIncoming, pollMessagesDelta, refreshChatsSilently]);

  useEffect(() => {
    if (!enabled || !accountId || !activeChatId || !readReceiptsEnabled) return;

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

    return startSerialPoll(
      async () => {
        if (shouldPoll()) await refreshReadReceipts(activeChatId);
        return true;
      },
      {
        intervalMs: 10_000,
        pauseWhenHidden: true,
        onError: () => undefined,
      },
    );
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
    // useLineData state is effect-reset on account changes. During the transition
    // render it can still contain the previous account, so never hydrate it here.
    if (line.dataAccountId !== accountId) return;

    if (!line.chats.length && useStore.getState().chats.length > 0) return;

    // contactCache の逐次解決など連続更新を 1 回の hydrate にまとめる
    // （連鎖する全チャット再マップ → 長タスク・ヒープ膨張を抑止）
    const run = () => {
      lastHydrateAt.current = Date.now();
      hydrateLineData({
        profile: line.profile
          ? {
              mid: line.profile.mid,
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

    line.dataAccountId,

    line.profile,

    line.chats,

    line.messages,

    line.contactCache,

    hiddenSet,

    hydrateLineData,
  ]);

  useEffect(() => {
    if (!enabled || syncingChat.current) return;
    const targetChatId = storeChatId ?? "";
    if (targetChatId !== line.selectedChatMid) {
      syncingChat.current = true;
      line.setSelectedChatMid(targetChatId);
      syncingChat.current = false;
    }
  }, [enabled, storeChatId, line.selectedChatMid, line.setSelectedChatMid]);
}
