import { memo, useEffect, useRef, useState } from "react";
import {
  useStore,
  formatTime,
  memberDisplayName,
  memberGlyph,
  type Message,
  type Chat,
} from "@/lib/store";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/vy-ui";
import { MessageContextMenu, type MenuItem } from "@/components/message-context-menu";
import { MediaLightbox } from "@/components/media-lightbox";
import { FlexMessageView } from "@/components/flex-message";
import { FlexActions } from "@/components/flex-actions";
import { RichMessageView } from "@/components/rich-message";
import { CallEventMessage } from "@/components/call-event-message";
import {
  IconReply,
  IconCopy,
  IconTrash,
  IconCheck,
  IconPlay,
  IconChevron,
  IconDownload,
  IconAtSign,
  IconPin,
} from "@/components/icons";
import { copyText, downloadUrl } from "@/utils/clipboard";
import { segmentUnicodeEmoji } from "@/utils/lineSticon";
import { lineCdnProxy, hideBrokenMedia } from "@/utils/lineMedia";
import { segmentTextWithMentions, type DraftSegment } from "@/utils/mention";

function SpoilerMedia({ src, alt, video }: { src: string; alt: string; video?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return (
      <img
        src={src}
        alt={alt}
        onError={hideBrokenMedia}
        className={cn("max-h-[360px] max-w-[240px] object-contain", video && "hidden")}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className="flex h-40 w-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--vy-border)] bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]"
      aria-label="メディアを表示"
    >
      <span className="text-2xl">👁</span>
      <span className="text-xs">画像を表示（配信者モード）</span>
    </button>
  );
}

function LinkPreviewCard({ preview }: { preview: NonNullable<Message["linkPreview"]> }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex gap-3 overflow-hidden rounded-xl border-l-2 bg-[color-mix(in_oklab,var(--vy-text)_6%,transparent)] p-2.5 transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
      style={{ borderColor: "var(--vy-accent)" }}
    >
      <span
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-2xl"
        style={{ background: "color-mix(in oklab, var(--vy-accent) 20%, transparent)" }}
        aria-hidden
      >
        {preview.thumb}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium" style={{ color: "var(--vy-accent)" }}>
          {preview.site}
        </span>
        <span className="block truncate text-sm font-semibold">{preview.title}</span>
        <span className="line-clamp-2 block text-xs opacity-80">{preview.description}</span>
      </span>
    </a>
  );
}

function formatAudioTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function AudioBubble({ src, seconds }: { src: string; seconds?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(seconds ?? 0);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setError(false);
    if (seconds != null) setDuration(seconds);
  }, [src, seconds]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || error) return;
    if (playing) el.pause();
    else void el.play().catch(() => setError(true));
  };

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="flex min-w-[220px] max-w-[280px] items-center gap-3 py-1">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration;
          if (d != null && Number.isFinite(d) && d > 0) setDuration(Math.round(d));
        }}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => setError(true)}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={error}
        aria-label={playing ? "音声を一時停止" : "音声を再生"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--vy-accent-contrast)] transition-transform hover:scale-105 disabled:opacity-40"
        style={{ background: "var(--vy-accent)" }}
      >
        {playing ? (
          <span className="flex gap-0.5" aria-hidden>
            <span className="h-3.5 w-1 rounded-sm bg-current" />
            <span className="h-3.5 w-1 rounded-sm bg-current" />
          </span>
        ) : (
          <IconPlay size={16} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--vy-text)_15%,transparent)]">
          <span
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-100"
            style={{ width: `${progress}%`, background: "var(--vy-accent)" }}
          />
        </div>
        <div className="mt-1.5 flex items-end gap-0.5 opacity-70" aria-hidden>
          {[6, 12, 8, 16, 10, 14, 7, 13, 9, 15, 6, 11, 8, 14].map((h, i) => (
            <span
              key={i}
              className="w-0.5 rounded-full bg-current"
              style={{
                height: h,
                opacity: playing && i / 14 <= progress / 100 ? 1 : 0.45,
              }}
            />
          ))}
        </div>
        <p className="mt-1 text-[0.7rem] tabular-nums opacity-80">
          {error
            ? "再生できません"
            : `${formatAudioTime(current)} / ${formatAudioTime(duration || seconds || 0)}`}
        </p>
      </div>
    </div>
  );
}

function ReplyQuote({
  author,
  snippet,
  onJump,
}: {
  author: string;
  snippet: string;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump();
      }}
      className="mb-2 w-full overflow-hidden rounded-lg border-l-2 px-2 py-1.5 text-left text-xs opacity-90 transition-colors hover:bg-[color-mix(in_oklab,var(--vy-accent)_12%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
      style={{
        borderColor: "var(--vy-accent)",
        background: "color-mix(in oklab, var(--vy-text) 8%, transparent)",
      }}
      aria-label={`${author} への返信 — 元メッセージへ移動`}
    >
      <p className="font-semibold" style={{ color: "var(--vy-accent)" }}>
        {author}
      </p>
      <p className="line-clamp-2 opacity-80">{snippet}</p>
    </button>
  );
}

/** 通常テキスト内の Unicode 絵文字を LINE サイズ感（1.15em）で一貫描画 */
function TextRuns({ value }: { value: string }) {
  const runs = segmentUnicodeEmoji(value);
  return (
    <>
      {runs.map((r, i) =>
        r.type === "emoji" ? (
          <span key={i} className="inline-block text-[1.15em] leading-none align-[-0.05em]">
            {r.value}
          </span>
        ) : (
          <span key={i}>{r.value}</span>
        ),
      )}
    </>
  );
}

/** LINE 準拠のメンション色（青 #457ed7 / @ALL は橙 #f5a623） */
const MENTION_COLOR = "#457ed7";
const MENTION_ALL_COLOR = "#e07b00";

function MentionSpan({ seg }: { seg: Extract<DraftSegment, { type: "mention" }> }) {
  const all = Boolean(seg.all);
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-[0.25em] px-0.5 align-baseline"
      style={{
        background: all ? "rgba(245,166,35,0.16)" : "rgba(69,126,215,0.14)",
        color: all ? MENTION_ALL_COLOR : MENTION_COLOR,
      }}
    >
      <IconAtSign size={11} className="shrink-0" />
      {seg.value.replace(/^@/, "")}
    </span>
  );
}

function MentionImage({ seg }: { seg: Extract<DraftSegment, { type: "sticon" }> }) {
  return (
    <img
      src={seg.url}
      alt={seg.alt}
      className="inline-block h-[1.35em] w-[1.35em] align-[-0.2em]"
      loading="lazy"
      draggable={false}
    />
  );
}

function Highlighted({
  text,
  query,
  sticons,
  mentions,
}: {
  text: string;
  query?: string;
  sticons?: import("@/utils/lineSticon").SticonResource[];
  mentions?: import("@/utils/mention").MentionInfo[];
}) {
  const segments: DraftSegment[] =
    (sticons && sticons.length > 0) || (mentions && mentions.length > 0)
      ? segmentTextWithMentions(text, sticons ?? [], mentions ?? [])
      : [{ type: "text", value: text }];

  const renderSegment = (seg: DraftSegment, i: number) => {
    if (seg.type === "sticon") return <MentionImage key={i} seg={seg} />;
    if (seg.type === "mention") return <MentionSpan key={i} seg={seg} />;
    return <TextRuns key={i} value={seg.value} />;
  };

  if (!query) {
    return <>{segments.map(renderSegment)}</>;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "sticon") return <MentionImage key={i} seg={seg} />;
        if (seg.type === "mention") return <MentionSpan key={i} seg={seg} />;
        const idx = seg.value.toLowerCase().indexOf(query.toLowerCase());
        if (idx < 0) return <TextRuns key={i} value={seg.value} />;
        return (
          <span key={i}>
            <TextRuns value={seg.value.slice(0, idx)} />
            <mark className="rounded bg-[var(--vy-accent)] px-0.5 text-[var(--vy-accent-contrast)]">
              {seg.value.slice(idx, idx + query.length)}
            </mark>
            <TextRuns value={seg.value.slice(idx + query.length)} />
          </span>
        );
      })}
    </>
  );
}

function replySnippet(m: Message): string {
  if (m.revoked) return "取り消されたメッセージ";
  if (m.kind === "image") return "写真";
  if (m.kind === "video") return "動画";
  if (m.kind === "audio") return "音声";
  if (m.kind === "sticker") return "スタンプ";
  if (m.kind === "emoji") return "絵文字";
  if (m.kind === "flex" || m.kind === "rich") return m.altText || m.text || "カード";
  if (m.kind === "call") return "通話";
  if (m.kind === "system") return m.text || "システム";
  const t = (m.text ?? "").replace(/[￼�$]/g, "").trim();
  return t || "絵文字";
}

/** スタンプ URL（/api/cdn/line?u=...android/sticker.png）→ アニメ版 URL */
function stickerAnimationUrl(url: string): string {
  let u = decodeURIComponent(url);
  u = u.replace(/\/sticker\.png$/, "/sticker_animation.png").replace(/\/android\//, "/ANDROID/");
  if (u.startsWith("http")) u = `/api/cdn/line?u=${encodeURIComponent(u)}`;
  return u;
}

// MessageReactionType → 表示絵文字（LINE 公式: NICE=2 LOVE=3 FUN=4 AMAZING=5 SAD=6 OMG=7）
export const REACTION_EMOJI: Record<number, string> = {
  2: "👍",
  3: "❤️",
  4: "😆",
  5: "🎉",
  6: "😢",
  7: "😲",
};

// 各リアクションの公式 sticon（LINE 本家の絵文字画像）: productId / sticonId
export const REACTION_STICON: Record<number, { productId: string; sticonId: string }> = {
  2: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "143" }, // NICE 👍
  3: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "165" }, // LOVE ❤️
  4: { productId: "5ac1bfd5040ab15980c9b435", sticonId: "002" }, // FUN 😆
  5: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "172" }, // AMAZING 🎉
  6: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "092" }, // SAD 😢
  7: { productId: "5ac1bfd5040ab15980c9b435", sticonId: "029" }, // OMG 😲
};

/** リアクション公式 sticon のプロキシ URL（未定義は空文字） */
export function reactionSticonUrl(type: number): string {
  const ref = REACTION_STICON[type];
  if (!ref) return "";
  return lineCdnProxy(
    `https://stickershop.line-scdn.net/sticonshop/v1/sticon/${ref.productId}/android/${ref.sticonId}.png`,
  );
}

/** メニュー等で使う小さなリアクション画像 */
function ReactionGlyph({ type }: { type: number }) {
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      <img
        src={reactionSticonUrl(type)}
        alt={REACTION_EMOJI[type] ?? ""}
        loading="lazy"
        draggable={false}
        onError={hideBrokenMedia}
        className="absolute inset-0 h-full w-full object-contain"
      />
      <span className="hidden h-full w-full items-center justify-center text-xs">
        {REACTION_EMOJI[type] ?? "…"}
      </span>
    </span>
  );
}

function ReactionBadges({
  reactions,
  myMid,
  onReact,
  side,
}: {
  reactions: NonNullable<Message["reactions"]>;
  myMid?: string;
  onReact: (type: number, mine: boolean) => void;
  side: "left" | "right";
}) {
  const byType = new Map<number, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const cur = byType.get(r.type) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.fromMid === myMid) cur.mine = true;
    byType.set(r.type, cur);
  }
  const entries = [...byType.entries()].filter(([t]) => REACTION_STICON[t]);
  if (!entries.length) return null;
  return (
    <div
      className={cn(
        "mt-1 flex flex-wrap gap-1 px-1",
        side === "right" ? "justify-end" : "justify-start",
      )}
    >
      {entries.map(([type, { count, mine }]) => (
        <button
          key={type}
          type="button"
          onClick={() => onReact(type, mine)}
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors hover:bg-[var(--vy-surface-2)]",
            mine &&
              "border-[var(--vy-accent)] bg-[color-mix(in_oklab,var(--vy-accent)_15%,transparent)]",
          )}
          style={{ borderColor: mine ? "var(--vy-accent)" : "var(--vy-border)" }}
          aria-label={mine ? "リアクションを取り消す" : "リアクション"}
        >
          <img
            src={reactionSticonUrl(type)}
            alt={REACTION_EMOJI[type]}
            loading="lazy"
            draggable={false}
            onError={hideBrokenMedia}
            className="h-4 w-4 object-contain"
          />
          <span className="hidden h-4 w-4 items-center justify-center text-sm">
            {REACTION_EMOJI[type]}
          </span>
          <span>{count}</span>
        </button>
      ))}
    </div>
  );
}

export const MessageBubble = memo(
  function MessageBubble({
    message,
    chat,
    showAvatar,
    showName,
    highlight,
  }: {
    message: Message;
    chat: Chat;
    showAvatar: boolean;
    showName: boolean;
    highlight?: string;
  }) {
    const isMe = message.authorId === "me";
    const settings = useStore((s) => s.settings);
    const streamerMode = settings.streamerMode;
    const revokeMessage = useStore((s) => s.revokeMessage);
    const retryMessage = useStore((s) => s.retryMessage);
    const markRead = useStore((s) => s.markRead);
    const setReplyTo = useStore((s) => s.setReplyTo);
    const scrollToMessage = useStore((s) => s.scrollToMessage);
    const openMemberProfile = useStore((s) => s.openMemberProfile);
    // 全メッセージ購読は再レンダーを誘発するため、返信先メッセージのみ購読
    // （find は同一オブジェクト参照を返すので、そのメッセージが変わらない限り再レンダーしない）
    const replied = useStore((s) =>
      message.replyToId ? s.messages.find((m) => m.id === message.replyToId) : undefined,
    );
    const self = useStore((s) => s.self);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [showReaders, setShowReaders] = useState(false);
    const [lightbox, setLightbox] = useState(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressFired = useRef(false);

    const author = chat.members?.find((m) => m.id === message.authorId);
    const repliedAuthor =
      replied?.authorId === "me"
        ? self.name
        : memberDisplayName(
            chat.members?.find((m) => m.id === replied?.authorId)?.name ?? "メンバー",
            streamerMode,
          );

    function openMenu(e: React.MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY });
    }

    function onTouchStart(e: React.TouchEvent) {
      if (message.revoked) return;
      const t = e.touches[0];
      longPressFired.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        if (navigator.vibrate) navigator.vibrate(12);
        setMenu({ x: t.clientX, y: t.clientY });
      }, 480);
    }
    function cancelLongPress() {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    const pressHandlers = {
      onContextMenu: openMenu,
      onTouchStart,
      onTouchEnd: cancelLongPress,
      onTouchMove: cancelLongPress,
    };

    const react = (type: number, mine: boolean) => {
      const accountId = useStore.getState().accountId;
      if (!accountId || message.id.startsWith("pending_")) return;
      // 公式アカウント（BOT）はリアクション不可
      if (chat.isOfficial) {
        window.alert("公式アカウントにはリアクションできません");
        return;
      }
      // Desktop: 古いメッセージはリアクション不可
      const ageMs = Date.now() - message.createdAt;
      if (ageMs > 14 * 24 * 60 * 60 * 1000) {
        window.alert("このメッセージは古すぎてリアクションできません");
        return;
      }
      const name = (
        { 2: "NICE", 3: "LOVE", 4: "FUN", 5: "AMAZING", 6: "SAD", 7: "OMG" } as Record<
          number,
          string
        >
      )[type];
      if (!name) return;
      // 楽観更新を先に即時反映（1クリックでバッジ表示。失敗時は次回同期で正規化）
      const store = useStore.getState();
      const myMid = store.self?.mid ?? "";
      store.setMessageReaction(message.id, mine ? "UNDO" : name, myMid);
      // 削除も同じタイプを送ってサーバ側でトグル（"UNDO" はサーバが ILLEGAL_ARGUMENT で拒否する）
      void api.line
        .react(accountId, message.id, name as "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG")
        .then((res) => {
          if (!res.ok) {
            window.alert(res.error ?? "リアクションに失敗しました");
          }
        })
        .catch(() => undefined);
    };

    const handleAnnounce = () => {
      const accountId = useStore.getState().accountId;
      if (!accountId) return;
      const text = message.text ?? message.altText ?? "";
      if (!text) return;
      const chatId = chat.id;
      void api.line.announce
        .create(accountId, chatId, text, message.id)
        .then((res) => {
          if (res.ok && res.data) {
            useStore.getState().addAnnouncement(chatId, {
              announcementSeq: res.data.announcementSeq,
              text,
              link: `line://nv/chatMsg?chatId=${chatId}&messageId=${message.id}`,
              creatorMid: useStore.getState().self?.mid ?? "",
              createdTime: Date.now(),
            });
          } else {
            window.alert("アナウンスに失敗しました");
          }
        })
        .catch(() => undefined);
    };

    const menuItems: MenuItem[] = [
      { label: "リプライ", icon: <IconReply size={16} />, onClick: () => setReplyTo(message.id) },
      ...(!chat.isOfficial
        ? [
            { label: "いいね", icon: <ReactionGlyph type={2} />, onClick: () => react(2, false) },
            { label: "愛してる", icon: <ReactionGlyph type={3} />, onClick: () => react(3, false) },
            { label: "面白い", icon: <ReactionGlyph type={4} />, onClick: () => react(4, false) },
            { label: "すごい", icon: <ReactionGlyph type={5} />, onClick: () => react(5, false) },
            { label: "悲しい", icon: <ReactionGlyph type={6} />, onClick: () => react(6, false) },
            { label: "びっくり", icon: <ReactionGlyph type={7} />, onClick: () => react(7, false) },
          ]
        : []),
      ...(message.text || message.altText
        ? [
            {
              label: "コピー",
              icon: <IconCopy size={16} />,
              onClick: () => void copyText(message.text ?? message.altText ?? ""),
            },
          ]
        : []),
      ...(message.kind === "sticker" && message.sticker?.startsWith("/api/")
        ? [
            {
              label: "ダウンロード",
              icon: <IconDownload size={16} />,
              ...(message.stickerAnimated
                ? {
                    children: [
                      {
                        label: "アニメーション画像",
                        icon: <IconDownload size={16} />,
                        onClick: () =>
                          downloadUrl(
                            stickerAnimationUrl(message.sticker!),
                            `sticker_${message.id}.png`,
                          ),
                      },
                      {
                        label: "通常画像",
                        icon: <IconDownload size={16} />,
                        onClick: () => downloadUrl(message.sticker!, `sticker_${message.id}.png`),
                      },
                    ],
                  }
                : {
                    onClick: () => downloadUrl(message.sticker!, `sticker_${message.id}.png`),
                  }),
            },
          ]
        : []),
      ...((message.kind === "image" || message.kind === "video") && message.imageSrc
        ? [
            {
              label: message.kind === "video" ? "動画をダウンロード" : "画像をダウンロード",
              icon: <IconDownload size={16} />,
              onClick: () =>
                downloadUrl(
                  message.imageSrc!.replace(/preview=1/, "preview=0"),
                  `vyline_${message.id}.${message.kind === "video" ? "mp4" : "jpg"}`,
                ),
            },
          ]
        : []),
      ...(!isMe && !message.read
        ? [
            {
              label: "既読にする",
              icon: <IconCheck size={16} />,
              onClick: () => markRead(message.id),
            },
          ]
        : []),
      ...(isMe &&
      !message.revoked &&
      message.status !== "sending" &&
      !message.id.startsWith("pending_")
        ? [
            {
              label: "送信を取り消し",
              icon: <IconTrash size={16} />,
              onClick: () => revokeMessage(message.id),
              danger: true,
            },
          ]
        : []),
      ...(chat.type === "group" && (message.text || message.altText)
        ? [
            {
              label: "アナウンスを追加",
              icon: <IconPin size={16} />,
              onClick: handleAnnounce,
            },
          ]
        : []),
    ];

    const readReceipt = (() => {
      if (!isMe || message.revoked) return null;
      if (message.status === "sending") return <span className="opacity-60">送信中…</span>;
      if (message.status === "failed")
        return (
          <button
            type="button"
            className="cursor-pointer underline decoration-dotted underline-offset-2 text-[var(--vy-danger)]"
            onClick={(e) => {
              e.stopPropagation();
              void retryMessage(message.id);
            }}
          >
            送信失敗 · 再送
          </button>
        );
      if (!message.read) return <span className="opacity-60">送信済み</span>;
      if (chat.type === "group") {
        const count = message.readBy?.length ?? 0;
        return (
          <span className="flex items-center gap-1">
            <span style={{ color: count > 0 ? "var(--vy-accent)" : undefined }}>
              {count > 0 ? `既読 ${count}` : "送信済み"}
            </span>
          </span>
        );
      }
      return <span style={{ color: "var(--vy-accent)" }}>既読</span>;
    })();

    const readers =
      chat.type === "group" && message.readBy
        ? message.readBy.map((id) => ({
            id,
            name: memberDisplayName(
              chat.members?.find((m) => m.id === id)?.name ?? id,
              streamerMode,
            ),
          }))
        : [];

    const canReaderList =
      isMe &&
      chat.type === "group" &&
      settings.showReaderList &&
      readers.length > 0 &&
      message.read;

    if (message.kind === "call" && !message.revoked) {
      return <CallEventMessage meta={message.callMeta} isMe={isMe} />;
    }

    if (message.kind === "system" && !message.revoked) {
      return (
        <div className="my-1 flex w-full justify-center px-1">
          <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-3 py-1 text-center text-[0.7rem] text-[var(--vy-text-dim)]">
            {message.text || "システムメッセージ"}
          </span>
        </div>
      );
    }

    const metaLine = !message.revoked && (
      <div
        className={cn(
          "mt-1 flex items-center gap-2 px-1 text-[0.7rem] text-[var(--vy-text-dim)]",
          isMe ? "flex-row-reverse" : "flex-row",
        )}
      >
        <span>{formatTime(message.createdAt)}</span>
        {readReceipt}
        {canReaderList && (
          <button
            type="button"
            onClick={() => setShowReaders((v) => !v)}
            className="flex items-center gap-0.5 transition-colors hover:text-[var(--vy-text)]"
            aria-expanded={showReaders}
          >
            既読者
            <IconChevron
              size={12}
              className={cn("transition-transform", showReaders && "rotate-90")}
            />
          </button>
        )}
      </div>
    );

    const readerList = showReaders && readers.length > 0 && (
      <div className="vy-fade-in mt-1 flex flex-wrap gap-1.5 px-1">
        {readers.map((r) => {
          const mem = chat.members?.find((m) => m.id === r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => openMemberProfile(chat.id, r.id)}
              className="flex items-center gap-1 rounded-full bg-[var(--vy-surface-2)] px-2 py-0.5 text-[0.7rem] text-[var(--vy-text-dim)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-accent)_20%,var(--vy-surface-2))] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
            >
              <Avatar
                glyph={memberGlyph(mem?.avatar ?? "•", streamerMode)}
                color={mem?.color ?? "#888"}
                size={16}
                imageUrl={streamerMode ? undefined : mem?.avatarUrl}
              />
              {r.name}
            </button>
          );
        })}
      </div>
    );

    const replyQuote = replied && (
      <ReplyQuote
        author={repliedAuthor}
        snippet={replySnippet(replied)}
        onJump={() => scrollToMessage(replied.id)}
      />
    );

    return (
      <div className={cn("flex w-full gap-2 px-1", isMe ? "flex-row-reverse" : "flex-row")}>
        {!isMe && chat.type === "group" && (
          <div className="w-8 shrink-0 self-end">
            {showAvatar && author && (
              <button
                type="button"
                onClick={() => openMemberProfile(chat.id, author.id)}
                aria-label={`${memberDisplayName(author.name, streamerMode)} のプロフィール`}
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              >
                <Avatar
                  glyph={memberGlyph(author.avatar, streamerMode)}
                  color={author.color}
                  size={32}
                  imageUrl={streamerMode ? undefined : author.avatarUrl}
                />
              </button>
            )}
          </div>
        )}

        <div
          className={cn(
            "flex flex-col",
            message.kind === "flex" || message.kind === "rich"
              ? "max-w-[min(100%,360px)]"
              : "max-w-[74%]",
            isMe ? "items-end" : "items-start",
          )}
        >
          {showName && !isMe && chat.type === "group" && author && (
            <button
              type="button"
              onClick={() => openMemberProfile(chat.id, author.id)}
              className="mb-1 px-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              style={{ color: streamerMode ? "var(--vy-text-dim)" : author.color }}
            >
              {memberDisplayName(author.name, streamerMode)}
            </button>
          )}

          {message.revoked ? (
            settings.keepRevokedMessages && message.revokedText ? (
              <div
                className="rounded-2xl border border-dashed px-4 py-2 text-sm opacity-90"
                style={{ borderColor: "var(--vy-border)" }}
              >
                <p className="mb-1 text-xs italic opacity-70">
                  {isMe
                    ? "あなたが送信を取り消しました（元の内容をローカルに保持）"
                    : "送信取り消しされました（元の内容をローカルに保持）"}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.revokedText}</p>
              </div>
            ) : (
              <div
                className="rounded-2xl border border-dashed px-4 py-2 text-sm italic opacity-70"
                style={{ borderColor: "var(--vy-border)" }}
              >
                {isMe
                  ? "あなたがメッセージの送信を取り消しました"
                  : "メッセージの送信が取り消されました"}
              </div>
            )
          ) : message.kind === "sticker" ? (
            <button
              type="button"
              {...pressHandlers}
              className={cn(
                "vy-pop-in cursor-default",
                message.stickerSticky && "relative flex w-full justify-center py-2",
              )}
              aria-label="スタンプ"
            >
              {replyQuote}
              {message.stickerSticky && (
                <span className="absolute -top-1 left-1 rounded-full bg-[color-mix(in_oklab,var(--vy-text)_15%,transparent)] px-1.5 py-0.5 text-[0.6rem] text-[var(--vy-text-dim)]">
                  くっつき
                </span>
              )}
              {message.sticker &&
              (message.sticker.startsWith("http") || message.sticker.startsWith("/api/")) ? (
                <img
                  src={
                    message.stickerAnimated ? stickerAnimationUrl(message.sticker) : message.sticker
                  }
                  alt="スタンプ"
                  onError={hideBrokenMedia}
                  className={cn(
                    "h-32 w-32 object-contain",
                    message.stickerSticky && "drop-shadow-md",
                  )}
                  draggable={false}
                />
              ) : (
                <span className="text-7xl leading-none">{message.sticker || "🎴"}</span>
              )}
            </button>
          ) : message.kind === "emoji" ? (
            <button
              type="button"
              {...pressHandlers}
              className="vy-pop-in cursor-default text-6xl leading-none"
              aria-label="絵文字"
            >
              {replyQuote}
              {message.sticons?.length ? (
                <Highlighted
                  text={message.text ?? ""}
                  sticons={message.sticons}
                  mentions={message.mentions}
                />
              ) : (
                message.text
              )}
            </button>
          ) : message.kind === "flex" ? (
            <div {...pressHandlers} className="vy-msg-enter max-w-[min(100%,340px)]">
              {replyQuote}
              {message.flexJson ? (
                <FlexMessageView
                  container={message.flexJson}
                  altText={message.altText || message.text}
                />
              ) : (
                <div className="rounded-xl bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
                  {message.altText || "Flexメッセージ"}
                </div>
              )}
              <FlexActions flexJson={message.flexJson} chatId={chat.id} />
            </div>
          ) : message.kind === "rich" ? (
            <div {...pressHandlers} className="vy-msg-enter">
              {replyQuote}
              <RichMessageView
                imageUrl={message.richImageUrl}
                markup={message.richMarkup}
                altText={message.altText || message.text}
              />
            </div>
          ) : message.kind === "location" ? (
            <div
              {...pressHandlers}
              className="vy-msg-enter max-w-[280px] overflow-hidden rounded-msg shadow-sm"
            >
              {replyQuote}
              {message.location?.latitude != null && message.location?.longitude != null ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${message.location.latitude},${message.location.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-32 w-full bg-cover bg-center"
                  style={{
                    backgroundImage: `url(https://maps.googleapis.com/maps/api/staticmap?center=${message.location.latitude},${message.location.longitude}&zoom=15&size=280x128&markers=color:red%7C${message.location.latitude},${message.location.longitude}&key=)`,
                  }}
                  aria-label="地図を開く"
                />
              ) : null}
              <div className="bg-[var(--vy-msg-in)] px-3 py-2 text-[var(--vy-msg-in-text)]">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <IconPin size={15} /> {message.location?.title || "位置情報"}
                </p>
                {message.location?.address && (
                  <p className="mt-0.5 text-xs text-[var(--vy-text-dim)]">
                    {message.location.address}
                  </p>
                )}
                {message.location?.latitude != null && message.location?.longitude != null && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${message.location.latitude},${message.location.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-medium"
                    style={{ color: "var(--vy-accent)" }}
                  >
                    地図を開く
                  </a>
                )}
              </div>
            </div>
          ) : message.kind === "contact" ? (
            <div
              {...pressHandlers}
              className="vy-msg-enter w-[240px] overflow-hidden rounded-msg shadow-sm"
            >
              {replyQuote}
              <div className="flex items-center gap-3 bg-[var(--vy-msg-in)] px-3 py-3 text-[var(--vy-msg-in-text)]">
                {message.contact?.thumbnailUrl ? (
                  <img
                    src={message.contact.thumbnailUrl}
                    alt=""
                    onError={hideBrokenMedia}
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--vy-accent)] text-lg font-bold text-white">
                    {(message.contact?.name || "?").charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {message.contact?.name || "連絡先"}
                  </p>
                  <p className="text-[0.65rem] text-[var(--vy-text-dim)]">連絡先が共有されました</p>
                </div>
              </div>
            </div>
          ) : (
            <div
              {...pressHandlers}
              className={cn(
                "vy-msg-enter vy-bubble-pad relative select-none rounded-msg text-[length:inherit] leading-relaxed shadow-sm",
              )}
              style={{
                background: isMe ? "var(--vy-msg-out)" : "var(--vy-msg-in)",
                color: isMe ? "var(--vy-msg-out-text)" : "var(--vy-msg-in-text)",
                borderTopRightRadius: isMe && settings.bubbleTail ? 6 : undefined,
                borderTopLeftRadius: !isMe && settings.bubbleTail ? 6 : undefined,
              }}
            >
              {replyQuote}
              {(message.kind === "image" || message.kind === "video") &&
                message.imageSrc &&
                (streamerMode ? (
                  <SpoilerMedia
                    src={message.imageSrc}
                    alt={message.kind === "video" ? "動画サムネイル" : "送信された画像"}
                    video={message.kind === "video"}
                  />
                ) : (
                  <button
                    type="button"
                    className="group relative block overflow-hidden rounded-xl text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightbox(true);
                    }}
                    aria-label={message.kind === "video" ? "動画を拡大" : "画像を拡大"}
                  >
                    {message.kind === "video" ? (
                      <div className="relative">
                        <img
                          src={message.imageSrc}
                          alt="動画サムネイル"
                          onError={hideBrokenMedia}
                          className="h-auto w-[260px] max-w-full object-cover"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white">
                            <IconPlay size={22} />
                          </span>
                        </span>
                      </div>
                    ) : (
                      <img
                        src={message.imageSrc}
                        alt="送信された画像"
                        onError={hideBrokenMedia}
                        className="max-h-[360px] max-w-[240px] object-contain transition-opacity group-hover:opacity-95"
                      />
                    )}
                  </button>
                ))}
              {message.kind === "audio" && message.audioSrc && (
                <AudioBubble src={message.audioSrc} seconds={message.audioSeconds} />
              )}
              {message.text && message.kind === "text" && (
                <p className="vy-msg-text whitespace-pre-wrap break-words">
                  <Highlighted
                    text={message.text}
                    query={highlight}
                    sticons={message.sticons}
                    mentions={message.mentions}
                  />
                </p>
              )}
              {message.linkPreview && !streamerMode && (
                <LinkPreviewCard preview={message.linkPreview} />
              )}
            </div>
          )}

          {metaLine}
          {readerList}
          {message.reactions && message.reactions.length > 0 && !message.revoked && (
            <ReactionBadges
              reactions={message.reactions}
              myMid={self?.mid ?? ""}
              onReact={react}
              side={isMe ? "right" : "left"}
            />
          )}
        </div>

        {menu && (
          <MessageContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onClose={() => setMenu(null)}
          />
        )}
        {lightbox && message.imageSrc && (
          <MediaLightbox
            src={message.imageSrc}
            kind={message.kind === "video" ? "video" : "image"}
            onClose={() => setLightbox(false)}
          />
        )}
      </div>
    );
  },
  (prev, next) => {
    // 下書き/既読プレビュー更新等で chat オブジェクト自体は変わっても、描画に関わるフィールドが
    // 同じなら再レンダーしない（大量メッセージ表示時の不要な再描画を防ぐ）
    return (
      prev.message === next.message &&
      prev.showAvatar === next.showAvatar &&
      prev.showName === next.showName &&
      prev.highlight === next.highlight &&
      prev.chat.type === next.chat.type &&
      prev.chat.isOfficial === next.chat.isOfficial &&
      prev.chat.members === next.chat.members
    );
  },
);
