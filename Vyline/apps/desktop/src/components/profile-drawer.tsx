import { useEffect, useMemo, useState } from "react";
import { useStore, displayName, commonGroupsWith, type Chat } from "@/lib/store";
import { api } from "@/api/client";
import { Avatar } from "@/components/vy-ui";
import { PremiumBadge } from "@/components/premium-badge";
import { OfficialBadge } from "@/components/official-badge";
import {
  IconClose,
  IconChat,
  IconPhone,
  IconVideo,
  IconEdit,
  IconLogout,
  IconUsers,
  IconCheck,
  IconDownload,
  IconMemo,
} from "@/components/icons";
import { looksLikeMid, mapMember } from "@/lib/mappers";
import { dismissChatMid } from "@/utils/dismissedChats";
import { AgentIActionDialog } from "@/components/agent-i-action-dialog";

type RichInfo = {
  statusMessage?: string;
  phoneticName?: string;
  musicProfile?: string;
  birthday?: string;
  backgroundUrl?: string;
  pictureStatus?: string;
  profileId?: string;
  userType?: number;
};

export function ProfileDrawer({ chat }: { chat: Chat }) {
  const setProfileDrawer = useStore((s) => s.setProfileDrawer);
  const openChat = useStore((s) => s.openChat);
  const openDirectChatWith = useStore((s) => s.openDirectChatWith);
  const openMemberProfile = useStore((s) => s.openMemberProfile);
  const chats = useStore((s) => s.chats);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const settings = useStore((s) => s.settings);
  const setLocalName = useStore((s) => s.setLocalName);
  const accountId = useStore((s) => s.accountId);
  const blockedMids = useStore((s) => s.blockedMids);
  const messages = useStore((s) => s.messages);
  const selfPremium = useStore((s) => s.self.premium?.active ?? false);
  const selfBackgroundUrl = useStore((s) => s.self.backgroundUrl);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(chat.localName ?? chat.name);
  const [rich, setRich] = useState<RichInfo>({});
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [apiCommonGroups, setApiCommonGroups] = useState<Chat[] | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null);

  // 共通グループ: VylineCache 一括読み（RPC なし）→ 失敗時は従来のローカル判定へ
  const commonGroups = useMemo(() => {
    if (chat.type !== "friend") return [];
    if (apiCommonGroups) return apiCommonGroups;
    return commonGroupsWith(chats, chat.id);
  }, [chat.type, apiCommonGroups, chats, chat.id]);

  useEffect(() => {
    setApiCommonGroups(null);
    if (!accountId || chat.type !== "friend" || streamerMode || chat.isSelf) return;
    let cancelled = false;
    void api.line
      .commonGroups(accountId, chat.id)
      .then((res) => {
        if (cancelled || !res.ok || !res.groups) return;
        const byId = new Map(chats.map((c) => [c.id, c]));
        const built = res.groups.map((g) => {
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
        });
        setApiCommonGroups(built);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId, chat.id, chat.type, streamerMode, chat.isSelf, chats]);

  useEffect(() => {
    setNameInput(chat.localName ?? chat.name);
    setEditing(false);
    setRich({});
    setActionMsg(null);
    setMembersLoading(false);
    setIsBlocked(blockedMids.includes(chat.id));
  }, [blockedMids, chat.id, chat.localName, chat.name]);

  useEffect(() => {
    if (!accountId || chat.type !== "friend" || streamerMode || chat.isSelf) return;
    let cancelled = false;
    void api.line
      .blockedContacts(accountId)
      .then((res) => {
        if (cancelled || !res.ok || !res.mids) return;
        setIsBlocked(res.mids.includes(chat.id));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId, chat.id, chat.type, streamerMode, chat.isSelf]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileDrawer(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setProfileDrawer]);

  useEffect(() => {
    if (!accountId || streamerMode || chat.isSelf) return;
    let cancelled = false;

    const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | "timeout"> =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve("timeout" as const), ms);
        promise.then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          () => {
            clearTimeout(timer);
            resolve("timeout" as const);
          },
        );
      });

    void (async () => {
      // プロフィール詳細（statusMessage など）— 短めのタイムアウト
      try {
        const res = await withTimeout(api.line.contactProfile(accountId, chat.id), 6_000);
        if (cancelled || res === "timeout" || !(res as { ok?: boolean }).ok) return;
        const r = res as {
          ok: boolean;
          profile?: {
            statusMessage?: string;
            phoneticName?: string;
            musicProfile?: string;
            birthday?: { display?: string };
            backgroundUrl?: string;
            displayName?: string;
            thumbnailUrl?: string;
            pictureStatus?: string;
            profileId?: string;
            userType?: number;
          };
        };
        if (!r.profile) return;
        setRich({
          statusMessage: r.profile.statusMessage,
          phoneticName: r.profile.phoneticName,
          musicProfile: r.profile.musicProfile,
          birthday: r.profile.birthday?.display,
          backgroundUrl: r.profile.backgroundUrl,
          pictureStatus: r.profile.pictureStatus,
          profileId: r.profile.profileId,
          userType: r.profile.userType,
        });
        const nextName =
          r.profile.displayName && !looksLikeMid(r.profile.displayName)
            ? r.profile.displayName
            : undefined;
        const nextAvatar = r.profile.thumbnailUrl;
        const nextStatus = r.profile.statusMessage;
        const nextBackground = r.profile.backgroundUrl;
        useStore.setState((st) => ({
          chats: st.chats.map((c) =>
            c.id === chat.id
              ? {
                  ...c,
                  name: nextName ?? c.name,
                  avatarUrl: nextAvatar || c.avatarUrl,
                  status: nextStatus || c.status,
                  backgroundUrl: nextBackground || c.backgroundUrl,
                  left: c.left,
                }
              : c,
          ),
        }));
      } catch {
        /* optional */
      }

      if (chat.type === "group") {
        setMembersLoading(true);
        try {
          const mem = await withTimeout(api.line.chatMembers(accountId, chat.id), 10_000);
          if (cancelled || mem === "timeout") {
            setMembersLoading(false);
            return;
          }
          const rm = mem as {
            ok: boolean;
            members?: Array<{ mid: string; displayName: string; thumbnailUrl?: string }>;
          };
          if (!rm.ok || !rm.members?.length) {
            setMembersLoading(false);
            return;
          }
          const members = rm.members.map((m) => mapMember(m.mid, m.displayName, m.thumbnailUrl));
          useStore.setState((st) => ({
            chats: st.chats.map((c) => (c.id === chat.id ? { ...c, members } : c)),
          }));
        } catch {
          /* optional */
        } finally {
          setMembersLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, chat.id, chat.type, streamerMode, chat.isSelf]);

  const name = displayName(chat, streamerMode);
  const backgroundUrl =
    chat.backgroundUrl ?? (chat.isSelf ? selfBackgroundUrl : undefined) ?? rich.backgroundUrl;
  const showBackground = Boolean(!streamerMode && settings.showBackground && backgroundUrl);

  const handleTalk = () => {
    if (chat.type === "friend") {
      openDirectChatWith(chat.id);
    } else {
      openChat(chat.id);
      setProfileDrawer(false);
    }
  };

  const saveName = async () => {
    const next = nameInput.trim();
    setLocalName(chat.id, next);
    setEditing(false);
    if (!accountId || chat.type !== "friend" || !next) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await api.line.renameContact(accountId, chat.id, next);
      if (!res.ok) {
        setActionMsg(res.error ?? "表示名の同期に失敗しました（ローカルのみ保存）");
      } else {
        useStore.setState((st) => ({
          chats: st.chats.map((c) =>
            c.id === chat.id ? { ...c, name: next, localName: next } : c,
          ),
        }));
        setActionMsg("友だち表示名を更新しました");
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const leaveOrBlock = async () => {
    if (!accountId || busy) return;
    // ブロック解除
    if (chat.type === "friend" && isBlocked) {
      if (!window.confirm(`「${name}」のブロックを解除しますか？`)) return;
      setBusy(true);
      setActionMsg(null);
      try {
        const res = await api.line.unblockContact(accountId, chat.id);
        if (!res.ok) {
          setActionMsg(res.error ?? "ブロック解除に失敗しました");
          return;
        }
        setIsBlocked(false);
        useStore.setState((st) => ({
          blockedMids: st.blockedMids.filter((m) => m !== chat.id),
        }));
      } catch (err) {
        setActionMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (chat.type === "group") {
      // すでに退出・キック済み → API なしで一覧から完全除外
      if (chat.left) {
        if (
          !window.confirm(
            `「${name}」を一覧から削除しますか？\n（以降このグループは表示されません）`,
          )
        )
          return;
        dismissChatMid(accountId, chat.id);
        useStore.setState((st) => ({
          chats: st.chats.filter((c) => c.id !== chat.id),
          activeChatId: st.activeChatId === chat.id ? null : st.activeChatId,
          profileDrawerOpen: false,
          messages: st.messages.filter((m) => m.chatId !== chat.id),
        }));
        return;
      }
      if (!window.confirm(`「${name}」から退出しますか？`)) return;
      setBusy(true);
      setActionMsg(null);
      try {
        const res = await api.line.leaveChat(accountId, chat.id);
        if (!res.ok) {
          // フロント側でも NOT_A_MEMBER 相当を拾って除外
          const errText = res.error ?? "";
          if (errText.includes("NOT_A_MEMBER")) {
            dismissChatMid(accountId, chat.id);
            useStore.setState((st) => ({
              chats: st.chats.filter((c) => c.id !== chat.id),
              activeChatId: st.activeChatId === chat.id ? null : st.activeChatId,
              profileDrawerOpen: false,
              messages: st.messages.filter((m) => m.chatId !== chat.id),
            }));
            return;
          }
          setActionMsg(errText || "退出に失敗しました");
          return;
        }
        // キック済み（alreadyLeft）は一覧から消す。通常退出は退出済みバッジ付きで残す
        if (res.alreadyLeft) {
          dismissChatMid(accountId, chat.id);
          useStore.setState((st) => ({
            chats: st.chats.filter((c) => c.id !== chat.id),
            activeChatId: st.activeChatId === chat.id ? null : st.activeChatId,
            profileDrawerOpen: false,
            messages: st.messages.filter((m) => m.chatId !== chat.id),
          }));
        } else {
          useStore.setState((st) => ({
            chats: st.chats.map((c) =>
              c.id === chat.id ? { ...c, left: true, status: "退出済み" } : c,
            ),
            profileDrawerOpen: false,
          }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NOT_A_MEMBER")) {
          dismissChatMid(accountId, chat.id);
          useStore.setState((st) => ({
            chats: st.chats.filter((c) => c.id !== chat.id),
            activeChatId: st.activeChatId === chat.id ? null : st.activeChatId,
            profileDrawerOpen: false,
            messages: st.messages.filter((m) => m.chatId !== chat.id),
          }));
          return;
        }
        setActionMsg(msg);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!window.confirm(`「${name}」をブロックしますか？`)) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await api.line.blockContact(accountId, chat.id);
      if (!res.ok) {
        setActionMsg(res.error ?? "ブロックに失敗しました");
        return;
      }
      setIsBlocked(true);
      useStore.setState((st) => ({
        chats: st.chats.filter((c) => c.id !== chat.id),
        activeChatId: st.activeChatId === chat.id ? null : st.activeChatId,
        profileDrawerOpen: false,
        blockedMids: st.blockedMids.includes(chat.id)
          ? st.blockedMids
          : [...st.blockedMids, chat.id],
      }));
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const conversationText = messages
    .filter((m) => m.chatId === chat.id && m.text?.trim())
    .map((m) => `${m.authorId === "me" ? "自分" : name}: ${m.text!.trim().slice(0, 800)}`)
    .join("\n");

  return (
    <>
      <div
        className="vy-fade-in fixed inset-0 z-30 bg-black/40 xl:hidden"
        onClick={() => setProfileDrawer(false)}
        aria-hidden
      />
      <aside className="vy-drawer-in fixed inset-y-0 right-0 z-40 flex w-[min(360px,88vw)] flex-col border-l border-[var(--vy-border)] bg-[var(--vy-surface)] xl:relative xl:z-0 xl:w-[340px]">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">プロフィール</span>
          <button
            type="button"
            onClick={() => setProfileDrawer(false)}
            aria-label="閉じる"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
          >
            <IconClose size={18} />
          </button>
        </div>

        <div className="vy-scroll flex-1 overflow-y-auto px-5 pb-6">
          <div className="overflow-hidden rounded-2xl border border-[var(--vy-border)]">
            <div
              className="h-28 bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]"
              style={
                showBackground
                  ? {
                      backgroundImage: `linear-gradient(180deg, color-mix(in oklab, black 8%, transparent), color-mix(in oklab, black 20%, transparent)), url(${backgroundUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : { background: `color-mix(in oklab, ${chat.color} 22%, var(--vy-surface-2))` }
              }
            />
            <div className="-mt-12 flex flex-col items-center px-4 pb-4 text-center">
              <Avatar
                glyph={streamerMode ? "•" : chat.avatar}
                color={chat.color}
                size={88}
                online={chat.online}
                imageUrl={streamerMode ? undefined : chat.avatarUrl}
                icon={!streamerMode && chat.isSelf ? <IconMemo size={44} /> : undefined}
              />
              {editing ? (
                <div className="mt-3 flex w-full items-center gap-2">
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-center text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
                    aria-label={chat.type === "friend" ? "友だち表示名" : "表示名（ローカル）"}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveName()}
                    aria-label="保存"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--vy-accent-contrast)] disabled:opacity-50"
                    style={{ background: "var(--vy-accent)" }}
                  >
                    <IconCheck size={18} />
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <h2 className="text-xl font-bold">{name}</h2>
                  {!streamerMode && chat.isOfficial && <OfficialBadge />}
                  {chat.isSelf && selfPremium && <PremiumBadge size={14} compact />}
                  {!streamerMode && !chat.isSelf && (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      aria-label="表示名を変更"
                      className="text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-accent)]"
                    >
                      <IconEdit size={16} />
                    </button>
                  )}
                </div>
              )}
              {chat.left && (
                <span className="mt-2 rounded-full bg-[color-mix(in_oklab,var(--vy-danger)_18%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--vy-danger)]">
                  {chat.type === "friend" ? "アカウント削除済み" : "退出済み"}
                </span>
              )}
              {isBlocked && (
                <span className="mt-2 rounded-full bg-[color-mix(in_oklab,var(--vy-danger)_18%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--vy-danger)]">
                  ブロック中
                </span>
              )}
              {!streamerMode && (
                <p className="mt-1 font-mono text-[0.65rem] break-all text-[var(--vy-text-dim)] select-all">
                  {chat.id}
                </p>
              )}
              {!streamerMode &&
                settings.showStatusMessage &&
                (chat.statusMessage ?? rich.statusMessage) && (
                  <p className="mt-1 text-sm text-[var(--vy-text-dim)]">
                    {chat.statusMessage ?? rich.statusMessage}
                  </p>
                )}
            </div>
          </div>

          {!streamerMode && (chat.isOfficial || rich.userType === 2) && (
            <div className="mt-4">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--vy-accent)_16%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--vy-accent)]">
                <OfficialBadge className="ml-0" />
                公式アカウント
              </span>
            </div>
          )}

          {!streamerMode && (chat.left || isBlocked) && (
            <div className="mt-4 space-y-1 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm">
              {chat.left && <p className="text-[var(--vy-danger)]">アカウントは削除済みです</p>}
              {isBlocked && (
                <p className="text-[var(--vy-danger)]">アカウントをブロックしています</p>
              )}
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-2">
            <Action icon={<IconChat size={20} />} label="トーク" onClick={handleTalk} />
            <Action icon={<IconPhone size={20} />} label="音声通話" disabled />
            <Action icon={<IconVideo size={20} />} label="ビデオ通話" disabled />
            <Action
              icon={<IconDownload size={20} />}
              label="トーク保存"
              onClick={() => {
                const { accountId } = useStore.getState();
                if (!accountId) return;
                setActionMsg("保存中…");
                void api.line
                  .exportMessages(accountId, chat.id, "txt")
                  .then(() => setActionMsg("トークを保存しました"))
                  .catch((err) =>
                    setActionMsg(err instanceof Error ? err.message : "保存に失敗しました"),
                  );
              }}
            />
          </div>

          {!streamerMode && settings.betaAgentI && chat.type === "friend" && !chat.isSelf && (
            <button
              type="button"
              disabled={!conversationText}
              onClick={() =>
                setAgentPrompt(
                  `次の「${name}」とのこれまでの会話を日本語で5行以内に要約してください。重要な決定、約束、TODOを含めてください。\n\n${conversationText}`,
                )
              }
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--vy-border)] px-3 py-2.5 text-sm disabled:opacity-50"
            >
              AIでこの人との会話を要約
            </button>
          )}

          {!streamerMode &&
            settings.betaBlockCheckManual &&
            chat.type === "friend" &&
            !chat.isOfficial && (
              <div className="mt-3">
                <button
                  type="button"
                  disabled={verifyBusy}
                  onClick={() => {
                    if (!accountId) return;
                    setVerifyBusy(true);
                    setVerifyMsg(null);
                    void api.line
                      .verifyFriendBlockStatus(accountId, chat.id)
                      .then((res) => {
                        const result = res.results?.[0];
                        setVerifyMsg(
                          result?.status === "blocked"
                            ? "ブロック中です"
                            : result?.status === "not_blocked"
                              ? "ブロックされていません"
                              : (result?.reason ?? "確認できませんでした"),
                        );
                      })
                      .catch((err) =>
                        setVerifyMsg(err instanceof Error ? err.message : "確認に失敗しました"),
                      )
                      .finally(() => setVerifyBusy(false));
                  }}
                  className="w-full rounded-xl border border-[var(--vy-border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
                >
                  {verifyBusy ? "ブロック状態を確認中…" : "ブロック状態を確認"}
                </button>
                {verifyMsg && <p className="mt-1 text-xs text-[var(--vy-text-dim)]">{verifyMsg}</p>}
              </div>
            )}

          {chat.type === "friend" && !streamerMode && !chat.isSelf && commonGroups.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--vy-text-dim)]">
                <IconUsers size={15} />
                共通のグループ ({commonGroups.length})
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--vy-border)]">
                {commonGroups.map((g, i) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setProfileDrawer(false);
                      openChat(g.id);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
                    style={i > 0 ? { borderTop: "1px solid var(--vy-border)" } : undefined}
                  >
                    <Avatar glyph={g.avatar} color={g.color} size={36} imageUrl={g.avatarUrl} />
                    <span className="truncate text-sm font-medium">{displayName(g, false)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {chat.type === "group" && chat.members && !chat.left && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--vy-text-dim)]">
                <IconUsers size={15} />
                メンバー {chat.members.length}人
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--vy-border)]">
                {chat.members.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => openMemberProfile(chat.id, m.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
                    style={i > 0 ? { borderTop: "1px solid var(--vy-border)" } : undefined}
                  >
                    <Avatar
                      glyph={streamerMode ? "•" : m.avatar}
                      color={m.color}
                      size={36}
                      imageUrl={streamerMode ? undefined : m.avatarUrl}
                    />
                    <span className="truncate text-sm font-medium">
                      {streamerMode
                        ? "メンバー"
                        : looksLikeMid(m.name)
                          ? membersLoading
                            ? "取得中…"
                            : `${m.name.slice(0, 12)}…`
                          : m.name}
                    </span>
                  </button>
                ))}
              </div>
              {!streamerMode && accountId && (
                <InviteToGroupRow
                  chatMid={chat.id}
                  accountId={accountId}
                  onDone={(msg) => setActionMsg(msg)}
                />
              )}
            </div>
          )}

          {!streamerMode && !chat.isSelf && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void leaveOrBlock()}
              className="mt-6 flex w-full items-center gap-3 rounded-xl border border-[var(--vy-border)] px-4 py-3 text-sm font-medium text-[var(--vy-danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-danger)_12%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--vy-danger)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconLogout size={18} />
              {chat.type === "group"
                ? chat.left
                  ? busy
                    ? "削除中…"
                    : "一覧から削除"
                  : busy
                    ? "退出中…"
                    : "グループを退出"
                : isBlocked
                  ? busy
                    ? "解除中…"
                    : "ブロックを解除"
                  : busy
                    ? "処理中…"
                    : "ブロック"}
            </button>
          )}
          {actionMsg && <p className="mt-2 text-xs text-[var(--vy-text-dim)]">{actionMsg}</p>}
        </div>
      </aside>
      {agentPrompt && (
        <AgentIActionDialog
          title={`${name}との会話の要約`}
          prompt={agentPrompt}
          onClose={() => setAgentPrompt(null)}
        />
      )}
    </>
  );
}

function Action({
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
      className="flex flex-col items-center gap-1.5 rounded-xl bg-[var(--vy-surface-2)] py-3 text-xs font-medium transition-colors hover:bg-[color-mix(in_oklab,var(--vy-accent)_16%,var(--vy-surface-2))] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span style={{ color: "var(--vy-accent)" }}>{icon}</span>
      {label}
    </button>
  );
}

function InviteToGroupRow({
  chatMid,
  accountId,
  onDone,
}: {
  chatMid: string;
  accountId: string;
  onDone: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mids, setMids] = useState("");
  const [busy, setBusy] = useState(false);

  const invite = async () => {
    const list = mids
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("u"));
    if (list.length === 0) {
      onDone("招待する mid（u…）を入力してください");
      return;
    }
    setBusy(true);
    try {
      const res = await api.line.inviteToGroup(accountId, chatMid, list);
      if (!res.ok) {
        onDone(res.error || "招待に失敗しました");
        return;
      }
      onDone(`${list.length}人を招待しました`);
      setMids("");
      setOpen(false);
    } catch (e) {
      onDone(e instanceof Error ? e.message : "招待に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-[var(--vy-accent)]"
      >
        {open ? "招待を閉じる" : "メンバーを招待"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-[var(--vy-border)] p-3">
          <textarea
            value={mids}
            onChange={(e) => setMids(e.target.value)}
            placeholder="招待する mid（改行またはカンマ区切り）"
            rows={3}
            className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void invite()}
            className="w-full rounded-lg py-2 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
            style={{ background: "var(--vy-accent)" }}
          >
            {busy ? "招待中…" : "招待する"}
          </button>
        </div>
      )}
    </div>
  );
}
