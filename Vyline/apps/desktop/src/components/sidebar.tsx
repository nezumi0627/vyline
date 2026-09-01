import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  useStore,
  displayName,
  formatTime,
  sortChats,
  CHAT_SORT_LABELS,
  type Chat,
  type ChatSort,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/vy-ui";
import { OfficialBadge } from "@/components/official-badge";
import { PremiumBadge } from "@/components/premium-badge";
import { MessageContextMenu, type MenuItem } from "@/components/message-context-menu";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import {
  IconSearch,
  IconSettings,
  IconChat,
  IconPin,
  IconEyeOff,
  IconEye,
  IconBell,
  IconBellOff,
  IconSort,
  IconCheck,
  IconPlus,
  IconBlock,
  IconCopy,
  IconMemo,
  IconLogout,
  IconChevron,
  IconShield,
  IconPanelLeft,
} from "@/components/icons";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { CHAT_PANE_DRAG_TYPE } from "@/lib/chatPanes";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";

type Tab = "all" | "friend" | "group" | "hidden" | "official";

/** ブロックしてはいけない MID（公式 LINE アカウント等） */
const BLOCK_PROTECTED_MIDS = new Set(["u085311ecd9e3e3d74ae4c9f5437cbcb5"]);

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "friend", label: "友だち" },
  { key: "group", label: "グループ" },
  { key: "official", label: "公式" },
  { key: "hidden", label: "非表示" },
];

const SORTS: ChatSort[] = ["recent", "unread", "custom"];

function buildPreviewMap(
  messages: ReturnType<typeof useStore.getState>["messages"],
  chats: Chat[],
  prev?: Map<string, { text: string; time: number } | null>,
): Map<string, { text: string; time: number } | null> {
  const previewForMessage = (m: (typeof messages)[number]): string => {
    if (m.messageState.startsWith("revoked")) {
      if (m.revokedSnapshot) return `取り消し済み: ${previewForMessage(m.revokedSnapshot)}`;
      const last = m.history
        ? [...m.history].reverse().find((h) => h.state === "normal" || h.state === "edited")
        : undefined;
      return last?.text ? `取り消し済み: ${last.text}` : "取り消し済みのメッセージ";
    }
    if (m.kind === "sticker") return m.altText || "[スタンプ]";
    if (m.kind === "image") return "[画像]";
    if (m.kind === "video") return "[動画]";
    if (m.kind === "audio") return "[音声メッセージ]";
    if (m.kind === "file") return `[${m.file?.name || "ファイル"}]`;
    if (m.kind === "flex" || m.kind === "rich")
      return m.altText || m.text || (m.kind === "flex" ? "[Flex]" : "[リッチメッセージ]");
    if (m.kind === "call") return "[通話]";
    if (m.kind === "emoji") return "[絵文字]";
    if (m.kind === "location") return "[位置情報]";
    if (m.kind === "contact") return "[連絡先]";
    if (m.kind === "system") return m.text ?? "";
    return m.text ?? "";
  };

  const lastByChat = new Map<string, (typeof messages)[number]>();
  for (const message of messages) {
    const previous = lastByChat.get(message.chatId);
    if (
      !previous ||
      message.createdAt > previous.createdAt ||
      (message.createdAt === previous.createdAt && message.id.localeCompare(previous.id) > 0)
    ) {
      lastByChat.set(message.chatId, message);
    }
  }
  const out = new Map<string, { text: string; time: number } | null>();
  for (const chat of chats) {
    const last = lastByChat.get(chat.id);
    // 前回と同内容なら前回のオブジェクトを使い ChatRow の memo を有効に保つ
    const prevEntry = prev?.get(chat.id);
    const stable = (text: string, time: number) =>
      prevEntry && prevEntry.text === text && prevEntry.time === time ? prevEntry : { text, time };
    const apiTime = chat.lastMessageTime ?? 0;
    if (!last) {
      out.set(chat.id, chat.lastMessagePreview ? stable(chat.lastMessagePreview, apiTime) : null);
      continue;
    }
    let text = previewForMessage(last) || chat.lastMessagePreview || "";
    if (last.authorId === "me" && text) text = `あなた: ${text}`;
    out.set(chat.id, stable(text, Math.max(last.createdAt, apiTime)));
  }
  return out;
}

function moveId(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order;
  const next = [...order];
  const from = next.indexOf(fromId);
  const to = next.indexOf(toId);
  if (from < 0 || to < 0) return order;
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

function SidebarBase() {
  const chats = useStore((s) => s.chats);
  const messages = useStore((s) => s.messages);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const activeChatId = useStore((s) => s.activeChatId);
  const chatPaneIds = useStore((s) => s.chatPaneIds);
  const openChat = useStore((s) => s.openChat);
  const openChatInSplit = useStore((s) => s.openChatInSplit);
  const setScreen = useStore((s) => s.setScreen);
  const showNotice = useStore((s) => s.showNotice);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const sort = useStore((s) => s.settings.chatSort);
  const updateSetting = useStore((s) => s.updateSetting);
  const customOrder = useStore((s) => s.customOrder);
  const setCustomOrder = useStore((s) => s.setCustomOrder);
  const self = useStore((s) => s.self);
  const desktopInteraction = isDesktopInteraction();

  const togglePin = useStore((s) => s.togglePin);
  const toggleHide = useStore((s) => s.toggleHide);
  const toggleMute = useStore((s) => s.toggleMute);
  const markChatRead = useStore((s) => s.markChatRead);
  const markAllChatsRead = useStore((s) => s.markAllChatsRead);
  const toggleChatReadDisabled = useStore((s) => s.toggleChatReadDisabled);
  const readDisabledMids = useStore((s) => s.readDisabledMids);
  const lockedChatMids = useStore((s) => s.lockedChatMids);
  const setChatLocked = useStore((s) => s.setChatLocked);

  const accountId = useStore((s) => s.accountId);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [wideLayoutAvailable, setWideLayoutAvailable] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 768px)").matches,
  );
  const [splitPickMode, setSplitPickMode] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [blockBusy, setBlockBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  /** ドラッグ中の一時順序（ストアは drop 時のみ更新してチラつきを防ぐ） */
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const liveOrderRef = useRef<string[] | null>(null);

  const previewMapRef = useRef<Map<string, { text: string; time: number } | null>>(new Map());
  const previewMap = useMemo(
    () => buildPreviewMap(messages, chats, previewMapRef.current),
    [messages, chats],
  );
  useEffect(() => {
    previewMapRef.current = previewMap;
  }, [previewMap]);

  const displayedPaneIds = useMemo(
    () => (chatPaneIds.length > 0 ? chatPaneIds : activeChatId ? [activeChatId] : []),
    [activeChatId, chatPaneIds],
  );

  // Split availability is a layout concern, so it follows viewport width rather than UA.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setWideLayoutAvailable(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!wideLayoutAvailable) setSplitPickMode(false);
  }, [wideLayoutAvailable]);

  const filtered = useMemo(() => {
    let list = chats;
    if (tab === "friend") list = chats.filter((c) => c.type === "friend" && !c.hidden && !c.left);
    else if (tab === "group")
      list = chats.filter((c) => c.type === "group" && !c.hidden && (!c.left || c.restoredHistory));
    else if (tab === "hidden") list = chats.filter((c) => c.hidden);
    else if (tab === "official") list = chats.filter((c) => c.isOfficial && !c.hidden && !c.left);
    else
      list = chats.filter(
        (c) =>
          !c.hidden &&
          (!c.left || c.restoredHistory || (c.members != null && c.members.length > 0)),
      );

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((c) => displayName(c, false).toLowerCase().includes(q));
    }
    // custom は messages 非依存にして再レンダーを減らす
    if (sort === "custom") {
      return sortChats(list, "custom", [], liveOrder ?? customOrder);
    }
    return sortChats(list, sort, messages, customOrder);
  }, [chats, tab, query, messages, sort, customOrder, liveOrder]);

  // --- チャット一覧の固定高ウィンドウリング（全件描画による DOM/listener 膨張を防ぐ） ---
  const listRef = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(70); // ChatRow 概算: avatar48 + py-2.5×2 + mb-0.5
  const [win, setWin] = useState({ start: 0, end: 24 });
  const [hasMeasured, setHasMeasured] = useState(false);
  const recomputeWin = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / rowH) - 10);
    const end = Math.min(filtered.length, Math.ceil((el.scrollTop + el.clientHeight) / rowH) + 10);
    setWin((p) => (p.start === start && p.end === end ? p : { start, end }));
  }, [filtered.length, rowH]);

  // 実測行高で補正（フォントメトリ差分の累積ドリフト防止）
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>("[data-vy-chat-row]");
    const h = row?.offsetHeight ?? 0;
    if (h > 0) {
      if (Math.abs(h - rowH) > 1) setRowH(h);
      if (!hasMeasured) setHasMeasured(true);
    }
  }, [win.start, rowH, hasMeasured]);

  useEffect(() => {
    recomputeWin();
  }, [recomputeWin]);

  // ウィンドウ範囲（filtered 縮小時の空描画防止にクランプ）
  const winStart = Math.min(win.start, filtered.length);
  const winEnd = Math.max(winStart, Math.min(win.end, filtered.length));

  useEffect(() => {
    liveOrderRef.current = liveOrder;
  }, [liveOrder]);

  const onDragStart = useCallback(
    (chatId: string) => {
      dragIdRef.current = chatId;
      setDragId(chatId);
      const order =
        (liveOrderRef.current?.length ? liveOrderRef.current : null) ??
        (customOrder.length ? customOrder : chats.map((c) => c.id));
      setLiveOrder([...order]);
    },
    [chats, customOrder],
  );

  const onDragOverRow = useCallback(
    (targetId: string) => {
      const fromId = dragIdRef.current;
      if (!fromId || fromId === targetId) return;
      setLiveOrder((prev) => {
        const base = prev ?? customOrder;
        const next = moveId(base, fromId, targetId);
        liveOrderRef.current = next;
        return next;
      });
    },
    [customOrder],
  );

  const finishDrag = useCallback(() => {
    const order = liveOrderRef.current;
    if (order?.length) setCustomOrder(order);
    dragIdRef.current = null;
    liveOrderRef.current = null;
    setDragId(null);
    setLiveOrder(null);
  }, [setCustomOrder]);

  const moveCustomChatBy = useCallback(
    (chatId: string, offset: -1 | 1) => {
      const order = customOrder.length ? [...customOrder] : chats.map((chat) => chat.id);
      const currentIndex = order.indexOf(chatId);
      const nextIndex = currentIndex + offset;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) return;
      const targetId = order[nextIndex];
      if (!targetId) return;
      order[currentIndex] = targetId;
      order[nextIndex] = chatId;
      setCustomOrder(order);
      showNotice(offset < 0 ? "トークを1つ上へ移動しました" : "トークを1つ下へ移動しました");
    },
    [chats, customOrder, setCustomOrder, showNotice],
  );

  // ブロック状態のキャッシュ（メニュー表示・確認用）
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void api.line
      .blockedContacts(accountId)
      .then((res) => {
        if (cancelled || !res.ok || !res.mids) return;
        setBlockedSet(new Set(res.mids));
        useStore.setState({ blockedMids: res.mids });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function openRowMenu(e: React.MouseEvent, chat: Chat) {
    e.preventDefault();
    e.stopPropagation();
    const x = "clientX" in e && typeof e.clientX === "number" ? e.clientX : 0;
    const y = "clientY" in e && typeof e.clientY === "number" ? e.clientY : 0;
    setMenu({ x: x || 12, y: y || 12, chat });
  }

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleChatClick = useCallback(
    (chat: Chat) => {
      if (!splitPickMode) {
        openChat(chat.id);
        return;
      }
      if (displayedPaneIds.includes(chat.id)) {
        showNotice("すでに表示中です。別のトークを選択してください");
        return;
      }
      openChatInSplit(chat.id);
      setSplitPickMode(false);
      showNotice(`「${displayName(chat, false)}」を分割表示しました`);
    },
    [displayedPaneIds, openChat, openChatInSplit, showNotice, splitPickMode],
  );

  const isBlocked = menu ? blockedSet.has(menu.chat.id) : false;
  const isChatLocked = menu ? lockedChatMids.includes(menu.chat.id) : false;
  const menuChatAlreadyDisplayed = menu ? displayedPaneIds.includes(menu.chat.id) : false;
  const menuCustomOrder =
    sort === "custom" ? (customOrder.length ? customOrder : chats.map((chat) => chat.id)) : [];
  const menuCustomIndex = menu ? menuCustomOrder.indexOf(menu.chat.id) : -1;

  const menuItems: MenuItem[] = menu
    ? [
        {
          label: isChatLocked ? "チャットのロックを解除" : "チャットをロック",
          icon: <IconShield size={16} />,
          danger: !isChatLocked,
          onClick: () => {
            if (!menu) return;
            if (
              !isChatLocked &&
              !window.confirm(`「${displayName(menu.chat, false)}」をロックしますか？`)
            )
              return;
            void setChatLocked(menu.chat.id, !isChatLocked).then((ok) => {
              if (!ok) window.alert("チャットのロック変更に失敗しました");
            });
          },
        },
        ...(wideLayoutAvailable
          ? [
              {
                label: menuChatAlreadyDisplayed ? "分割するトークを選ぶ" : "チャット分割",
                icon: <IconPanelLeft size={16} />,
                onClick: () => {
                  if (menuChatAlreadyDisplayed) {
                    setSplitPickMode(true);
                    showNotice("分割表示する別のトークをタップしてください");
                    return;
                  }
                  openChatInSplit(menu.chat.id);
                  showNotice(`「${displayName(menu.chat, false)}」を分割表示しました`);
                },
              },
            ]
          : []),
        ...(!desktopInteraction && sort === "custom" && menuCustomIndex > 0
          ? [
              {
                label: "1つ上へ移動",
                icon: <IconChevron size={16} className="-rotate-90" />,
                onClick: () => moveCustomChatBy(menu.chat.id, -1),
              },
            ]
          : []),
        ...(!desktopInteraction &&
        sort === "custom" &&
        menuCustomIndex >= 0 &&
        menuCustomIndex < menuCustomOrder.length - 1
          ? [
              {
                label: "1つ下へ移動",
                icon: <IconChevron size={16} className="rotate-90" />,
                onClick: () => moveCustomChatBy(menu.chat.id, 1),
              },
            ]
          : []),
        {
          label: menu.chat.pinned ? "ピン留めを解除" : "ピン留め",
          icon: <IconPin size={16} />,
          onClick: () => togglePin(menu.chat.id),
        },
        ...(menu.chat.unread > 0
          ? [
              {
                label: "既読にする",
                icon: <IconCheck size={16} />,
                onClick: () => markChatRead(menu.chat.id),
              },
            ]
          : []),
        {
          label: readDisabledMids[menu.chat.id] ? "既読を有効にする" : "既読を無効化",
          icon: readDisabledMids[menu.chat.id] ? <IconEye size={16} /> : <IconEyeOff size={16} />,
          onClick: () => toggleChatReadDisabled(menu.chat.id),
        },
        {
          label: menu.chat.muted ? "ミュートを解除" : "通知をミュート",
          icon: menu.chat.muted ? <IconBell size={16} /> : <IconBellOff size={16} />,
          onClick: () => toggleMute(menu.chat.id),
        },
        {
          label: menu.chat.hidden ? "非表示を解除" : "非表示にする",
          icon: menu.chat.hidden ? <IconEye size={16} /> : <IconEyeOff size={16} />,
          onClick: () => toggleHide(menu.chat.id),
        },
        {
          label: menu.chat.type === "group" ? "GID をコピー" : "MID をコピー",
          icon: <IconCopy size={16} />,
          onClick: () => {
            void navigator.clipboard.writeText(menu.chat.id);
          },
        },
        ...(!isChatLocked &&
        menu.chat.type === "friend" &&
        !menu.chat.isSelf &&
        !BLOCK_PROTECTED_MIDS.has(menu.chat.id)
          ? [
              {
                label: isBlocked ? "ブロックを解除" : "ブロック",
                icon: <IconBlock size={16} />,
                danger: !isBlocked,
                onClick: () => {
                  if (!accountId || blockBusy) return;
                  const mid = menu.chat.id;
                  const name = displayName(menu.chat, false);
                  if (!isBlocked && !window.confirm(`「${name}」をブロックしますか？`)) return;
                  setBlockBusy(true);
                  const req = isBlocked
                    ? api.line.unblockContact(accountId, mid)
                    : api.line.blockContact(accountId, mid);
                  void req
                    .then((res) => {
                      if (!res.ok) {
                        window.alert(res.error ?? "ブロック操作に失敗しました");
                        return;
                      }
                      setBlockedSet((s) => {
                        const n = new Set(s);
                        if (isBlocked) n.delete(mid);
                        else n.add(mid);
                        return n;
                      });
                      useStore.setState((st) => ({
                        blockedMids: isBlocked
                          ? st.blockedMids.filter((m) => m !== mid)
                          : st.blockedMids.includes(mid)
                            ? st.blockedMids
                            : [...st.blockedMids, mid],
                      }));
                      if (!isBlocked) {
                        useStore.setState((st) => ({
                          chats: st.chats.filter((c) => c.id !== mid),
                          activeChatId: st.activeChatId === mid ? null : st.activeChatId,
                        }));
                      }
                    })
                    .catch((err) => {
                      window.alert(err instanceof Error ? err.message : String(err));
                    })
                    .finally(() => setBlockBusy(false));
                },
              },
            ]
          : []),
      ]
    : [];

  return (
    <aside className="vy-sidebar flex h-full w-full flex-col bg-[var(--vy-sidebar)] md:border-r md:border-[var(--vy-border)]">
      <div className="vy-sidebar-profile flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={() => setScreen("settings")}
          className="vy-touch-target rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          aria-label="プロフィール設定"
        >
          <Avatar
            glyph={self.avatar}
            color="var(--vy-accent)"
            size={42}
            imageUrl={self.avatarUrl}
          />
        </button>
        <button
          type="button"
          onClick={() => setScreen("settings")}
          className="min-w-0 flex-1 text-left outline-none"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{self.name}</p>
            {self.premium?.active && <PremiumBadge size={14} compact />}
          </div>
          <p className="truncate text-xs text-[var(--vy-text-dim)]">{self.status}</p>
        </button>
        <button
          type="button"
          onClick={() => setScreen("chat")}
          aria-label="チャット"
          className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
        >
          <IconChat size={19} />
        </button>
        <button
          type="button"
          onClick={() => setScreen("settings")}
          aria-label="設定"
          className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
        >
          <IconSettings size={19} />
        </button>
      </div>

      <div className="vy-sidebar-tools flex items-center gap-2 px-4 pb-3">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-[var(--vy-surface-2)] px-3 py-2">
          <IconSearch size={17} className="text-[var(--vy-text-dim)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="検索"
            aria-label="チャットを検索"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--vy-text-dim)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="検索をクリア"
              className="text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-text)]"
            >
              ×
            </button>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSortOpen((v) => !v)}
            aria-label="並び順"
            aria-expanded={sortOpen}
            className={cn(
              "vy-touch-target flex h-9 w-9 items-center justify-center rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
              sortOpen
                ? "text-[var(--vy-accent)]"
                : "text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
            )}
          >
            <IconSort size={18} />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} aria-hidden />
              <div className="vy-scale-in absolute right-0 top-11 z-50 w-40 overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] py-1 shadow-2xl">
                <p className="px-3 py-1.5 text-[0.7rem] font-medium text-[var(--vy-text-dim)]">
                  並び順
                </p>
                {SORTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      updateSetting("chatSort", s);
                      setSortOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
                  >
                    {CHAT_SORT_LABELS[s]}
                    {sort === s && <IconCheck size={15} style={{ color: "var(--vy-accent)" }} />}
                  </button>
                ))}
                <div className="my-1 border-t border-[var(--vy-border)]" />
                <button
                  type="button"
                  onClick={() => {
                    void markAllChatsRead();
                    setSortOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
                >
                  <IconCheck size={15} />
                  すべて既読にする
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="vy-sidebar-tabs flex gap-1 px-3 pb-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
              tab === t.key
                ? "text-[var(--vy-accent-contrast)]"
                : "text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
            )}
            style={tab === t.key ? { background: "var(--vy-accent)" } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "group" && (
        <div className="vy-sidebar-create-group px-3 pb-2">
          <button
            type="button"
            onClick={() => setCreateGroupOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--vy-border)] px-3 py-2 text-xs font-medium text-[var(--vy-accent)] transition-colors hover:bg-[var(--vy-surface-2)]"
          >
            <IconPlus size={14} />
            グループを作成
          </button>
        </div>
      )}

      {sort === "custom" && (
        <p className="vy-sidebar-sort-hint px-4 pb-1.5 text-[0.7rem] text-[var(--vy-text-dim)]">
          {desktopInteraction ? "ドラッグして並び替え" : "長押しメニューから順序を変更"}
        </p>
      )}

      {splitPickMode && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-[var(--vy-surface-2)] px-3 py-2 text-xs">
          <IconPanelLeft size={15} className="shrink-0 text-[var(--vy-accent)]" />
          <span className="min-w-0 flex-1">分割表示するトークを選択</span>
          <button
            type="button"
            onClick={() => setSplitPickMode(false)}
            className="vy-touch-target shrink-0 rounded-lg px-2 py-1 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface)] hover:text-[var(--vy-text)]"
          >
            キャンセル
          </button>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={recomputeWin}
        className="vy-scroll flex-1 overflow-y-auto px-2 pb-3"
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]">
              <IconSearch size={22} />
            </span>
            <p className="text-sm text-[var(--vy-text-dim)]">
              {query ? "一致するチャットがありません" : "ここにはチャットがありません"}
            </p>
          </div>
        ) : (
          <>
            {hasMeasured && winStart > 0 && <div style={{ height: winStart * rowH }} aria-hidden />}
            {filtered.slice(winStart, winEnd).map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeChatId || chatPaneIds.includes(chat.id)}
                reorderable={sort === "custom" && desktopInteraction}
                desktopInteraction={desktopInteraction}
                dragging={dragId === chat.id}
                blocked={blockedSet.has(chat.id)}
                locked={lockedChatMids.includes(chat.id)}
                onClick={() => handleChatClick(chat)}
                onContextMenu={(e) => openRowMenu(e, chat)}
                onDragStart={() => onDragStart(chat.id)}
                onDragEnd={finishDrag}
                onDragOver={(e) => {
                  if (sort !== "custom" || !dragIdRef.current) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  onDragOverRow(chat.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  finishDrag();
                }}
                streamerMode={streamerMode}
                preview={previewMap.get(chat.id) ?? null}
              />
            ))}
            {hasMeasured && filtered.length - winEnd > 0 && (
              <div style={{ height: (filtered.length - winEnd) * rowH }} aria-hidden />
            )}
          </>
        )}
      </div>

      {menu && menuItems.length > 0 && (
        <MessageContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
      {createGroupOpen && <CreateGroupDialog onClose={() => setCreateGroupOpen(false)} />}

      {/* Keep the account switcher available on mobile as well. */}
      <div className="vy-sidebar-account-switcher">
        <AccountSwitcher />
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarBase);

const ChatRow = memo(function ChatRow({
  chat,
  active,
  reorderable,
  desktopInteraction,
  dragging,
  blocked,
  locked,
  onClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  streamerMode,
  preview,
}: {
  chat: Chat;
  active: boolean;
  reorderable: boolean;
  desktopInteraction: boolean;
  dragging: boolean;
  blocked?: boolean;
  locked?: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  streamerMode: boolean;
  preview: { text: string; time: number } | null;
}) {
  const name = displayName(chat, streamerMode);
  const longPressRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    fired: boolean;
    startX: number | null;
    startY: number | null;
  }>({
    timer: null,
    fired: false,
    startX: null,
    startY: null,
  });
  const suppressClickUntilRef = useRef(0);

  useEffect(
    () => () => {
      if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
    },
    [],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (desktopInteraction) return;
      const t = e.touches[0];
      if (!t) return;
      const cx = t.clientX;
      const cy = t.clientY;
      if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
      longPressRef.current.fired = false;
      longPressRef.current.startX = cx;
      longPressRef.current.startY = cy;
      longPressRef.current.timer = setTimeout(() => {
        longPressRef.current.timer = null;
        longPressRef.current.fired = true;
        longPressRef.current.startX = null;
        longPressRef.current.startY = null;
        suppressClickUntilRef.current = Date.now() + 750;
        window.getSelection()?.removeAllRanges();
        if (navigator.vibrate) navigator.vibrate(12);
        onContextMenu({
          preventDefault() {},
          stopPropagation() {},
          clientX: cx,
          clientY: cy,
        } as React.MouseEvent);
      }, 480);
    },
    [desktopInteraction, onContextMenu],
  );

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    const startX = longPressRef.current.startX;
    const startY = longPressRef.current.startY;
    if (!touch || startX == null || startY == null) return;
    if (Math.abs(touch.clientX - startX) <= 8 && Math.abs(touch.clientY - startY) <= 8) return;
    if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
    longPressRef.current.timer = null;
    longPressRef.current.startX = null;
    longPressRef.current.startY = null;
  }, []);

  const onTouchEnd = useCallback((event: React.TouchEvent) => {
    if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
    longPressRef.current.timer = null;
    longPressRef.current.startX = null;
    longPressRef.current.startY = null;
    if (longPressRef.current.fired) {
      event.preventDefault();
      longPressRef.current.fired = false;
    }
  }, []);

  const onTouchCancel = useCallback(() => {
    if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
    longPressRef.current.timer = null;
    longPressRef.current.fired = false;
    longPressRef.current.startX = null;
    longPressRef.current.startY = null;
  }, []);

  return (
    <div
      data-vy-chat-row
      draggable={desktopInteraction}
      onDragStart={(event) => {
        if (!desktopInteraction) return;
        // 一覧の並べ替えは move、トーク領域への分割追加は copy。
        // source 側で copy のみにすると target が move を選んだ瞬間に drop 自体が拒否される。
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData(CHAT_PANE_DRAG_TYPE, chat.id);
        event.dataTransfer.setData("text/plain", chat.id);
        if (event.currentTarget instanceof HTMLElement) {
          event.dataTransfer.setDragImage(event.currentTarget, 24, 24);
        }
        if (reorderable) onDragStart();
      }}
      onDragEnd={() => {
        if (reorderable) onDragEnd();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn("mb-0.5 will-change-transform", dragging && "opacity-40")}
    >
      <button
        type="button"
        onClick={(event) => {
          if (Date.now() < suppressClickUntilRef.current) {
            event.preventDefault();
            suppressClickUntilRef.current = 0;
            return;
          }
          onClick();
        }}
        onContextMenu={(event) => {
          if (!desktopInteraction) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onContextMenu(event);
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        className={cn(
          "vy-sidebar-row relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
          active ? "text-[var(--vy-accent-contrast)]" : "hover:bg-[var(--vy-surface-2)]",
          desktopInteraction && "md:cursor-grab md:active:cursor-grabbing",
        )}
        style={active ? { background: "var(--vy-accent)" } : undefined}
      >
        <Avatar
          glyph={streamerMode ? "•" : chat.avatar}
          color={chat.color}
          size={48}
          online={chat.online}
          imageUrl={streamerMode ? undefined : chat.avatarUrl}
          icon={!streamerMode && chat.isSelf ? <IconMemo size={24} /> : undefined}
        />
        {blocked && (
          <span
            title="ブロック済み"
            aria-label="ブロック済み"
            className={cn(
              "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white shadow-sm ring-2 ring-[var(--vy-surface)]",
              "bg-[var(--vy-danger)]",
            )}
          >
            <IconBlock size={10} />
          </span>
        )}
        {locked && !blocked && (
          <span
            title="チャットロック中"
            aria-label="チャットロック中"
            className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-accent)] shadow-sm ring-2 ring-[var(--vy-surface)]"
          >
            <IconShield size={10} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {chat.pinned && (
              <IconPin size={12} className={active ? "opacity-90" : "text-[var(--vy-text-dim)]"} />
            )}
            {chat.muted && (
              <IconBellOff
                size={12}
                className={active ? "opacity-90" : "text-[var(--vy-text-dim)]"}
              />
            )}
            {chat.hidden && (
              <IconEyeOff
                size={12}
                className={active ? "opacity-90" : "text-[var(--vy-text-dim)]"}
              />
            )}
            <span className="truncate text-sm font-semibold">{name}</span>
            {chat.isOfficial && <OfficialBadge />}
            {chat.left && (
              <span
                title={chat.type === "friend" ? "アカウントは削除済みです" : "退出済み"}
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[0.65rem] font-medium",
                  active
                    ? "bg-black/20"
                    : "bg-[color-mix(in_oklab,var(--vy-danger)_16%,transparent)] text-[var(--vy-danger)]",
                )}
              >
                {chat.type === "friend" ? "削除済み" : "退出済み"}
              </span>
            )}
            {preview && preview.time > 0 && (
              <span
                className={cn(
                  "ml-auto shrink-0 text-[0.7rem]",
                  active ? "opacity-80" : "text-[var(--vy-text-dim)]",
                )}
              >
                {formatTime(preview.time)}
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                "vy-sidebar-preview truncate",
                active ? "opacity-90" : "text-[var(--vy-text-dim)]",
              )}
            >
              {preview?.text ?? chat.status}
            </span>
            {chat.unread > 0 && (
              <span
                className={cn(
                  "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[0.7rem] font-bold",
                  chat.muted && "opacity-60",
                  active
                    ? "bg-[var(--vy-accent-contrast)] text-[var(--vy-accent)]"
                    : "text-[var(--vy-accent-contrast)]",
                )}
                style={
                  active
                    ? undefined
                    : { background: chat.muted ? "var(--vy-text-dim)" : "var(--vy-accent)" }
                }
              >
                {chat.unread}
              </span>
            )}
          </span>
        </span>
      </button>
    </div>
  );
});

export function AccountSwitcher({
  context = "sidebar",
}: {
  context?: "sidebar" | "settings";
}) {
  const navigate = useNavigate();
  const accountId = useStore((s) => s.accountId);
  const accounts = useAuthStore((s) => s.accounts);
  const sessions = useAuthStore((s) => s.sessions);
  const openLogin = useAuthStore((s) => s.openLogin);
  const switchAccount = useAuthStore((s) => s.switchAccount);
  const logout = useAuthStore((s) => s.logout);
  const setScreen = useStore((s) => s.setScreen);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const switchableAccountIds = useMemo(
    () => [
      ...new Set([
        ...accounts,
        ...sessions.filter((session) => session.hasToken).map((session) => session.accountId),
      ]),
    ],
    [accounts, sessions],
  );
  const currentSession = sessions.find((s) => s.accountId === accountId);
  const currentName = currentSession?.displayName || accountId || "未ログイン";
  const selfPremium = useStore((s) => s.self.premium?.active ?? false);
  const currentPremium = currentSession?.premium?.active ?? selfPremium;

  const handleSwitch = async (id: string) => {
    if (busy) return;
    setOpen(false);
    setBusy(true);
    const result = await switchAccount(id);
    setBusy(false);
    if (!result.ok) {
      openLogin("manual", id);
      setScreen("login");
      navigate("/login");
      return;
    }
    setScreen(context === "settings" ? "settings" : "chat");
    navigate("/");
  };

  const handleLogout = async () => {
    if (!accountId) return;
    setBusy(true);
    await logout(accountId);
    setBusy(false);
    setOpen(false);
    if (useAuthStore.getState().activeAccountId) {
      setScreen(context === "settings" ? "settings" : "chat");
      navigate("/");
      return;
    }
    openLogin("manual", null);
    setScreen("login");
    navigate("/login");
  };

  return (
    <div
      className={cn(
        context === "sidebar" ? "border-t border-[var(--vy-border)] px-3 py-2" : "px-1 py-2",
      )}
    >
      {context === "settings" && (
        <p className="px-2 pb-1 text-[0.65rem] font-medium text-[var(--vy-text-dim)]">
          ログイン中のアカウント
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--vy-surface-2)]"
      >
        <Avatar
          glyph={currentName.charAt(0).toUpperCase()}
          color="var(--vy-accent)"
          size={36}
          imageUrl={currentSession?.picturePath}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{currentName}</p>
            {currentPremium && <PremiumBadge size={14} compact />}
          </div>
          <p className="truncate text-[0.65rem] text-[var(--vy-text-dim)]">{accountId}</p>
        </div>
        <IconChevron
          size={16}
          className={cn("shrink-0 transition-transform", open ? "rotate-180" : "")}
        />
      </button>

      {open && (
        <div className="mt-1 space-y-1 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-1 shadow-lg">
          {switchableAccountIds
            .filter((id) => id !== accountId)
            .map((id) => {
              const s = sessions.find((s) => s.accountId === id);
              const name = s?.displayName || id;
              const isPremium = s?.premium?.active ?? false;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSwitch(id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
                >
                  <Avatar
                    glyph={name.charAt(0).toUpperCase()}
                    color="var(--vy-accent)"
                    size={28}
                    imageUrl={s?.picturePath}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1">
                      <p className="truncate text-xs font-medium">{name}</p>
                      {isPremium && <PremiumBadge size={12} compact />}
                    </div>
                    <p className="truncate text-[0.6rem] text-[var(--vy-text-dim)]">{id}</p>
                  </div>
                </button>
              );
            })}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
            onClick={() => {
              setOpen(false);
              openLogin("manual", null);
              setScreen("login");
              navigate("/login");
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--vy-surface-2)]">
              <IconPlus size={14} />
            </span>
            アカウントを追加
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-[var(--vy-danger)] transition-colors hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--vy-surface-2)]">
              <IconLogout size={14} />
            </span>
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}
