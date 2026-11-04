import { tr as uiText } from "@/i18n";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore.js";
import { useStore } from "../lib/store.js";
import { useVylineSync } from "../hooks/useVylineSync.js";
import { ThemeApplier } from "../components/theme-applier.js";
import { ChatShell } from "../components/chat-shell.js";
import { FloatNotice } from "../components/float-notice.js";
import { TosConsentGate } from "../components/tos-consent.js";
import { hasTosConsent } from "../lib/tosConsent.js";
import { api } from "../api/client.js";
import { VylineSetup } from "../components/vyline-setup.js";

const HubHome = lazy(() =>
  import("../components/hub-home.js").then((module) => ({ default: module.HubHome })),
);
const SettingsSections = lazy(() =>
  import("../components/settings-sections.js").then((module) => ({
    default: module.SettingsSections,
  })),
);

export function VylineApp() {
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const accounts = useAuthStore((s) => s.accounts);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const navigate = useNavigate();
  const showUpdateNote = useStore((s) => s.showUpdateNote);
  const indexing = useStore((s) => s.indexing);
  const notice = useStore((s) => s.notice);
  const mid = useStore((s) => s.self.mid);
  const profileName = useStore((s) => s.self.name);
  const accountId = useStore((s) => s.accountId);
  const [consented, setConsented] = useState(() => hasTosConsent());
  const [setupDone, setSetupDone] = useState(false);
  // アプリの画面を一度出した後に mid が判明した場合（設定の「引継ぎ・診断」など）、
  // いきなり VylineSetup に差し替えると開いている画面が作り直される。裏で確かめてから出す。
  const appShown = useRef(false);
  const [setupNeeded, setSetupNeeded] = useState(false);

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

  // ログイン画面は /login のルートにある。アカウントの追加・切替・ログアウトが
  // setScreen("login") したら、画面の状態を戻して /login へ移す（戻るで元の画面へ）
  useEffect(() => {
    if (screen !== "login") return;
    setScreen("home");
    navigate("/login");
  }, [screen, setScreen, navigate]);

  useEffect(() => {
    if (setupDone || !appShown.current || !mid || !/^u[0-9a-f]{32}$/i.test(mid)) return;
    let cancelled = false;
    void api.settings
      .account(mid)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.settings.setup.completed) setSetupDone(true);
        else setSetupNeeded(true);
      })
      .catch(() => {
        if (!cancelled) setSetupNeeded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mid, setupDone]);

  if (!initialized || loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] text-[var(--vy-text)]">
        <ThemeApplier />
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="vy-fade-in flex h-12 w-12 items-center justify-center rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-lg">
            <span className="h-4 w-4 rounded-full bg-[var(--vy-accent)] animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-medium">{uiText("バックエンドを起動中…")}</p>
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

  if (!setupDone && mid && /^u[0-9a-f]{32}$/i.test(mid) && (!appShown.current || setupNeeded)) {
    return (
      <VylineSetup
        mid={mid}
        accountId={accountId}
        profileName={profileName}
        onComplete={() => setSetupDone(true)}
      />
    );
  }

  appShown.current = true;
  return (
    <main className="min-h-dvh bg-[var(--vy-bg)] text-[var(--vy-text)]">
      <ThemeApplier />
      {indexing?.active && <FloatNotice>{indexing.label}</FloatNotice>}
      {notice && !indexing?.active && <FloatNotice>{notice}</FloatNotice>}
      {screen === "home" && showUpdateNote && (
        <div className="vy-screen-enter h-full">
          <Suspense fallback={null}>
            <HubHome />
          </Suspense>
        </div>
      )}
      {(screen === "chat" || screen === "updater" || (screen === "home" && !showUpdateNote)) && (
        <div className="vy-screen-enter h-full">
          <ChatShell />
        </div>
      )}
      {screen === "settings" && (
        <div className="vy-screen-enter h-full">
          <Suspense fallback={null}>
            <SettingsSections />
          </Suspense>
        </div>
      )}
    </main>
  );
}
