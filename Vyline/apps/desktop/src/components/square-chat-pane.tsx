import { tr as uiText } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/vy-ui";
import { IconChevron } from "@/components/icons";

type SquareMessage = {
  message?: {
    id: string;
    text?: string;
    createdTime?: number | string;
    from?: string;
    contentType?: number | string;
  };
  threadInfo?: { chatThreadMid?: string; threadRoot?: boolean };
  state?: unknown;
};

type SquareRoomMember = {
  squareMemberMid: string;
  displayName: string;
  profileImageObsHash?: string;
  role: string | number;
};

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
  const [messages, setMessages] = useState<SquareMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [threadMid, setThreadMid] = useState<string | null>(null);
  const [threadMembershipState, setThreadMembershipState] = useState<number | string | null>(null);
  const [joiningThread, setJoiningThread] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<SquareRoomMember[]>([]);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const operationIdRef = useRef<string | null>(null);

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
        setMembers((current) => (cursor ? [...current, ...result.members] : result.members));
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

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-[var(--vy-chat-bg)]">
      <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 pl-14">
        <button
          type="button"
          className="mr-1 rounded-lg p-2 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] md:hidden"
          onClick={onBack}
          aria-label={uiText("戻る")}
        >
          <IconChevron size={18} />
        </button>
        {threadMid && (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs text-[var(--vy-accent)] hover:bg-[var(--vy-surface-2)]"
            onClick={() => setThreadMid(null)}
          >
            {uiText("スレッドから戻る")}
          </button>
        )}
        <Avatar glyph={(room.name ?? "O").slice(0, 1)} color="#635bff" size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--vy-text)]">
            {room.name || uiText("名前未設定のルーム")}
          </p>
          <p className="truncate text-xs text-[var(--vy-text-dim)]">
            {threadMid ? uiText("スレッド") : squareName || uiText("オープンチャット")} ·{" "}
            {uiText("OpenChat")}
          </p>
        </div>
        <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold text-indigo-300">
          BETA
        </span>
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
        <button
          type="button"
          onClick={() => {
            const next = !membersOpen;
            setMembersOpen(next);
            if (next && members.length === 0) void loadMembers();
          }}
          className="rounded-lg border border-[var(--vy-border)] px-2.5 py-1.5 text-xs text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
        >
          {uiText("メンバー")}
        </button>
      </header>

      <div className="vy-scroll flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
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
          {messages.map((item) => {
            const message = item.message;
            if (!message?.id) return null;
            const fromMe = message.from === "me";
            const timestamp = Number(message.createdTime ?? 0);
            const mediaKind = getSquareMediaKind(message.contentType);
            return (
              <article
                key={`${room.id}:${message.id}`}
                className={`flex ${fromMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[min(78%,640px)] rounded-2xl px-3.5 py-2.5 ${fromMe ? "bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]" : "bg-[var(--vy-surface-2)] text-[var(--vy-text)]"}`}
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
                    <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
                  ) : !mediaKind ? (
                    <p className="whitespace-pre-wrap break-words text-sm">
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
                  {timestamp > 0 && (
                    <time className="mt-1 block text-right text-[10px] opacity-60">
                      {new Date(timestamp).toLocaleTimeString()}
                    </time>
                  )}
                </div>
              </article>
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
        className="border-t border-[var(--vy-border)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-2">
          <textarea
            value={text}
            onChange={(event) => {
              if (event.target.value !== text) operationIdRef.current = null;
              setText(event.target.value);
            }}
            rows={1}
            maxLength={5000}
            placeholder={uiText("OpenChatにメッセージを送信")}
            className="max-h-32 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-[var(--vy-text)] outline-none"
          />
          <button
            type="submit"
            disabled={busy || !text.trim() || (Boolean(threadMid) && !isThreadJoined)}
            className="rounded-xl bg-[var(--vy-accent)] px-4 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-40"
          >
            {busy ? uiText("送信中…") : uiText("送信")}
          </button>
        </div>
      </form>
    </section>
  );
}
