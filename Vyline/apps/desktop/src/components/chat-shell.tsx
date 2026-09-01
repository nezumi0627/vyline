import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import { cn } from "@/lib/utils";
import { IconPanelLeft } from "@/components/icons";
import {
  CHAT_PANE_DRAG_TYPE,
  CHAT_PANE_SOURCE_TYPE,
  chatPaneDropEffect,
  chatPaneDropPlan,
  chatPaneRects,
  equalChatPaneSizes,
  normalizeChatPaneLayout,
  normalizeChatPaneSizes,
  placeChatPane,
  resizeAdjacentChatPanes,
  type ChatPaneLayoutMode,
  type ChatPaneRect,
} from "@/lib/chatPanes";
import { startSerialPoll } from "@/lib/serialPoll";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";

function useWideChatLayout(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return wide;
}

function layoutStorageKey(accountId: string | null): string {
  return `vyline:chat-pane-layout:${accountId ?? "default"}`;
}

function readLayout(accountId: string | null): {
  mode: ChatPaneLayoutMode;
  mainRatio: number;
  crossRatio: number;
} {
  if (typeof localStorage === "undefined")
    return { mode: "columns", mainRatio: 50, crossRatio: 50 };
  try {
    const parsed = JSON.parse(localStorage.getItem(layoutStorageKey(accountId)) ?? "{}") as {
      mode?: ChatPaneLayoutMode;
      mainRatio?: number;
      crossRatio?: number;
    };
    return {
      mode: parsed.mode ?? "columns",
      mainRatio: Number.isFinite(parsed.mainRatio)
        ? Math.max(22, Math.min(78, parsed.mainRatio!))
        : 50,
      crossRatio: Number.isFinite(parsed.crossRatio)
        ? Math.max(22, Math.min(78, parsed.crossRatio!))
        : 50,
    };
  } catch {
    return { mode: "columns", mainRatio: 50, crossRatio: 50 };
  }
}

function columnRects(sizes: readonly number[]): ChatPaneRect[] {
  const normalized = normalizeChatPaneSizes(sizes.length, sizes);
  let x = 0;
  return normalized.map((width) => {
    const rect = { x, y: 0, width, height: 100 };
    x += width;
    return rect;
  });
}

function ChatPaneRuntime({
  chatId,
  index,
  count,
  rect,
  focused,
  reserveSidebarToggle,
  desktopManipulationEnabled,
}: {
  chatId: string;
  index: number;
  count: number;
  rect: ChatPaneRect;
  focused: boolean;
  reserveSidebarToggle: boolean;
  desktopManipulationEnabled: boolean;
}) {
  const focusChatPane = useStore((state) => state.focusChatPane);
  const closeChatPane = useStore((state) => state.closeChatPane);
  const refreshMessages = useStore((state) => state.refreshMessages);
  const pollMessagesDelta = useStore((state) => state.pollMessagesDelta);
  const loadAnnouncements = useStore((state) => state.loadAnnouncements);
  const demoMode = useStore((state) => state.demoMode);

  useEffect(() => {
    void loadAnnouncements(chatId);
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
        "absolute overflow-hidden bg-[var(--vy-chat-bg)] transition-[left,top,width,height] duration-150",
        focused && count > 1 && "ring-1 ring-inset ring-[var(--vy-accent)]",
      )}
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.width}%`,
        height: `${rect.height}%`,
      }}
      data-vy-chat-pane={chatId}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".vy-msg-text, a, [data-vy-pane-drag-handle]")) return;
        focusChatPane(index);
      }}
    >
      <ChatArea
        chatId={chatId}
        paneCount={count}
        onFocus={() => focusChatPane(index)}
        onClosePane={() => closeChatPane(index)}
        reserveSidebarToggle={reserveSidebarToggle}
        onPaneDragStart={
          desktopManipulationEnabled
            ? (event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(CHAT_PANE_DRAG_TYPE, chatId);
                event.dataTransfer.setData(CHAT_PANE_SOURCE_TYPE, String(index));
              }
            : undefined
        }
      />
    </section>
  );
}

type DropPreview = {
  mode: ChatPaneLayoutMode;
  slot: number;
  label: string;
  count: number;
};

type PaneResize =
  | { kind: "columns"; dividerIndex: number; startX: number; startSizes: number[]; width: number }
  | { kind: "main"; startX: number; startRatio: number; width: number }
  | { kind: "cross"; startY: number; startRatio: number; height: number };

function ChatShellBase() {
  const activeChatId = useStore((state) => state.activeChatId);
  const accountId = useStore((state) => state.accountId);
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

  const isWideLayout = useWideChatLayout();
  const desktopInteraction = isDesktopInteraction();
  const initialLayout = useMemo(() => readLayout(accountId), [accountId]);
  const [layoutMode, setLayoutMode] = useState<ChatPaneLayoutMode>(initialLayout.mode);
  const [mainRatio, setMainRatio] = useState(initialLayout.mainRatio);
  const [crossRatio, setCrossRatio] = useState(initialLayout.crossRatio);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [paneResize, setPaneResize] = useState<PaneResize | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const paneContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = readLayout(accountId);
    setLayoutMode(next.mode);
    setMainRatio(next.mainRatio);
    setCrossRatio(next.crossRatio);
  }, [accountId]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      layoutStorageKey(accountId),
      JSON.stringify({ mode: layoutMode, mainRatio, crossRatio }),
    );
  }, [accountId, crossRatio, layoutMode, mainRatio]);

  const paneIds = useMemo(() => {
    const valid = chatPaneIds.filter((id) => chats.some((chat) => chat.id === id)).slice(0, 4);
    if (valid.length > 0) return valid;
    return activeChatId && chats.some((chat) => chat.id === activeChatId) ? [activeChatId] : [];
  }, [activeChatId, chatPaneIds, chats]);
  const paneSizes = useMemo(
    () => normalizeChatPaneSizes(paneIds.length, chatPaneSizes),
    [chatPaneSizes, paneIds.length],
  );
  const effectiveLayout = normalizeChatPaneLayout(paneIds.length, layoutMode);
  const paneRects = useMemo(
    () =>
      effectiveLayout === "columns"
        ? columnRects(paneSizes)
        : chatPaneRects(paneIds.length, effectiveLayout, mainRatio, crossRatio),
    [crossRatio, effectiveLayout, mainRatio, paneIds.length, paneSizes],
  );
  const focusedPaneId = chatPaneIds[focusedChatPane] ?? activeChatId;
  const effectiveFocusedPane = Math.max(0, paneIds.indexOf(focusedPaneId ?? ""));

  useEffect(() => {
    const normalized = normalizeChatPaneLayout(paneIds.length, layoutMode);
    if (normalized !== layoutMode) setLayoutMode(normalized);
  }, [layoutMode, paneIds.length]);

  const moveSidebar = useCallback(
    (clientX: number) => {
      const left = shellRef.current?.getBoundingClientRect().left ?? 0;
      setSidebarWidth(clientX - left);
    },
    [setSidebarWidth],
  );

  useEffect(() => {
    if (!sidebarDragging || !desktopInteraction) return;
    const handlePointer = (event: PointerEvent) => moveSidebar(event.clientX);
    const stop = () => setSidebarDragging(false);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointer);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [desktopInteraction, moveSidebar, sidebarDragging]);

  useEffect(() => {
    if (!paneResize || !desktopInteraction) return;
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = paneResize.kind === "cross" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    const move = (event: PointerEvent) => {
      if (paneResize.kind === "columns") {
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
      } else if (paneResize.kind === "main") {
        const delta = ((event.clientX - paneResize.startX) / Math.max(1, paneResize.width)) * 100;
        setMainRatio(Math.max(22, Math.min(78, paneResize.startRatio + delta)));
      } else {
        const delta = ((event.clientY - paneResize.startY) / Math.max(1, paneResize.height)) * 100;
        setCrossRatio(Math.max(22, Math.min(78, paneResize.startRatio + delta)));
      }
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
  }, [desktopInteraction, paneResize, setChatPaneSizes]);

  useEffect(() => {
    if (isWideLayout && desktopInteraction) return;
    setSidebarDragging(false);
    setPaneResize(null);
    setDropPreview(null);
  }, [desktopInteraction, isWideLayout]);

  const hasChatDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes(CHAT_PANE_DRAG_TYPE);

  const computeDropPreview = (event: React.DragEvent<HTMLDivElement>): DropPreview | null => {
    if (!isWideLayout || !desktopInteraction || !hasChatDrag(event)) return null;
    const chatId = event.dataTransfer.getData(CHAT_PANE_DRAG_TYPE);
    const existing = paneIds.includes(chatId);
    const count = Math.min(4, Math.max(1, paneIds.length + (existing ? 0 : 1)));
    const rect = event.currentTarget.getBoundingClientRect();
    const plan = chatPaneDropPlan(
      count,
      (event.clientX - rect.left) / Math.max(1, rect.width),
      (event.clientY - rect.top) / Math.max(1, rect.height),
    );
    return { ...plan, count };
  };

  const handleChatDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const preview = computeDropPreview(event);
    if (!preview) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = chatPaneDropEffect(Array.from(event.dataTransfer.types));
    setDropPreview(preview);
  };

  const handleChatDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isWideLayout || !desktopInteraction || !hasChatDrag(event)) return;
    // drop を受理することを最初に確定する。validation 後の preventDefault では
    // Chromium が「禁止された drop」として先に破棄するケースがある。
    event.preventDefault();
    event.stopPropagation();
    const chatId = event.dataTransfer.getData(CHAT_PANE_DRAG_TYPE);
    const preview = computeDropPreview(event) ?? dropPreview;
    setDropPreview(null);
    if (!chatId || !preview || !chats.some((chat) => chat.id === chatId)) return;

    const isExisting = paneIds.includes(chatId);
    if (!isExisting && paneIds.length >= 4) {
      useStore.getState().showNotice("同時に開けるトークは最大4画面です");
      return;
    }
    if (!isExisting) openChatInSplit(chatId);

    const state = useStore.getState();
    const sourceIds = state.chatPaneIds.length ? state.chatPaneIds : paneIds;
    const nextIds = placeChatPane(sourceIds, chatId, preview.slot);
    const focusIndex = Math.max(0, nextIds.indexOf(chatId));
    useStore.setState({
      chatPaneIds: nextIds,
      chatPaneSizes: equalChatPaneSizes(nextIds.length),
      focusedChatPane: focusIndex,
      activeChatId: chatId,
    });
    setLayoutMode(preview.mode);
  };

  const previewRects = dropPreview
    ? chatPaneRects(dropPreview.count, dropPreview.mode, 50, 50)
    : [];

  return (
    <div
      ref={shellRef}
      className="vy-chat-shell vy-viewport-root flex overflow-hidden bg-[var(--vy-bg)]"
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

      {!collapsed && isWideLayout && desktopInteraction && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバーの幅を調整（ダブルクリックでリセット）"
          onPointerDown={(event) => {
            event.preventDefault();
            setSidebarDragging(true);
          }}
          onDoubleClick={() => setSidebarWidth(360)}
          className={cn(
            "vy-desktop-manipulator group hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-[var(--vy-border)] transition-colors hover:bg-[var(--vy-accent)] md:flex",
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
          className="vy-touch-target absolute left-2 top-3 z-40 hidden h-8 w-8 items-center justify-center rounded-lg bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)] shadow-sm transition-colors hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none md:flex"
        >
          <IconPanelLeft size={17} />
        </button>

        {isWideLayout ? (
          <div
            ref={paneContainerRef}
            className="relative h-full min-w-0 flex-1 overflow-hidden"
            onDragEnter={handleChatDragOver}
            onDragOver={handleChatDragOver}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDropPreview(null);
            }}
            onDrop={handleChatDrop}
          >
            {paneIds.length === 0 ? (
              <ChatArea />
            ) : (
              paneIds.map((chatId, index) => (
                <ChatPaneRuntime
                  key={chatId}
                  chatId={chatId}
                  index={index}
                  count={paneIds.length}
                  rect={paneRects[index] ?? { x: 0, y: 0, width: 100, height: 100 }}
                  focused={index === effectiveFocusedPane}
                  reserveSidebarToggle={index === 0}
                  desktopManipulationEnabled={desktopInteraction}
                />
              ))
            )}

            {desktopInteraction &&
              effectiveLayout === "columns" &&
              paneRects.slice(0, -1).map((rect, index) => (
                <div
                  key={`column-divider-${index}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${index + 1}番目と${index + 2}番目のトーク画面の幅を調整`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    const width = paneContainerRef.current?.getBoundingClientRect().width ?? 1;
                    setPaneResize({
                      kind: "columns",
                      dividerIndex: index,
                      startX: event.clientX,
                      startSizes: [...paneSizes],
                      width,
                    });
                  }}
                  onDoubleClick={() => setChatPaneSizes(equalChatPaneSizes(paneIds.length))}
                  className="vy-desktop-manipulator absolute top-0 z-30 h-full w-1.5 -translate-x-1/2 cursor-col-resize bg-[var(--vy-border)] hover:bg-[var(--vy-accent)]"
                  style={{ left: `${rect.x + rect.width}%` }}
                />
              ))}

            {desktopInteraction &&
              (effectiveLayout === "split-left" ||
                effectiveLayout === "split-right" ||
                effectiveLayout === "grid") && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="左右のトーク領域の幅を調整"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setPaneResize({
                      kind: "main",
                      startX: event.clientX,
                      startRatio: mainRatio,
                      width: paneContainerRef.current?.getBoundingClientRect().width ?? 1,
                    });
                  }}
                  onDoubleClick={() => setMainRatio(50)}
                  className="vy-desktop-manipulator absolute top-0 z-30 h-full w-1.5 -translate-x-1/2 cursor-col-resize bg-[var(--vy-border)] hover:bg-[var(--vy-accent)]"
                  style={{ left: `${mainRatio}%` }}
                />
              )}

            {desktopInteraction &&
              (effectiveLayout === "split-left" ||
                effectiveLayout === "split-right" ||
                effectiveLayout === "grid") && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="上下のトーク領域の高さを調整"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setPaneResize({
                      kind: "cross",
                      startY: event.clientY,
                      startRatio: crossRatio,
                      height: paneContainerRef.current?.getBoundingClientRect().height ?? 1,
                    });
                  }}
                  onDoubleClick={() => setCrossRatio(50)}
                  className="vy-desktop-manipulator absolute z-30 h-1.5 -translate-y-1/2 cursor-row-resize bg-[var(--vy-border)] hover:bg-[var(--vy-accent)]"
                  style={{
                    top: `${crossRatio}%`,
                    left: effectiveLayout === "split-right" ? `${mainRatio}%` : "0%",
                    width:
                      effectiveLayout === "grid"
                        ? "100%"
                        : effectiveLayout === "split-left"
                          ? `${mainRatio}%`
                          : `${100 - mainRatio}%`,
                  }}
                />
              )}

            {dropPreview && (
              <div className="pointer-events-none absolute inset-2 z-50 rounded-2xl bg-black/20 backdrop-blur-[2px]">
                {previewRects.map((rect, index) => (
                  <div
                    key={`preview-${index}`}
                    className={cn(
                      "absolute rounded-xl border-2 bg-[color-mix(in_oklab,var(--vy-surface)_72%,transparent)] shadow-lg transition-all",
                      index === dropPreview.slot
                        ? "border-[var(--vy-accent)] ring-2 ring-inset ring-[var(--vy-accent)]"
                        : "border-white/35",
                    )}
                    style={{
                      left: `calc(${rect.x}% + 4px)`,
                      top: `calc(${rect.y}% + 4px)`,
                      width: `calc(${rect.width}% - 8px)`,
                      height: `calc(${rect.height}% - 8px)`,
                    }}
                  >
                    {index === dropPreview.slot && (
                      <div className="flex h-full items-center justify-center">
                        <div className="rounded-xl border border-dashed border-[var(--vy-accent)] bg-[var(--vy-surface)]/90 px-4 py-3 text-center shadow-xl">
                          <div className="text-2xl font-light text-[var(--vy-accent)]">＋</div>
                          <p className="mt-1 text-sm font-semibold text-[var(--vy-text)]">
                            {dropPreview.label}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
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
