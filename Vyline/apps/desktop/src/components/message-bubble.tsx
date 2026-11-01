import { memo, useEffect, useRef, useState } from "react";
import {
  useStore,
  formatTime,
  memberDisplayName,
  memberGlyph,
  shouldMaskStreamerAvatars,
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
  IconPin,
  IconHeart,
  IconClose,
  IconEdit,
} from "@/components/icons";
import { copyText, downloadUrl } from "@/utils/clipboard";
import { segmentUnicodeEmoji } from "@/utils/lineSticon";
import { lineCdnProxy, hideBrokenMedia } from "@/utils/lineMedia";
import { segmentTextWithMentions, type DraftSegment } from "@/utils/mention";
import { mentionLabel } from "./message-bubble-helpers";
import { previewUrlsForText, splitMessageUrls } from "@/lib/messageUrls";

export async function deleteRevokedMessageFromDevice(
  accountId: string | null,
  chatId: string,
  messageId: string,
) {
  if (
    !accountId ||
    useStore.getState().accountId !== accountId ||
    !window.confirm(
      "このメッセージをこの端末のローカルDBから完全に削除します。削除後は復元できません。相手の端末には影響しません。削除しますか？",
    )
  )
    return;
  try {
    const result = await api.line.deleteRevokedMessage(accountId, chatId, messageId);
    if (!result.ok) throw new Error("削除に失敗しました");
    useStore.setState((state) =>
      state.accountId !== accountId
        ? {}
        : {
            messages: state.messages.filter(
              (item) => item.chatId !== chatId || item.id !== messageId,
            ),
          },
    );
  } catch {
    window.alert("この端末からの削除に失敗しました。もう一度お試しください。");
  }
}

function SpoilerMedia({ src, alt, video }: { src: string; alt: string; video?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    if (video) return <VideoPlayer src={src.replace(/preview=1/, "preview=0")} />;
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

function VideoPlayer({ src }: { src: string }) {
  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      aria-label="動画を再生"
      className="h-auto w-[260px] max-w-full rounded-xl object-cover"
    />
  );
}

function LinkPreviewCard({
  preview,
  accountId,
}: { preview: NonNullable<Message["linkPreview"]>; accountId: string | null }) {
  const [thumbnail, setThumbnail] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setThumbnail(undefined);
    if (preview.imageId && accountId) {
      void api.line
        .linkPreviewImage(accountId, preview.imageId)
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setThumbnail(objectUrl);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, preview.imageId]);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(preview.url);
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      parsedUrl.username ||
      parsedUrl.password
    )
      return null;
  } catch {
    return null;
  }
  return (
    <div className="mt-2 flex w-full max-w-[360px] min-w-0 overflow-hidden rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] text-[var(--vy-text)] shadow-sm">
      <a
        href={parsedUrl.toString()}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        onClick={(event) => event.stopPropagation()}
        className="flex min-w-0 flex-1 items-center gap-2 p-2"
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-11 w-11 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg"
            style={{ background: "color-mix(in oklab, var(--vy-accent) 18%, var(--vy-surface))" }}
            aria-hidden
          >
            {preview.thumb || "↗"}
          </span>
        )}
        <span className="min-w-0 flex-1 self-center leading-tight">
          <span className="block truncate text-xs font-semibold">
            {preview.title || preview.site || parsedUrl.hostname}
          </span>
          <span
            className="mt-1 block truncate text-[11px] font-medium text-[var(--vy-text)]"
            title={preview.url}
          >
            {preview.url}
          </span>
        </span>
      </a>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void copyText(preview.url).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
        aria-label={copied ? "URLをコピーしました" : "URLをコピー"}
        title={copied ? "コピーしました" : "URLをコピー"}
        className="m-1 flex shrink-0 items-center gap-1 rounded-md bg-[var(--vy-surface-2)] px-2 text-[11px] font-medium text-[var(--vy-text)] transition-colors hover:text-[var(--vy-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--vy-accent)]"
      >
        <span aria-hidden>{copied ? "✓" : "⧉"}</span>
        {copied ? "コピー済み" : "コピー"}
      </button>
    </div>
  );
}

function InlineUrl({ value, href }: { value: string; href: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        onClick={(event) => event.stopPropagation()}
        className="break-all font-medium text-current underline decoration-current/70 underline-offset-2 hover:decoration-current"
      >
        {value}
      </a>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void copyText(value).then((ok) => {
            if (ok) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }
          });
        }}
        aria-label={copied ? "URLをコピーしました" : "URLをコピー"}
        title={copied ? "コピーしました" : "URLをコピー"}
        className="mx-0.5 inline-flex align-middle rounded px-1 text-[0.75em] text-current hover:bg-[color-mix(in_oklab,currentColor_12%,transparent)]"
      >
        {copied ? "✓" : "⧉ コピー"}
      </button>
    </>
  );
}

function MessageLinkPreviews({
  text,
  accountId,
  disabled,
  excludeUrl,
}: { text: string; accountId: string | null; disabled: boolean; excludeUrl?: string }) {
  const limit = useStore((state) => state.settings.linkPreviewLimit ?? 3);
  const urls = previewUrlsForText(text, limit).filter((url) => url !== excludeUrl);
  const [found, setFound] = useState<Record<string, NonNullable<Message["linkPreview"]>>>({});
  useEffect(() => {
    let cancelled = false;
    if (!accountId || disabled || urls.length === 0)
      return () => {
        cancelled = true;
      };
    void (async () => {
      for (const url of urls) {
        try {
          const result = await api.line.linkPreview(accountId, url);
          if (cancelled || useStore.getState().accountId !== accountId) return;
          if (result.ok && result.preview) {
            const metadata = result.preview;
            const preview: NonNullable<Message["linkPreview"]> = {
              url,
              title: metadata.title || new URL(url).hostname,
              description: metadata.description || "",
              site: metadata.site || new URL(url).hostname,
              ...(metadata.imageId ? { imageId: metadata.imageId } : {}),
            };
            setFound((previous) => ({ ...previous, [url]: preview }));
          }
        } catch {
          /* A missing preview never blocks the original URL. */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, disabled, limit, text]);
  if (!accountId || disabled) return null;
  return (
    <>
      {urls.map((url) =>
        found[url] ? (
          <LinkPreviewCard key={url} preview={found[url]} accountId={accountId} />
        ) : null,
      )}
    </>
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
  const settings = useStore((s) => s.settings);
  const visibleText =
    settings.streamerMode && settings.streamerMaskUrls
      ? value.replace(/https?:\/\/[^\s<>]+/gi, "[URL]")
      : value;
  const parts = splitMessageUrls(visibleText);
  return (
    <>
      {parts.map((part, i) =>
        part.type === "url" ? (
          <InlineUrl key={`url-${i}`} value={part.value} href={part.href} />
        ) : (
          segmentUnicodeEmoji(part.value).map((run, j) =>
            run.type === "emoji" ? (
              <span
                key={`${i}-${j}`}
                className="inline-block text-[1.15em] leading-none align-[-0.05em]"
              >
                {run.value}
              </span>
            ) : (
              <span key={`${i}-${j}`}>{run.value}</span>
            ),
          )
        ),
      )}
    </>
  );
}

/** Dark theme and green outgoing bubbles both need clear mention contrast. */
const MENTION_COLOR = "#ffe08a";
const MENTION_ALL_COLOR = "#ffad75";

function MentionSpan({
  seg,
  memberName,
  chatId,
}: {
  seg: Extract<DraftSegment, { type: "mention" }>;
  memberName?: string;
  chatId: string;
}) {
  const all = Boolean(seg.all);
  const openMemberProfile = useStore((s) => s.openMemberProfile);
  const profileName = useStore((s) =>
    seg.mid && (seg.mid === s.self.mid || seg.mid === "me")
      ? s.self.name
      : s.chats.find((c) => c.id === seg.mid)?.name,
  );
  const streamerSettings = useStore((s) => s.settings);
  const streamerMode = streamerSettings.streamerMode;
  const label = all
    ? "ALL"
    : memberDisplayName(mentionLabel(seg.value, false, memberName || profileName), streamerMode);
  const style = {
    background: all ? "rgba(255,173,117,0.16)" : "rgba(255,224,138,0.14)",
    color: all ? MENTION_ALL_COLOR : MENTION_COLOR,
  };
  if (!all && seg.mid) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={`@${label} のプロフィールを開く`}
        onClick={(event) => {
          event.stopPropagation();
          openMemberProfile(chatId, seg.mid!);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          openMemberProfile(chatId, seg.mid!);
        }}
        className="inline rounded-[0.25em] px-0.5 align-baseline font-semibold underline decoration-current/60 underline-offset-2 cursor-pointer hover:brightness-125 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2"
        style={style}
      >
        @{label}
      </span>
    );
  }
  return (
    <span className="inline rounded-[0.25em] px-0.5 align-baseline font-semibold" style={style}>
      @{label}
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
  regex = false,
  sticons,
  mentions,
  membersById,
  chatId,
}: {
  text: string;
  query?: string;
  regex?: boolean;
  sticons?: import("@/utils/lineSticon").SticonResource[];
  mentions?: import("@/utils/mention").MentionInfo[];
  membersById?: ReadonlyMap<string, NonNullable<Chat["members"]>[number]>;
  chatId: string;
}) {
  const segments: DraftSegment[] =
    (sticons && sticons.length > 0) || (mentions && mentions.length > 0)
      ? segmentTextWithMentions(text, sticons ?? [], mentions ?? [])
      : [{ type: "text", value: text }];

  const renderSegment = (seg: DraftSegment, i: number) => {
    if (seg.type === "sticon") return <MentionImage key={i} seg={seg} />;
    if (seg.type === "mention")
      return (
        <MentionSpan
          key={i}
          seg={seg}
          chatId={chatId}
          memberName={membersById?.get(seg.mid ?? "")?.name}
        />
      );
    return <TextRuns key={i} value={seg.value} />;
  };

  if (!query) {
    return <>{segments.map(renderSegment)}</>;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "sticon") return <MentionImage key={i} seg={seg} />;
        if (seg.type === "mention")
          return (
            <MentionSpan
              key={i}
              seg={seg}
              chatId={chatId}
              memberName={membersById?.get(seg.mid ?? "")?.name}
            />
          );
        const ranges: Array<{ start: number; end: number }> = [];
        if (regex) {
          try {
            const matcher = new RegExp(query, "gi");
            for (const match of seg.value.matchAll(matcher)) {
              if (match[0].length)
                ranges.push({ start: match.index!, end: match.index! + match[0].length });
              if (ranges.length >= 100) break;
            }
          } catch {
            /* invalid patterns are rejected by the search API */
          }
        } else {
          const source = seg.value.toLocaleLowerCase();
          const needle = query.toLocaleLowerCase();
          let start = 0;
          while (needle && ranges.length < 100) {
            const idx = source.indexOf(needle, start);
            if (idx < 0) break;
            ranges.push({ start: idx, end: idx + needle.length });
            start = idx + needle.length;
          }
        }
        if (!ranges.length) return <TextRuns key={i} value={seg.value} />;
        return (
          <span key={i}>
            {ranges.map((range, index) => (
              <span key={index}>
                <TextRuns
                  value={seg.value.slice(index === 0 ? 0 : ranges[index - 1]!.end, range.start)}
                />
                <mark className="rounded bg-amber-300 px-0.5 text-black ring-1 ring-amber-500/80 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
                  {seg.value.slice(range.start, range.end)}
                </mark>
              </span>
            ))}
            <TextRuns value={seg.value.slice(ranges[ranges.length - 1]!.end)} />
          </span>
        );
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
    src && (src.startsWith("http") || src.startsWith("/api/") || src.startsWith("data:")),
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
    replied,
    membersById,
    chat,
    showAvatar,
    showName,
    highlight,
    highlightRegex,
    mediaGroup,
  }: {
    message: Message;
    replied?: Message;
    membersById: ReadonlyMap<string, NonNullable<Chat["members"]>[number]>;
    chat: Chat;
    showAvatar: boolean;
    showName: boolean;
    highlight?: string;
    highlightRegex?: boolean;
    mediaGroup?: Message[];
  }) {
    const isMe = message.authorId === "me";
    const accountId = useStore((s) => s.accountId);
    const settings = useStore((s) => s.settings);
    const streamerMode = settings.streamerMode;
    const maskUrls = streamerMode && settings.streamerMaskUrls;
    const revokeMessage = useStore((s) => s.revokeMessage);
    const restoreRevokedMessage = useStore((s) => s.restoreRevokedMessage);
    const fetchMessageHistory = useStore((s) => s.fetchMessageHistory);
    const editMessage = useStore((s) => s.editMessage);
    const retryMessage = useStore((s) => s.retryMessage);
    const refreshMessages = useStore((s) => s.refreshMessages);
    const markRead = useStore((s) => s.markRead);
    const setReplyTo = useStore((s) => s.setReplyTo);
    const scrollToMessage = useStore((s) => s.scrollToMessage);
    const openMemberProfile = useStore((s) => s.openMemberProfile);
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
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressFired = useRef(false);
    const isRevoked = message.messageState.startsWith("revoked");
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

    const author = membersById.get(message.authorId);
    const framelessMedia =
      (message.kind === "image" || message.kind === "video") && Boolean(message.imageSrc);
    const mediaItems = mediaGroup?.filter((item) => item.kind === "image" && item.imageSrc) ?? [];
    const repliedAuthor =
      replied?.authorId === "me"
        ? self.name
        : memberDisplayName(
            membersById.get(replied?.authorId ?? "")?.name ?? "メンバー",
            streamerMode,
          );

    function openMenu(e: React.MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY });
    }

    function onTouchStart(e: React.TouchEvent) {
      if (isRevoked) return;
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
      ...(isRevoked
        ? [
            {
              label: "この端末から完全に削除",
              icon: <IconTrash size={16} />,
              danger: true,
              onClick: () =>
                void deleteRevokedMessageFromDevice(accountId, message.chatId, message.id),
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
              label: "取り消し表示を解除",
              icon: <IconCheck size={16} />,
              onClick: () => restoreRevokedMessage(message.chatId, message.id),
            },
          ]
        : []),
      ...(isMe &&
      !isRevoked &&
      (message.status === "sent" || message.status === "read") &&
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
      if (message.status === "restricted")
        return <span className="text-[var(--vy-danger)]">送信制限 · 再送停止</span>;
      if (message.status === "rejected")
        return <span className="text-[var(--vy-danger)]">送信拒否 · 内容を確認</span>;
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
      if (message.status === "uncertain")
        return (
          <button
            type="button"
            className="cursor-pointer underline decoration-dotted underline-offset-2 text-[var(--vy-danger)]"
            title="通信が切れる直前に送信された可能性があります。履歴を確認してから再送してください。"
            onClick={async (e) => {
              e.stopPropagation();
              await refreshMessages(message.chatId, { force: true });
              const pending = useStore
                .getState()
                .messages.find((item) => item.id === message.id && item.status === "uncertain");
              if (!pending?.retry) return;
              if (
                window.confirm(
                  "履歴で送信を確認できませんでした。送信済みの可能性は残っています。再送すると相手に同じ内容が重複して届く場合があります。それでも再送しますか？",
                )
              ) {
                await retryMessage(message.id);
              }
            }}
          >
            送信結果不明 · 履歴を確認
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
            name: memberDisplayName(membersById.get(id)?.name ?? id, streamerMode),
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
          const mem = membersById.get(r.id);
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
                imageUrl={shouldMaskStreamerAvatars(streamerMode) ? undefined : mem?.avatarUrl}
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
      const frameless =
        (target.kind === "image" || target.kind === "video") && Boolean(target.imageSrc);
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
                membersById={membersById}
                chatId={chat.id}
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
            "vy-msg-enter relative select-none rounded-msg text-[length:inherit] leading-relaxed",
            !frameless && "vy-bubble-pad shadow-sm",
            isRevoked && !frameless && "border border-dotted",
          )}
          style={{
            background: frameless ? undefined : isMe ? "var(--vy-msg-out)" : "var(--vy-msg-in)",
            color: isMe ? "var(--vy-msg-out-text)" : "var(--vy-msg-in-text)",
            borderColor: isRevoked
              ? isMe
                ? "color-mix(in oklab, var(--vy-accent) 55%, transparent)"
                : "var(--vy-border)"
              : undefined,
            borderTopRightRadius: !frameless && isMe && settings.bubbleTail ? 6 : undefined,
            borderTopLeftRadius: !!frameless && isMe && settings.bubbleTail ? 6 : undefined,
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
              <VideoPlayer src={target.imageSrc.replace(/preview=1/, "preview=0")} />
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
                  regex={highlightRegex}
                  sticons={target.sticons}
                  mentions={target.mentions}
                  membersById={membersById}
                  chatId={chat.id}
                />
              </p>
            </div>
          )}
          {target.linkPreview && !maskUrls && (
            <LinkPreviewCard preview={target.linkPreview} accountId={accountId} />
          )}
          {target.kind === "text" && (
            <MessageLinkPreviews
              text={showOriginal && target.originalText ? target.originalText : (target.text ?? "")}
              accountId={accountId}
              disabled={maskUrls}
              excludeUrl={target.linkPreview?.url}
            />
          )}
        </div>
      );
    };

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
                  imageUrl={shouldMaskStreamerAvatars(streamerMode) ? undefined : author.avatarUrl}
                />
              </button>
            )}
          </div>
        )}

        <div
          className={cn(
            "flex min-w-0 max-w-full flex-col",
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

          {isRevoked ? (
            <div {...pressHandlers} className="max-w-[min(74%,560px)]">
              {renderBubbleContent(revokedDisplayMessage)}
              <div className="mt-1 flex items-center gap-1.5 px-1 text-[0.7rem] text-[var(--vy-text-dim)]">
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
                  membersById={membersById}
                  chatId={chat.id}
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
                "vy-msg-enter relative select-none rounded-msg text-[length:inherit] leading-relaxed",
                !framelessMedia && "vy-bubble-pad shadow-sm",
              )}
              style={{
                background: framelessMedia
                  ? undefined
                  : isMe
                    ? "var(--vy-msg-out)"
                    : "var(--vy-msg-in)",
                color: isMe ? "var(--vy-msg-out-text)" : "var(--vy-msg-in-text)",
                borderTopRightRadius:
                  !framelessMedia && isMe && settings.bubbleTail ? 6 : undefined,
                borderTopLeftRadius:
                  !framelessMedia && !isMe && settings.bubbleTail ? 6 : undefined,
              }}
            >
              {replyQuote}
              {mediaItems.length > 1 && !streamerMode && (
                <div
                  className={cn(
                    "grid overflow-hidden rounded-xl",
                    mediaItems.length === 2 ? "grid-cols-2" : "grid-cols-3",
                  )}
                >
                  {mediaItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="group relative aspect-square overflow-hidden bg-black/5"
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
                  {mediaItems.map((item) =>
                    item.kind === "video" ? (
                      <VideoPlayer
                        key={item.id}
                        src={item.imageSrc!.replace(/preview=1/, "preview=0")}
                      />
                    ) : (
                      <SpoilerMedia key={item.id} src={item.imageSrc!} alt="送信された画像" />
                    ),
                  )}
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
                  <VideoPlayer src={message.imageSrc.replace(/preview=1/, "preview=0")} />
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
                      regex={highlightRegex}
                      sticons={message.sticons}
                      mentions={message.mentions}
                      membersById={membersById}
                      chatId={chat.id}
                    />
                  </p>
                </div>
              )}
              {message.linkPreview && !maskUrls && (
                <LinkPreviewCard preview={message.linkPreview} accountId={accountId} />
              )}
              <MessageLinkPreviews
                text={
                  showOriginal && message.originalText ? message.originalText : (message.text ?? "")
                }
                accountId={accountId}
                disabled={maskUrls}
                excludeUrl={message.linkPreview?.url}
              />
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
      prev.membersById === next.membersById &&
      prev.showAvatar === next.showAvatar &&
      prev.showName === next.showName &&
      prev.highlight === next.highlight &&
      prev.highlightRegex === next.highlightRegex &&
      prev.chat.type === next.chat.type &&
      prev.chat.isOfficial === next.chat.isOfficial &&
      prev.chat.members === next.chat.members
    );
  },
);
