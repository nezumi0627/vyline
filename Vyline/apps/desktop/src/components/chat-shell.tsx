import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import { cn } from "@/lib/utils";
import { IconPanelLeft } from "@/components/icons";

function ChatShellBase() {
  const activeChatId = useStore((s) => s.activeChatId);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  const [dragging, setDragging] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

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
          collapsed ? "hidden" : activeChatId ? "hidden w-full md:block" : "block w-full",
        )}
      >
        <Sidebar />
      </div>

      {/* drag handle (desktop only, when sidebar visible) */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバーの幅を調整（ダブルクリックでリセット）"
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
          activeChatId ? "flex" : "hidden md:flex",
        )}
      >
        {/* collapse / expand toggle */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
          className="absolute left-2 top-3 z-20 hidden h-8 w-8 items-center justify-center rounded-lg bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none md:flex"
        >
          <IconPanelLeft size={17} />
        </button>
        <ChatArea />
      </div>
    </div>
  );
}

export const ChatShell = memo(ChatShellBase);
