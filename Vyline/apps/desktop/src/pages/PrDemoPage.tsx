import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { ChatShell } from "@/components/chat-shell";
import { SettingsSections } from "@/components/settings-sections";
import { ThemeApplier } from "@/components/theme-applier";
import { FloatNotice } from "@/components/float-notice";
import { demoChats, demoMessages, demoSelf, demoSettings } from "@/demo/demoData";

/** PR撮影専用の実UI。accountId は null のまま、操作はデモ状態に限定する。 */
export function PrDemoPage() {
  const screen = useStore((s) => s.screen);
  const notice = useStore((s) => s.notice);

  useEffect(() => {
    useStore.setState({
      demoMode: true,
      accountId: null,
      screen: "chat",
      activeChatId: "demo-chat-team",
      chats: demoChats,
      messages: demoMessages,
      self: demoSelf,
      settings: demoSettings,
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
      <div className="pointer-events-none fixed right-6 top-5 z-50 rounded-full border border-emerald-300/30 bg-emerald-950/90 px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide text-emerald-100 shadow-xl backdrop-blur">
        DEMO MODE ON · 仮データのみ · 実アカウント接続なし
      </div>
      {notice && <FloatNotice>{notice}</FloatNotice>}
      <div className="pr-demo-shell relative h-full overflow-hidden rounded-[22px] border border-white/15 bg-[var(--vy-bg)] shadow-[0_28px_80px_rgba(15,23,42,0.42)]">
        {screen === "settings" ? <SettingsSections /> : <ChatShell />}
      </div>
    </main>
  );
}
