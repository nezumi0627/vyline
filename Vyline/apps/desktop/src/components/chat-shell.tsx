import { tr as uiText } from "@/i18n";
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";
import { UpdaterPage } from "@/components/updater-page";

const ChatArea = lazy(() =>
  import("@/components/chat-area").then((module) => ({ default: module.ChatArea })),
);
const SquareChatPane = lazy(() =>
  import("@/components/square-chat-pane").then((module) => ({ default: module.SquareChatPane })),
);

type SquareRoomSelection = { id: string; name?: string; squareName?: string };

function ChatShellBase() {
  const screen = useStore((s) => s.screen);
  const activeChatId = useStore((s) => s.activeChatId);
  const closeChat = useStore((s) => s.closeChat);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const collapsed = useStore((s) => s.sidebarCollapsed);

  const [dragging, setDragging] = useState(false);
  const [squareRoom, setSquareRoom] = useState<SquareRoomSelection | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selectRoom = (event: Event) => {
      const detail = (event as CustomEvent<SquareRoomSelection>).detail;
      if (!detail || typeof detail.id !== "string") return;
      setSquareRoom(detail);
      closeChat();
    };
    const clearRoom = () => setSquareRoom(null);
    const onSquareSettingChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (detail?.enabled === false) setSquareRoom(null);
    };
    window.addEventListener("vyline:square-room", selectRoom);
    window.addEventListener("vyline:square-close", clearRoom);
    window.addEventListener("vyline:square-changed", onSquareSettingChanged);
    return () => {
      window.removeEventListener("vyline:square-room", selectRoom);
      window.removeEventListener("vyline:square-close", clearRoom);
      window.removeEventListener("vyline:square-changed", onSquareSettingChanged);
    };
  }, [closeChat]);

  const onMove = useCallback(
    (clientX: number) => {
      const left = shellRef.current?.getBoundingClientRect().left ?? 0;
      setSidebarWidth(clientX - left);
    },
    [setSidebarWidth],
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMouse = (e: MouseEvent) => onMove(e.clientX);
    const handleTouch = (e: TouchEvent) => onMove(e.touches[0].clientX);
    const stop = () => setDragging(false);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouse);
    window.addEventListener("touchmove", handleTouch);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouse);
      window.removeEventListener("touchmove", handleTouch);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
    };
  }, [dragging, onMove]);

  return (
    <div
      ref={shellRef}
      className="vy-chat-shell flex h-dvh overflow-hidden bg-[var(--vy-bg)]"
      style={{ ["--sb-w" as string]: `${sidebarWidth}px` }}
    >
      {/* Sidebar */}
      <div
        className={cn(
          "vy-chat-sidebar-pane h-full shrink-0 md:w-[var(--sb-w)]",
          collapsed
            ? "hidden"
            : activeChatId || squareRoom
              ? "hidden w-full md:block"
              : "block w-full",
        )}
      >
        <Sidebar />
      </div>

      {/* drag handle (desktop only, when sidebar visible) */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={uiText("サイドバーの幅を調整（ダブルクリックでリセット）")}
          onMouseDown={() => setDragging(true)}
          onTouchStart={() => setDragging(true)}
          onDoubleClick={() => setSidebarWidth(360)}
          className={cn(
            "group hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-[var(--vy-border)] transition-colors hover:bg-[var(--vy-accent)] md:flex",
            dragging && "bg-[var(--vy-accent)]",
          )}
        >
          <span className="h-8 w-0.5 rounded-full bg-[var(--vy-text-dim)] opacity-40 transition-opacity group-hover:opacity-0" />
        </div>
      )}

      <div
        className={cn(
          "vy-chat-pane relative h-full min-w-0 flex-1",
          activeChatId || squareRoom ? "flex" : "hidden md:flex",
        )}
      >
        {screen === "updater" ? (
          <UpdaterPage />
        ) : squareRoom ? (
          <Suspense fallback={null}>
            <SquareChatPane
              room={squareRoom}
              squareName={squareRoom.squareName}
              onBack={() => setSquareRoom(null)}
            />
          </Suspense>
        ) : activeChatId ? (
          <Suspense fallback={null}>
            <ChatArea />
          </Suspense>
        ) : (
          <div
            className="hidden flex-1 items-center justify-center bg-[var(--vy-chat-bg)] md:flex"
            data-pattern="0"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-3xl opacity-60">
                {uiText("💬")}{" "}
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--vy-text-dim)]">
                  {uiText("チャットを選択してください")}{" "}
                </p>
                <p className="mt-1 text-xs text-[var(--vy-text-dim)] opacity-60">
                  {uiText("左のリストからトークを開くか、新しい会話を始めましょう")}{" "}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatShell = memo(ChatShellBase);
