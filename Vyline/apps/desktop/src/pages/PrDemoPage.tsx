import { useEffect } from "react";
import { changeUiLanguage } from "@/i18n";
import { api } from "@/api/client";
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
    const line = api.line as unknown as Record<string, unknown>;
    const originalStatus = line.squareStatus;
    // デモではバックエンドへ出さない（squareStore を作らせない）
    line.squareStatus = async () => ({ enabled: false });
    const previous = {
      demoMode: useStore.getState().demoMode,
      accountId: useStore.getState().accountId,
      screen: useStore.getState().screen,
      activeChatId: useStore.getState().activeChatId,
      chats: useStore.getState().chats,
      messages: useStore.getState().messages,
      self: useStore.getState().self,
      settings: useStore.getState().settings,
      showUpdateNote: useStore.getState().showUpdateNote,
    };
    void changeUiLanguage("ja").then(() => {
      useStore.setState({
        demoMode: true,
        accountId: "demo",
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
    });
    return () => {
      line.squareStatus = originalStatus;
      useStore.setState(previous);
      void changeUiLanguage(previous.settings.uiLanguage);
    };
  }, []);

  return (
    <main className="min-h-dvh bg-[var(--vy-bg)] text-[var(--vy-text)]">
      <ThemeApplier />
      <div className="pointer-events-none fixed right-6 top-5 z-50 rounded-full border border-emerald-300/30 bg-emerald-950/90 px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide text-emerald-100 shadow-xl backdrop-blur">
        DEMO MODE ON · 仮データのみ · 実アカウント接続なし
      </div>
      {notice && <FloatNotice>{notice}</FloatNotice>}
      <div className="vy-screen-enter h-full">
        {screen === "settings" ? <SettingsSections /> : <ChatShell />}
      </div>
    </main>
  );
}
