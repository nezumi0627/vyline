import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  useStore,
  memberDisplayName,
  memberGlyph,
  shouldMaskStreamerAvatars,
  displayName,
  commonGroupsWith,
  type Chat,
} from "@/lib/store";
import { api } from "@/api/client";
import { looksLikeMid } from "@/lib/mappers";
import { Avatar } from "@/components/vy-ui";
import { useCall } from "@/hooks/useCall";
import { canDirectCall } from "@/utils/callAllowlist";
import { CallOverlay } from "@/components/call-overlay";
import { MediaLightbox } from "@/components/media-lightbox";
import { OfficialBadge } from "@/components/official-badge";
import { IconClose, IconChat, IconPhone, IconVideo, IconUsers } from "@/components/icons";

type RichInfo = {
  statusMessage?: string;
  backgroundUrl?: string;
  userType?: number;
};

export function MemberProfilePopover({ chat }: { chat: Chat }) {
  const memberProfile = useStore((s) => s.memberProfile);
  const close = useStore((s) => s.closeMemberProfile);
  const openDirectChatWith = useStore((s) => s.openDirectChatWith);
  const openChat = useStore((s) => s.openChat);
  const chats = useStore((s) => s.chats);
  const streamerSettings = useStore((s) => s.settings);
  const streamerMode = streamerSettings.streamerMode;
  const accountId = useStore((s) => s.accountId);
  const selfMid = useStore((s) => s.self.mid);
  const { call, startCall, endCall, setMuted } = useCall(accountId);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const blockedMids = useStore((s) => s.blockedMids);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [apiCommonGroups, setApiCommonGroups] = useState<Chat[] | null>(null);
  const [rich, setRich] = useState<RichInfo>({});

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !avatarOpen && !backgroundOpen && !call) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, avatarOpen, backgroundOpen, call]);

  const member = chat.members?.find((m) => m.id === memberProfile?.memberId);
  const memberId = member?.id;
  const commonGroups = useMemo(() => {
    if (!member) return [];
    const groups = apiCommonGroups ?? commonGroupsWith(chats, member.id);
    const viewingGroupIncludesMember =
      chat.type === "group" && chat.members?.some((candidate) => candidate.id === member.id);
    if (!viewingGroupIncludesMember || groups.some((group) => group.id === chat.id)) return groups;
    return [...groups, chat];
  }, [apiCommonGroups, chats, member, chat]);

  const backgroundUrl = rich.backgroundUrl;
  const showBackground = Boolean(!streamerMode && backgroundUrl);

  useEffect(() => {
    setApiCommonGroups(null);
    setRich({});
    if (!accountId || !memberId || streamerMode) return;
    let cancelled = false;
    void api.line
      .getContact(accountId, memberId)
      .then((res) => {
        if (cancelled || !res.ok || !res.profile) return;
        setRich({
          statusMessage: res.profile.statusMessage,
          backgroundUrl: res.profile.backgroundUrl,
          userType: res.profile.userType,
        });
        useStore.setState((st) => ({
          chats: st.chats.map((c) =>
            c.id === chat.id
              ? {
                  ...c,
                  members: c.members?.map((m) =>
                    m.id === member.id
                      ? {
                          ...m,
                          avatarUrl: res.profile?.thumbnailUrl || m.avatarUrl,
                          name:
                            res.profile?.displayName && !looksLikeMid(res.profile.displayName)
                              ? res.profile.displayName
                              : m.name,
                        }
                      : m,
                  ),
                }
              : c,
          ),
        }));
      })
      .catch(() => undefined);
    void api.line
      .commonGroups(accountId, memberId)
      .then((res) => {
        if (cancelled || !res.ok || !res.groups) return;
        const byId = new Map(useStore.getState().chats.map((c) => [c.id, c]));
        setApiCommonGroups(
          res.groups.map((g) => {
            const local = byId.get(g.chatMid);
            const name = local?.name && !looksLikeMid(local.name) ? local.name : g.name;
            const initial = (name || "G").trim().charAt(0).toUpperCase();
            return {
              id: g.chatMid,
              type: "group" as const,
              name,
              avatar: looksLikeMid(initial) ? "G" : initial,
              avatarUrl: g.thumbnailUrl || local?.avatarUrl,
              color: local?.color ?? "#7c5cff",
              status: "グループ",
              unread: 0,
            } satisfies Chat;
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId, memberId, chat.id, streamerMode]);

  if (!member) return null;

  const name = memberDisplayName(member.name, streamerMode);
  const glyph = memberGlyph(member.avatar, streamerMode);
  const isBlocked = blockedMids.includes(member.id);
  const isOfficial = rich.userType === 2;
  const canCall = Boolean(accountId && canDirectCall(member.id) && member.id !== selfMid && !isOfficial && !isBlocked);

  const blockMember = async () => {
    if (!accountId || busy) return;
    const isBlocked = useStore.getState().blockedMids.includes(member.id);
    if (!isBlocked && !window.confirm(`「${name}」をブロックしますか？`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = isBlocked
        ? await api.line.unblockContact(accountId, member.id, streamerSettings.betaBlockedListSqliteSync)
        : await api.line.blockContact(accountId, member.id, streamerSettings.betaBlockedListSqliteSync);
      if (!res.ok) {
        setMsg(res.error ?? (isBlocked ? "ブロック解除に失敗しました" : "ブロックに失敗しました"));
        return;
      }
      useStore.setState((st) => ({
        blockedMids: isBlocked
          ? st.blockedMids.filter((m) => m !== member.id)
          : st.blockedMids.includes(member.id)
            ? st.blockedMids
            : [...st.blockedMids, member.id],
      }));
      setMsg(isBlocked ? "ブロックを解除しました" : "ブロックしました");
      close();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="vy-fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
        onClick={close}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} のプロフィール`}
      >
        <div
          className="vy-scale-in relative w-full max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto vy-scroll rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-2xl"
          style={showBackground ? {
            backgroundImage: `linear-gradient(180deg, rgba(8, 11, 16, 0.58), rgba(8, 11, 16, 0.78)), url(${backgroundUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            color: "#f8fafc",
            "--vy-text": "#f8fafc",
            "--vy-text-dim": "rgba(235, 239, 244, 0.78)",
            "--vy-surface": "rgba(12, 16, 22, 0.78)",
            "--vy-surface-2": "rgba(31, 38, 48, 0.82)",
            "--vy-border": "rgba(255, 255, 255, 0.2)",
          } as CSSProperties : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {showBackground && (
            <button
              type="button"
              aria-label={`${name} のプロフィール背景を拡大`}
              onClick={() => setBackgroundOpen(true)}
              className="absolute inset-0 z-0 cursor-zoom-in"
            />
          )}
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--vy-surface)] text-[var(--vy-text)] transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          >
            <IconClose size={16} />
          </button>
          <div className="relative z-10 flex flex-col items-center bg-transparent px-5 py-8 text-center text-[var(--vy-text)] sm:px-8">
            <button
              type="button"
              aria-label={`${name} のプロフィール画像を拡大`}
              disabled={streamerMode || !member.avatarUrl}
              onClick={() => setAvatarOpen(true)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] disabled:cursor-default"
            >
              <Avatar
                glyph={glyph}
                color={member.color}
                size={92}
                imageUrl={shouldMaskStreamerAvatars(streamerMode) ? undefined : member.avatarUrl}
              />
            </button>
            <div className="mt-4 flex max-w-full items-center justify-center gap-1.5">
              <h2 className="min-w-0 break-words text-xl font-bold sm:text-2xl">{name}</h2>
              {!streamerMode && isOfficial && <OfficialBadge className="ml-0" />}
            </div>
            {!streamerMode && (
              <p className="mt-1 font-mono text-xs break-all text-[var(--vy-text-dim)] select-all">
                {member.id}
              </p>
            )}
            <p className="mt-2 break-words text-xs text-[var(--vy-text-dim)]">
              {streamerMode ? "配信者モードで非表示" : `${chat.name} のメンバー`}
            </p>
            {!streamerMode && (rich.statusMessage || isOfficial || isBlocked) && (
              <div className="mt-5 w-full space-y-2 border-t border-[var(--vy-border)] pt-4 text-left text-[var(--vy-text)]">
                {rich.statusMessage && <TinyInfo label="ステメ" value={rich.statusMessage} />}
                {isOfficial && (
                  <span className="inline-flex rounded-full bg-[var(--vy-surface-2)] px-2.5 py-1 text-[0.65rem] font-medium text-[var(--vy-text)]">
                    公式アカウント
                  </span>
                )}
                {isBlocked && <TinyInfo label="状態" value="アカウントをブロックしています" />}
              </div>
            )}
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-2 p-4">
            <MiniAction
              icon={<IconChat size={18} />}
              label="トーク"
              onClick={() => openDirectChatWith(member.id)}
            />
            <MiniAction
              icon={<IconPhone size={18} />}
              label="音声通話"
              disabled={!canCall || Boolean(call)}
              onClick={() => void startCall(member.id, "voice")}
            />
            <MiniAction
              icon={<IconVideo size={18} />}
              label="ビデオ通話"
              disabled={!canCall || Boolean(call)}
              onClick={() => void startCall(member.id, "video")}
            />
          </div>

          {!streamerMode && (
            <div className="relative z-10 px-4 pb-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void blockMember()}
                className="w-full rounded-xl border border-[var(--vy-border)] px-3 py-2.5 text-sm font-medium text-[var(--vy-danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-danger)_12%,transparent)] disabled:opacity-50"
              >
                {busy ? "処理中…" : isBlocked ? "ブロックを解除" : "ブロック"}
              </button>
              {msg && <p className="mt-2 text-xs text-[var(--vy-text-dim)]">{msg}</p>}
            </div>
          )}

          {!streamerMode && (
            <div className="relative z-10 border-t border-[var(--vy-border)] px-4 pb-4 pt-2">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--vy-text-dim)]">
                <IconUsers size={14} />
                共通のグループ
                {commonGroups.length > 0 && (
                  <span className="rounded-full bg-[var(--vy-surface-2)] px-2 py-0.5 text-[0.65rem]">
                    {commonGroups.length}
                  </span>
                )}
              </div>
              {commonGroups.length === 0 ? (
                <p className="text-xs leading-relaxed text-[var(--vy-text-dim)]">
                  履歴を読み込んだグループの中に共通グループは見つかりませんでした
                </p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto vy-scroll">
                  {commonGroups.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          openChat(g.id);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
                      >
                          <Avatar glyph={g.avatar} color={g.color} size={32} imageUrl={g.avatarUrl} />
                        <span className="truncate text-sm font-medium">{displayName(g, false)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      {avatarOpen && !streamerMode && member.avatarUrl && (
        <MediaLightbox src={member.avatarUrl} alt={`${name} のプロフィール画像`} onClose={() => setAvatarOpen(false)} />
      )}
      {backgroundOpen && showBackground && backgroundUrl && (
        <MediaLightbox src={backgroundUrl} alt={`${name} のプロフィール背景`} onClose={() => setBackgroundOpen(false)} />
      )}
      {call && (
        <CallOverlay kind={call.kind} name={name} glyph={glyph} color={member.color}
          imageUrl={shouldMaskStreamerAvatars(streamerMode) ? undefined : member.avatarUrl} state={call.state} error={call.error}
          onClose={() => void endCall()} onMutedChange={setMuted} />
      )}
    </>
  );
}

function TinyInfo({ label, value }: { label: string; value: string }) {
  return (
    <p className="break-words text-sm leading-relaxed">
      <span className="text-[var(--vy-text-dim)]">{label} · </span>
      <span>{value}</span>
    </p>
  );
}

function MiniAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 rounded-xl bg-[var(--vy-surface-2)] py-2.5 text-xs font-medium transition-colors hover:bg-[color-mix(in_oklab,var(--vy-accent)_16%,var(--vy-surface-2))] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span style={{ color: "var(--vy-accent)" }}>{icon}</span>
      {label}
    </button>
  );
}
