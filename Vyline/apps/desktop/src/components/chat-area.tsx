import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, useCallback, type UIEvent } from "react";
import { useStore, displayName, shouldMaskStreamerAvatars, type Message } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useCall } from "@/hooks/useCall";
import { api } from "@/api/client";
import { useVirtualList, type VirtualRow } from "@/hooks/useVirtualList";
import { createChatMessageSelector } from "@/lib/chatMessageSelector";
import { buildChatMessageRowIndex, missingMessagePageRequestKey } from "@/lib/chatMessageRowIndex";
import { resolveInitialChatScrollPosition } from "@/lib/initialChatScroll";
import { countReceivedMessages, findFirstUnreadReceivedMessage, findUnreadAnchorByCount } from "@/lib/readReceiptSelection";
import { createChatDayLabels } from "@/lib/chatDayLabels";
import { canDirectCall, directCallHint } from "@/utils/callAllowlist";
import { MessageBubble } from "@/components/message-bubble";
import { MessageInput } from "@/components/message-input";
import { ProfileDrawer } from "@/components/profile-drawer";
import { MemberProfilePopover } from "@/components/member-profile";
const CallOverlay = lazy(async () => ({ default: (await import("@/components/call-overlay")).CallOverlay }));
import { MessageContextMenu, type MenuItem } from "@/components/message-context-menu";
import { Avatar } from "@/components/vy-ui";
import { OfficialBadge } from "@/components/official-badge";
import {
  IconArrowLeft,
  IconPhone,
  IconVideo,
  IconSearch,
  IconMore,
  IconClose,
  IconChevron,
  IconBell,
  IconBellOff,
  IconPalette,
  IconArrowDown,
  IconMemo,
  IconPin,
  IconChat,
} from "@/components/icons";
import { AgentIActionDialog } from "@/components/agent-i-action-dialog";

type MsgRow =
  | { key: string; kind: "day"; label: string }
  | { key: string; kind: "unread" }
  | {
      key: string;
      kind: "msg";
      message: Message;
      mediaGroup?: Message[];
      index: number;
      sameAuthorAsPrev: boolean;
      sameAuthorAsNext: boolean;
      isMatch: boolean;
      isActive: boolean;
      flash: boolean;
      searching: boolean;
      highlight?: string;
      highlightRegex?: boolean;
    };

function canGroupImageMessage(message: Message): boolean {
  return message.kind === "image" && Boolean(message.imageSrc) && !message.replyToId;
}

function shouldGroupAdjacentImages(left: Message, right: Message, day: string, nextDay: string): boolean {
  return (
    canGroupImageMessage(left) &&
    canGroupImageMessage(right) &&
    left.authorId === right.authorId &&
    left.chatId === right.chatId &&
    day === nextDay &&
    Math.abs(right.createdAt - left.createdAt) <= 30_000
  );
}

function compareMessagesOldestFirst(left: Message, right: Message): number {
  const byTime = left.createdAt - right.createdAt;
  if (byTime) return byTime;
  try {
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
  } catch {
    return left.id.localeCompare(right.id);
  }
}

function ChatAreaBase() {
  const activeChatId = useStore((s) => s.activeChatId);
  const chats = useStore((s) => s.chats);
  const chatMessagesSelector = useMemo(() => {
    const select = createChatMessageSelector(compareMessagesOldestFirst);
    return (state: ReturnType<typeof useStore.getState>) =>
      select(state.messages, state.activeChatId);
  }, []);
  const chatMessages = useStore(chatMessagesSelector);
  const setScreen = useStore((s) => s.setScreen);
  const closeChat = useStore((s) => s.closeChat);
  const profileOpen = useStore((s) => s.profileDrawerOpen);
  const setProfileDrawer = useStore((s) => s.setProfileDrawer);
  const streamerSettings = useStore((s) => s.settings);
  const streamerMode = streamerSettings.streamerMode;
  const agentEnabled = useStore((s) => s.settings.aiEnabled);
  const theme = useStore((s) => s.theme);
  const toggleMute = useStore((s) => s.toggleMute);
  const memberProfile = useStore((s) => s.memberProfile);
  const highlightMessageId = useStore((s) => s.highlightMessageId);
  const initialChatScrollMessageId = useStore((s) => s.initialChatScrollMessageId);
  const initialChatScrollPending = useStore((s) => s.initialChatScrollPending);
  const initialChatScrollUnreadCount = useStore((s) => s.initialChatScrollUnreadCount);
  const accountId = useStore((s) => s.accountId);
  const scrollToMessage = useStore((s) => s.scrollToMessage);
  const announcements = useStore((s) => s.announcements);
  const removeAnnouncement = useStore((s) => s.removeAnnouncement);

  const { call, startCall, endCall, setMuted } = useCall(accountId);
  const [callHint, setCallHint] = useState<string | null>(null);
  const [search, setSearch] = useState<{ open: boolean; q: string; index: number }>({
    open: false,
    q: "",
    index: 0,
  });
  const [regexSearch, setRegexSearch] = useState(false);
  const [searchResultIds, setSearchResultIds] = useState<string[]>([]);
  const [searchNotice, setSearchNotice] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<{ x: number; y: number } | null>(null);
  const [groupCallOnline, setGroupCallOnline] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null);
  const [olderState, setOlderState] = useState({ hasMore: true, loading: false });

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const membersById = useMemo(
    () => new Map((chat?.members ?? []).map((member) => [member.id, member])),
    [chat?.members],
  );

  const canCall = !!chat && !chat.isSelf && canDirectCall(chat.id);

  // グループ通話状態（通話中バッジ）— 15s ポーリング
  useEffect(() => {
    if (!accountId || !chat || chat.type !== "group") {
      setGroupCallOnline(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      try {
        const res = await api.line.groupCallStatus(accountId, chat.id);
        if (!cancelled && res.ok) setGroupCallOnline(Boolean(res.online));
      } catch {
        if (!cancelled) setGroupCallOnline(false);
      }
    };
    void check();
    const timer = window.setInterval(check, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId, chat?.id, chat?.type]);

  useEffect(() => {
    setCallHint(null);
  }, [activeChatId]);

  useEffect(() => {
    if (!callHint) return;
    const t = window.setTimeout(() => setCallHint(null), 3_000);
    return () => window.clearTimeout(t);
  }, [callHint]);

  const handleStartCall = useCallback(
    async (kind: "voice" | "video") => {
      if (!chat || !accountId) return;
      if (!canCall) {
        setCallHint(directCallHint());
        return;
      }
      setCallHint(null);
      await startCall(chat.id, kind);
    },
    [accountId, canCall, chat, startCall],
  );

  const handleEndCall = useCallback(async () => {
    await endCall();
    setCallHint(null);
  }, [endCall]);

  const messageById = useMemo(() => new Map(chatMessages.map((message) => [message.id, message])), [chatMessages]);

  const matches = searchResultIds;
  const matchIds = useMemo(() => new Set(matches), [matches]);

  const activeMatchId = matches.length ? matches[search.index % matches.length] : null;

  useEffect(() => {
    if (!search.open || !accountId || !activeChatId || !search.q.trim()) {
      setSearchResultIds([]);
      setSearchNotice("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.line.searchMessages(accountId, activeChatId, search.q, regexSearch).then((result) => {
        if (cancelled || useStore.getState().activeChatId !== activeChatId) return;
        setSearchResultIds(result.messages.map((message) => message.id));
        setSearchNotice(result.truncated ? (regexSearch
          ? "新しいメッセージ最大1,000件を検索しています。結果は上位100件です。"
          : "結果は上位100件です。必要なら検索語を絞ってください。") : "");
        useStore.getState().mergeIncomingMessages(activeChatId, result.messages, { silent: true });
        setSearch((current) => ({ ...current, index: Math.min(current.index, Math.max(0, result.messages.length - 1)) }));
      }).catch((error: unknown) => {
        if (cancelled) return;
        setSearchResultIds([]);
        setSearchNotice(error instanceof Error ? error.message : "検索に失敗しました");
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [accountId, activeChatId, regexSearch, search.open, search.q]);

  useEffect(() => {
    const onFind = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f" || !activeChatId) return;
      event.preventDefault();
      setSearch((current) => ({ ...current, open: true }));
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, [activeChatId]);

  const rows = useMemo<VirtualRow<MsgRow>[]>(() => {
    const out: VirtualRow<MsgRow>[] = [];
    const dayLabels = createChatDayLabels(chatMessages);
    const unreadAnchorId = initialChatScrollPending ? null : initialChatScrollMessageId;
    let lastDay = "";
    const searching = search.open && search.q.trim().length > 0;
    const q = search.q.trim();
    for (let i = 0; i < chatMessages.length; i++) {
      const m = chatMessages[i]!;
      const dl = dayLabels[i]!;
      if (dl !== lastDay) {
        lastDay = dl;
        out.push({ key: `day-${m.id}`, item: { key: `day-${m.id}`, kind: "day", label: dl } });
      }
      const prev = chatMessages[i - 1];
      const mediaGroup = canGroupImageMessage(m) ? [m] : undefined;
      if (mediaGroup) {
        while (
          i + 1 < chatMessages.length &&
          shouldGroupAdjacentImages(
            mediaGroup[mediaGroup.length - 1]!,
            chatMessages[i + 1]!,
            dl,
            dayLabels[i + 1]!,
          )
        ) {
          mediaGroup.push(chatMessages[i + 1]!);
          i++;
        }
      }
      const lastInRow = mediaGroup?.[mediaGroup.length - 1] ?? m;
      const next = chatMessages[i + 1];
      const sameAuthorAsNext =
        next && next.authorId === lastInRow.authorId && dayLabels[i + 1] === dl;
      const sameAuthorAsPrev =
        prev && prev.authorId === m.authorId && dayLabels[i - 1] === lastDay;
      const groupIds = mediaGroup?.map((item) => item.id) ?? [m.id];
      if (unreadAnchorId && groupIds.includes(unreadAnchorId)) {
        out.push({
          key: `unread-${unreadAnchorId}`,
          item: { key: `unread-${unreadAnchorId}`, kind: "unread" },
        });
      }
      out.push({
        key: `msg-${m.id}`,
        item: {
          key: `msg-${m.id}`,
          kind: "msg",
          message: m,
          mediaGroup: mediaGroup && mediaGroup.length > 1 ? mediaGroup : undefined,
          index: i,
          sameAuthorAsPrev: Boolean(sameAuthorAsPrev),
          sameAuthorAsNext: Boolean(sameAuthorAsNext),
          isMatch: groupIds.some((id) => matchIds.has(id)),
          isActive: groupIds.includes(activeMatchId ?? ""),
          flash: groupIds.includes(highlightMessageId ?? ""),
          searching,
          highlight: searching && !regexSearch ? q : undefined,
          highlightRegex: searching && regexSearch,
        },
      });
    }
    return out;
  }, [chatMessages, matchIds, search.open, search.q, activeMatchId, highlightMessageId,
    initialChatScrollMessageId, initialChatScrollPending]);
  const messageRowKeyById = useMemo(() => buildChatMessageRowIndex(rows), [rows]);

  const estimateMsgHeight = useCallback((row: MsgRow): number => {
    if (row.kind === "day") return 40;
    if (row.kind === "unread") return 36;
    if (row.mediaGroup && row.mediaGroup.length > 1) {
      return row.mediaGroup.length <= 2 ? 210 : 300;
    }
    const m = row.message!;
    if (m.kind === "sticker") return 160;
    if (m.kind === "image" || m.kind === "video") return 320;
    if (m.kind === "flex" || m.kind === "rich") return 300;
    if (m.kind === "emoji") return 90;
    if (m.kind === "call") return 60;
    return 60 + (m.text?.length ?? 0) * 0.35;
  }, []);
  const {
    containerRef,
    onScroll,
    visibleRows,
    topSpacer,
    bottomSpacer,
    rowRef,
    scrollToKey,
    scrollToBottom,
  } = useVirtualList<MsgRow>({ rows, estimateHeight: estimateMsgHeight });

  // 先頭に居続けているときは、ページ追加後も次のローカル履歴を連続して取得する。
  useEffect(() => {
    const onOlderLoaded = (event: Event) => {
      const chatMid = (event as CustomEvent<{ chatMid?: string }>).detail?.chatMid;
      if (chatMid !== activeChatId) return;
      const container = containerRef.current;
      if (!container || container.scrollTop > 160) return;
      window.requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("vyline:load-older-messages", { detail: { chatMid: activeChatId } }),
        );
      });
    };
    window.addEventListener("vyline:older-messages-loaded", onOlderLoaded);
    return () => window.removeEventListener("vyline:older-messages-loaded", onOlderLoaded);
  }, [activeChatId, containerRef]);

  const handleMessageScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onScroll(event);
      if (event.currentTarget.scrollTop <= 160 && activeChatId) {
        window.dispatchEvent(
          new CustomEvent("vyline:load-older-messages", { detail: { chatMid: activeChatId } }),
        );
      }
    },
    [activeChatId, onScroll],
  );

  const requestOlderMessages = useCallback(() => {
    if (!activeChatId || olderState.loading || !olderState.hasMore) return;
    window.dispatchEvent(
      new CustomEvent("vyline:load-older-messages", { detail: { chatMid: activeChatId } }),
    );
  }, [activeChatId, olderState]);

  useEffect(() => {
    setOlderState({ hasMore: true, loading: false });
    const onOlderState = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          chatMid?: string;
          hasMore?: boolean;
          loading?: boolean;
        }>
      ).detail;
      if (detail?.chatMid !== activeChatId) return;
      setOlderState({ hasMore: detail.hasMore ?? false, loading: detail.loading ?? false });
    };
    window.addEventListener("vyline:older-messages-state", onOlderState);
    return () => window.removeEventListener("vyline:older-messages-state", onOlderState);
  }, [activeChatId]);

  const openedChatRef = useRef<string | null>(null);
  const replyJumpFrame = useRef<number | null>(null);
  const jumpRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeChatId) return;
    openedChatRef.current = null;
    jumpRequestKeyRef.current = null;
  }, [activeChatId]);

  // Large unread backlogs can exceed the first fetched page. Fetch older pages
  // until the oldest unread message is in memory before choosing the opening position.
  useEffect(() => {
    if (!activeChatId || !initialChatScrollPending || initialChatScrollUnreadCount <= 0) return;
    const receivedCount = countReceivedMessages(chatMessages, activeChatId);
    if (receivedCount >= initialChatScrollUnreadCount) return;
    if (olderState.loading) return;
    if (chatMessages.length === 0) return;
    if (!olderState.hasMore) {
      const target =
        findUnreadAnchorByCount(chatMessages, activeChatId, initialChatScrollUnreadCount)?.id ??
        findFirstUnreadReceivedMessage(chatMessages, activeChatId)?.id ??
        initialChatScrollMessageId;
      useStore.setState({
        initialChatScrollMessageId: target,
        initialChatScrollUnreadCount: 0,
        initialChatScrollPending: false,
      });
      if (receivedCount < initialChatScrollUnreadCount && chatMessages.length > 0) {
        useStore.getState().showNotice("未読位置より前の履歴をすべて読み込めませんでした");
      }
      return;
    }
    const requestKey = `unread:${activeChatId}:${chatMessages[0]?.id ?? "empty"}:${receivedCount}`;
    if (jumpRequestKeyRef.current === requestKey) return;
    jumpRequestKeyRef.current = requestKey;
    window.dispatchEvent(new CustomEvent("vyline:load-older-messages", {
      detail: { chatMid: activeChatId },
    }));
  }, [activeChatId, chatMessages, initialChatScrollMessageId, initialChatScrollPending,
    initialChatScrollUnreadCount, olderState]);

  useEffect(() => {
    if (!activeChatId) return;
    const onOlderFailure = (event: Event) => {
      const detail = (event as CustomEvent<{ chatMid?: string }>).detail;
      if (detail?.chatMid !== activeChatId) return;
      const state = useStore.getState();
      if (!state.initialChatScrollPending || state.initialChatScrollUnreadCount <= 0) return;
      const target =
        findUnreadAnchorByCount(chatMessages, activeChatId, state.initialChatScrollUnreadCount)?.id ??
        findFirstUnreadReceivedMessage(chatMessages, activeChatId)?.id ??
        state.initialChatScrollMessageId;
      useStore.setState({
        initialChatScrollMessageId: target,
        initialChatScrollUnreadCount: 0,
        initialChatScrollPending: false,
      });
      state.showNotice("未読位置までの履歴を取得できませんでした");
    };
    window.addEventListener("vyline:older-messages-failed", onOlderFailure);
    return () => window.removeEventListener("vyline:older-messages-failed", onOlderFailure);
  }, [activeChatId, chatMessages]);

  // 返信・未読の対象が現在のページより古ければ、必要なページだけ追加取得する。
  useEffect(() => {
    if (!activeChatId || initialChatScrollPending) return;
    const targetId = highlightMessageId ?? (
      openedChatRef.current !== activeChatId ? initialChatScrollMessageId : null
    );
    if (!targetId || messageRowKeyById.has(targetId) || olderState.loading) return;
    if (!olderState.hasMore) {
      useStore.getState().showNotice(
        highlightMessageId === targetId
          ? "対象メッセージが読み込み済みの履歴にありません"
          : "未読メッセージの位置を特定できませんでした",
      );
      if (highlightMessageId === targetId) {
        useStore.setState({ highlightMessageId: null });
      } else {
        openedChatRef.current = activeChatId;
        useStore.setState({ initialChatScrollMessageId: null });
        scrollToBottom("auto");
      }
      return;
    }
    const requestKey = missingMessagePageRequestKey(
      activeChatId,
      targetId,
      chatMessages[0]?.id,
      false,
      olderState.hasMore,
      olderState.loading,
      jumpRequestKeyRef.current,
    );
    if (!requestKey) return;
    jumpRequestKeyRef.current = requestKey;
    window.dispatchEvent(new CustomEvent("vyline:load-older-messages", {
      detail: { chatMid: activeChatId, targetMessageId: targetId },
    }));
  }, [activeChatId, chatMessages, highlightMessageId, initialChatScrollMessageId, initialChatScrollPending,
    messageRowKeyById, olderState, scrollToBottom]);

  // 開いた瞬間だけ位置を決める。未読があればその先頭、なければ末尾に置き、
  // 以後の受信・画像の高さ確定・ページ追加では利用者のスクロール位置を動かさない。
  useEffect(() => {
    if (!activeChatId || initialChatScrollPending || openedChatRef.current === activeChatId) return;
    const key = initialChatScrollMessageId ? messageRowKeyById.get(initialChatScrollMessageId) : undefined;
    const position = resolveInitialChatScrollPosition(initialChatScrollMessageId, key, olderState.hasMore);
    if (position === "waiting" || position === "missing") return;
    let settleFrame = 0;
    const frame = requestAnimationFrame(() => {
      // Wait for the virtual list to recalculate its spacers after chat data and
      // the active pane have committed. Otherwise scrollHeight can still be
      // the previous chat's partial window, leaving all-read chats mid-history.
      settleFrame = requestAnimationFrame(() => {
        if (useStore.getState().activeChatId !== activeChatId) return;
        if (position === "target" && key) scrollToKey(key, { behavior: "auto", center: true });
        else scrollToBottom("auto");
        openedChatRef.current = activeChatId;
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (settleFrame) cancelAnimationFrame(settleFrame);
    };
  }, [activeChatId, initialChatScrollMessageId, initialChatScrollPending, messageRowKeyById, olderState.hasMore, scrollToBottom, scrollToKey]);

  // 返信ジャンプ（store.scrollToMessage → highlightMessageId）
  useEffect(() => {
    if (!highlightMessageId) return;
    const key = messageRowKeyById.get(highlightMessageId);
    if (!key) return;
    const targetId = highlightMessageId;
    replyJumpFrame.current = requestAnimationFrame(() => {
      replyJumpFrame.current = null;
      scrollToKey(key, { center: true });
    });
    const clearTimer = window.setTimeout(() => {
      if (useStore.getState().highlightMessageId === targetId) {
        useStore.setState({ highlightMessageId: null });
      }
    }, 2200);
    return () => {
      window.clearTimeout(clearTimer);
      if (replyJumpFrame.current !== null) cancelAnimationFrame(replyJumpFrame.current);
      replyJumpFrame.current = null;
    };
  }, [highlightMessageId, messageRowKeyById, scrollToKey]);

  // 検索ヒットへジャンプ
  useEffect(() => {
    if (!matches.length) return;
    const id = matches[search.index % matches.length];
    const key = messageRowKeyById.get(id);
    if (key) scrollToKey(key, { center: true });
  }, [search.index, matches, messageRowKeyById, scrollToKey]);

  const name = chat ? displayName(chat, streamerMode) : "";
  const todayText = useMemo(() => {
    if (!agentEnabled || !chat) return "";
    const today = new Date().toDateString();
    return chatMessages
      .filter((m) => new Date(m.createdAt).toDateString() === today && m.text?.trim())
      .slice(-120)
      .map((m) => `${m.authorId === "me" ? "自分" : name}: ${m.text!.trim().slice(0, 800)}`)
      .join("\n");
  }, [agentEnabled, chat, chatMessages, name]);

  if (!chat) {
    return (
      <div
        className="hidden flex-1 items-center justify-center bg-[var(--vy-chat-bg)] md:flex"
        data-pattern="0"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <IconChat size={32} className="text-[var(--vy-text-dim)]" />
          <div>
            <p className="text-base font-medium text-[var(--vy-text)]">
              チャットを選択してください
            </p>
            <p className="mt-2 text-sm text-[var(--vy-text-dim)]">
              左のリストからトークを開くか、新しい会話を始めましょう
            </p>
          </div>
        </div>
      </div>
    );
  }

  const panelItems: MenuItem[] = [
    {
      label: "メッセージを検索",
      icon: <IconSearch size={16} />,
      onClick: () => setSearch((s) => ({ ...s, open: true })),
    },
    ...(agentEnabled
      ? [
          {
            label: "今日の会話をAIで要約",
            icon: <IconMemo size={16} />,
            onClick: () =>
              setAgentPrompt(
                todayText
                  ? `次の今日の会話を日本語で5行以内に要約してください。重要な話題、決定、TODOを含めてください。\n\n${todayText}`
                  : "今日の会話に要約できるテキストメッセージはありません。",
              ),
          },
        ]
      : []),
    {
      label: "一番下へスクロール",
      icon: <IconArrowDown size={16} />,
      onClick: () => scrollToBottom("smooth"),
    },
    {
      label: chat.muted ? "ミュートを解除" : "通知をミュート",
      icon: chat.muted ? <IconBell size={16} /> : <IconBellOff size={16} />,
      onClick: () => toggleMute(chat.id),
    },
    {
      label: "VyTheme を開く",
      icon: <IconPalette size={16} />,
      onClick: () => setScreen("settings"),
    },
    {
      label: "プロフィールを表示",
      icon: <IconMore size={16} />,
      onClick: () => setProfileDrawer(true),
    },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="vy-chat-header flex min-h-16 items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2.5 md:gap-3 md:pl-12 md:pr-4">
          <button
            type="button"
            onClick={() => closeChat()}
            aria-label="チャット一覧に戻る"
            className="vy-mobile-back flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none md:hidden"
          >
            <IconArrowLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => setProfileDrawer(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          >
            <Avatar
              glyph={shouldMaskStreamerAvatars(streamerMode) ? "•" : chat.avatar}
              color={chat.color}
              size={40}
              online={chat.online}
              imageUrl={shouldMaskStreamerAvatars(streamerMode) ? undefined : chat.avatarUrl}
              icon={!streamerMode && chat.isSelf ? <IconMemo size={22} /> : undefined}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="vy-chat-header-title truncate text-sm font-semibold">{name}</span>
                {chat.isOfficial && <OfficialBadge />}
                {chat.muted && (
                  <IconBellOff size={13} className="shrink-0 text-[var(--vy-text-dim)]" />
                )}
                {groupCallOnline && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--vy-accent)]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--vy-accent)]" />
                    通話中
                  </span>
                )}
              </span>
              <span
                className="block truncate text-xs"
                style={{ color: chat.online ? "#3fd07d" : "var(--vy-text-dim)" }}
              >
                {chat.status}
              </span>
            </span>
          </button>
          <HeaderButton
            label={canCall ? "音声通話" : directCallHint()}
            onClick={() => void handleStartCall("voice")}
          >
            <IconPhone size={19} />
          </HeaderButton>
          <HeaderButton
            label={canCall ? "ビデオ通話" : directCallHint()}
            onClick={() => void handleStartCall("video")}
          >
            <IconVideo size={19} />
          </HeaderButton>
          <HeaderButton
            label="検索"
            active={search.open}
            onClick={() => setSearch((s) => ({ ...s, open: !s.open, q: s.open ? "" : s.q }))}
          >
            <IconSearch size={19} />
          </HeaderButton>
          <HeaderButton label="メニュー" onClick={() => setProfileDrawer(!profileOpen)}>
            <IconMore size={19} />
          </HeaderButton>
        </header>

        {/* in-chat search bar */}
        {search.open && (
          <div className="vy-fade-in flex items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2 md:px-4">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-[var(--vy-surface-2)] px-3 py-2">
              <IconSearch size={16} className="text-[var(--vy-text-dim)]" />
              <input
                ref={searchInputRef}
                value={search.q}
                onChange={(e) => setSearch((s) => ({ ...s, q: e.target.value, index: 0 }))}
                placeholder={regexSearch ? "正規表現で検索" : "このトーク内を検索"}
                aria-label="トーク内を検索"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--vy-text-dim)]"
              />
              <span className="shrink-0 text-xs tabular-nums text-[var(--vy-text-dim)]">
                {search.q.trim()
                  ? `${matches.length ? (search.index % matches.length) + 1 : 0}/${matches.length}`
                  : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRegexSearch((enabled) => !enabled)}
              aria-pressed={regexSearch}
              aria-label="正規表現検索を切り替え"
              title={regexSearch ? "正規表現 ON" : "正規表現 OFF"}
              className={cn("h-9 rounded-lg border px-2 font-mono text-xs", regexSearch
                ? "border-[var(--vy-accent)] text-[var(--vy-accent)]"
                : "border-[var(--vy-border)] text-[var(--vy-text-dim)]")}
            >.*</button>
            <button
              type="button"
              disabled={!matches.length}
              onClick={() =>
                setSearch((s) => ({ ...s, index: (s.index - 1 + matches.length) % matches.length }))
              }
              aria-label="前の一致"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-30"
            >
              <IconChevron size={16} className="-rotate-90" />
            </button>
            <button
              type="button"
              disabled={!matches.length}
              onClick={() => setSearch((s) => ({ ...s, index: (s.index + 1) % matches.length }))}
              aria-label="次の一致"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-30"
            >
              <IconChevron size={16} className="rotate-90" />
            </button>
            <button
              type="button"
              onClick={() => setSearch({ open: false, q: "", index: 0 })}
              aria-label="検索を閉じる"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
            >
              <IconClose size={16} />
            </button>
          </div>
        )}
        {search.open && searchNotice && (
          <div role="status" className="px-4 py-1 text-xs text-[var(--vy-text-dim)]">{searchNotice}</div>
        )}

        {/* pinned announcement banner */}
        {(() => {
          const list = activeChatId ? (announcements[activeChatId] ?? []) : [];
          if (!list.length) return null;
          return (
            <div className="mx-auto w-full max-w-3xl px-1">
              <div
                className="mb-3 rounded-xl border border-[var(--vy-border)] bg-[color-mix(in_oklab,var(--vy-accent)_10%,var(--vy-surface))] text-xs text-[var(--vy-text)]"
                data-pattern={theme.pattern}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <IconPin size={14} className="shrink-0 text-[var(--vy-accent)]" />
                  <span className="font-semibold">アナウンス</span>
                  <span className="text-[var(--vy-text-dim)]">({list.length}件)</span>
                </div>
                <div className="max-h-40 overflow-y-auto border-t border-[var(--vy-border)]">
                  {list.map((a) => (
                    <div
                      key={a.announcementSeq}
                      className="flex items-center gap-2 px-3 py-2 last:border-b-0 hover:bg-[var(--vy-surface-2)]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const m = a.link.match(/[?&]messageId=([^&]+)/);
                          const messageId = m ? decodeURIComponent(m[1]) : null;
                          if (messageId) {
                            scrollToMessage(messageId);
                          }
                        }}
                        className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline"
                        title={a.text}
                      >
                        {a.text}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (a.announcementSeq && activeChatId && accountId) {
                            void api.line.announce
                              .remove(accountId, activeChatId, a.announcementSeq)
                              .then((res) => {
                                if (res.ok && activeChatId) {
                                  removeAnnouncement(activeChatId, a.announcementSeq);
                                }
                              });
                          }
                        }}
                        className="shrink-0 rounded-lg p-1 transition-colors hover:bg-[var(--vy-surface)]"
                        aria-label="アナウンスを解除"
                      >
                        <IconClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* messages */}
        <div
          ref={containerRef}
          onScroll={handleMessageScroll}
          onContextMenu={(e) => {
            e.preventDefault();
            setPanel({ x: e.clientX, y: e.clientY });
          }}
          className="vy-scroll vy-chat-surface vy-chat-messages [overflow-anchor:none] flex-1 overflow-y-auto px-3 py-4 md:px-6"
          style={{ overflowAnchor: "none" }}
          data-pattern={theme.pattern}
          data-image={theme.chatImage ? "" : undefined}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col">
            <div className="mb-4 flex justify-center">
              {olderState.hasMore ? (
                <button
                  type="button"
                  onClick={requestOlderMessages}
                  disabled={olderState.loading}
                  className="rounded-xl bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-4 py-2 text-center text-xs leading-relaxed text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-text)] disabled:cursor-wait disabled:opacity-70"
                >
                  {olderState.loading
                    ? "過去のメッセージを読み込み中…"
                    : "↑ 過去のメッセージを読み込む"}
                </button>
              ) : (
                <span className="rounded-xl bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-4 py-2 text-center text-xs leading-relaxed text-[var(--vy-text-dim)]">
                  {chat.type === "group"
                    ? "▲ ここがトークの一番上です"
                    : "▲ ここから会話が始まります"}
                </span>
              )}
            </div>
            {topSpacer > 0 && <div style={{ height: topSpacer }} aria-hidden />}
            {visibleRows.map(({ key, item }) =>
              item.kind === "day" ? (
                <div key={key} ref={rowRef(key)} className="my-3 flex justify-center">
                  <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_12%,transparent)] px-3 py-1 text-[0.7rem] font-medium text-[var(--vy-text)] backdrop-blur">
                    {item.label}
                  </span>
                </div>
              ) : item.kind === "unread" ? (
                <div
                  key={key}
                  ref={rowRef(key)}
                  role="separator"
                  aria-label="ここから未読"
                  className="my-2 flex items-center gap-3 px-1 py-1 text-xs font-semibold text-[var(--vy-accent)]"
                >
                  <span className="h-px flex-1 bg-[color-mix(in_oklab,var(--vy-accent)_55%,transparent)]" />
                  <span>ここから未読</span>
                  <span className="h-px flex-1 bg-[color-mix(in_oklab,var(--vy-accent)_55%,transparent)]" />
                </div>
              ) : (
                <div
                  key={key}
                  id={key}
                  ref={rowRef(key)}
                  className={cnRow(
                    item.searching,
                    item.isMatch,
                    item.isActive,
                    item.sameAuthorAsPrev,
                    item.flash,
                  )}
                >
                  <MessageBubble
                    message={item.message}
                    replied={item.message.replyToId ? messageById.get(item.message.replyToId) : undefined}
                    membersById={membersById}
                    mediaGroup={item.mediaGroup}
                    chat={chat}
                    showAvatar={!item.sameAuthorAsNext}
                    showName={!item.sameAuthorAsPrev}
                    highlight={item.searching ? (item.highlight as string) : undefined}
                    highlightRegex={item.searching ? item.highlightRegex : false}
                  />
                </div>
              ),
            )}
            {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden />}
          </div>
        </div>

        {/* input */}
        {callHint && (
          <p className="border-t border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-2 text-xs text-[var(--vy-text-dim)]">
            {callHint}
          </p>
        )}
        <MessageInput chatId={chat.id} />
      </div>

      {profileOpen && <ProfileDrawer chat={chat} />}
      {memberProfile && memberProfile.chatId === chat.id && <MemberProfilePopover chat={chat} />}
      {panel && (
        <MessageContextMenu
          x={panel.x}
          y={panel.y}
          items={panelItems}
          onClose={() => setPanel(null)}
        />
      )}
      {agentPrompt && (
        <AgentIActionDialog
          title="今日の会話の要約"
          prompt={agentPrompt}
          onClose={() => setAgentPrompt(null)}
        />
      )}
      {call && (
        <Suspense fallback={null}>
          <CallOverlay
            kind={call.kind}
            name={name}
            glyph={shouldMaskStreamerAvatars(streamerMode) ? "•" : chat.avatar}
            color={chat.color}
            imageUrl={shouldMaskStreamerAvatars(streamerMode) ? undefined : chat.avatarUrl}
            state={call.state}
            error={call.error}
            onClose={() => void handleEndCall()}
            onMutedChange={setMuted}
          />
        </Suspense>
      )}
    </div>
  );
}

export const ChatArea = memo(ChatAreaBase);

function cnRow(
  searching: boolean,
  isMatch: boolean,
  isActive: boolean,
  sameAuthorAsPrev: boolean,
  flashHighlight: boolean,
) {
  const base = sameAuthorAsPrev ? "mt-0.5 vy-msg-stack-gap-tight" : "mt-3 vy-msg-stack-gap";
  if (flashHighlight) {
    return `${base} rounded-xl ring-2 ring-[var(--vy-accent)] vy-fade-in transition-all`;
  }
  if (!searching) return base;
  if (isActive) return `${base} rounded-xl ring-2 ring-[var(--vy-accent)] transition-all`;
  if (isMatch) return base;
  return `${base} opacity-40 transition-opacity`;
}

function HeaderButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
        active
          ? "bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] text-[var(--vy-accent)]"
          : "text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
      )}
    >
      {children}
    </button>
  );
}
