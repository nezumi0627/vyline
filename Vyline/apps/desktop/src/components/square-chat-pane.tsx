import { tr as uiText } from "@/i18n";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { formatTime, useStore, type Member } from "@/lib/store";
import { mapMember } from "@/lib/mappers";
import { createChatDayLabels } from "@/lib/chatDayLabels";
import { cn } from "@/lib/utils";
import { copyText } from "@/utils/clipboard";
import { Avatar } from "@/components/vy-ui";
import {
  IconArrowLeft,
  IconChat,
  IconCheck,
  IconCopy,
  IconHeart,
  IconMore,
  IconPin,
  IconPlus,
  IconSend,
  IconSmile,
  IconUsers,
} from "@/components/icons";
import { MessageContextMenu, type MenuItem } from "@/components/message-context-menu";
import { getSquareStickerUrl } from "@/lib/square-message";

const StickerEmojiPanel = lazy(async () => ({
  default: (await import("@/components/sticker-emoji-panel")).StickerEmojiPanel,
}));

type SquareMessage = {
  message?: {
    id: string;
    text?: string;
    createdTime?: number | string;
    from?: string;
    contentType?: number | string;
    contentMetadata?: Record<string, string> | null;
  };
  threadInfo?: { chatThreadMid?: string; threadRoot?: boolean };
  state?: unknown;
};

type SquareRoomMember = {
  squareMemberMid: string;
  displayName: string;
  profileImageObsHash?: string;
  thumbnailUrl?: string;
  pictureUrl?: string;
  role: string | number;
};

/** 通常チャットと同じく、バックエンドが返した http(s) URL のみアバターに使う。
 *  profileImageObsHash から URL を推測しない（スキーム未検証のため）。 */
function squareMemberAvatarUrl(member: SquareRoomMember): string | undefined {
  const candidate = member.thumbnailUrl ?? member.pictureUrl;
  return candidate && /^https?:\/\//.test(candidate) ? candidate : undefined;
}

const SQUARE_REACTIONS = [
  ["NICE", "👍", "いいね"],
  ["LOVE", "❤️", "大好き"],
  ["FUN", "😂", "面白い"],
  ["AMAZING", "😮", "すごい"],
  ["SAD", "😢", "悲しい"],
  ["OMG", "😱", "びっくり"],
] as const;

function getSquareMediaKind(
  value: string | number | undefined,
): "image" | "video" | "audio" | null {
  if (value === "IMAGE" || value === 1) return "image";
  if (value === "VIDEO" || value === 2) return "video";
  if (value === "AUDIO" || value === 3) return "audio";
  return null;
}

function SquareMediaPreview({
  accountId,
  roomId,
  messageId,
  kind,
}: {
  accountId: string;
  roomId: string;
  messageId: string;
  kind: "image" | "video" | "audio";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const load = async () => {
      try {
        const blob = await api.line.squareMediaPreview(accountId, roomId, messageId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    if (typeof IntersectionObserver === "undefined") {
      void load();
      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, roomId, messageId]);

  return (
    <div ref={hostRef} className="mt-2 max-w-full">
      {failed ? (
        <span className="text-xs opacity-60">
          {uiText("メディアプレビューを取得できませんでした")}
        </span>
      ) : url && kind === "image" ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="max-h-80 max-w-full rounded-xl object-contain"
        />
      ) : url && kind === "video" ? (
        <video src={url} controls preload="none" className="max-h-80 max-w-full rounded-xl" />
      ) : url ? (
        <audio src={url} controls preload="none" className="max-w-full" />
      ) : (
        <div aria-hidden="true" className="h-24 w-40 animate-pulse rounded-xl bg-black/10" />
      )}
    </div>
  );
}

export function SquareChatPane({
  room,
  squareName,
  onBack,
}: {
  room: { id: string; name?: string };
  squareName?: string;
  onBack: () => void;
}) {
  const accountId = useStore((state) => state.accountId);
  const settings = useStore((state) => state.settings);
  const [messages, setMessages] = useState<SquareMessage[]>([]);
  const [myMid, setMyMid] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [messageActionId, setMessageActionId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; messageId: string } | null>(null);
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number } | null>(null);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [threadMid, setThreadMid] = useState<string | null>(null);
  const [threadMembershipState, setThreadMembershipState] = useState<number | string | null>(null);
  const [joiningThread, setJoiningThread] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<SquareRoomMember[]>([]);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [roomToolsOpen, setRoomToolsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<
    Array<{ announcementSeq: string | number; contents?: unknown }>
  >([]);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const operationIdRef = useRef<string | null>(null);
  const stickerOperationRef = useRef<{ key: string; id: string } | null>(null);

  const refresh = useCallback(
    async (initial = false) => {
      if (!accountId || !room.id) return;
      try {
        const result = await api.line.squareMessages(
          accountId,
          room.id,
          100,
          threadMid ?? undefined,
        );
        setMessages(result.messages as SquareMessage[]);
        setMyMid(result.mySquareMemberMid ?? null);
        setNotice(result.stale ? uiText("接続できないため保存済みメッセージを表示しています") : "");
      } catch (error) {
        setNotice(
          error instanceof Error && error.message.includes("SQUARE_DISABLED")
            ? uiText("OpenChatが無効になりました")
            : uiText("メッセージを取得できませんでした。Beta設定と接続状態を確認してください"),
        );
      } finally {
        if (initial) setLoading(false);
      }
    },
    [accountId, room.id, threadMid],
  );

  useEffect(() => {
    setThreadMid(null);
  }, [room.id]);

  useEffect(() => {
    if (!accountId || !threadMid) {
      setThreadMembershipState(null);
      return;
    }
    let cancelled = false;
    setThreadMembershipState("loading");
    void api.line
      .squareThreadContext(accountId, room.id, threadMid)
      .then((result) => {
        if (!cancelled) setThreadMembershipState(result.membershipState);
      })
      .catch(() => {
        if (!cancelled) {
          setThreadMembershipState("unknown");
          setNotice(uiText("スレッドの参加状態を取得できませんでした"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, room.id, threadMid]);

  const isThreadJoined = threadMembershipState === 1 || threadMembershipState === "JOINED";
  const joinThread = async () => {
    if (!accountId || !threadMid || joiningThread) return;
    setJoiningThread(true);
    try {
      await api.line.squareThreadJoin(accountId, room.id, threadMid);
      const context = await api.line.squareThreadContext(accountId, room.id, threadMid);
      setThreadMembershipState(context.membershipState);
      setNotice("");
      void refresh();
    } catch {
      setNotice(uiText("スレッドに参加できませんでした"));
    } finally {
      setJoiningThread(false);
    }
  };

  const loadMembers = useCallback(
    async (cursor?: string) => {
      if (!accountId || membersLoading) return;
      setMembersLoading(true);
      try {
        const result = await api.line.squareMembers(accountId, room.id, cursor);
        setMembers((current) => {
          if (!cursor) return result.members;
          const seen = new Set(current.map((member) => member.squareMemberMid));
          return [...current, ...result.members.filter((m) => !seen.has(m.squareMemberMid))];
        });
        setMemberCursor(result.continuationToken);
      } catch {
        setNotice(uiText("メンバー一覧を取得できませんでした"));
      } finally {
        setMembersLoading(false);
      }
    },
    [accountId, room.id, membersLoading],
  );

  useEffect(() => {
    setMembers([]);
    setMemberCursor(null);
    setMembersOpen(false);
  }, [room.id]);

  // 送信者名・アバター表示用に、開いた時点でメンバー一覧を取り込む（最大5ページ）
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      let cursor: string | undefined;
      for (let page = 0; page < 5 && !cancelled; page += 1) {
        try {
          const result = await api.line.squareMembers(accountId, room.id, cursor);
          if (cancelled) return;
          setMembers((current) => {
            const seen = new Set(current.map((member) => member.squareMemberMid));
            return [...current, ...result.members.filter((m) => !seen.has(m.squareMemberMid))];
          });
          setMemberCursor(result.continuationToken);
          cursor = result.continuationToken ?? undefined;
          if (!cursor) break;
        } catch {
          break;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, room.id]);

  const memberByMid = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of members) {
      map.set(
        member.squareMemberMid,
        mapMember(member.squareMemberMid, member.displayName, squareMemberAvatarUrl(member)),
      );
    }
    return map;
  }, [members]);

  const dayLabels = useMemo(
    () =>
      createChatDayLabels(
        messages.map((item) => ({ createdAt: Number(item.message?.createdTime ?? 0) })),
      ),
    [messages],
  );

  const openMenu = (x: number, y: number, messageId: string) => setMenu({ x, y, messageId });
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const pressHandlers = (messageId: string) => ({
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      openMenu(event.clientX, event.clientY, messageId);
    },
    onTouchStart: (event: React.TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const { clientX, clientY } = touch;
      longPressRef.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => openMenu(clientX, clientY, messageId), 500),
      };
    },
    onTouchMove: (event: React.TouchEvent) => {
      const pending = longPressRef.current;
      const touch = event.touches[0];
      if (!pending || !touch) return;
      if (Math.hypot(touch.clientX - pending.x, touch.clientY - pending.y) > 8) {
        window.clearTimeout(pending.timer);
        longPressRef.current = null;
      }
    },
    onTouchEnd: () => {
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current.timer);
        longPressRef.current = null;
      }
    },
  });

  const menuItemsFor = (item: SquareMessage): MenuItem[] => {
    const message = item.message;
    if (!message?.id) return [];
    const items: MenuItem[] = [];
    if (message.text?.trim()) {
      items.push({
        label: uiText("コピー"),
        icon: <IconCopy size={16} />,
        onClick: () => void copyText(message.text ?? ""),
      });
    }
    items.push({
      label: uiText("既読を送信"),
      icon: <IconCheck size={16} />,
      onClick: () => void markRead(message.id),
    });
    items.push({
      label: uiText("リアクション"),
      icon: <IconHeart size={16} />,
      children: SQUARE_REACTIONS.map(([type, glyph, label]) => ({
        label: uiText(label),
        icon: <span aria-hidden="true">{glyph}</span>,
        onClick: () => void react(message.id, type),
      })),
    });
    if (!threadMid && message.text?.trim()) {
      items.push({
        label: uiText("アナウンスに設定"),
        icon: <IconPin size={16} />,
        onClick: () => void createAnnouncement(message.id),
      });
    }
    if (!threadMid && item.threadInfo?.threadRoot && item.threadInfo.chatThreadMid) {
      items.push({
        label: uiText("スレッドを開く"),
        icon: <IconChat size={16} />,
        onClick: () => setThreadMid(item.threadInfo?.chatThreadMid ?? null),
      });
    }
    return items;
  };

  const menuMessage = menu ? messages.find((item) => item.message?.id === menu.messageId) : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    void refresh(true);
    const timer = window.setInterval(() => {
      if (!cancelled && document.visibilityState === "visible") void refresh();
    }, 60_000);
    const changed = () => {
      if (!cancelled) void refresh();
    };
    window.addEventListener("vyline:square-changed", changed);
    const visibilityChanged = () => {
      if (!cancelled && document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("vyline:square-changed", changed);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    const value = text.trim();
    if (!accountId || !value || busy || (threadMid && !isThreadJoined)) return;
    setBusy(true);
    setNotice("");
    try {
      operationIdRef.current ??= crypto.randomUUID();
      const result = threadMid
        ? await api.line.squareThreadSendMessage(
            accountId,
            room.id,
            threadMid,
            operationIdRef.current,
            value,
          )
        : await api.line.squareSendMessage(accountId, room.id, operationIdRef.current, value);
      if (!result.ok) {
        setNotice(
          result.error === "SQUARE_SEND_ALREADY_ATTEMPTED"
            ? uiText("同じ送信操作は再送しません。履歴を更新して送信結果を確認してください")
            : uiText("送信間隔が短すぎます。少し待ってから再試行してください"),
        );
      } else {
        setText("");
        operationIdRef.current = null;
        void refresh();
      }
    } catch {
      setNotice(
        uiText("送信結果を確認できませんでした。重複送信を避けるため、履歴を更新してください"),
      );
    } finally {
      setBusy(false);
    }
  };

  const sendSticker = async (packageId: string, stickerId: string, isPremium?: boolean) => {
    if (!accountId || busy || threadMid) return;
    setBusy(true);
    setNotice("");
    try {
      const key = `${room.id}:${packageId}:${stickerId}:${Boolean(isPremium)}`;
      if (stickerOperationRef.current?.key !== key) {
        stickerOperationRef.current = { key, id: crypto.randomUUID() };
      }
      const result = await api.line.squareSendSticker(
        accountId,
        room.id,
        stickerOperationRef.current.id,
        packageId,
        stickerId,
        isPremium,
      );
      if (!result.ok) {
        setNotice(
          result.error === "SQUARE_SEND_ALREADY_ATTEMPTED"
            ? uiText("同じ送信操作は再送しません。履歴を更新して送信結果を確認してください")
            : uiText("送信間隔が短すぎます。少し待ってから再試行してください"),
        );
      } else {
        stickerOperationRef.current = null;
        setStickerPickerOpen(false);
        void refresh();
      }
    } catch {
      setNotice(uiText("送信結果を確認できませんでした。履歴を更新して確認してください"));
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (messageId: string) => {
    if (!accountId || messageActionId) return;
    setMessageActionId(messageId);
    try {
      await api.line.squareMarkRead(accountId, room.id, messageId, threadMid ?? undefined);
      setNotice(uiText("既読を送信しました"));
    } catch {
      setNotice(uiText("既読を送信できませんでした"));
    } finally {
      setMessageActionId(null);
    }
  };

  const react = async (
    messageId: string,
    type: "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG",
  ) => {
    if (!accountId || messageActionId) return;
    setMessageActionId(messageId);
    try {
      await api.line.squareReact(accountId, room.id, messageId, type, threadMid ?? undefined);
      setNotice(uiText("リアクションを送信しました"));
      void refresh();
    } catch {
      setNotice(uiText("リアクションを送信できませんでした"));
    } finally {
      setMessageActionId(null);
    }
  };

  const loadAnnouncements = async () => {
    if (!accountId || announcementLoading) return;
    setAnnouncementLoading(true);
    try {
      const result = await api.line.squareAnnouncements(accountId, room.id);
      setAnnouncements(result.announcements);
    } catch {
      setNotice(uiText("アナウンスを取得できませんでした"));
    } finally {
      setAnnouncementLoading(false);
    }
  };

  const copyInvitation = async () => {
    if (!accountId) return;
    try {
      const { invitationURL } = await api.line.squareInvitation(accountId, room.id);
      await navigator.clipboard.writeText(invitationURL);
      setNotice(uiText("招待リンクをコピーしました"));
    } catch {
      setNotice(uiText("招待リンクを取得できませんでした"));
    }
  };

  const createAnnouncement = async (messageId: string) => {
    if (!accountId || messageActionId) return;
    setMessageActionId(messageId);
    try {
      await api.line.squareCreateAnnouncement(accountId, room.id, messageId);
      await loadAnnouncements();
      setNotice(uiText("アナウンスに設定しました"));
    } catch {
      setNotice(uiText("アナウンスに設定できませんでした。権限とメッセージ形式を確認してください"));
    } finally {
      setMessageActionId(null);
    }
  };

  const deleteAnnouncement = async (sequence: string | number) => {
    if (!accountId || messageActionId) return;
    if (!window.confirm(uiText("このアナウンスを削除しますか？"))) return;
    const key = String(sequence);
    setMessageActionId(key);
    try {
      await api.line.squareDeleteAnnouncement(accountId, room.id, sequence);
      setAnnouncements((current) => current.filter((item) => String(item.announcementSeq) !== key));
      setNotice(uiText("アナウンスを削除しました"));
    } catch {
      setNotice(uiText("アナウンスを削除できませんでした。権限と状態を確認してください"));
    } finally {
      setMessageActionId(null);
    }
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-[var(--vy-chat-bg)]">
      <header className="vy-chat-header flex min-h-16 shrink-0 items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2.5 md:gap-3 md:pl-12 md:pr-4">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none md:hidden"
          onClick={onBack}
          aria-label={uiText("戻る")}
        >
          <IconArrowLeft size={20} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar glyph={(room.name ?? "O").slice(0, 1)} color="#635bff" size={40} />
          <div className="min-w-0 flex-1">
            <p className="vy-chat-header-title truncate font-semibold text-[var(--vy-text)]">
              {room.name || uiText("名前未設定のルーム")}
            </p>
            <p className="truncate text-xs text-[var(--vy-text-dim)]">
              {threadMid ? uiText("スレッド") : squareName || uiText("オープンチャット")} ·{" "}
              {uiText("OpenChat")}
            </p>
          </div>
        </div>
        {threadMid && (
          <button
            type="button"
            className="rounded-full border border-[var(--vy-border)] px-3 py-1 text-xs text-[var(--vy-accent)] hover:bg-[var(--vy-surface-2)]"
            onClick={() => setThreadMid(null)}
          >
            {uiText("スレッドから戻る")}
          </button>
        )}
        {threadMid && threadMembershipState !== "loading" && !isThreadJoined && (
          <button
            type="button"
            disabled={joiningThread || threadMembershipState === "unknown"}
            onClick={() => void joinThread()}
            className="rounded-lg bg-[var(--vy-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
          >
            {joiningThread ? uiText("参加中…") : uiText("スレッドに参加")}
          </button>
        )}
        <HeaderButton
          label={uiText("メンバー")}
          active={membersOpen}
          onClick={() => {
            const next = !membersOpen;
            setMembersOpen(next);
            if (next && members.length === 0) void loadMembers();
          }}
        >
          <IconUsers size={20} />
        </HeaderButton>
        <HeaderButton
          label={uiText("グループ設定")}
          active={roomToolsOpen}
          onClick={() => {
            const next = !roomToolsOpen;
            setRoomToolsOpen(next);
            if (next && announcements.length === 0) void loadAnnouncements();
          }}
        >
          <IconMore size={20} />
        </HeaderButton>
      </header>

      <div className="vy-scroll vy-chat-surface vy-chat-messages [overflow-anchor:none] flex-1 overflow-y-auto px-3 py-4 md:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {membersOpen && (
            <section className="mb-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-3">
              <h2 className="mb-2 text-xs font-semibold text-[var(--vy-text-dim)]">
                {uiText("メンバー")} · {members.length}
              </h2>
              <div className="grid gap-1 sm:grid-cols-2">
                {members.map((member) => {
                  const owner = member.role === 1 || member.role === "ADMIN";
                  const coAdmin = member.role === 2 || member.role === "CO_ADMIN";
                  return (
                    <div
                      key={member.squareMemberMid}
                      className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          owner
                            ? "text-sky-400"
                            : coAdmin
                              ? "rotate-180 text-violet-400"
                              : "text-transparent"
                        }
                      >
                        {owner || coAdmin ? (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                            <path d="M4 20h16l2-12-5 4-5-7-5 7-5-4 2 12Z" />
                          </svg>
                        ) : (
                          "·"
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--vy-text)]">
                        {member.displayName || uiText("名前未設定")}
                      </span>
                      {(owner || coAdmin) && (
                        <span className="shrink-0 text-[10px] text-[var(--vy-text-dim)]">
                          {owner ? uiText("管理者") : uiText("共同管理者")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {memberCursor && (
                <button
                  type="button"
                  disabled={membersLoading}
                  onClick={() => void loadMembers(memberCursor)}
                  className="mt-2 rounded-lg px-2 py-1 text-xs text-[var(--vy-accent)] disabled:opacity-50"
                >
                  {membersLoading ? uiText("読み込み中…") : uiText("続きを読み込む")}
                </button>
              )}
            </section>
          )}
          {roomToolsOpen && (
            <section className="mb-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-[var(--vy-text-dim)]">
                  {uiText("OpenChatの機能")}
                </h2>
                <button
                  type="button"
                  onClick={() => void copyInvitation()}
                  className="rounded-lg border border-[var(--vy-border)] px-2.5 py-1.5 text-xs text-[var(--vy-text)] hover:bg-[var(--vy-surface-2)]"
                >
                  {uiText("招待リンクをコピー")}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                <h3 className="text-xs font-semibold text-[var(--vy-text)]">
                  {uiText("アナウンス")}
                </h3>
                {announcementLoading ? (
                  <p className="text-xs text-[var(--vy-text-dim)]">{uiText("読み込み中…")}</p>
                ) : announcements.length === 0 ? (
                  <p className="text-xs text-[var(--vy-text-dim)]">
                    {uiText("アナウンスはありません")}
                  </p>
                ) : (
                  announcements.map((item) => (
                    <div
                      key={String(item.announcementSeq)}
                      className="flex items-start gap-2 rounded-lg bg-[var(--vy-surface-2)] p-2"
                    >
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-[var(--vy-text)]">
                        {(
                          item.contents as
                            | { textMessageAnnouncementContents?: { text?: string } }
                            | undefined
                        )?.textMessageAnnouncementContents?.text ??
                          uiText("このアナウンスの本文は表示できません")}
                      </p>
                      <button
                        type="button"
                        disabled={messageActionId === String(item.announcementSeq)}
                        onClick={() => void deleteAnnouncement(item.announcementSeq)}
                        className="shrink-0 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-400/10"
                      >
                        {uiText("削除")}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--vy-text-dim)]">
              {uiText("読み込み中…")}
            </p>
          ) : null}
          {!loading && messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--vy-text-dim)]">
              {uiText("取得できるメッセージがありません")}
            </p>
          ) : null}
          {messages.map((item, index) => {
            const message = item.message;
            if (!message?.id) return null;
            const fromMe = myMid ? message.from === myMid : message.from === "me";
            const timestamp = Number(message.createdTime ?? 0);
            const mediaKind = getSquareMediaKind(message.contentType);
            const stickerUrl = getSquareStickerUrl(message);
            const author = message.from
              ? (memberByMid.get(message.from) ?? mapMember(message.from))
              : mapMember(message.id);
            const previous = index > 0 ? messages[index - 1] : null;
            const previousFromMe = previous?.message?.from
              ? myMid
                ? previous.message.from === myMid
                : previous.message.from === "me"
              : false;
            const dayLabel = dayLabels[index];
            const showDaySeparator = index === 0 || dayLabel !== dayLabels[index - 1];
            const grouped =
              !showDaySeparator &&
              previous?.message?.from === message.from &&
              previousFromMe === fromMe;
            return (
              <div key={`${room.id}:${message.id}`} className="contents">
                {showDaySeparator && timestamp > 0 && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_12%,transparent)] px-3 py-1 text-[0.7rem] font-medium text-[var(--vy-text)] backdrop-blur">
                      {dayLabel}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    "flex w-full gap-2 px-1",
                    grouped ? "mt-0.5 vy-msg-stack-gap-tight" : "mt-3 vy-msg-stack-gap",
                    fromMe ? "flex-row-reverse" : "flex-row",
                  )}
                >
                  {!fromMe && (
                    <div className="w-8 shrink-0 self-end">
                      {!grouped && (
                        <Avatar
                          glyph={author.avatar}
                          color={author.color}
                          imageUrl={author.avatarUrl}
                          size={32}
                        />
                      )}
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex min-w-0 max-w-[78%] flex-col md:max-w-[72%]",
                      fromMe ? "items-end" : "items-start",
                    )}
                  >
                    {!fromMe && !grouped && (
                      <span
                        className="mb-1 px-1 text-xs font-semibold"
                        style={{ color: author.color }}
                      >
                        {author.name}
                      </span>
                    )}
                    <div
                      {...pressHandlers(message.id)}
                      className="vy-msg-enter relative select-none rounded-msg text-[length:inherit] leading-relaxed vy-bubble-pad shadow-sm"
                      style={{
                        background: fromMe ? "var(--vy-msg-out)" : "var(--vy-msg-in)",
                        color: fromMe ? "var(--vy-msg-out-text)" : "var(--vy-msg-in-text)",
                        borderTopRightRadius: fromMe && settings.bubbleTail ? 6 : undefined,
                        borderTopLeftRadius: !fromMe && settings.bubbleTail ? 6 : undefined,
                      }}
                    >
                      {item.threadInfo?.chatThreadMid &&
                        (item.threadInfo.threadRoot && !threadMid ? (
                          <button
                            type="button"
                            onClick={() => setThreadMid(item.threadInfo?.chatThreadMid ?? null)}
                            className="mb-1 block text-left text-[10px] text-[var(--vy-accent)] underline-offset-2 hover:underline"
                          >
                            {uiText("スレッドを開く")}
                          </button>
                        ) : (
                          <p className="mb-1 text-[10px] opacity-70">{uiText("スレッド返信")}</p>
                        ))}
                      {message.text ? (
                        <p className="vy-msg-text whitespace-pre-wrap break-words">
                          {message.text}
                        </p>
                      ) : stickerUrl ? (
                        <img
                          src={stickerUrl}
                          alt={uiText("スタンプ")}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-32 w-32 object-contain"
                        />
                      ) : !mediaKind ? (
                        <p className="vy-msg-text whitespace-pre-wrap break-words">
                          {uiText("テキスト以外のメッセージ（表示未対応）")}
                        </p>
                      ) : null}
                      {mediaKind && accountId && (
                        <SquareMediaPreview
                          accountId={accountId}
                          roomId={room.id}
                          messageId={message.id}
                          kind={mediaKind}
                        />
                      )}
                    </div>
                    <div
                      className={cn(
                        "mt-1 flex items-center gap-1.5 px-1 text-[0.7rem] text-[var(--vy-text-dim)]",
                        fromMe && "flex-row-reverse",
                      )}
                    >
                      {timestamp > 0 && <time>{formatTime(timestamp)}</time>}
                      {fromMe && <span className="opacity-60">{uiText("送信済み")}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>

      {notice && (
        <p role="status" className="px-4 pb-2 text-xs text-amber-300">
          {notice}
        </p>
      )}
      <form
        className="relative border-t border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2 md:px-6 md:py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {stickerPickerOpen && accountId && !threadMid && (
          <Suspense
            fallback={
              <div role="status" className="absolute bottom-full right-4 p-3 text-xs">
                {uiText("スタンプを読み込んでいます…")}
              </div>
            }
          >
            <StickerEmojiPanel
              accountId={accountId}
              stickerOnly
              onPickSticker={(packageId, stickerId, isPremium) => {
                void sendSticker(packageId, stickerId, isPremium);
              }}
              onPickEmoji={() => {}}
              onSendCombinationSticker={async () => {}}
            />
          </Suspense>
        )}
        <div className="vy-input-row mx-auto flex max-w-3xl items-end gap-1 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-2 py-1">
          {!threadMid && (
            <IconButton
              label={uiText("メニューを開く")}
              active={Boolean(plusMenu)}
              onClick={(event) =>
                setPlusMenu((open) => (open ? null : { x: event.clientX, y: event.clientY - 8 }))
              }
            >
              <IconPlus size={20} />
            </IconButton>
          )}
          {!threadMid && (
            <IconButton
              label={uiText("スタンプ")}
              active={stickerPickerOpen}
              onClick={() => setStickerPickerOpen((open) => !open)}
            >
              <IconSmile size={20} />
            </IconButton>
          )}
          <textarea
            value={text}
            onChange={(event) => {
              if (event.target.value !== text) operationIdRef.current = null;
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                settings.enterToSend &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={5000}
            disabled={busy}
            placeholder={text ? undefined : uiText("メッセージを入力")}
            aria-label={uiText("メッセージを入力")}
            className="vy-scroll vy-input-text max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 leading-relaxed text-[var(--vy-text)] outline-none placeholder:text-[var(--vy-text-dim)]"
          />
          <button
            type="submit"
            aria-label={uiText("送信")}
            disabled={busy || !text.trim() || (Boolean(threadMid) && !isThreadJoined)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--vy-accent-contrast)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
            style={{ background: "var(--vy-accent)" }}
          >
            <IconSend size={18} />
          </button>
        </div>
      </form>
      {plusMenu && (
        <MessageContextMenu
          x={plusMenu.x}
          y={plusMenu.y}
          items={[
            {
              label: uiText("スタンプ"),
              icon: <IconSmile size={16} />,
              onClick: () => setStickerPickerOpen(true),
            },
            {
              label: uiText("招待リンクをコピー"),
              icon: <IconCopy size={16} />,
              onClick: () => void copyInvitation(),
            },
          ]}
          onClose={() => setPlusMenu(null)}
        />
      )}
      {menu && menuMessage && (
        <MessageContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menuMessage)}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

function HeaderButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
        active
          ? "bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] text-[var(--vy-accent)]"
          : "text-[var(--vy-text-dim)] hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] hover:text-[var(--vy-text)]",
      )}
    >
      {children}
    </button>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
        active
          ? "text-[var(--vy-accent)]"
          : "text-[var(--vy-text-dim)] hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] hover:text-[var(--vy-text)]",
      )}
    >
      {children}
    </button>
  );
}
