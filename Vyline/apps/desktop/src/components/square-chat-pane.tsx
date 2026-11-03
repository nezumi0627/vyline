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
  const endRef = useRef<HTMLDivElement>(null);
  const operationIdRef = useRef<string | null>(null);

  const refresh = useCallback(
    async (initial = false) => {
      if (!accountId || !room.id) return;
      try {
        const result = await api.line.squareMessages(accountId, room.id, 100);
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
    [accountId, room.id],
  );

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
    if (!accountId || !value || busy) return;
    setBusy(true);
    setNotice("");
    try {
      operationIdRef.current ??= crypto.randomUUID();
      const result = await api.line.squareSendMessage(
        accountId,
        room.id,
        operationIdRef.current,
        value,
      );
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
        <Avatar glyph={(room.name ?? "O").slice(0, 1)} color="#635bff" size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--vy-text)]">
            {room.name || uiText("名前未設定のルーム")}
          </p>
          <p className="truncate text-xs text-[var(--vy-text-dim)]">
            {squareName || uiText("オープンチャット")} · {uiText("OpenChat")}
          </p>
        </div>
        <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold text-indigo-300">
          BETA
        </span>
      </header>

      <div className="vy-scroll flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
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
            return (
              <article
                key={`${room.id}:${message.id}`}
                className={`flex ${fromMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[min(78%,640px)] rounded-2xl px-3.5 py-2.5 ${fromMe ? "bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]" : "bg-[var(--vy-surface-2)] text-[var(--vy-text)]"}`}
                >
                  {item.threadInfo?.chatThreadMid && (
                    <p className="mb-1 text-[10px] opacity-70">
                      {uiText(
                        item.threadInfo.threadRoot ? "スレッドの親メッセージ" : "スレッド返信",
                      )}{" "}
                      · {item.threadInfo.chatThreadMid.slice(0, 8)}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {message.text || uiText("テキスト以外のメッセージ（表示未対応）")}
                  </p>
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
            disabled={busy || !text.trim()}
            className="rounded-xl bg-[var(--vy-accent)] px-4 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-40"
          >
            {busy ? uiText("送信中…") : uiText("送信")}
          </button>
        </div>
      </form>
    </section>
  );
}
