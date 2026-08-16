import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type {
  FlexAction,
  FlexBubble,
  FlexCarousel,
  FlexComponent,
  FlexContainer,
} from "@/lib/flex/types";
import {
  BUBBLE_WIDTH,
  fontSizeCss,
  iconSizeCss,
  imageSizeCss,
  openFlexAction,
  parseAspectRatio,
  spacingCss,
} from "@/lib/flex/tokens";

function padStyle(c: FlexComponent): CSSProperties {
  const s: CSSProperties = {};
  const all = spacingCss(c.paddingAll as string | undefined);
  if (all) {
    s.padding = all;
  }
  const top = spacingCss(c.paddingTop as string | undefined);
  const bottom = spacingCss(c.paddingBottom as string | undefined);
  const start = spacingCss(c.paddingStart as string | undefined);
  const end = spacingCss(c.paddingEnd as string | undefined);
  if (top) s.paddingTop = top;
  if (bottom) s.paddingBottom = bottom;
  if (start) s.paddingLeft = start;
  if (end) s.paddingRight = end;
  return s;
}

function offsetStyle(c: FlexComponent): CSSProperties {
  const s: CSSProperties = {};
  if (c.position === "absolute") s.position = "absolute";
  const top = spacingCss(c.offsetTop as string | undefined);
  const bottom = spacingCss(c.offsetBottom as string | undefined);
  const start = spacingCss(c.offsetStart as string | undefined);
  const end = spacingCss(c.offsetEnd as string | undefined);
  if (top) s.top = top;
  if (bottom) s.bottom = bottom;
  if (start) s.left = start;
  if (end) s.right = end;
  return s;
}

function marginStyle(c: FlexComponent): CSSProperties {
  const m = spacingCss(c.margin as string | undefined);
  return m ? { marginTop: m } : {};
}

function ActionWrap({
  action,
  className,
  style,
  children,
}: {
  action?: FlexAction;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (!action) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  const clickable =
    action.type === "uri" ||
    action.type === "clipboard" ||
    Boolean(action.uri);
  if (!clickable) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(className, "cursor-pointer text-left")}
      style={{ ...style, background: "transparent", border: "none", padding: 0 }}
      onClick={(e) => {
        e.stopPropagation();
        openFlexAction(action);
      }}
    >
      {children}
    </button>
  );
}

function FlexText({ c }: { c: FlexComponent }) {
  const spans = Array.isArray(c.contents) ? c.contents.filter((x) => x.type === "span") : [];
  const style: CSSProperties = {
    color: (c.color as string) || "#111111",
    fontSize: fontSizeCss(c.size as string | undefined) || "16px",
    fontWeight: c.weight === "bold" ? 700 : 400,
    textAlign: c.align === "center" ? "center" : c.align === "end" ? "right" : "left",
    whiteSpace: c.wrap ? "pre-wrap" : "nowrap",
    // wrap 時は折り返しで縦に伸ばす（クリップしない）。nowrap のときだけ 1 行 ellipsis
    ...(c.wrap
      ? {}
      : { overflow: "hidden", textOverflow: "ellipsis" }),
    lineHeight: 1.35,
    ...(c.lineSpacing && c.wrap
      ? { lineHeight: `calc(1.35em + ${spacingCss(c.lineSpacing as string) ?? "0px"})` }
      : {}),
    textDecoration:
      c.decoration === "underline"
        ? "underline"
        : c.decoration === "line-through"
          ? "line-through"
          : undefined,
    flex: c.flex != null ? c.flex : undefined,
    maxWidth: "100%",
    ...marginStyle(c),
    ...offsetStyle(c),
  };
  if (c.maxLines != null && Number(c.maxLines) > 0) {
    style.display = "-webkit-box";
    style.WebkitLineClamp = Number(c.maxLines);
    style.WebkitBoxOrient = "vertical";
    style.whiteSpace = "normal";
    style.overflow = "hidden";
  }

  const body =
    spans.length > 0 ? (
      spans.map((sp, i) => (
        <span
          key={i}
          style={{
            color: (sp.color as string) || undefined,
            fontSize: fontSizeCss(sp.size as string | undefined),
            fontWeight: sp.weight === "bold" ? 700 : undefined,
            textDecoration:
              sp.decoration === "underline"
                ? "underline"
                : sp.decoration === "line-through"
                  ? "line-through"
                  : undefined,
            whiteSpace: "pre-wrap",
          }}
        >
          {sp.text ?? ""}
        </span>
      ))
    ) : (
      <>{c.text ?? ""}</>
    );

  return (
    <ActionWrap action={c.action} style={style}>
      <p style={{ margin: 0, ...style }}>{body}</p>
    </ActionWrap>
  );
}

function FlexImage({ c }: { c: FlexComponent }) {
  const ratio = parseAspectRatio(c.aspectRatio as string | undefined);
  const size = (c.size as string) || "md";
  const width = size === "full" ? "100%" : imageSizeCss(size);
  const cover = c.aspectMode !== "fit";
  const style: CSSProperties = {
    width,
    maxWidth: "100%",
    aspectRatio: String(ratio),
    objectFit: cover ? "cover" : "contain",
    display: "block",
    borderRadius: spacingCss(c.cornerRadius as string | undefined),
    backgroundColor: (c.backgroundColor as string) || undefined,
    flex: c.flex != null ? c.flex : size === "full" ? undefined : 0,
    alignSelf:
      c.align === "center" ? "center" : c.align === "end" ? "flex-end" : "flex-start",
    ...marginStyle(c),
    ...offsetStyle(c),
  };
  const img = (
    <img
      src={String(c.url ?? "")}
      alt=""
      className="max-w-full"
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => {
        (e.target as HTMLImageElement).style.opacity = "0.3";
      }}
    />
  );
  return (
    <ActionWrap action={c.action} style={{ width: size === "full" ? "100%" : undefined }}>
      {img}
    </ActionWrap>
  );
}

function FlexIcon({ c }: { c: FlexComponent }) {
  const size = iconSizeCss(c.size as string | undefined);
  return (
    <img
      src={String(c.url ?? "")}
      alt=""
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        flexShrink: 0,
        ...marginStyle(c),
      }}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function FlexButton({ c }: { c: FlexComponent }) {
  const styleName = c.style || "link";
  const label = c.action?.label || (c.text as string) || "開く";
  const primary = styleName === "primary";
  const secondary = styleName === "secondary";
  const bg = (c.color as string) || (primary ? "#17c950" : secondary ? "#f0f0f0" : "transparent");
  const fg = primary ? "#ffffff" : secondary ? "#111111" : (c.color as string) || "#42659a";
  return (
    <button
      type="button"
      className="w-full truncate rounded-md px-3 py-2 text-center text-sm font-semibold transition-opacity hover:opacity-90"
      style={{
        background: bg,
        color: fg,
        height: c.height === "sm" ? 32 : 40,
        flex: c.flex != null ? c.flex : undefined,
        ...marginStyle(c),
        ...offsetStyle(c),
      }}
      onClick={(e) => {
        e.stopPropagation();
        openFlexAction(c.action);
      }}
    >
      {label}
    </button>
  );
}

function FlexSeparator({ c, horizontal }: { c: FlexComponent; horizontal: boolean }) {
  return (
    <div
      style={{
        background: (c.color as string) || "#e0e0e0",
        width: horizontal ? 1 : "100%",
        height: horizontal ? "auto" : 1,
        alignSelf: "stretch",
        flexShrink: 0,
        ...marginStyle(c),
      }}
    />
  );
}

function FlexVideo({ c }: { c: FlexComponent }) {
  const ratio = parseAspectRatio(c.aspectRatio as string | undefined);
  return (
    <div style={{ width: "100%", aspectRatio: String(ratio), position: "relative", ...marginStyle(c) }}>
      <video
        src={String(c.url ?? "")}
        poster={c.previewUrl ? String(c.previewUrl) : undefined}
        controls
        playsInline
        className="h-full w-full object-cover"
        style={{ borderRadius: spacingCss(c.cornerRadius as string | undefined) }}
      />
    </div>
  );
}

function FlexBox({
  c,
  bubbleWidth,
}: {
  c: FlexComponent;
  bubbleWidth: number;
}) {
  const layout = c.layout || "vertical";
  const horizontal = layout === "horizontal" || layout === "baseline";
  const gap = spacingCss(c.spacing as string | undefined);
  const kids = Array.isArray(c.contents) ? c.contents : [];
  const style: CSSProperties = {
    display: "flex",
    flexDirection: horizontal ? "row" : "column",
    alignItems:
      layout === "baseline"
        ? "baseline"
        : c.alignItems === "center"
          ? "center"
          : c.alignItems === "flex-end" || c.alignItems === "end"
            ? "flex-end"
            : c.alignItems === "flex-start" || c.alignItems === "start"
              ? "flex-start"
              : horizontal
                ? "center"
                : "stretch",
    justifyContent:
      c.justifyContent === "center"
        ? "center"
        : c.justifyContent === "flex-end" || c.justifyContent === "end"
          ? "flex-end"
          : c.justifyContent === "space-between"
            ? "space-between"
            : c.justifyContent === "space-around"
              ? "space-around"
              : c.justifyContent === "space-evenly"
                ? "space-evenly"
                : "flex-start",
    gap: gap || undefined,
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: (c.backgroundColor as string) || undefined,
    borderWidth: c.borderWidth ? spacingCss(c.borderWidth as string) : undefined,
    borderStyle: c.borderWidth ? "solid" : undefined,
    borderColor: (c.borderColor as string) || undefined,
    borderRadius: spacingCss(c.cornerRadius as string | undefined),
    flex: c.flex != null ? c.flex : undefined,
    position: c.position === "absolute" ? "absolute" : "relative",
    height: c.height === "full" ? "100%" : spacingCss(c.height as string | undefined),
    maxHeight: spacingCss(c.maxHeight as string | undefined),
    maxWidth: spacingCss(c.maxWidth as string | undefined),
    ...padStyle(c),
    ...marginStyle(c),
    ...offsetStyle(c),
  };

  const inner = (
    <div style={style}>
      {kids.map((child, i) => (
        <FlexNode key={i} c={child} bubbleWidth={bubbleWidth} parentHorizontal={horizontal} />
      ))}
    </div>
  );

  return <ActionWrap action={c.action}>{inner}</ActionWrap>;
}

function FlexFiller({ c }: { c: FlexComponent }) {
  return <div style={{ flex: c.flex != null ? c.flex : 1, minWidth: 0, minHeight: 0 }} />;
}

function FlexNode({
  c,
  bubbleWidth,
  parentHorizontal,
}: {
  c: FlexComponent;
  bubbleWidth: number;
  parentHorizontal?: boolean;
}) {
  switch (c.type) {
    case "box":
      return <FlexBox c={c} bubbleWidth={bubbleWidth} />;
    case "text":
      return <FlexText c={c} />;
    case "button":
      return <FlexButton c={c} />;
    case "image":
      return <FlexImage c={c} />;
    case "icon":
      return <FlexIcon c={c} />;
    case "separator":
      return <FlexSeparator c={c} horizontal={Boolean(parentHorizontal)} />;
    case "filler":
      return <FlexFiller c={c} />;
    case "video":
      return <FlexVideo c={c} />;
    case "span":
      return <span>{c.text ?? ""}</span>;
    default:
      return null;
  }
}

/** LINE Desktop 準拠: バブルブロック内コンテンツの既定パディング */
const BLOCK_PAD = 11;

function bubbleBlock(
  block: FlexComponent | undefined,
  styles: FlexBubble["styles"],
  key: "header" | "hero" | "body" | "footer",
  bubbleWidth: number,
  showSep: boolean,
) {
  if (!block) return null;
  const st = styles?.[key];
  return (
    <>
      {showSep && st?.separator !== false && key !== "header" && (
        <div
          style={{
            height: 1,
            background: st?.separatorColor || "#e0e0e0",
            width: "100%",
          }}
        />
      )}
      <div style={{ backgroundColor: st?.backgroundColor, width: "100%" }}>
        <div style={{ padding: BLOCK_PAD, width: "100%" }}>
          <FlexNode c={block} bubbleWidth={bubbleWidth} />
        </div>
      </div>
    </>
  );
}

function FlexBubbleView({ bubble }: { bubble: FlexBubble }) {
  const size = bubble.size || "mega";
  const width = BUBBLE_WIDTH[size] ?? BUBBLE_WIDTH.mega!;
  const hasHero = Boolean(bubble.hero);
  const hasHeader = Boolean(bubble.header);
  const hasBody = Boolean(bubble.body);
  const hasFooter = Boolean(bubble.footer);

  const card = (
    <div
      className="overflow-hidden bg-white text-black shadow-sm"
      style={{
        width,
        maxWidth: "100%",
        borderRadius: 12,
        direction: bubble.direction === "rtl" ? "rtl" : "ltr",
      }}
    >
      {bubbleBlock(bubble.header, bubble.styles, "header", width, false)}
      {bubbleBlock(bubble.hero, bubble.styles, "hero", width, hasHeader)}
      {bubbleBlock(bubble.body, bubble.styles, "body", width, hasHeader || hasHero)}
      {bubbleBlock(bubble.footer, bubble.styles, "footer", width, hasHeader || hasHero || hasBody)}
      {!hasHeader && !hasHero && !hasBody && !hasFooter && (
        <div className="px-3 py-2 text-sm text-neutral-500">（空の Flex）</div>
      )}
    </div>
  );

  if (bubble.action) {
    return (
      <button
        type="button"
        className="block border-0 bg-transparent p-0 text-left"
        onClick={(e) => {
          e.stopPropagation();
          openFlexAction(bubble.action);
        }}
      >
        {card}
      </button>
    );
  }
  return card;
}

/** 横スクロールをマウスで掴んでドラッグできるようにする（タッチはネイティブに任せる） */
function useGrabScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down = false;
    let startX = 0;
    let startScroll = 0;
    let moved = 0;
    let suppressClick = false;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      down = true;
      moved = 0;
      suppressClick = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      moved += Math.abs(dx);
      el.scrollLeft = startScroll - dx;
      // 5px 以上動いたらクリックはドラッグとみなして発火させない
      if (moved > 5) suppressClick = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      if (suppressClick) {
        const target = e.target as HTMLElement | null;
        const cancel = (ce: Event) => {
          ce.preventDefault();
          ce.stopPropagation();
          target?.removeEventListener("click", cancel, true);
        };
        target?.addEventListener("click", cancel, true);
      }
    };
    const onCancel = () => {
      down = false;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, [ref]);
}

function FlexCarouselView({ carousel }: { carousel: FlexCarousel }) {
  const items = Array.isArray(carousel.contents) ? carousel.contents : [];
  const scrollRef = useRef<HTMLDivElement>(null);
  useGrabScroll(scrollRef);
  return (
    <div
      ref={scrollRef}
      className="flex max-w-full cursor-grab select-none gap-2 overflow-x-auto pb-1 active:cursor-grabbing [-ms-overflow-style:none] [scrollbar-width:thin]"
      style={{ scrollSnapType: "x mandatory" }}
    >
      {items.map((b, i) => (
        <div key={i} className="shrink-0" style={{ scrollSnapAlign: "start" }}>
          <FlexBubbleView bubble={b.type === "bubble" ? b : { type: "bubble", body: b }} />
        </div>
      ))}
    </div>
  );
}

export function FlexMessageView({
  container,
  altText,
}: {
  container: FlexContainer;
  altText?: string;
}) {
  if (!container || typeof container !== "object") {
    return (
      <div className="rounded-xl bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
        {altText || "Flexメッセージ"}
      </div>
    );
  }

  if (container.type === "carousel") {
    return <FlexCarouselView carousel={container as FlexCarousel} />;
  }
  if (container.type === "bubble") {
    return <FlexBubbleView bubble={container as FlexBubble} />;
  }
  // 単体コンポーネントが来た場合は bubble に包む
  return (
    <FlexBubbleView
      bubble={{
        type: "bubble",
        body: container as FlexComponent,
      }}
    />
  );
}
