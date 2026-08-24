import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore.js";
import { useStore } from "../lib/store.js";
import { useVylineSync } from "../hooks/useVylineSync.js";
import { ThemeApplier } from "../components/theme-applier.js";
import { HubHome } from "../components/hub-home.js";
import { ChatShell } from "../components/chat-shell.js";
import { SettingsSections } from "../components/settings-sections.js";
import { FloatNotice } from "../components/float-notice.js";
import { TosConsentGate, hasTosConsent } from "../components/tos-consent.js";
import { api } from "../api/client.js";

export function VylineApp() {
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const accounts = useAuthStore((s) => s.accounts);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const screen = useStore((s) => s.screen);
  const showUpdateNote = useStore((s) => s.showUpdateNote);
  const indexing = useStore((s) => s.indexing);
  const notice = useStore((s) => s.notice);
  const [consented, setConsented] = useState(() => hasTosConsent());

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const token = localStorage.getItem("vyline:subdevice-session");
    if (!token) return;
    const beat = () => void api.subdevices.heartbeat(token).catch(() => undefined);
    beat();
    const timer = window.setInterval(beat, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 同意前は同期・通信を開始しない
  useVylineSync(initialized && accounts.length > 0 && consented);

  if (!initialized || loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] text-[var(--vy-text)]">
        <ThemeApplier />
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="vy-fade-in flex h-12 w-12 items-center justify-center rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-lg">
            <span className="h-4 w-4 rounded-full bg-[var(--vy-accent)] animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-medium">バックエンドを起動中…</p>
            <p className="mt-1 text-xs text-[var(--vy-text-dim)]">
              {error ? error : "接続できるまで待機しています"}
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (accounts.length === 0) {
    return <Navigate to="/login" replace />;
  }

  // ログイン後・同意前は利用規約画面のみ（同意しない限りアプリは動作しない）
  if (!consented) {
    return (
      <main className="min-h-dvh bg-[var(--vy-bg)] text-[var(--vy-text)]">
        <ThemeApplier />
        <TosConsentGate onConsent={() => setConsented(true)} />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[var(--vy-bg)] text-[var(--vy-text)]">
      <ThemeApplier />
      {indexing?.active && <FloatNotice>{indexing.label}</FloatNotice>}
      {notice && !indexing?.active && <FloatNotice>{notice}</FloatNotice>}
      {screen === "home" && showUpdateNote && (
        <div className="vy-screen-enter h-full">
          <HubHome />
        </div>
      )}
      {(screen === "chat" || (screen === "home" && !showUpdateNote)) && (
        <div className="vy-screen-enter h-full">
          <ChatShell />
        </div>
      )}
      {screen === "settings" && (
        <div className="vy-screen-enter h-full">
          <SettingsSections />
        </div>
      )}
    </main>
  );
}
