import { useStore, UPDATE_NOTES } from "@/lib/store";
import { Avatar } from "@/components/vy-ui";
import { IconChat, IconClose, IconChevron, IconSpark } from "@/components/icons";

/**
 * アップデート時のみ表示するリリースノート画面。
 * 通常起動では chat へ直行する（store.onRehydrateStorage / useVylineSync）。
 */
export function HubHome() {
  const dismissUpdateNote = useStore((s) => s.dismissUpdateNote);
  const setScreen = useStore((s) => s.setScreen);
  const self = useStore((s) => s.self);

  return (
    <div className="vy-scroll relative h-dvh overflow-y-auto bg-[var(--vy-bg)] overflow-y-auto">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            "radial-gradient(1200px 420px at 30% -10%, color-mix(in oklab, var(--vy-accent) 22%, transparent), transparent 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6 py-10 md:px-10 md:py-14">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--vy-accent-contrast)]"
              style={{ background: "var(--vy-accent)" }}
            >
              <IconChat size={22} />
            </div>
            <span className="text-lg font-semibold tracking-tight">Vyline</span>
          </div>
        </div>

        <div className="mt-14 md:mt-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--vy-surface-2)] px-3 py-1 text-xs font-medium text-[var(--vy-text-dim)]">
            <IconSpark size={14} />
            {UPDATE_NOTES.version} アップデート
          </span>
          <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl">
            {UPDATE_NOTES.title}
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-[var(--vy-text-dim)]">
            今回のアップデートで変わったこと
          </p>
        </div>

        <div className="mt-8 overflow-hidden rounded-3xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl">
          <div
            className="flex items-center gap-3 px-6 py-5"
            style={{ background: "color-mix(in oklab, var(--vy-accent) 14%, var(--vy-surface))" }}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--vy-accent-contrast)]"
              style={{ background: "var(--vy-accent)" }}
            >
              <IconSpark size={20} />
            </span>
            <div>
              <p className="text-xs text-[var(--vy-text-dim)]">リリースノート</p>
              <h2 className="text-base font-semibold">What's New</h2>
            </div>
          </div>
          <ul className="space-y-3 px-6 py-5">
            {UPDATE_NOTES.items.map((it, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--vy-accent)" }}
                />
                <span>{it}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-3 px-6 pb-6">
            <button
              type="button"
              onClick={() => {
                dismissUpdateNote();
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl py-3 text-sm font-semibold text-[var(--vy-accent-contrast)] transition-opacity hover:opacity-90"
              style={{ background: "var(--vy-accent)" }}
            >
              チャットを開く
              <IconChevron size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                dismissUpdateNote();
                setScreen("settings");
              }}
              aria-label="設定へ"
              className="rounded-xl border border-[var(--vy-border)] px-4 py-3 text-sm text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
            >
              <IconClose size={18} className="sr-only" />
              設定
            </button>
          </div>
        </div>

        <div className="flex-1" />
        <p className="mt-10 flex items-center justify-center gap-2 text-center text-xs text-[var(--vy-text-dim)]">
          <Avatar
            glyph={self.avatar}
            color="var(--vy-accent)"
            size={22}
            imageUrl={self.avatarUrl}
          />
          <span>
            {self.name} としてログイン中 · Vyline は LINE 非公式のサードパーティクライアントです
          </span>
        </p>
      </div>
    </div>
  );
}
