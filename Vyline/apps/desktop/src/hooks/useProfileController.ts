import { useEffect, useMemo, useState } from "react";
import { useStore, displayName, commonGroupsWith, type Chat } from "@/lib/store";
import { api } from "@/api/client";
import { looksLikeMid, mapMember } from "@/lib/mappers";
import { canStartCall } from "@/utils/callAllowlist";
import { dismissChatMid } from "@/utils/dismissedChats";
import { updateContactProfile } from "@/lib/contactProfileUpdate";
import { captureAccountContext } from "@/lib/accountContext";
import { requestControllerConfirm } from "@/ui/controller-dialog";
const defaultConfirm = (message: string) => requestControllerConfirm(message);

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

export function useProfileController(chat: Chat, confirm: (message: string) => boolean | Promise<boolean> = defaultConfirm) {
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
        const byId = new Map(useStore.getState().chats.map((c) => [c.id, c]));
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
  }, [accountId, chat.id, chat.type, streamerMode, chat.isSelf]);

  useEffect(() => {
    setNameInput(chat.localName ?? chat.name);
    setEditing(false);
  }, [accountId, chat.id, chat.localName, chat.name]);

  useEffect(() => {
    setRich({});
    setActionMsg(null);
    setMembersLoading(false);
    setBusy(false);
    setVerifyBusy(false);
    setVerifyMsg(null);
    setAgentPrompt(null);
  }, [accountId, chat.id, streamerMode]);

  useEffect(() => {
    setIsBlocked(blockedMids.includes(chat.id));
  }, [accountId, blockedMids, chat.id]);

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
    const accountContext = captureAccountContext(useStore);

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

    const profileTask = async () => {
      // Groups use chatMembers independently; a contact-profile failure must not skip membership.
      try {
        const res = await withTimeout(api.line.contactProfile(accountId, chat.id), 6_000);
        if (cancelled || !accountContext.isCurrent() || res === "timeout" || !(res as { ok?: boolean }).ok) return;
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
        const profile = r.profile;
        useStore.setState((st) => ({
          chats: updateContactProfile(st.chats, chat.id, profile),
        }));
      } catch {
        /* optional */
      }

    };
    const memberTask = async () => {
      if (chat.type === "group") {
        setMembersLoading(true);
        try {
          const mem = await withTimeout(api.line.chatMembers(accountId, chat.id), 10_000);
          if (cancelled || !accountContext.isCurrent() || mem === "timeout") return;
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
          if (!cancelled && accountContext.isCurrent()) setMembersLoading(false);
        }
      }
    };
    void Promise.all([profileTask(), memberTask()]).finally(() => accountContext.dispose());
    return () => {
      cancelled = true;
      accountContext.dispose();
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

  // 誤タップで実際に発信してしまわないよう必ず確認する。
  const placeCall = async (kind: "voice" | "video") => {
    if (!canStartCall(chat.id, kind)) return;
    const label = kind === "video" ? "ビデオ通話" : "音声通話";
    const prompt = chat.id.startsWith("c")
      ? `${name} の${label}に参加しますか？通話がない場合は開始します。`
      : `${name} に${label}を発信しますか？`;
    if (!await confirm(prompt)) return;
    if (useStore.getState().accountId !== accountId) return;
    setProfileDrawer(false);
    useStore.getState().requestCall(chat.id, kind);
  };

  const saveName = async () => {
    if (useStore.getState().accountId !== accountId) return;
    const next = nameInput.trim();
    setLocalName(chat.id, next);
    setEditing(false);
    if (!accountId || chat.type !== "friend" || !next) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await api.line.renameContact(accountId, chat.id, next);
      if (useStore.getState().accountId !== accountId) return;
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
    if (!accountId || busy || useStore.getState().accountId !== accountId) return;
    // ブロック解除
    if (chat.type === "friend" && isBlocked) {
      if (!await confirm(`「${name}」のブロックを解除しますか？`)) return;
      setBusy(true);
      setActionMsg(null);
      try {
        const res = await api.line.unblockContact(accountId, chat.id);
      if (useStore.getState().accountId !== accountId) return;
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
          !await confirm(
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
      if (!await confirm(`「${name}」から退出しますか？`)) return;
      setBusy(true);
      setActionMsg(null);
      try {
        const res = await api.line.leaveChat(accountId, chat.id);
      if (useStore.getState().accountId !== accountId) return;
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
        if (useStore.getState().accountId !== accountId) return;
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

    if (!await confirm(`「${name}」をブロックしますか？`)) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await api.line.blockContact(accountId, chat.id);
      if (useStore.getState().accountId !== accountId) return;
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

  const exportConversation = async () => {
    if (!accountId) return;
    setActionMsg("保存中…");
    try { await api.line.exportMessages(accountId, chat.id, "txt"); setActionMsg("トークを保存しました"); }
    catch (error) { setActionMsg(error instanceof Error ? error.message : "保存に失敗しました"); }
  };
  const verifyBlockStatus = async () => {
    if (!accountId) return;
    setVerifyBusy(true); setVerifyMsg(null);
    try {
      const response = await api.line.verifyFriendBlockStatus(accountId, chat.id);
      const result = response.results?.[0];
      setVerifyMsg(result?.status === "blocked" ? "ブロック中です" : result?.status === "not_blocked" ? "ブロックされていません" : result?.reason ?? "確認できませんでした");
    } catch (error) { setVerifyMsg(error instanceof Error ? error.message : "確認に失敗しました"); }
    finally { setVerifyBusy(false); }
  };

  return { setProfileDrawer, openChat, openMemberProfile, streamerMode, settings, accountId, selfPremium, editing, setEditing, nameInput, setNameInput, rich, busy, setBusy, actionMsg, setActionMsg, membersLoading, isBlocked, verifyBusy, setVerifyBusy, verifyMsg, setVerifyMsg, commonGroups, agentPrompt, setAgentPrompt, name, backgroundUrl, showBackground, handleTalk, placeCall, saveName, leaveOrBlock, conversationText, exportConversation, verifyBlockStatus };
}
