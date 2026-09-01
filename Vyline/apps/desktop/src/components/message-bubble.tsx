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
import { EditMessageDialog } from "@/components/edit-message-dialog";
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
  IconHeart,
  IconClose,
  IconEdit,
} from "@/components/icons";
import { copyText, downloadUrl } from "@/utils/clipboard";
import {
  segmentTextWithSticon,
  segmentUnicodeEmoji,
  type SticonResource,
} from "@/utils/lineSticon";
import { lineCdnProxy, hideBrokenMedia, lineStickerUrl } from "@/utils/lineMedia";
import { segmentTextWithMentions, type DraftSegment } from "@/utils/mention";
import { splitTextLinks } from "@/lib/linkifyText";
import { isMobileInteraction } from "@/lib/interactionEnvironment";

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

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findPostRecord(value: unknown): Record<string, unknown> | null {
  const root = objectRecord(value);
  if (!root) return null;
  const result = objectRecord(root.result) ?? root;
  const post = objectRecord(result.post) ?? objectRecord(result.item) ?? result;
  return objectRecord(post.contents) ?? post;
}

function findAlbumRecord(value: unknown, albumId: string): Record<string, unknown> | null {
  const root = objectRecord(value);
  const result = objectRecord(root?.result) ?? root;
  const albums = result?.albums;
  if (!Array.isArray(albums)) return null;
  return (
    (albums.find((album) => {
      const record = objectRecord(album);
      return String(record?.albumId ?? record?.id ?? "") === albumId;
    }) as Record<string, unknown> | undefined) ?? null
  );
}

function noteSticons(post: Record<string, unknown> | null): SticonResource[] {
  const raw = post?.sticonMetas;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const record = objectRecord(item);
    const productId = String(record?.productId ?? record?.product_id ?? "");
    const sticonId = String(record?.sticonId ?? record?.sticon_id ?? record?.id ?? "");
    if (!productId || !sticonId) return [];
    const S = Number(record?.S ?? record?.start);
    const E = Number(record?.E ?? record?.end);
    return [
      {
        productId,
        sticonId,
        ...(Number.isFinite(S) ? { S } : {}),
        ...(Number.isFinite(E) ? { E } : {}),
        ...(typeof record?.alt === "string" ? { alt: record.alt } : {}),
      },
    ];
  });
}

function NoteText({ text, sticons }: { text: string; sticons: SticonResource[] }) {
  if (!sticons.length) return <Highlighted text={text} />;
  return (
    <>
      {segmentTextWithSticon(text, sticons).map((segment, index) =>
        segment.type === "sticon" ? (
          <img
            key={`${segment.url}-${index}`}
            src={segment.url}
            alt={segment.alt}
            className="mx-0.5 inline-block h-6 w-6 align-text-bottom object-contain"
            onError={hideBrokenMedia}
          />
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}

function PostNotificationCard({
  message,
  accountId,
}: {
  message: Message;
  accountId?: string;
}) {
  const notification = message.postNotification;
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!notification || notification.kind === "unknown") return null;

  const load = async () => {
    if (!accountId || loading || detail) return;
    setLoading(true);
    setError(null);
    try {
      const raw =
        notification.kind === "note" && notification.homeId && notification.postId
          ? await api.line.notes.get(accountId, notification.homeId, notification.postId)
          : notification.kind === "album" && notification.albumId
            ? await api.line.albums.list(accountId)
            : null;
      setDetail(
        notification.kind === "album" && notification.albumId
          ? findAlbumRecord(raw, notification.albumId)
          : objectRecord(raw),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const post = notification.kind === "note" ? findPostRecord(detail) : null;
  const text = typeof post?.text === "string" ? post.text : undefined;
  const stickers = Array.isArray(post?.stickers) ? post.stickers : [];
  const media = Array.isArray(post?.media) ? post.media : [];
  const sticons = noteSticons(post);
  const sharedPostId = typeof post?.sharedPostId === "string" ? post.sharedPostId : undefined;

  return (
    <div className="my-1 flex w-full justify-center px-2">
      <button
        type="button"
        onClick={() => void load()}
        className="w-full max-w-[360px] overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] text-left shadow-sm transition-colors hover:bg-[var(--vy-surface-2)]"
      >
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--vy-accent)]">
            {notification.kind === "album" ? "Album" : "Note"}
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--vy-text)]">
            {notification.kind === "album"
              ? notification.title || "アルバムが更新されました"
              : "ノートが作成されました"}
          </p>
          {notification.kind === "album" && notification.mediaCount != null && (
            <p className="mt-1 text-xs text-[var(--vy-text-dim)]">
              {notification.mediaCount}件のメディア
            </p>
          )}
          {loading && <p className="mt-2 text-xs text-[var(--vy-text-dim)]">読み込み中…</p>}
          {error && <p className="mt-2 text-xs text-[var(--vy-danger)]">{error}</p>}
          {text && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--vy-text)]">
              <NoteText text={text} sticons={sticons} />
            </p>
          )}
          {stickers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {stickers.slice(0, 6).map((value, index) => {
                const sticker = objectRecord(value);
                const id = String(sticker?.id ?? sticker?.stickerId ?? "");
                return id ? (
                  <img
                    key={`${id}-${index}`}
                    src={lineStickerUrl(id)}
                    alt="スタンプ"
                    className="h-20 w-20 object-contain"
                    onError={hideBrokenMedia}
                  />
                ) : null;
              })}
            </div>
          )}
          {media.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
              {media.slice(0, 6).map((value, index) => {
                const item = objectRecord(value);
                const objectId = String(item?.objectId ?? "");
                const type = String(item?.type ?? "PHOTO").toUpperCase();
                if (!objectId) return null;
                const src = lineCdnProxy(
                  `https://obs.line-apps.com/r/myhome/h/${encodeURIComponent(objectId)}`,
                );
                return type === "VIDEO" ? (
                  <video
                    key={`${objectId}-${index}`}
                    src={src}
                    controls
                    preload="metadata"
                    className="max-h-48 w-full bg-black object-contain"
                  />
                ) : (
                  <img
                    key={`${objectId}-${index}`}
                    src={src}
                    alt="ノート画像"
                    className="max-h-48 w-full object-cover"
                    onError={hideBrokenMedia}
                  />
                );
              })}
            </div>
          )}
          {sharedPostId && (
            <p className="mt-2 rounded-lg bg-[var(--vy-surface-2)] px-3 py-2 text-xs text-[var(--vy-text-dim)]">
              共有ノート: {sharedPostId}
            </p>
          )}
          {!detail && !loading && (
            <p className="mt-2 text-xs text-[var(--vy-text-dim)]">クリックして内容を表示</p>
          )}
        </div>
      </button>
    </div>
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

function HighlightedTextRuns({ value, query }: { value: string; query?: string }) {
  const needle = query?.trim();
  if (!needle) return <TextRuns value={value} />;
  const lower = value.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const pieces: React.ReactNode[] = [];
  let offset = 0;
  let matchIndex = lower.indexOf(lowerNeedle);
  while (matchIndex >= 0) {
    if (matchIndex > offset) {
      pieces.push(<TextRuns key={`plain-${offset}`} value={value.slice(offset, matchIndex)} />);
    }
    pieces.push(
      <mark
        key={`match-${matchIndex}`}
        className="rounded bg-[var(--vy-accent)] px-0.5 text-[var(--vy-accent-contrast)]"
      >
        {value.slice(matchIndex, matchIndex + needle.length)}
      </mark>,
    );
    offset = matchIndex + needle.length;
    matchIndex = lower.indexOf(lowerNeedle, offset);
  }
  if (offset < value.length) {
    pieces.push(<TextRuns key={`plain-${offset}`} value={value.slice(offset)} />);
  }
  return <>{pieces}</>;
}

function LinkedTextRuns({ value, query }: { value: string; query?: string }) {
  return (
    <>
      {splitTextLinks(value).map((segment, index) =>
        segment.type === "link" ? (
          <a
            key={`${segment.href}-${index}`}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            draggable={false}
            className="break-all underline decoration-current/50 underline-offset-2 hover:decoration-current"
            onClick={(event) => event.stopPropagation()}
          >
            <HighlightedTextRuns value={segment.value} query={query} />
          </a>
        ) : (
          <HighlightedTextRuns key={index} value={segment.value} query={query} />
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

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "sticon") return <MentionImage key={index} seg={segment} />;
        if (segment.type === "mention") return <MentionSpan key={index} seg={segment} />;
        return <LinkedTextRuns key={index} value={segment.value} query={query} />;
      })}
    </>
  );
}

function replySnippet(m: Message): string {
  if (m.messageState.startsWith("revoked")) {
    if (m.revokedSnapshot) return `取り消し済み: ${replySnippet(m.revokedSnapshot)}`;
    return "取り消し済みのメッセージ";
  }
  if (m.kind === "image") return "写真";
  if (m.kind === "video") return "動画";
  if (m.kind === "audio") return "音声";
  if (m.kind === "file") return m.file?.name || "ファイル";
  if (m.kind === "sticker") return "スタンプ";
  if (m.kind === "emoji") return "絵文字";
  if (m.kind === "flex" || m.kind === "rich") return m.altText || m.text || "カード";
  if (m.kind === "call") return "通話";
  if (m.kind === "system") return m.text || "システム";
  const t = (m.text ?? "").replace(/[￼�$]/g, "").trim();
  return t || "絵文字";
}

/** スタンプ URL（/api/cdn/line?u=...android/sticker.png）→ アニメ版 URL */
function stickerAnimationUrl(url?: string): string {
  if (!url) return "";
  let u = decodeURIComponent(url);
  u = u.replace(/\/sticker\.png$/, "/sticker_animation.png").replace(/\/android\//, "/ANDROID/");
  if (u.startsWith("http")) u = `/api/cdn/line?u=${encodeURIComponent(u)}`;
  return u;
}

function isStickerImageSrc(src?: string): boolean {
  return Boolean(
    src &&
      (src.startsWith("http") ||
        src.startsWith("/api/") ||
        src.startsWith("/demo/") ||
        src.startsWith("data:")),
  );
}

// MessageReactionType → 表示絵文字（LINE 公式: NICE=2 LOVE=3 FUN=4 AMAZING=5 SAD=6 OMG=7）
const REACTION_EMOJI: Record<number, string> = {
  2: "👍",
  3: "❤️",
  4: "😆",
  5: "🎉",
  6: "😢",
  7: "😲",
};

// 各リアクションの公式 sticon（LINE 本家の絵文字画像）: productId / sticonId
const REACTION_STICON: Record<number, { productId: string; sticonId: string }> = {
  2: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "143" }, // NICE 👍
  3: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "165" }, // LOVE ❤️
  4: { productId: "5ac1bfd5040ab15980c9b435", sticonId: "002" }, // FUN 😆
  5: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "172" }, // AMAZING 🎉
  6: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "092" }, // SAD 😢
  7: { productId: "5ac1bfd5040ab15980c9b435", sticonId: "029" }, // OMG 😲
};

/** リアクション公式 sticon のプロキシ URL（未定義は空文字） */
function reactionSticonUrl(type: number): string {
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
    mediaGroup,
  }: {
    message: Message;
    chat: Chat;
    showAvatar: boolean;
    showName: boolean;
    highlight?: string;
    mediaGroup?: Message[];
  }) {
    const isMe = message.authorId === "me";
    const accountId = useStore((s) => s.accountId);
    const settings = useStore((s) => s.settings);
    const streamerMode = settings.streamerMode;
    const revokeMessage = useStore((s) => s.revokeMessage);
    const restoreRevokedMessage = useStore((s) => s.restoreRevokedMessage);
    const fetchMessageHistory = useStore((s) => s.fetchMessageHistory);
    const editMessage = useStore((s) => s.editMessage);
    const retryMessage = useStore((s) => s.retryMessage);
    const markRead = useStore((s) => s.markRead);
    const markChatRead = useStore((s) => s.markChatRead);
    const readDisabled = useStore((s) => Boolean(s.readDisabledMids[chat.id]));
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
    const [editing, setEditing] = useState(false);
    const [showOriginal, setShowOriginal] = useState(false);
    const [showReaders, setShowReaders] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<NonNullable<Message["history"]>>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [lightbox, setLightbox] = useState(false);
    const [revokedFallbackText, setRevokedFallbackText] = useState<string | null>(null);
    const [lightboxMedia, setLightboxMedia] = useState<Message | null>(null);
    const [partialCopyOpen, setPartialCopyOpen] = useState(false);
    const [swipeOffset, setSwipeOffset] = useState(0);
    const partialCopyRef = useRef<HTMLTextAreaElement>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressFired = useRef(false);
    const touchGesture = useRef<{
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      axis: "pending" | "horizontal" | "vertical";
    } | null>(null);
    const isRevoked =
      message.messageState.startsWith("revoked") ||
      Boolean(message.revokedSnapshot) ||
      Boolean(
        message.history?.length &&
          message.history.some(
            (h) => h.state === "normal" || h.state === "edited" || h.contentType === "UNSENT",
          ),
      );
    const displayMessage = isRevoked && message.revokedSnapshot ? message.revokedSnapshot : message;
    const revokedHistoryText =
      message.history && message.history.length > 0
        ? ([...message.history]
            .reverse()
            .find((h) => h.state === "normal" || h.state === "edited")
            ?.text?.trim() ?? null)
        : null;
    const revokedBodyText =
      revokedFallbackText ?? revokedHistoryText ?? displayMessage.text?.trim() ?? null;
    const revokedDisplayMessage =
      displayMessage.kind === "text" ||
      displayMessage.kind === "emoji" ||
      displayMessage.kind === "system"
        ? {
            ...displayMessage,
            text: revokedBodyText || "（内容なし）",
          }
        : displayMessage;

    useEffect(() => {
      let cancelled = false;
      if (!isRevoked) {
        setRevokedFallbackText(null);
        return () => {
          cancelled = true;
        };
      }
      const snapshotText = message.revokedSnapshot?.text?.trim();
      if (snapshotText) {
        setRevokedFallbackText(null);
        return () => {
          cancelled = true;
        };
      }
      void (async () => {
        try {
          const history = await fetchMessageHistory(message.chatId, message.id);
          const last = [...(history ?? [])]
            .reverse()
            .find((h) => h.state === "normal" || h.state === "edited");
          if (!cancelled) setRevokedFallbackText(last?.text ?? null);
        } catch {
          if (!cancelled) setRevokedFallbackText(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      fetchMessageHistory,
      message.chatId,
      message.id,
      message.messageState,
      isRevoked,
      message.revokedSnapshot?.text,
    ]);

    const author = chat.members?.find((m) => m.id === message.authorId);
    const mediaItems = mediaGroup?.filter((item) => item.kind === "image" && item.imageSrc) ?? [];
    const repliedAuthor =
      replied?.authorId === "me"
        ? self.name
        : memberDisplayName(
            chat.members?.find((m) => m.id === replied?.authorId)?.name ?? "メンバー",
            streamerMode,
          );

    function openMenu(e: React.MouseEvent) {
      // Portal events bubble through the React tree even though the menu is not
      // inside this message row in the DOM. Ignore those events here.
      if (!e.currentTarget.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      // Touch long-press is handled by the row gesture. Ignore the synthetic
      // contextmenu event emitted afterwards so it cannot restart selection.
      if (isMobileInteraction()) return;
      setMenu({ x: e.clientX, y: e.clientY });
    }

    function onTouchStart(e: React.TouchEvent) {
      if (isRevoked || !isMobileInteraction()) return;
      const target = e.target as HTMLElement;
      // MessageContextMenu is rendered through a portal. React still bubbles
      // its touch events through this component, so require real DOM ancestry.
      if (!e.currentTarget.contains(target)) return;
      if (
        target.closest(
          "a, input, textarea, select, video, [contenteditable='true'], [data-vy-native-touch='true']",
        )
      )
        return;
      const t = e.touches[0];
      if (!t) return;
      const x = t.clientX;
      const y = t.clientY;
      touchGesture.current = {
        startX: x,
        startY: y,
        lastX: x,
        lastY: y,
        axis: "pending",
      };
      longPressFired.current = false;
      setSwipeOffset(0);
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        touchGesture.current = null;
        setSwipeOffset(0);
        window.getSelection()?.removeAllRanges();
        if (navigator.vibrate) navigator.vibrate(12);
        setMenu({ x, y });
      }, 480);
    }

    function cancelLongPress() {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    function resetTouchGesture() {
      cancelLongPress();
      touchGesture.current = null;
      setSwipeOffset(0);
      longPressFired.current = false;
    }

    function onTouchMove(e: React.TouchEvent) {
      const gesture = touchGesture.current;
      const t = e.touches[0];
      if (!gesture || !t) return;
      gesture.lastX = t.clientX;
      gesture.lastY = t.clientY;
      const dx = gesture.lastX - gesture.startX;
      const dy = gesture.lastY - gesture.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX > 8 || absY > 8) cancelLongPress();

      // Do not claim the gesture until the user has moved horizontally far
      // enough. Vertical scrolling therefore keeps winning for ordinary drags.
      if (gesture.axis === "pending") {
        if (absX < 18 && absY < 18) return;
        if (dx < 0 && -dx >= 18 && -dx > absY * 1.25) {
          gesture.axis = "horizontal";
        } else {
          gesture.axis = "vertical";
          setSwipeOffset(0);
          return;
        }
      }

      if (gesture.axis !== "horizontal") return;
      const progress = Math.max(0, -dx - 18);
      setSwipeOffset(-Math.min(72, progress));
    }

    function finishTouch(e: React.TouchEvent) {
      const gesture = touchGesture.current;
      const changed = e.changedTouches[0];
      const endX = changed?.clientX ?? gesture?.lastX ?? 0;
      const endY = changed?.clientY ?? gesture?.lastY ?? 0;
      const horizontalDistance = gesture ? gesture.startX - endX : 0;
      const verticalDistance = gesture ? Math.abs(gesture.startY - endY) : 0;
      const shouldReply =
        !longPressFired.current &&
        gesture?.axis === "horizontal" &&
        horizontalDistance >= 52 &&
        horizontalDistance > verticalDistance * 1.25;

      resetTouchGesture();

      if (shouldReply) {
        if (navigator.vibrate) navigator.vibrate(8);
        setReplyTo(message.id);
      }
    }

    const pressHandlers = {
      onContextMenu: openMenu,
    };

    const react = (type: number, mine: boolean) => {
      const state = useStore.getState();
      const accountId = state.accountId;
      if ((!accountId && !state.demoMode) || message.id.startsWith("pending_")) return;
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
      if (store.demoMode) {
        store.showNotice(mine ? "リアクションを外しました" : "リアクションを追加しました");
        return;
      }
      // 削除も同じタイプを送ってサーバ側でトグル（"UNDO" はサーバが ILLEGAL_ARGUMENT で拒否する）
      void api.line
        .react(accountId!, message.id, name as "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG")
        .then((res) => {
          if (!res.ok) {
            window.alert(res.error ?? "リアクションに失敗しました");
          }
        })
        .catch(() => undefined);
    };

    const handleAnnounce = () => {
      const state = useStore.getState();
      const accountId = state.accountId;
      if (!accountId && !state.demoMode) return;
      const text = message.text ?? message.altText ?? "";
      if (!text) return;
      const chatId = chat.id;
      if (state.demoMode) {
        state.addAnnouncement(chatId, {
          announcementSeq: String(Date.now()),
          text,
          link: `line://nv/chatMsg?chatId=${chatId}&messageId=${message.id}`,
          creatorMid: state.self?.mid ?? "demo-self",
          createdTime: Date.now(),
        });
        state.showNotice("アナウンスに追加しました");
        return;
      }
      void api.line.announce
        .create(accountId!, chatId, text, message.id)
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
            {
              label: "リアクション",
              icon: <IconHeart size={16} />,
              children: [
                ...(message.reactions?.some((r) => r.fromMid === self?.mid)
                  ? [
                      {
                        label: "リアクションを取り消す",
                        icon: <IconClose size={16} />,
                        onClick: () =>
                          react(
                            message.reactions?.find((r) => r.fromMid === self?.mid)?.type ?? 0,
                            true,
                          ),
                      },
                    ]
                  : []),
                {
                  label: "いいね",
                  icon: <ReactionGlyph type={2} />,
                  onClick: () => react(2, false),
                },
                {
                  label: "愛してる",
                  icon: <ReactionGlyph type={3} />,
                  onClick: () => react(3, false),
                },
                {
                  label: "面白い",
                  icon: <ReactionGlyph type={4} />,
                  onClick: () => react(4, false),
                },
                {
                  label: "すごい",
                  icon: <ReactionGlyph type={5} />,
                  onClick: () => react(5, false),
                },
                {
                  label: "悲しい",
                  icon: <ReactionGlyph type={6} />,
                  onClick: () => react(6, false),
                },
                {
                  label: "びっくり",
                  icon: <ReactionGlyph type={7} />,
                  onClick: () => react(7, false),
                },
              ],
            },
          ]
        : []),
      ...(message.text || message.altText
        ? [
            {
              label: "コピー",
              icon: <IconCopy size={16} />,
              onClick: () => void copyText(message.text ?? message.altText ?? ""),
            },
            {
              label: "部分コピー",
              icon: <IconCopy size={16} />,
              onClick: () => setPartialCopyOpen(true),
            },
          ]
        : []),
      ...(message.kind === "sticker" && isStickerImageSrc(message.sticker)
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
      ...(!isMe && (!settings.readReceipts || readDisabled)
        ? [
            {
              label: "このメッセージまで既読",
              icon: <IconCheck size={16} />,
              onClick: () =>
                void markChatRead(chat.id, message.id, {
                  forceReceipt: true,
                }),
            },
          ]
        : !isMe && !message.read
          ? [
              {
                label: "既読にする",
                icon: <IconCheck size={16} />,
                onClick: () => markRead(message.id),
              },
            ]
          : []),
      ...(isMe &&
      !isRevoked &&
      message.kind === "text" &&
      message.status !== "sending" &&
      !message.id.startsWith("pending_")
        ? [
            {
              label: "編集",
              icon: <IconEdit size={16} />,
              onClick: () => setEditing(true),
            },
          ]
        : []),
      ...(message.edited && message.originalText
        ? [
            {
              label: showOriginal ? "編集後のメッセージを表示" : "編集前のメッセージを表示",
              icon: <IconEdit size={16} />,
              onClick: () => setShowOriginal((v) => !v),
            },
          ]
        : []),
      ...(message.history && message.history.length > 0
        ? [
            {
              label: "履歴を表示",
              icon: <IconChevron size={16} />,
              onClick: async () => {
                setHistoryLoading(true);
                setShowHistory(true);
                const h = await useStore.getState().fetchMessageHistory(message.chatId, message.id);
                setHistory(h ?? []);
                setHistoryLoading(false);
              },
            },
          ]
        : []),
      ...(isMe &&
      isRevoked &&
      message.authorId === "me" &&
      (message.revokedSnapshot || (message.history && message.history.length > 0))
        ? [
            {
              label: "復元",
              icon: <IconCheck size={16} />,
              onClick: () => restoreRevokedMessage(message.chatId, message.id),
            },
          ]
        : []),
      ...(isMe && !isRevoked && message.status !== "sending" && !message.id.startsWith("pending_")
        ? [
            {
              label: "送信を取り消し",
              icon: <IconTrash size={16} />,
              onClick: () => revokeMessage(message.id),
              danger: true,
            },
          ]
        : []),
      ...(chat.type === "group" && !isRevoked && (message.text || message.altText)
        ? [
            {
              label: "アナウンスを追加",
              icon: <IconPin size={16} />,
              onClick: handleAnnounce,
            },
          ]
        : []),
    ];

    const isMessageEdited = message.edited || Boolean(message.originalText);

    const readReceipt = (() => {
      if (!isMe || isRevoked) return null;
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

    if (message.kind === "call" && !isRevoked) {
      return <CallEventMessage meta={message.callMeta} isMe={isMe} />;
    }

    if (message.postNotification && message.postNotification.kind !== "unknown" && !isRevoked) {
      return <PostNotificationCard message={message} accountId={accountId ?? undefined} />;
    }

    if (message.kind === "system" && !isRevoked) {
      return (
        <div className="my-1 flex w-full justify-center px-1">
          <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-3 py-1 text-center text-[0.7rem] text-[var(--vy-text-dim)]">
            {message.text || "システムメッセージ"}
          </span>
        </div>
      );
    }

    const metaLine = !isRevoked && (
      <div
        className={cn(
          "mt-1 flex items-center gap-1.5 px-1 text-[0.7rem] text-[var(--vy-text-dim)]",
          isMe ? "flex-row-reverse" : "flex-row",
        )}
      >
        <span>{formatTime(message.createdAt)}</span>
        {readReceipt}
        {isMessageEdited && (
          <span
            className="flex items-center gap-0.5 text-[0.65rem] opacity-80"
            title={
              message.originalText
                ? `クリックで${showOriginal ? "編集後" : "編集前"}を表示`
                : "編集済み"
            }
          >
            <span className="opacity-50">·</span>
            {message.originalText ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowOriginal((v) => !v);
                }}
                className="hover:text-[var(--vy-text)] hover:underline focus-visible:outline-none"
              >
                {showOriginal ? "編集前を表示中" : "編集済み"}
              </button>
            ) : (
              <span>編集済み</span>
            )}
          </span>
        )}
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

    const renderBubbleContent = (target: Message) => {
      if (target.kind === "call") {
        return <CallEventMessage meta={target.callMeta} isMe={target.authorId === "me"} />;
      }

      if (target.kind === "system") {
        return (
          <div className="my-1 flex w-full justify-center px-1">
            <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-3 py-1 text-center text-[0.7rem] text-[var(--vy-text-dim)]">
              {target.text || "システムメッセージ"}
            </span>
          </div>
        );
      }

      if (target.kind === "sticker") {
        return (
          <div
            className={cn(
              "vy-pop-in cursor-default",
              target.stickerSticky && "relative flex w-full justify-center py-2",
            )}
            aria-label="スタンプ"
          >
            {target.stickerSticky && (
              <span className="absolute -top-1 left-1 rounded-full bg-[color-mix(in_oklab,var(--vy-text)_15%,transparent)] px-1.5 py-0.5 text-[0.6rem] text-[var(--vy-text-dim)]">
                くっつき
              </span>
            )}
            {isStickerImageSrc(target.sticker) ? (
              <img
                src={target.stickerAnimated ? stickerAnimationUrl(target.sticker) : target.sticker}
                alt="スタンプ"
                onError={hideBrokenMedia}
                className={cn("h-32 w-32 object-contain", target.stickerSticky && "drop-shadow-md")}
                draggable={false}
              />
            ) : (
              <span className="text-7xl leading-none">{target.sticker || "🎴"}</span>
            )}
          </div>
        );
      }

      if (target.kind === "emoji") {
        return (
          <div className="vy-pop-in cursor-default text-6xl leading-none" aria-label="絵文字">
            {target.sticons?.length ? (
              <Highlighted
                text={target.text ?? ""}
                sticons={target.sticons}
                mentions={target.mentions}
              />
            ) : (
              target.text
            )}
          </div>
        );
      }

      if (target.kind === "flex") {
        return target.flexJson ? (
          <FlexMessageView container={target.flexJson} altText={target.altText || target.text} />
        ) : (
          <div className="rounded-xl bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
            {target.altText || "Flexメッセージ"}
          </div>
        );
      }

      if (target.kind === "rich") {
        return (
          <RichMessageView
            imageUrl={target.richImageUrl}
            markup={target.richMarkup}
            altText={target.altText || target.text}
          />
        );
      }

      if (target.kind === "location") {
        return (
          <div className="vy-msg-enter max-w-[280px] overflow-hidden rounded-msg shadow-sm">
            {target.location?.latitude != null && target.location?.longitude != null ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${target.location.latitude},${target.location.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="block h-32 w-full bg-cover bg-center"
                style={{
                  backgroundImage: `url(https://maps.googleapis.com/maps/api/staticmap?center=${target.location.latitude},${target.location.longitude}&zoom=15&size=280x128&markers=color:red%7C${target.location.latitude},${target.location.longitude}&key=)`,
                }}
                aria-label="地図を開く"
              />
            ) : null}
            <div className="bg-[var(--vy-msg-in)] px-3 py-2 text-[var(--vy-msg-in-text)]">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <IconPin size={15} /> {target.location?.title || "位置情報"}
              </p>
              {target.location?.address && (
                <p className="mt-0.5 text-xs text-[var(--vy-text-dim)]">
                  {target.location.address}
                </p>
              )}
              {target.location?.latitude != null && target.location?.longitude != null && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${target.location.latitude},${target.location.longitude}`}
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
        );
      }

      if (target.kind === "contact") {
        return (
          <div className="vy-msg-enter w-[240px] overflow-hidden rounded-msg shadow-sm">
            <div className="flex items-center gap-3 bg-[var(--vy-msg-in)] px-3 py-3 text-[var(--vy-msg-in-text)]">
              {target.contact?.thumbnailUrl ? (
                <img
                  src={target.contact.thumbnailUrl}
                  alt=""
                  onError={hideBrokenMedia}
                  className="h-11 w-11 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--vy-accent)] text-lg font-bold text-white">
                  {(target.contact?.name || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{target.contact?.name || "連絡先"}</p>
                <p className="text-[0.65rem] text-[var(--vy-text-dim)]">連絡先が共有されました</p>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div
          className={cn(
            "vy-msg-enter vy-bubble-pad relative cursor-text select-text rounded-msg text-[length:inherit] leading-relaxed shadow-sm",
          )}
          style={{
            background: isMe ? "var(--vy-msg-out)" : "var(--vy-msg-in)",
            color: isMe ? "var(--vy-msg-out-text)" : "var(--vy-msg-in-text)",
            borderTopRightRadius: isMe && settings.bubbleTail ? 6 : undefined,
            borderTopLeftRadius: !isMe && settings.bubbleTail ? 6 : undefined,
          }}
        >
          {replyQuote}
          {(target.kind === "image" || target.kind === "video") &&
            target.imageSrc &&
            (streamerMode ? (
              <SpoilerMedia
                src={target.imageSrc}
                alt={target.kind === "video" ? "動画サムネイル" : "送信された画像"}
                video={target.kind === "video"}
              />
            ) : target.kind === "video" ? (
              <div className="relative overflow-hidden rounded-xl">
                <video
                  src={target.imageSrc.replace(/preview=1/, "preview=0")}
                  controls
                  preload="metadata"
                  className="h-auto w-[260px] max-w-full object-cover"
                />
              </div>
            ) : (
              <button
                type="button"
                className="group relative block overflow-hidden rounded-xl text-left"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(true);
                }}
                aria-label="画像を拡大"
              >
                <img
                  src={target.imageSrc}
                  alt="送信された画像"
                  onError={hideBrokenMedia}
                  className="max-h-[360px] max-w-[240px] object-contain transition-opacity group-hover:opacity-95"
                />
              </button>
            ))}
          {target.kind === "audio" && target.audioSrc && (
            <AudioBubble src={target.audioSrc} seconds={target.audioSeconds} />
          )}
          {target.kind === "text" && (
            <div>
              {showOriginal && target.originalText && (
                <div className="mb-1 flex items-center justify-between border-b border-current/15 pb-1 text-[0.65rem] opacity-70">
                  <span>編集前のメッセージ</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOriginal(false);
                    }}
                    className="underline hover:opacity-100"
                  >
                    戻す
                  </button>
                </div>
              )}
              <p className="vy-msg-text whitespace-pre-wrap break-words">
                <Highlighted
                  text={
                    showOriginal && target.originalText ? target.originalText : (target.text ?? "")
                  }
                  query={highlight}
                  sticons={target.sticons}
                  mentions={target.mentions}
                />
              </p>
            </div>
          )}
          {target.linkPreview && !streamerMode && <LinkPreviewCard preview={target.linkPreview} />}
        </div>
      );
    };

    return (
      <div
        data-vy-message="true"
        onContextMenu={openMenu}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={finishTouch}
        onTouchCancel={resetTouchGesture}
        className={cn(
          "vy-message-interaction relative flex w-full gap-2 px-1",
          isMe ? "flex-row-reverse" : "flex-row",
        )}
      >
        {swipeOffset < -10 && (
          <span
            className="pointer-events-none absolute right-2 top-1/2 z-0 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-accent)]"
            aria-hidden
          >
            <IconReply size={17} />
          </span>
        )}
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
            "relative z-[1] min-w-0 flex flex-col",
            message.kind === "flex" || message.kind === "rich"
              ? "max-w-[min(100%,360px)]"
              : "max-w-[74%]",
            isMe ? "items-end" : "items-start",
          )}
          style={{
            transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined,
            transition: swipeOffset === 0 ? "transform 160ms ease-out" : "none",
          }}
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

          {isRevoked ? (
            <div
              className={cn(
                "relative overflow-hidden rounded-msg border border-dashed px-3 py-2.5 shadow-sm",
                isRevoked && message.authorId === "me"
                  ? "bg-[color-mix(in_oklab,var(--vy-accent)_7%,transparent)]"
                  : "bg-[color-mix(in_oklab,var(--vy-text)_5%,var(--vy-surface-2))]",
              )}
              style={{
                borderColor:
                  isRevoked && message.authorId === "me"
                    ? "color-mix(in oklab, var(--vy-accent) 55%, transparent)"
                    : "var(--vy-border)",
              }}
            >
              <span
                className={cn(
                  "absolute right-2 top-2 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold tracking-wide",
                  isRevoked && message.authorId === "me"
                    ? "border-[color-mix(in_oklab,var(--vy-accent)_50%,transparent)] bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] text-[var(--vy-accent)]"
                    : "border-[var(--vy-border)] bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] text-[var(--vy-text-dim)]",
                )}
              >
                取り消し済み
              </span>
              <div className="pr-16">{renderBubbleContent(revokedDisplayMessage)}</div>
              <div className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-[var(--vy-text-dim)]">
                <IconTrash className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span>{formatTime(message.createdAt)}</span>
                <span className="opacity-70">
                  {isRevoked && message.authorId === "me"
                    ? "あなたが送信を取り消しました"
                    : "送信が取り消されました"}
                </span>
              </div>
            </div>
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
              {isStickerImageSrc(message.sticker) ? (
                <img
                  src={
                    message.sticker
                      ? message.stickerAnimated
                        ? stickerAnimationUrl(message.sticker)
                        : message.sticker
                      : ""
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
                <span className="text-7xl leading-none">{message.sticker || "🧩"}</span>
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
                  className="flex h-20 w-full items-center justify-center bg-[var(--vy-accent)]/10 text-2xl"
                  aria-label="地図を開く"
                >
                  🗺️
                </a>
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
          ) : message.kind === "file" ? (
            <div
              {...pressHandlers}
              className="vy-msg-enter w-[260px] overflow-hidden rounded-msg shadow-sm"
            >
              {replyQuote}
              <div className="flex items-center gap-3 bg-[var(--vy-msg-in)] px-3 py-3 text-[var(--vy-msg-in-text)]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--vy-accent)]/15 text-xl">
                  📄
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {message.file?.name || "ファイル"}
                  </p>
                  {message.file?.size != null && (
                    <p className="text-[0.65rem] text-[var(--vy-text-dim)]">
                      {message.file.size > 1024 * 1024
                        ? `${(message.file.size / 1024 / 1024).toFixed(1)} MB`
                        : `${Math.max(1, Math.round(message.file.size / 1024))} KB`}
                    </p>
                  )}
                </div>
                {useStore.getState().accountId && (
                  <a
                    href={`/api/line/${encodeURIComponent(useStore.getState().accountId!)}/media/${encodeURIComponent(message.chatId)}/${encodeURIComponent(message.id)}?preview=0`}
                    download={message.file?.name || true}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="ダウンロード"
                    className="shrink-0 rounded-md p-1.5 hover:bg-black/10"
                    style={{ color: "var(--vy-accent)" }}
                  >
                    ⬇
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
                "vy-msg-enter vy-bubble-pad relative cursor-text select-text rounded-msg text-[length:inherit] leading-relaxed shadow-sm",
              )}
              style={{
                background: isMe ? "var(--vy-msg-out)" : "var(--vy-msg-in)",
                color: isMe ? "var(--vy-msg-out-text)" : "var(--vy-msg-in-text)",
                borderTopRightRadius: isMe && settings.bubbleTail ? 6 : undefined,
                borderTopLeftRadius: !isMe && settings.bubbleTail ? 6 : undefined,
              }}
            >
              {replyQuote}
              {mediaItems.length > 1 && !streamerMode && (
                <div
                  className={cn(
                    "grid gap-px overflow-hidden rounded-xl bg-[var(--vy-border)] p-px",
                    mediaItems.length === 2 ? "grid-cols-2" : "grid-cols-3",
                  )}
                >
                  {mediaItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="group relative aspect-square overflow-hidden bg-[var(--vy-surface)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxMedia(item);
                        setLightbox(true);
                      }}
                      aria-label="画像を拡大"
                    >
                      <img
                        src={item.imageSrc}
                        alt="送信された画像"
                        onError={hideBrokenMedia}
                        className="h-full w-full object-cover transition-opacity group-hover:opacity-95"
                      />
                    </button>
                  ))}
                </div>
              )}
              {mediaItems.length > 1 && streamerMode && (
                <div
                  className={cn(
                    "grid gap-1",
                    mediaItems.length === 2 ? "grid-cols-2" : "grid-cols-3",
                  )}
                >
                  {mediaItems.map((item) => (
                    <SpoilerMedia key={item.id} src={item.imageSrc!} alt="送信された画像" />
                  ))}
                </div>
              )}
              {mediaItems.length <= 1 &&
                (message.kind === "image" || message.kind === "video") &&
                message.imageSrc &&
                (streamerMode ? (
                  <SpoilerMedia
                    src={message.imageSrc}
                    alt={message.kind === "video" ? "動画サムネイル" : "送信された画像"}
                    video={message.kind === "video"}
                  />
                ) : message.kind === "video" ? (
                  <div className="relative overflow-hidden rounded-xl">
                    <video
                      src={message.imageSrc.replace(/preview=1/, "preview=0")}
                      controls
                      preload="metadata"
                      className="h-auto w-[260px] max-w-full object-cover"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="group relative block overflow-hidden rounded-xl text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxMedia(message);
                      setLightbox(true);
                    }}
                    aria-label="画像を拡大"
                  >
                    <img
                      src={message.imageSrc}
                      alt="送信された画像"
                      onError={hideBrokenMedia}
                      className="max-h-[360px] max-w-[240px] object-contain transition-opacity group-hover:opacity-95"
                    />
                  </button>
                ))}
              {mediaItems.length <= 1 && message.kind === "audio" && message.audioSrc && (
                <AudioBubble src={message.audioSrc} seconds={message.audioSeconds} />
              )}
              {mediaItems.length <= 1 && message.kind === "text" && (
                <div>
                  {showOriginal && message.originalText && (
                    <div className="mb-1 flex items-center justify-between border-b border-current/15 pb-1 text-[0.65rem] opacity-70">
                      <span>編集前のメッセージ</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowOriginal(false);
                        }}
                        className="underline hover:opacity-100"
                      >
                        戻す
                      </button>
                    </div>
                  )}
                  <p className="vy-msg-text whitespace-pre-wrap break-words">
                    <Highlighted
                      text={
                        showOriginal && message.originalText
                          ? message.originalText
                          : (message.text ?? "")
                      }
                      query={highlight}
                      sticons={message.sticons}
                      mentions={message.mentions}
                    />
                  </p>
                </div>
              )}
              {message.linkPreview && !streamerMode && (
                <LinkPreviewCard preview={message.linkPreview} />
              )}
            </div>
          )}

          {metaLine}
          {readerList}
          {message.reactions && message.reactions.length > 0 && !isRevoked && (
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
        {editing && (
          <EditMessageDialog
            initialText={message.text ?? ""}
            onSave={async (newText) => {
              await editMessage(message.id, newText);
            }}
            onClose={() => setEditing(false)}
          />
        )}
        {partialCopyOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="メッセージを部分コピー"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPartialCopyOpen(false);
            }}
          >
            <div className="w-full max-w-md rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 shadow-2xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">部分コピー</p>
                <button
                  type="button"
                  onClick={() => setPartialCopyOpen(false)}
                  className="rounded-lg p-1 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
                  aria-label="閉じる"
                >
                  <IconClose size={17} />
                </button>
              </div>
              <p className="mb-2 text-xs text-[var(--vy-text-dim)]">
                コピーしたい範囲を選択してください
              </p>
              <textarea
                ref={partialCopyRef}
                readOnly
                value={message.text ?? message.altText ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                className="vy-partial-copy-text vy-scroll h-40 w-full resize-none rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              />
              <button
                type="button"
                onClick={() => {
                  const textarea = partialCopyRef.current;
                  const full = message.text ?? message.altText ?? "";
                  const start = textarea?.selectionStart ?? 0;
                  const end = textarea?.selectionEnd ?? 0;
                  const selected = end > start ? full.slice(start, end) : full;
                  void copyText(selected);
                  setPartialCopyOpen(false);
                }}
                className="mt-3 w-full rounded-xl bg-[var(--vy-accent)] px-3 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)]"
              >
                選択範囲をコピー
              </button>
            </div>
          </div>
        )}
        {lightbox && (lightboxMedia?.imageSrc ?? message.imageSrc) && (
          <MediaLightbox
            src={(lightboxMedia?.imageSrc ?? message.imageSrc)!}
            kind={(lightboxMedia?.kind ?? message.kind) === "video" ? "video" : "image"}
            onClose={() => setLightbox(false)}
          />
        )}
        {showHistory && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowHistory(false);
            }}
          >
            <div className="max-h-[80vh] w-[360px] overflow-y-auto rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">メッセージ履歴</h3>
                <button
                  type="button"
                  onClick={() => setShowHistory(false)}
                  className="rounded p-1 hover:bg-[var(--vy-surface-2)]"
                >
                  ✕
                </button>
              </div>
              {historyLoading && <p className="text-xs text-[var(--vy-text-dim)]">読み込み中...</p>}
              {!historyLoading && history.length === 0 && (
                <p className="text-xs text-[var(--vy-text-dim)]">履歴がありません</p>
              )}
              {!historyLoading &&
                history.map((entry, i) => (
                  <div
                    key={i}
                    className="mb-2 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2.5"
                  >
                    <div className="mb-1 flex items-center gap-2 text-[0.65rem] text-[var(--vy-text-dim)]">
                      <span className="rounded bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-1.5 py-0.5">
                        {entry.state === "normal"
                          ? "通常"
                          : entry.state === "edited"
                            ? "編集済み"
                            : entry.state === "revoked-by-other"
                              ? "相手が削除"
                              : "自分が削除"}
                      </span>
                      <span>{new Date(entry.updatedTime).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {entry.text ?? <span className="italic opacity-60">（なし）</span>}
                    </p>
                  </div>
                ))}
            </div>
          </div>
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
