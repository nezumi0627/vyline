import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { ChatShell } from "@/components/chat-shell";
import { SettingsSections } from "@/components/settings-sections";
import { ThemeApplier } from "@/components/theme-applier";
import { FloatNotice } from "@/components/float-notice";
import { LegacyControllerDialogHost } from "@/components/legacy-controller-dialog";
import { demoChats, demoSelf, demoSettings, demoTimeline } from "@/demo/demoData";
import { isComposeMode, useDesignSystemStore } from "@/ui/design-system-store";

/** PR撮影専用の実UI。accountId は null のまま、操作はデモ状態に限定する。 */
export function PrDemoPage() {
  const mode = useDesignSystemStore((state) => state.mode);
  const compose = isComposeMode(mode);
  const screen = useStore((s) => s.screen);
  const notice = useStore((s) => s.notice);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    useStore.setState({
      demoMode: true,
      accountId: null,
      screen: "chat",
      activeChatId: "demo-chat-team",
      chats: demoChats,
      messages: demoTimeline(Number(params.get("stress")), params.get("images") === "1"),
      self: demoSelf,
      settings: { ...demoSettings, streamerMode: false },
      showUpdateNote: false,
      profileDrawerOpen: false,
      drafts: {},
      draftSticons: {},
      draftMentions: {},
      replyToId: null,
      blockedMids: [],
      announcements: {},
    });
    return () => {
      useStore.setState({
        demoMode: false,
        accountId: null,
        activeChatId: null,
        chats: [],
        messages: [],
        screen: "home",
        showUpdateNote: false,
      });
    };
  }, []);

  return (
    <main className="pr-demo-stage relative h-dvh overflow-hidden text-[var(--vy-text)]">
      <ThemeApplier />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-6 items-center justify-center bg-emerald-950 text-[0.6rem] font-medium tracking-wide text-emerald-100">
        DEMO MODE ON · 仮データのみ · 実アカウント接続なし
      </div>
      {notice && !compose && <FloatNotice>{notice}</FloatNotice>}
      <div className="pr-demo-shell relative h-full overflow-hidden rounded-[22px] border border-white/15 bg-[var(--vy-bg)] shadow-[0_28px_80px_rgba(15,23,42,0.42)]">
        <div
          inert={screen === "settings" && !compose}
          style={{
            display: screen === "settings" && !compose ? "none" : undefined,
            height: "100%",
          }}
        >
          <ChatShell />
        </div>
        {screen === "settings" && !compose && <SettingsSections />}
      </div>
      <LegacyControllerDialogHost />
    </main>
  );
}
