import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import { cn } from "@/lib/utils";
import { IconPanelLeft } from "@/components/icons";
import {
  CHAT_PANE_DRAG_TYPE,
  normalizeChatPaneSizes,
  resizeAdjacentChatPanes,
} from "@/lib/chatPanes";
import { startSerialPoll } from "@/lib/serialPoll";

function useDesktopChatLayout(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return desktop;
}

function ChatPaneRuntime({
  chatId,
  index,
  count,
  size,
  focused,
  reserveSidebarToggle,
}: {
  chatId: string;
  index: number;
  count: number;
  size: number;
  focused: boolean;
  reserveSidebarToggle: boolean;
}) {
  const focusChatPane = useStore((state) => state.focusChatPane);
  const closeChatPane = useStore((state) => state.closeChatPane);
  const refreshMessages = useStore((state) => state.refreshMessages);
  const pollMessagesDelta = useStore((state) => state.pollMessagesDelta);
  const loadAnnouncements = useStore((state) => state.loadAnnouncements);
  const demoMode = useStore((state) => state.demoMode);

  useEffect(() => {
    void loadAnnouncements(chatId);
    // The focused pane is hydrated by useLineData. Only background panes need
    // their own bounded local/latest-page refresh.
    if (!focused && !demoMode) void refreshMessages(chatId);
  }, [chatId, demoMode, focused, loadAnnouncements, refreshMessages]);

  useEffect(() => {
    if (focused || demoMode) return;
    return startSerialPoll(
      async () => {
        await pollMessagesDelta(chatId);
        return true;
      },
      {
        intervalMs: 15_000,
        runImmediately: false,
        pauseWhenHidden: true,
        onError: () => undefined,
      },
    );
  }, [chatId, demoMode, focused, pollMessagesDelta]);

  return (
    <section
      className={cn(
        "relative h-full min-w-0 overflow-hidden bg-[var(--vy-chat-bg)]",
        focused && count > 1 && "ring-1 ring-inset ring-[var(--vy-accent)]",
      )}
      style={{ flex: `${size} 1 0px` }}
      data-vy-chat-pane={chatId}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".vy-msg-text, a")) return;
        focusChatPane(index);
      }}
    >
      <ChatArea
        chatId={chatId}
        paneCount={count}
        onFocus={() => focusChatPane(index)}
        onClosePane={() => closeChatPane(index)}
        reserveSidebarToggle={reserveSidebarToggle}
      />
    </section>
  );
}

function ChatShellBase() {
  const activeChatId = useStore((state) => state.activeChatId);
  const chatPaneIds = useStore((state) => state.chatPaneIds);
  const chatPaneSizes = useStore((state) => state.chatPaneSizes);
  const focusedChatPane = useStore((state) => state.focusedChatPane);
  const setChatPaneSizes = useStore((state) => state.setChatPaneSizes);
  const openChatInSplit = useStore((state) => state.openChatInSplit);
  const chats = useStore((state) => state.chats);
  const sidebarWidth = useStore((state) => state.sidebarWidth);
  const setSidebarWidth = useStore((state) => state.setSidebarWidth);
  const collapsed = useStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useStore((state) => state.toggleSidebar);

  const isDesktop = useDesktopChatLayout();
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [paneResize, setPaneResize] = useState<{
    dividerIndex: number;
    startX: number;
    startSizes: number[];
    width: number;
  } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const paneContainerRef = useRef<HTMLDivElement>(null);

  const paneIds = useMemo(() => {
    const valid = chatPaneIds.filter((id) => chats.some((chat) => chat.id === id)).slice(0, 4);
    if (valid.length > 0) return valid;
    return activeChatId && chats.some((chat) => chat.id === activeChatId) ? [activeChatId] : [];
  }, [activeChatId, chatPaneIds, chats]);
  const paneSizes = useMemo(
    () => normalizeChatPaneSizes(paneIds.length, chatPaneSizes),
    [chatPaneSizes, paneIds.length],
  );
  const focusedPaneId = chatPaneIds[focusedChatPane] ?? activeChatId;
  const effectiveFocusedPane = Math.max(0, paneIds.indexOf(focusedPaneId ?? ""));

  const moveSidebar = useCallback(
    (clientX: number) => {
      const left = shellRef.current?.getBoundingClientRect().left ?? 0;
      setSidebarWidth(clientX - left);
    },
    [setSidebarWidth],
  );

  useEffect(() => {
    if (!sidebarDragging) return;
    const handleMouse = (event: MouseEvent) => moveSidebar(event.clientX);
    const handleTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) moveSidebar(touch.clientX);
    };
    const stop = () => setSidebarDragging(false);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouse);
    window.addEventListener("touchmove", handleTouch, { passive: true });
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener("mousemove", handleMouse);
      window.removeEventListener("touchmove", handleTouch);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
    };
  }, [moveSidebar, sidebarDragging]);

  useEffect(() => {
    if (!paneResize) return;
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (event: PointerEvent) => {
      const count = paneResize.startSizes.length;
      const naturalMinimum = (220 / Math.max(1, paneResize.width)) * 100;
      const minimum = Math.max(10, Math.min(100 / count - 1, naturalMinimum));
      const deltaPercent = ((event.clientX - paneResize.startX) / paneResize.width) * 100;
      setChatPaneSizes(
        resizeAdjacentChatPanes(
          paneResize.startSizes,
          paneResize.dividerIndex,
          deltaPercent,
          minimum,
        ),
      );
    };
    const stop = () => setPaneResize(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [paneResize, setChatPaneSizes]);

  const hasChatDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes(CHAT_PANE_DRAG_TYPE);

  const handleChatDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isDesktop || !hasChatDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };

  const handleChatDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isDesktop) return;
    const chatId = event.dataTransfer.getData(CHAT_PANE_DRAG_TYPE);
    setDropActive(false);
    if (!chatId || !chats.some((chat) => chat.id === chatId)) return;
    event.preventDefault();
    openChatInSplit(chatId);
  };

  return (
    <div
      ref={shellRef}
      className="vy-chat-shell flex h-dvh overflow-hidden bg-[var(--vy-bg)]"
      style={{ ["--sb-w" as string]: `${sidebarWidth}px` }}
    >
      <div
        className={cn(
          "vy-chat-sidebar-pane h-full shrink-0 md:w-[var(--sb-w)]",
          collapsed ? "hidden" : activeChatId ? "hidden w-full md:block" : "block w-full",
        )}
      >
        <Sidebar />
      </div>

      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバーの幅を調整（ダブルクリックでリセット）"
          onMouseDown={() => setSidebarDragging(true)}
          onTouchStart={() => setSidebarDragging(true)}
          onDoubleClick={() => setSidebarWidth(360)}
          className={cn(
            "group hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-[var(--vy-border)] transition-colors hover:bg-[var(--vy-accent)] md:flex",
            sidebarDragging && "bg-[var(--vy-accent)]",
          )}
        >
          <span className="h-8 w-0.5 rounded-full bg-[var(--vy-text-dim)] opacity-40 transition-opacity group-hover:opacity-0" />
        </div>
      )}

      <div
        className={cn(
          "vy-chat-pane relative h-full min-w-0 flex-1",
          activeChatId ? "flex" : "hidden md:flex",
        )}
      >
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
          className="absolute left-2 top-3 z-40 hidden h-8 w-8 items-center justify-center rounded-lg bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)] shadow-sm transition-colors hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none md:flex"
        >
          <IconPanelLeft size={17} />
        </button>

        {isDesktop ? (
          <div
            ref={paneContainerRef}
            className="relative flex h-full min-w-0 flex-1 overflow-hidden"
            onDragEnter={handleChatDragOver}
            onDragOver={handleChatDragOver}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropActive(false);
              }
            }}
            onDrop={handleChatDrop}
          >
            {paneIds.length === 0 ? (
              <ChatArea />
            ) : (
              paneIds.map((chatId, index) => (
                <div key={chatId} className="contents">
                  <ChatPaneRuntime
                    chatId={chatId}
                    index={index}
                    count={paneIds.length}
                    size={paneSizes[index] ?? 100 / paneIds.length}
                    focused={index === effectiveFocusedPane}
                    reserveSidebarToggle={index === 0}
                  />
                  {index < paneIds.length - 1 && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`${index + 1}番目と${index + 2}番目のトーク画面の幅を調整`}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        const width = paneContainerRef.current?.getBoundingClientRect().width ?? 1;
                        setPaneResize({
                          dividerIndex: index,
                          startX: event.clientX,
                          startSizes: [...paneSizes],
                          width,
                        });
                      }}
                      onDoubleClick={() => setChatPaneSizes(normalizeChatPaneSizes(paneIds.length, []))}
                      className={cn(
                        "group relative z-30 w-1.5 shrink-0 cursor-col-resize bg-[var(--vy-border)] transition-colors hover:bg-[var(--vy-accent)]",
                        paneResize?.dividerIndex === index && "bg-[var(--vy-accent)]",
                      )}
                    >
                      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--vy-text-dim)] opacity-35 group-hover:opacity-0" />
                    </div>
                  )}
                </div>
              ))
            )}

            {dropActive && (
              <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--vy-accent)] bg-[color-mix(in_oklab,var(--vy-accent)_16%,var(--vy-bg))] backdrop-blur-sm">
                <div className="rounded-xl bg-[var(--vy-surface)] px-5 py-3 text-center shadow-xl">
                  <p className="text-sm font-semibold">ここにトーク画面を追加</p>
                  <p className="mt-1 text-xs text-[var(--vy-text-dim)]">最大4画面・境界をドラッグして幅調整</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <ChatArea />
        )}
      </div>
    </div>
  );
}

export const ChatShell = memo(ChatShellBase);
