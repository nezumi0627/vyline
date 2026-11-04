import { useEffect, useRef, useState } from "react";
import { tr as uiText } from "@/i18n";
import { useStore, UPDATE_NOTES } from "@/lib/store";
import { getVersionReleaseUrl, releaseChannel } from "@/lib/updater";
import { IconChat, IconChevron, IconClose, IconSpark } from "@/components/icons";

type WhatsNewViewProps = { mode: "startup" | "settings" };

export function WhatsNewView({ mode }: WhatsNewViewProps) {
  const dismissUpdateNote = useStore((s) => s.dismissUpdateNote);
  const closeManualWhatsNew = useStore((s) => s.closeManualWhatsNew);
  const [detailsUrl, setDetailsUrl] = useState(
    "https://github.com/nezumi0627/Vyline/blob/main/CHANGELOG.md",
  );
  const [detailsReady, setDetailsReady] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const channel = releaseChannel(UPDATE_NOTES.version);
  const manual = mode === "settings";

  useEffect(() => {
    let active = true;
    void getVersionReleaseUrl(UPDATE_NOTES.version).then((url) => {
      if (active) {
        setDetailsUrl(url);
        setDetailsReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!manual) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeManualWhatsNew();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [manual, closeManualWhatsNew]);

  const openDetails = () => window.open(detailsUrl, "_blank", "noopener,noreferrer");
  const openChat = () => (manual ? closeManualWhatsNew(true) : dismissUpdateNote());

  return (
    <div
      ref={dialog}
      className={
        manual
          ? "fixed inset-0 z-[70] overflow-y-auto bg-[var(--vy-bg)] text-[var(--vy-text)]"
          : "vy-scroll relative min-h-dvh overflow-y-auto bg-[var(--vy-bg)] text-[var(--vy-text)]"
      }
      role={manual ? "dialog" : undefined}
      aria-modal={manual || undefined}
      aria-labelledby="whats-new-title"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(1200px_420px_at_30%_-10%,color-mix(in_oklab,var(--vy-accent)_22%,transparent),transparent_70%)]"
      />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6 py-8 md:px-10 md:py-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon-128.png" alt={uiText("Vyline ロゴ")} className="h-10 w-10 rounded-xl" />
            <span className="text-lg font-semibold tracking-tight">{uiText("Vyline")}</span>
          </div>
          {manual && (
            <button
              ref={backButton}
              type="button"
              onClick={() => closeManualWhatsNew()}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--vy-border)] px-3 py-2 text-sm text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
            >
              <IconClose size={16} />
              {uiText("設定")}
            </button>
          )}
        </header>

        <section className="mt-10 md:mt-14">
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--vy-surface-2)] px-3 py-1 text-xs font-medium text-[var(--vy-text-dim)]">
            <IconSpark size={14} />
            {uiText("What's New")}
          </span>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 id="whats-new-title" className="text-3xl font-bold tracking-tight md:text-4xl">
              Vyline {UPDATE_NOTES.version}
            </h1>
            {channel && (
              <span className="rounded-full border border-[var(--vy-border)] px-2.5 py-1 text-xs font-semibold text-[var(--vy-accent)]">
                {channel}
              </span>
            )}
          </div>
          <h2 className="mt-3 text-xl font-semibold">{UPDATE_NOTES.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--vy-text-dim)]">
            {uiText("このバージョンで追加・修正された内容")}
          </p>
        </section>

        <section className="mt-7 overflow-hidden rounded-3xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl">
          <div className="flex items-center gap-3 px-5 py-4 md:px-6">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--vy-accent-contrast)]"
              style={{ background: "var(--vy-accent)" }}
            >
              <IconSpark size={20} />
            </span>
            <div>
              <p className="text-xs text-[var(--vy-text-dim)]">{uiText("リリースノート")}</p>
              <h3 className="font-semibold">{uiText("主な追加・修正")}</h3>
            </div>
          </div>
          <ul className="space-y-3 px-5 pb-5 md:px-6">
            {UPDATE_NOTES.items.map((item, index) => (
              <li key={`${index}-${item}`} className="flex gap-3 text-sm leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--vy-accent)]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 border-t border-[var(--vy-border)] p-5 md:flex-row md:px-6">
            <button
              type="button"
              onClick={openDetails}
              disabled={!detailsReady}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--vy-border)] px-4 py-3 text-sm font-semibold hover:bg-[var(--vy-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] disabled:cursor-wait disabled:opacity-60"
            >
              {uiText("詳しくはGitHubで見る")}
            </button>
            <button
              type="button"
              onClick={openChat}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl px-4 py-3 text-sm font-semibold text-[var(--vy-accent-contrast)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              style={{ background: "var(--vy-accent)" }}
            >
              {uiText("チャットを開く")}
              <IconChat size={16} />
              <IconChevron size={15} />
            </button>
          </div>
        </section>
        <div className="mt-auto pt-8" />
      </div>
    </div>
  );
}
