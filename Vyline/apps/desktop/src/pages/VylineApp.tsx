import { tr as uiText } from "@/i18n";
import { lazy, Suspense, useEffect, useState } from "react";
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
const WhatsNewView = lazy(() =>
  import("../components/whats-new-view.js").then((module) => ({ default: module.WhatsNewView })),
);

export function VylineApp() {
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const accounts = useAuthStore((s) => s.accounts);
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const navigate = useNavigate();
  const showUpdateNote = useStore((s) => s.showUpdateNote);
  const showManualWhatsNew = useStore((s) => s.showManualWhatsNew);
  const indexing = useStore((s) => s.indexing);
  const notice = useStore((s) => s.notice);
  const mid = useStore((s) => s.self.mid);
  const profileName = useStore((s) => s.self.name);
  const accountId = useStore((s) => s.accountId);
  const setupAccountId = accountId ?? activeAccountId;
  const [consented, setConsented] = useState(() => hasTosConsent());
  const [setupDone, setSetupDone] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [setupChecked, setSetupChecked] = useState<string | null>(null);
  const [setupCheckError, setSetupCheckError] = useState(false);

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
    if (!setupAccountId) return;
    let cancelled = false;
    setSetupDone(false);
    setSetupNeeded(false);
    setSetupCheckError(false);
    setSetupChecked(null);
    void (async () => {
      let resolvedMid = accountId === setupAccountId ? (mid ?? "") : "";
      if (!/^u[0-9a-f]{32}$/i.test(resolvedMid)) {
        const profile = await api.line.getProfile(setupAccountId);
        resolvedMid = profile.ok ? (profile.profile?.mid ?? "") : "";
        if (resolvedMid)
          useStore.setState((state) => ({ self: { ...state.self, mid: resolvedMid } }));
      }
      if (!/^u[0-9a-f]{32}$/i.test(resolvedMid)) throw new Error("account MID unavailable");
      const result = await api.settings.account(resolvedMid);
      if (!result.ok) throw new Error("setup status unavailable");
      if (cancelled) return;
      setSetupDone(Boolean(result.settings.setup.completed));
      setSetupNeeded(!result.settings.setup.completed);
      setSetupChecked(setupAccountId);
    })().catch(() => {
      if (!cancelled) {
        setSetupCheckError(true);
        setSetupChecked(setupAccountId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setupAccountId, accountId, mid]);

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

  if (setupChecked !== setupAccountId && setupAccountId) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] text-[var(--vy-text)]">
        <ThemeApplier />
        <p className="text-sm text-[var(--vy-text-dim)]">
          {uiText("セットアップ状態を確認しています…")}
        </p>
      </main>
    );
  }

  if (setupChecked === setupAccountId && setupCheckError) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--vy-bg)] px-6 text-center text-[var(--vy-text)]">
        <ThemeApplier />
        <p role="alert" className="text-sm">
          {uiText(
            "セットアップ状態を確認できません。ネットワークを確認して再読み込みしてください。",
          )}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-[var(--vy-accent)] px-4 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)]"
        >
          {uiText("再読み込み")}
        </button>
      </main>
    );
  }

  if (!setupDone && setupNeeded && mid && /^u[0-9a-f]{32}$/i.test(mid)) {
    return (
      <VylineSetup
        mid={mid}
        accountId={setupAccountId}
        profileName={profileName}
        onComplete={() => setSetupDone(true)}
      />
    );
  }
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
      {showManualWhatsNew && (
        <Suspense fallback={null}>
          <WhatsNewView mode="settings" />
        </Suspense>
      )}
    </main>
  );
}
