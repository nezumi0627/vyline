import { useEffect } from "react";
import { tr as uiText } from "@/i18n";
import { THEME_PRESETS, useStore } from "@/lib/store";
import { ChatShell } from "@/components/chat-shell";
import { SettingsSections } from "@/components/settings-sections";
import { ThemeApplier } from "@/components/theme-applier";
import { FloatNotice } from "@/components/float-notice";
import { demoChats, demoMessages, demoSelf, demoSettings } from "@/demo/demoData";
import { requestSettingsSection } from "@/lib/settingsSection";

/** PR撮影専用の実UI。accountId は null のまま、操作はデモ状態に限定する。 */
export function PrDemoPage() {
  const screen = useStore((s) => s.screen);
  const notice = useStore((s) => s.notice);

  useEffect(() => {
    requestSettingsSection("theme");
    useStore.setState({
      demoMode: true,
      accountId: null,
      screen: "settings",
      activeChatId: "demo-chat-team",
      chats: demoChats,
      messages: demoMessages,
      self: demoSelf,
      settings: { ...demoSettings, streamerMode: false, betaThemeEffects: true },
      theme: {
        ...THEME_PRESETS[0]!,
        chatImage: "/chat-wallpaper-preview.png",
        chatBackgroundBlur: 8,
      },
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
    <main className="pr-demo pr-demo-stage h-dvh overflow-hidden text-[var(--vy-text)]">
      <ThemeApplier />
      <div className="pr-demo-rail" role="status">
        <span>{uiText("PRプレビュー")}</span>
        <span>{uiText("サンプルデータのみ・実アカウント未接続")}</span>
      </div>
      {notice && <FloatNotice>{notice}</FloatNotice>}
      <div className="pr-demo-shell">
        {screen === "settings" ? <SettingsSections /> : <ChatShell />}
      </div>
    </main>
  );
}
