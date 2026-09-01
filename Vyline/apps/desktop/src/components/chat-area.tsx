import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
  type DragEvent,
} from "react";
import { useStore, displayName, type Message } from "@/lib/store";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { useVirtualList, type VirtualRow } from "@/hooks/useVirtualList";
import { MessageBubble } from "@/components/message-bubble";
import { MessageInput } from "@/components/message-input";
import { ProfileDrawer } from "@/components/profile-drawer";
import { MemberProfilePopover } from "@/components/member-profile";
import { MessageContextMenu, type MenuItem } from "@/components/message-context-menu";
import { Avatar } from "@/components/vy-ui";
import { OfficialBadge } from "@/components/official-badge";
import {
  IconArrowLeft,
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
} from "@/components/icons";
import { AgentIActionDialog } from "@/components/agent-i-action-dialog";
import { findFirstUnreadMessage, isNearScrollBottom } from "@/lib/chatScroll";
import { emitAppEvent, onAppEvent } from "@/lib/appEvents";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "今日";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨日";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

type MsgRow =
  | { key: string; kind: "day"; label: string }
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
    };

function canGroupImageMessage(message: Message): boolean {
  return message.kind === "image" && Boolean(message.imageSrc) && !message.replyToId;
}

function shouldGroupAdjacentImages(left: Message, right: Message): boolean {
  return (
    canGroupImageMessage(left) &&
    canGroupImageMessage(right) &&
    left.authorId === right.authorId &&
    left.chatId === right.chatId &&
    dayLabel(left.createdAt) === dayLabel(right.createdAt) &&
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

type ChatAreaProps = {
  chatId?: string;
  paneCount?: number;
  onFocus?: () => void;
  onClosePane?: () => void;
  reserveSidebarToggle?: boolean;
  onPaneDragStart?: (event: DragEvent<HTMLDivElement>) => void;
};

function ChatAreaBase({
  chatId,
  paneCount = 1,
  onFocus,
  onClosePane,
  reserveSidebarToggle = true,
  onPaneDragStart,
}: ChatAreaProps) {
  const desktopInteraction = isDesktopInteraction();
  const storeActiveChatId = useStore((s) => s.activeChatId);
  const activeChatId = chatId ?? storeActiveChatId;
  const isFocusedPane = !chatId || storeActiveChatId === activeChatId;
  const chats = useStore((s) => s.chats);
  const messages = useStore((s) => s.messages);
  const setScreen = useStore((s) => s.setScreen);
  const closeChat = useStore((s) => s.closeChat);
  const storedProfileOpen = useStore((s) => s.profileDrawerOpen);
  const profileOpen = storedProfileOpen && isFocusedPane;
  const setProfileDrawer = useStore((s) => s.setProfileDrawer);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const agentEnabled = useStore((s) => s.settings.betaAgentI);
  const theme = useStore((s) => s.theme);
  const toggleMute = useStore((s) => s.toggleMute);
  const memberProfile = useStore((s) => s.memberProfile);
  const highlightMessageId = useStore((s) => s.highlightMessageId);
  const storedInitialChatScrollMessageId = useStore((s) => s.initialChatScrollMessageId);
  const storedLoadingMessages = useStore((s) => s.loadingMessages);
  const storedInitialChatScrollMode = useStore((s) => s.initialChatScrollMode);
  const initialChatScrollMessageId = isFocusedPane ? storedInitialChatScrollMessageId : null;
  const loadingMessages = isFocusedPane ? storedLoadingMessages : false;
  const initialChatScrollMode = isFocusedPane ? storedInitialChatScrollMode : "bottom";
  const accountId = useStore((s) => s.accountId);
  const scrollToMessage = useStore((s) => s.scrollToMessage);
  const announcements = useStore((s) => s.announcements);
  const removeAnnouncement = useStore((s) => s.removeAnnouncement);

  const [search, setSearch] = useState<{ open: boolean; q: string; index: number }>({
    open: false,
    q: "",
    index: 0,
  });
  const [panel, setPanel] = useState<{ x: number; y: number } | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null);
  const [olderState, setOlderState] = useState({ hasMore: true, loading: false });
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [announcementExpandedByChat, setAnnouncementExpandedByChat] = useState<
    Record<string, boolean>
  >({});

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const announcementExpanded = activeChatId
    ? (announcementExpandedByChat[activeChatId] ?? false)
    : false;
  const updateProfileDrawer = useCallback(
    (open: boolean) => {
      onFocus?.();
      setProfileDrawer(open);
    },
    [onFocus, setProfileDrawer],
  );

  const chatMessages = useMemo(
    () => messages.filter((m) => m.chatId === activeChatId).sort(compareMessagesOldestFirst),
    [messages, activeChatId],
  );

  const firstUnreadMessageId = useMemo(
    () => findFirstUnreadMessage(chatMessages)?.id ?? null,
    [chatMessages],
  );
  const matches = useMemo(() => {
    const q = search.q.trim().toLowerCase();
    if (!q) return [] as string[];
    return chatMessages.filter((m) => (m.text ?? "").toLowerCase().includes(q)).map((m) => m.id);
  }, [search.q, chatMessages]);

  const activeMatchId = matches.length ? matches[search.index % matches.length] : null;

  const rows = useMemo<VirtualRow<MsgRow>[]>(() => {
    const out: VirtualRow<MsgRow>[] = [];
    let lastDay = "";
    const searching = search.open && search.q.trim().length > 0;
    const q = search.q.trim();
    for (let i = 0; i < chatMessages.length; i++) {
      const m = chatMessages[i]!;
      const dl = dayLabel(m.createdAt);
      if (dl !== lastDay) {
        lastDay = dl;
        out.push({ key: `day-${m.id}`, item: { key: `day-${m.id}`, kind: "day", label: dl } });
      }
      const prev = chatMessages[i - 1];
      const mediaGroup = canGroupImageMessage(m) ? [m] : undefined;
      if (mediaGroup) {
        while (
          i + 1 < chatMessages.length &&
          shouldGroupAdjacentImages(mediaGroup[mediaGroup.length - 1]!, chatMessages[i + 1]!)
        ) {
          mediaGroup.push(chatMessages[i + 1]!);
          i++;
        }
      }
      const lastInRow = mediaGroup?.[mediaGroup.length - 1] ?? m;
      const next = chatMessages[i + 1];
      const sameAuthorAsNext =
        next && next.authorId === lastInRow.authorId && dayLabel(next.createdAt) === dl;
      const sameAuthorAsPrev =
        prev && prev.authorId === m.authorId && dayLabel(prev.createdAt) === lastDay;
      const groupIds = mediaGroup?.map((item) => item.id) ?? [m.id];
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
          isMatch: groupIds.some((id) => matches.includes(id)),
          isActive: groupIds.includes(activeMatchId ?? ""),
          flash: groupIds.includes(highlightMessageId ?? ""),
          searching,
          highlight: searching ? q : undefined,
        },
      });
    }
    return out;
  }, [chatMessages, matches, search.open, search.q, activeMatchId, highlightMessageId]);

  const estimateMsgHeight = useCallback((row: MsgRow): number => {
    if (row.kind === "day") return 40;
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
    hasMeasured,
    topSpacer,
    bottomSpacer,
    rowRef,
    scrollToMessagePosition,
    scrollToBottom,
  } = useVirtualList<MsgRow>({ rows, estimateHeight: estimateMsgHeight });
  const messageListRef = useRef<HTMLDivElement>(null);

  const syncBottomButton = useCallback(
    (element: HTMLDivElement | null = containerRef.current) => {
      if (!element) {
        setShowScrollToBottom(false);
        return;
      }
      setShowScrollToBottom(
        !isNearScrollBottom({
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }),
      );
    },
    [containerRef],
  );

  const toggleAnnouncementExpanded = useCallback(() => {
    if (!activeChatId) return;
    setAnnouncementExpandedByChat((current) => ({
      ...current,
      [activeChatId]: !(current[activeChatId] ?? false),
    }));
  }, [activeChatId]);

  const olderBoundaryArmedRef = useRef(true);
  const lastUserScrollIntentAtRef = useRef(0);
  const prependAnchorRef = useRef<{
    chatMid: string;
    messageCount: number;
    oldestMessageId: string | null;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  const requestOlderMessages = useCallback(() => {
    if (!activeChatId || olderState.loading || !olderState.hasMore) return;
    const container = containerRef.current;
    if (container) {
      prependAnchorRef.current = {
        chatMid: activeChatId,
        messageCount: chatMessages.length,
        oldestMessageId: chatMessages[0]?.id ?? null,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }
    emitAppEvent("history:load-older", { chatMid: activeChatId });
  }, [activeChatId, chatMessages.length, containerRef, olderState]);

  const handleMessageScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onScroll(event);
      syncBottomButton(event.currentTarget);
      const top = event.currentTarget.scrollTop;
      if (top > 240) {
        olderBoundaryArmedRef.current = true;
        return;
      }
      const userDriven = performance.now() - lastUserScrollIntentAtRef.current < 1_500;
      if (
        top <= 80 &&
        userDriven &&
        olderBoundaryArmedRef.current &&
        olderState.hasMore &&
        !olderState.loading
      ) {
        // wheel / touch / scrollbar 操作で実際に上端へ到達した時だけ1ページ。
        // 初期レイアウトやプログラムによる scrollTop 変更では取得しない。
        olderBoundaryArmedRef.current = false;
        requestOlderMessages();
      }
    },
    [olderState.hasMore, olderState.loading, onScroll, requestOlderMessages, syncBottomButton],
  );

  // prepend 後も、読み込み前に見ていた位置を維持する。
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor || anchor.chatMid !== activeChatId) return;
    if (chatMessages.length <= anchor.messageCount) return;
    if ((chatMessages[0]?.id ?? null) === anchor.oldestMessageId) return;

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const addedHeight = Math.max(0, container.scrollHeight - anchor.scrollHeight);
      container.scrollTop = anchor.scrollTop + addedHeight;
      prependAnchorRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeChatId, chatMessages.length, containerRef]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => syncBottomButton());
    return () => cancelAnimationFrame(frame);
  }, [activeChatId, bottomSpacer, chatMessages.length, hasMeasured, syncBottomButton, topSpacer]);

  useEffect(() => {
    const viewport = containerRef.current;
    const content = messageListRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncBottomButton(viewport));
    observer.observe(viewport);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [activeChatId, containerRef, syncBottomButton]);

  useEffect(() => {
    olderBoundaryArmedRef.current = true;
    prependAnchorRef.current = null;
    setOlderState({ hasMore: true, loading: false });
    return onAppEvent("history:state", (detail) => {
      if (detail.chatMid !== activeChatId) return;
      const next = { hasMore: detail.hasMore, loading: detail.loading };
      if (!next.loading && !next.hasMore && prependAnchorRef.current?.chatMid === activeChatId) {
        prependAnchorRef.current = null;
      }
      setOlderState(next);
    });
  }, [activeChatId]);

  const openedChatRef = useRef<string | null>(null);

  // 開いた瞬間だけ位置を決める。未読があればその先頭、なければ末尾に置き、
  // 以後の受信・画像の高さ確定・ページ追加では利用者のスクロール位置を動かさない。
  useEffect(() => {
    if (!activeChatId) {
      openedChatRef.current = null;
      return;
    }
    // リロード直後はチャットIDだけ復元され、メッセージが後から hydrate される。
    // 空の状態で初期位置を確定すると、メッセージ到着後に再実行されなくなる。
    if (!rows.length || openedChatRef.current === activeChatId) return;
    if (!hasMeasured) return;
    const targetMessageId =
      initialChatScrollMode === "unread"
        ? (initialChatScrollMessageId ?? firstUnreadMessageId)
        : null;
    const key = targetMessageId ? `msg-${targetMessageId}` : null;
    if (key && !rows.some((row) => row.key === key)) {
      // 初回取得中は、未読位置が分かるまでスクロール位置を確定しない。
      if (loadingMessages) return;
    }
    const frame = requestAnimationFrame(() => {
      openedChatRef.current = activeChatId;
      if (targetMessageId) {
        scrollToMessagePosition(targetMessageId, { behavior: "auto", center: true });
      } else scrollToBottom("auto");
    });
    return () => cancelAnimationFrame(frame);
  }, [
    activeChatId,
    firstUnreadMessageId,
    hasMeasured,
    initialChatScrollMessageId,
    initialChatScrollMode,
    loadingMessages,
    rows,
    scrollToBottom,
    scrollToMessagePosition,
  ]);

  // 返信ジャンプ（store.scrollToMessage → highlightMessageId）
  useEffect(() => {
    if (!highlightMessageId) return;
    requestAnimationFrame(() => scrollToMessagePosition(highlightMessageId, { center: true }));
  }, [highlightMessageId, scrollToMessagePosition]);

  // 検索ヒットへジャンプ
  useEffect(() => {
    if (!matches.length) return;
    const id = matches[search.index % matches.length];
    scrollToMessagePosition(id, { center: true });
  }, [search.index, matches, scrollToMessagePosition]);

  if (!chat) {
    return (
      <div
        className="hidden flex-1 items-center justify-center bg-[var(--vy-chat-bg)] md:flex"
        data-pattern="0"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-3xl opacity-60">
            💬
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--vy-text-dim)]">
              チャットを選択してください
            </p>
            <p className="mt-1 text-xs text-[var(--vy-text-dim)] opacity-60">
              左のリストからトークを開くか、新しい会話を始めましょう
            </p>
          </div>
        </div>
      </div>
    );
  }

  const name = displayName(chat, streamerMode);

  const todayText = chatMessages
    .filter(
      (m) => new Date(m.createdAt).toDateString() === new Date().toDateString() && m.text?.trim(),
    )
    .slice(-120)
    .map((m) => `${m.authorId === "me" ? "自分" : name}: ${m.text!.trim().slice(0, 800)}`)
    .join("\n");

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
      onClick: () => updateProfileDrawer(true),
    },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header
          className={cn(
            "relative flex items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2.5 md:gap-3 md:pr-4",
            reserveSidebarToggle ? "md:pl-12" : "md:pl-4",
          )}
        >
          <button
            type="button"
            onClick={() => closeChat()}
            aria-label="チャット一覧に戻る"
            className="vy-mobile-back vy-touch-target flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none md:hidden"
          >
            <IconArrowLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => updateProfileDrawer(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          >
            <Avatar
              glyph={streamerMode ? "•" : chat.avatar}
              color={chat.color}
              size={40}
              online={chat.online}
              imageUrl={streamerMode ? undefined : chat.avatarUrl}
              icon={!streamerMode && chat.isSelf ? <IconMemo size={22} /> : undefined}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="vy-chat-header-title truncate text-sm font-semibold">{name}</span>
                {chat.isOfficial && <OfficialBadge />}
                {chat.muted && (
                  <IconBellOff size={13} className="shrink-0 text-[var(--vy-text-dim)]" />
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
          {desktopInteraction && paneCount > 1 && onPaneDragStart && (
            <div
              data-vy-pane-drag-handle
              draggable
              onDragStart={onPaneDragStart}
              onPointerDown={(event) => event.stopPropagation()}
              title="ドラッグしてトーク画面を移動"
              aria-label="トーク画面をドラッグして再配置"
              className="vy-desktop-manipulator absolute left-1/2 top-1/2 z-20 hidden h-7 w-14 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface-2)]/95 shadow-sm active:cursor-grabbing md:flex"
            >
              <span className="grid grid-cols-3 gap-1" aria-hidden>
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={index} className="h-1 w-1 rounded-full bg-[var(--vy-text-dim)]" />
                ))}
              </span>
            </div>
          )}
          <HeaderButton
            label="検索"
            active={search.open}
            onClick={() => setSearch((s) => ({ ...s, open: !s.open, q: s.open ? "" : s.q }))}
          >
            <IconSearch size={19} />
          </HeaderButton>
          <HeaderButton label="メニュー" onClick={() => updateProfileDrawer(!profileOpen)}>
            <IconMore size={19} />
          </HeaderButton>
          {paneCount > 1 && onClosePane && (
            <span className="hidden md:inline-flex">
              <HeaderButton label="このトーク画面を閉じる" onClick={onClosePane}>
                <IconClose size={18} />
              </HeaderButton>
            </span>
          )}
        </header>

        {/* in-chat search bar */}
        {search.open && (
          <div className="vy-fade-in flex items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2 md:px-4">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-[var(--vy-surface-2)] px-3 py-2">
              <IconSearch size={16} className="text-[var(--vy-text-dim)]" />
              <input
                value={search.q}
                onChange={(e) => setSearch((s) => ({ ...s, q: e.target.value, index: 0 }))}
                placeholder="このトーク内を検索"
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
              disabled={!matches.length}
              onClick={() =>
                setSearch((s) => ({ ...s, index: (s.index - 1 + matches.length) % matches.length }))
              }
              aria-label="前の一致"
              className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-30"
            >
              <IconChevron size={16} className="-rotate-90" />
            </button>
            <button
              type="button"
              disabled={!matches.length}
              onClick={() => setSearch((s) => ({ ...s, index: (s.index + 1) % matches.length }))}
              aria-label="次の一致"
              className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-30"
            >
              <IconChevron size={16} className="rotate-90" />
            </button>
            <button
              type="button"
              onClick={() => setSearch({ open: false, q: "", index: 0 })}
              aria-label="検索を閉じる"
              className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
            >
              <IconClose size={16} />
            </button>
          </div>
        )}

        {/* pinned announcement banner */}
        {(() => {
          const list = activeChatId ? (announcements[activeChatId] ?? []) : [];
          if (!list.length) return null;
          const panelId = `vy-announcements-${encodeURIComponent(activeChatId ?? "chat")}`;
          const jumpToAnnouncement = (link: string) => {
            const match = link.match(/[?&]messageId=([^&]+)/);
            const messageId = match ? decodeURIComponent(match[1]) : null;
            if (messageId) scrollToMessage(messageId);
          };
          const removePinnedAnnouncement = (announcementSeq: string) => {
            if (!activeChatId || !accountId) return;
            void api.line.announce
              .remove(accountId, activeChatId, announcementSeq)
              .then((res) => {
                if (!res.ok) throw new Error("アナウンスの解除に失敗しました");
                removeAnnouncement(activeChatId, announcementSeq);
              })
              .catch((error) => {
                useStore
                  .getState()
                  .showNotice(
                    error instanceof Error ? error.message : "アナウンスの解除に失敗しました",
                  );
              });
          };
          const first = list[0]!;
          return (
            <div className="relative z-30 mx-auto mb-2 w-full max-w-3xl px-1">
              <div className="rounded-xl bg-[var(--vy-surface)] text-xs text-[var(--vy-text)] shadow-sm">
                <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
                  <IconPin size={14} className="shrink-0 text-[var(--vy-accent)]" />
                  <span className="font-semibold">アナウンス</span>
                  <span className="text-[var(--vy-text-dim)]">({list.length}件)</span>
                  {!announcementExpanded && (
                    <button
                      type="button"
                      onClick={() => jumpToAnnouncement(first.link)}
                      className="ml-1 min-w-0 flex-1 truncate text-left text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-text)]"
                      title={first.text}
                    >
                      {first.text}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleAnnouncementExpanded}
                    aria-expanded={announcementExpanded}
                    aria-controls={panelId}
                    aria-label={announcementExpanded ? "アナウンスをたたむ" : "アナウンスを広げる"}
                    className="vy-touch-target ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base font-semibold text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
                  >
                    <span aria-hidden>{announcementExpanded ? "∧" : "∨"}</span>
                  </button>
                </div>
              </div>
              {announcementExpanded && (
                <div
                  id={panelId}
                  className="vy-scroll absolute left-1 right-1 top-full z-40 mt-1 max-h-[min(18rem,38vh)] overflow-y-auto rounded-xl bg-[var(--vy-surface)] p-1 shadow-2xl"
                >
                  {list.map((announcement) => (
                    <div
                      key={announcement.announcementSeq}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--vy-surface-2)]"
                    >
                      <button
                        type="button"
                        onClick={() => jumpToAnnouncement(announcement.link)}
                        className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline"
                        title={announcement.text}
                      >
                        {announcement.text}
                      </button>
                      <button
                        type="button"
                        onClick={() => removePinnedAnnouncement(announcement.announcementSeq)}
                        className="shrink-0 rounded-lg p-1 transition-colors hover:bg-[var(--vy-bg)]"
                        aria-label={`「${announcement.text}」のアナウンスを解除`}
                      >
                        <IconClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* messages */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={containerRef}
            onScroll={handleMessageScroll}
            onWheel={() => {
              lastUserScrollIntentAtRef.current = performance.now();
            }}
            onTouchStart={() => {
              lastUserScrollIntentAtRef.current = performance.now();
            }}
            onPointerDown={() => {
              lastUserScrollIntentAtRef.current = performance.now();
            }}
            onContextMenu={(e) => {
              // Mobile long-press is reserved for message actions. Do not let the
              // generic chat menu race the message gesture/native context event.
              if (!isDesktopInteraction()) return;
              const target = e.target as HTMLElement;
              if (
                target.closest("[data-vy-message='true']") ||
                target.closest("button, input, textarea, a, [data-message-actionable='true']")
              ) {
                return;
              }
              e.preventDefault();
              setPanel({ x: e.clientX, y: e.clientY });
            }}
            className="vy-scroll vy-chat-surface vy-chat-messages h-full w-full overflow-y-auto px-3 py-4 md:px-6"
            data-pattern={theme.pattern}
            data-image={theme.chatImage ? "" : undefined}
          >
            <div ref={messageListRef} className="mx-auto flex w-full max-w-3xl flex-col">
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
                      mediaGroup={item.mediaGroup}
                      chat={chat}
                      showAvatar={!item.sameAuthorAsNext}
                      showName={!item.sameAuthorAsPrev}
                      highlight={item.searching ? (item.highlight as string) : undefined}
                    />
                  </div>
                ),
              )}
              {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden />}
            </div>
          </div>
          {showScrollToBottom && (
            <button
              type="button"
              onClick={() => scrollToBottom("smooth")}
              aria-label="トークの一番下へ移動"
              title="トークの一番下へ"
              className="absolute bottom-4 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--vy-border)] bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)] shadow-lg transition-[transform,opacity,background-color] hover:scale-105 active:scale-95 md:right-5"
            >
              <IconArrowDown size={22} />
            </button>
          )}
        </div>

        {/* input */}
        <MessageInput chatId={chat.id} />
      </div>

      {profileOpen && <ProfileDrawer chat={chat} />}
      {isFocusedPane && memberProfile && memberProfile.chatId === chat.id && (
        <MemberProfilePopover chat={chat} />
      )}
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
        "vy-touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
        active
          ? "bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] text-[var(--vy-accent)]"
          : "text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
      )}
    >
      {children}
    </button>
  );
}
