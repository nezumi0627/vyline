import { memo, useEffect, useMemo, useRef, useState, useCallback, type UIEvent } from "react";
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
import { findFirstUnreadMessage } from "@/lib/chatScroll";

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

function ChatAreaBase() {
  const activeChatId = useStore((s) => s.activeChatId);
  const chats = useStore((s) => s.chats);
  const messages = useStore((s) => s.messages);
  const setScreen = useStore((s) => s.setScreen);
  const closeChat = useStore((s) => s.closeChat);
  const profileOpen = useStore((s) => s.profileDrawerOpen);
  const setProfileDrawer = useStore((s) => s.setProfileDrawer);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const agentEnabled = useStore((s) => s.settings.betaAgentI);
  const theme = useStore((s) => s.theme);
  const toggleMute = useStore((s) => s.toggleMute);
  const memberProfile = useStore((s) => s.memberProfile);
  const highlightMessageId = useStore((s) => s.highlightMessageId);
  const initialChatScrollMessageId = useStore((s) => s.initialChatScrollMessageId);
  const initialChatScrollMode = useStore((s) => s.initialChatScrollMode);
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

  const chat = chats.find((c) => c.id === activeChatId) ?? null;

  const chatMessages = useMemo(
    () => messages.filter((m) => m.chatId === activeChatId).sort(compareMessagesOldestFirst),
    [messages, activeChatId],
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
    topSpacer,
    bottomSpacer,
    rowRef,
    scrollToMessagePosition,
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

  // 開いた瞬間だけ位置を決める。未読があればその先頭、なければ末尾に置き、
  // 以後の受信・画像の高さ確定・ページ追加では利用者のスクロール位置を動かさない。
  useEffect(() => {
    if (!activeChatId) {
      openedChatRef.current = null;
      return;
    }
    if (openedChatRef.current === activeChatId) return;

    const fallbackUnread =
      initialChatScrollMode === "unread" && !initialChatScrollMessageId
        ? findFirstUnreadMessage(chatMessages)?.id
        : undefined;
    const targetId = initialChatScrollMessageId ?? fallbackUnread;
    if (chatMessages.length === 0) return;
    const targetRow = targetId
      ? rows.find(
          (row) =>
            row.key === `msg-${targetId}` ||
            (row.item.kind === "msg" &&
              row.item.mediaGroup?.some((message) => message.id === targetId)),
        )
      : undefined;
    if (initialChatScrollMode === "unread" && targetId && !targetRow) {
      // 未読がまだ読み込まれていない（履歴の奥にある）→ 過去を読み込みつつ上端で待機
      window.dispatchEvent(
        new CustomEvent("vyline:load-older-messages", { detail: { chatMid: activeChatId } }),
      );
      return;
    }
    const frame = requestAnimationFrame(() => {
      openedChatRef.current = activeChatId;
      if (targetId && targetRow) {
        scrollToMessagePosition(targetId, { behavior: "auto", center: true }, targetRow.key);
      } else if (targetId && !targetRow) {
        // フォールバック: 見つからなければ末尾
        scrollToBottom("auto");
      } else {
        scrollToBottom("auto");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    activeChatId,
    chatMessages,
    initialChatScrollMessageId,
    initialChatScrollMode,
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
      onClick: () => setProfileDrawer(true),
    },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="flex items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2.5 md:gap-3 md:pl-12 md:pr-4">
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
          className="vy-scroll vy-chat-surface vy-chat-messages flex-1 overflow-y-auto px-3 py-4 md:px-6"
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

        {/* input */}
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
