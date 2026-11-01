import { useEffect } from "react";
import { Avatar } from "@/components/vy-ui";
import { IconChat, IconClose, IconPlus } from "@/components/icons";

export type MidSearchProfile = {
  mid: string;
  displayName: string;
  thumbnailUrl?: string;
  backgroundUrl?: string;
  statusMessage?: string;
};

type MidSearchProfileProps = {
  profile: MidSearchProfile;
  isFriend: boolean;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onTalk: () => void;
  onAddFriend: () => void;
};

export function MidSearchProfileDrawer({
  profile,
  isFriend,
  busy,
  notice,
  onClose,
  onTalk,
  onAddFriend,
}: MidSearchProfileProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/45" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="mid-search-profile-title"
        className="vy-drawer-in fixed inset-y-0 right-0 z-[61] flex w-[min(360px,90vw)] flex-col border-l border-[var(--vy-border)] bg-[var(--vy-surface)] text-[var(--vy-text)] shadow-2xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--vy-border)] px-4">
          <span className="text-sm font-semibold">プロフィール</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          >
            <IconClose size={18} />
          </button>
        </div>

        <div className="vy-scroll flex-1 overflow-y-auto px-5 py-5">
          <div
            className="relative isolate flex min-h-52 flex-col items-center justify-end overflow-hidden rounded-2xl bg-[var(--vy-surface-2)] px-4 pb-5 pt-8 text-center"
            style={
              profile.backgroundUrl
                ? {
                    backgroundImage: `linear-gradient(180deg, rgba(8, 11, 16, 0.28), rgba(8, 11, 16, 0.76)), url(${profile.backgroundUrl})`,
                    backgroundPosition: "center",
                    backgroundSize: "cover",
                  }
                : undefined
            }
          >
            <Avatar
              glyph={profile.displayName?.trim().slice(0, 1) || "?"}
              imageUrl={profile.thumbnailUrl}
              color="var(--vy-accent)"
              size={88}
            />
            <h2
              id="mid-search-profile-title"
              className="mt-3 max-w-full break-words text-lg font-semibold"
            >
              {profile.displayName || "名前未設定"}
            </h2>
            <p className="mt-1 max-w-full break-all font-mono text-[0.68rem] text-white/70">
              {profile.mid}
            </p>
          </div>

          {profile.statusMessage && (
            <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3.5 py-3 text-sm leading-relaxed text-[var(--vy-text-dim)]">
              {profile.statusMessage}
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!isFriend}
              onClick={onTalk}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)] transition-opacity hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: "var(--vy-accent)" }}
              title={isFriend ? undefined : "友だち追加後に利用できます"}
            >
              <IconChat size={17} />
              トーク
            </button>
            <button
              type="button"
              disabled={isFriend || busy}
              onClick={onAddFriend}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--vy-border)] px-3 py-2 text-sm font-semibold transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              title={isFriend ? "すでに友だちです" : undefined}
            >
              <IconPlus size={17} />
              {isFriend ? "友だち追加済み" : busy ? "追加中…" : "友だち追加"}
            </button>
          </div>
          {notice && (
            <p role="status" className="mt-3 text-center text-xs text-[var(--vy-text-dim)]">
              {notice}
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
