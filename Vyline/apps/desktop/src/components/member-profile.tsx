import { useEffect, useMemo, useState } from "react";
import {
  useStore,
  memberDisplayName,
  memberGlyph,
  displayName,
  commonGroupsWith,
  type Chat,
} from "@/lib/store";
import { api } from "@/api/client";
import { looksLikeMid } from "@/lib/mappers";
import { Avatar } from "@/components/vy-ui";
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
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const accountId = useStore((s) => s.accountId);
  const blockedMids = useStore((s) => s.blockedMids);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [apiCommonGroups, setApiCommonGroups] = useState<Chat[] | null>(null);
  const [rich, setRich] = useState<RichInfo>({});

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const member = chat.members?.find((m) => m.id === memberProfile?.memberId);
  const memberId = member?.id;
  const commonGroups = useMemo(
    () => apiCommonGroups ?? (member ? commonGroupsWith(chats, member.id, chat.id) : []),
    [apiCommonGroups, chats, member, chat.id],
  );

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
      .getCommonGroupIds(accountId, memberId, chat.id)
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
  const isOfficial = chat.isOfficial || rich.userType === 2;

  const blockMember = async () => {
    if (!accountId || busy) return;
    const isBlocked = useStore.getState().blockedMids.includes(member.id);
    if (!isBlocked && !window.confirm(`「${name}」をブロックしますか？`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = isBlocked
        ? await api.line.unblockContact(accountId, member.id)
        : await api.line.blockContact(accountId, member.id);
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
    <div
      className="vy-fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} のプロフィール`}
    >
      <div
        className="vy-scale-in w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative flex flex-col items-center px-6 pb-5 pt-8"
          style={
            showBackground
              ? {
                  backgroundImage: `linear-gradient(180deg, color-mix(in oklab, black 10%, transparent), color-mix(in oklab, black 24%, transparent)), url(${backgroundUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : { background: `color-mix(in oklab, ${member.color} 18%, var(--vy-surface))` }
          }
        >
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-black/10 hover:text-[var(--vy-text)]"
          >
            <IconClose size={16} />
          </button>
          <Avatar
            glyph={glyph}
            color={member.color}
            size={92}
            imageUrl={streamerMode ? undefined : member.avatarUrl}
          />
          <div className="mt-3 flex items-center gap-1.5">
            <h2 className="text-lg font-bold">{name}</h2>
            {!streamerMode && isOfficial && <OfficialBadge className="ml-0" />}
          </div>
          {!streamerMode && (
            <p className="mt-1 font-mono text-xs break-all text-[var(--vy-text-dim)] select-all">
              {member.id}
            </p>
          )}
          <p className="mt-0.5 text-xs text-[var(--vy-text-dim)]">
            {streamerMode ? "配信者モードで非表示" : `${chat.name} のメンバー`}
          </p>
          {!streamerMode && (rich.statusMessage || isOfficial || isBlocked) && (
            <div className="mt-4 w-full space-y-2 rounded-2xl border border-white/10 bg-black/10 p-3 text-left text-white backdrop-blur-sm">
              {rich.statusMessage && <TinyInfo label="ステメ" value={rich.statusMessage} />}
              {isOfficial && (
                <span className="inline-flex rounded-full bg-white/15 px-2.5 py-1 text-[0.65rem] font-medium text-white">
                  公式アカウント
                </span>
              )}
              {isBlocked && <TinyInfo label="状態" value="アカウントをブロックしています" />}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 p-4">
          <MiniAction
            icon={<IconChat size={18} />}
            label="トーク"
            onClick={() => openDirectChatWith(member.id)}
          />
          <MiniAction icon={<IconPhone size={18} />} label="通話" disabled />
          <MiniAction icon={<IconVideo size={18} />} label="ビデオ" disabled />
        </div>

        {!streamerMode && (
          <div className="border-t border-[var(--vy-border)] px-4 pb-3">
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
          <div className="border-t border-[var(--vy-border)] px-4 pb-4 pt-2">
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
  );
}

function TinyInfo({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs leading-relaxed">
      <span className="text-white/70">{label} · </span>
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
