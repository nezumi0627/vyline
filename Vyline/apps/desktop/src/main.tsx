import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot as createReactRoot, type Root } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";
import { useStore } from "./lib/store.js";
import { useAuthStore } from "./stores/authStore.js";
import { useDraftStore } from "./stores/draftStore.js";
import { useSettingsStore } from "./stores/settingsStore.js";
import { useThemeStore } from "./stores/themeStore.js";
import { hydrateDismissedChatState } from "./utils/dismissedChats.js";
import { hydrateHiddenChats } from "./hooks/useHiddenChats.js";
import { hydrateTosConsent } from "./lib/tosConsent.js";
import { hydrateBetaConsent } from "./lib/betaConsent.js";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Vyline render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main
          role="alert"
          className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-foreground"
        >
          <h1 className="text-lg font-semibold">Vylineの画面を表示できません</h1>
          <p className="text-sm text-muted-foreground">
            再読み込みしても解決しない場合は、ログを確認してください。
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            再読み込み
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

const appRoot: Root = import.meta.hot?.data.appRoot ?? createReactRoot(root);
let disposed = false;
if (import.meta.hot) import.meta.hot.data.appRoot = appRoot;
appRoot.render(
  <div
    role="status"
    aria-live="polite"
    className="flex min-h-screen items-center justify-center bg-background text-foreground"
  >
    Vyline を準備しています…
  </div>,
);

const stores = [useAuthStore, useSettingsStore, useDraftStore, useThemeStore, useStore];
import.meta.hot?.dispose(() => {
  disposed = true;
});
void Promise.all(stores.map((store) => Promise.resolve(store.persist.rehydrate())))
  .then(async () => {
    await Promise.all([hydrateTosConsent(), hydrateBetaConsent()]);
    await Promise.all([hydrateDismissedChatState(), hydrateHiddenChats()]);
  })
  .catch(() => undefined)
  .then(() => {
    if (!disposed)
      appRoot.render(
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>,
      );
  });
