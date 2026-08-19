import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type {
  FlexAction,
  FlexBubble,
  FlexCarousel,
  FlexComponent,
  FlexContainer,
} from "@/lib/flex/types";
import { fontSizeCss, openFlexAction, parseAspectRatio, spacingCss } from "@/lib/flex/tokens";
import "@/lib/flex/flex-main.css";

/** LINE Flex Simulator 公式描画の完全移植。
 *  HTML 構造・クラスは公式 renderer (static.line-scdn.net/line_flexible_msg/.../sp/main.css) 準拠。 */

const LY: Record<string, string> = {
  nano: "LyNa",
  micro: "LyMi",
  kilo: "LyKi",
  hecto: "LyHe",
  deca: "LyDe",
  mega: "LyMe",
  giga: "LyGi",
};

const EX_SIZE: Record<string, string> = {
  xxs: "ExXXs",
  xs: "ExXs",
  sm: "ExSm",
  md: "ExMd",
  lg: "ExLg",
  xl: "ExXl",
  xxl: "ExXXl",
  "3xl": "Ex3Xl",
  "4xl": "Ex4Xl",
  "5xl": "Ex5Xl",
  full: "ExFull",
};

const SPC: Record<string, string> = {
  xs: "spcXs",
  sm: "spcSm",
  md: "spcMd",
  lg: "spcLg",
  xl: "spcXl",
  xxl: "spcXXl",
};

const JFC: Record<string, string> = {
  center: "itms-jfcC",
  "flex-end": "itms-jfcE",
  end: "itms-jfcE",
  "space-between": "itms-jfcSB",
  "space-around": "itms-jfcSA",
  "space-evenly": "itms-jfcSE",
};

const ALG: Record<string, string> = {
  center: "itms-algC",
  "flex-end": "itms-algE",
  end: "itms-algE",
  "flex-start": "itms-algS",
  start: "itms-algS",
  baseline: "itms-algBL",
  stretch: "itms-algSR",
};

/** flex 値 → クラス（0-3 は公式 fl0..fl3 を使う）。それ以外は inline flex（比率指定 flex:22 等） */
function flexCls(n: unknown): string | undefined {
  if (typeof n !== "number") return undefined;
  if (Number.isInteger(n) && n >= 0 && n <= 3) return `fl${n}`;
  return undefined;
}

function flexStyle(n: unknown): CSSProperties | undefined {
  if (typeof n !== "number") return undefined;
  if (Number.isInteger(n) && n >= 0 && n <= 3) return undefined;
  return { flexGrow: n, flexShrink: 0, flexBasis: 0 };
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

/** action（uri/clipboard）をクリック可能にする props */
function clickProps(action?: FlexAction): {
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  style?: CSSProperties;
} {
  if (!action) return {};
  const clickable = action.type === "uri" || action.type === "clipboard" || Boolean(action.uri);
  if (!clickable) return {};
  return {
    onClick: (e) => {
      e.stopPropagation();
      openFlexAction(action);
    },
    style: { cursor: "pointer" },
  };
}

function boxStyle(c: FlexComponent): CSSProperties {
  const s: CSSProperties = {};
  if (c.paddingAll != null) s.padding = spacingCss(c.paddingAll as string);
  if (c.paddingTop != null) s.paddingTop = spacingCss(c.paddingTop as string);
  if (c.paddingBottom != null) s.paddingBottom = spacingCss(c.paddingBottom as string);
  if (c.paddingStart != null) s.paddingLeft = spacingCss(c.paddingStart as string);
  if (c.paddingEnd != null) s.paddingRight = spacingCss(c.paddingEnd as string);
  if (c.width != null) s.width = c.width === "full" ? "100%" : spacingCss(c.width as string);
  if (c.height != null) s.height = c.height === "full" ? "100%" : spacingCss(c.height as string);
  if (c.maxWidth != null) s.maxWidth = spacingCss(c.maxWidth as string);
  if (c.maxHeight != null) s.maxHeight = spacingCss(c.maxHeight as string);
  if (c.backgroundColor) s.backgroundColor = c.backgroundColor as string;
  if (c.borderWidth) {
    s.borderWidth = spacingCss(c.borderWidth as string);
    s.borderStyle = "solid";
    s.borderColor = (c.borderColor as string) || "#000000";
  }
  if (c.cornerRadius) s.borderRadius = spacingCss(c.cornerRadius as string);
  return { ...s, ...offsetStyle(c) };
}

function FlexBoxNode({ c }: { c: FlexComponent }) {
  const horizontal = c.layout === "horizontal" || c.layout === "baseline";
  const cp = clickProps(c.action);
  const cls = cn(
    "MdBx",
    horizontal ? "hr" : "vr",
    horizontal && c.layout === "baseline" ? "bl" : undefined,
    JFC[c.justifyContent as string],
    ALG[c.alignItems as string],
    c.flex != null ? flexCls(c.flex) : c.width != null || c.height != null ? "fl0" : undefined,
    c.position === "absolute" ? "ExAbs" : undefined,
    c.spacing ? SPC[c.spacing as string] : undefined,
  );
  return (
    <div
      className={cls}
      style={{ ...boxStyle(c), ...flexStyle(c.flex), ...cp.style }}
      onClick={cp.onClick}
    >
      {(Array.isArray(c.contents) ? c.contents : []).map((ch, i) => (
        <FlexNode key={i} c={ch} />
      ))}
    </div>
  );
}

function FlexTextNode({ c }: { c: FlexComponent }) {
  const spans = Array.isArray(c.contents) ? c.contents.filter((x) => x.type === "span") : [];
  const cp = clickProps(c.action);
  const cls = cn(
    "MdTxt",
    c.wrap ? "ExWrap" : undefined,
    c.align === "center" ? "ExAlgC" : c.align === "end" ? "ExAlgE" : undefined,
    c.weight === "bold" ? "ExWB" : c.weight === "regular" ? "ExWR" : undefined,
    c.decoration === "underline"
      ? "ExTxtDecUl"
      : c.decoration === "line-through"
        ? "ExTxtDecLt"
        : undefined,
    c.flex != null ? flexCls(c.flex) : c.width != null || c.height != null ? "fl0" : undefined,
  );
  const maxLines = c.maxLines != null && Number(c.maxLines) > 0 ? Number(c.maxLines) : undefined;
  const pStyle: CSSProperties = maxLines
    ? {
        display: "-webkit-box",
        WebkitLineClamp: maxLines,
        WebkitBoxOrient: "vertical",
        whiteSpace: "normal",
        overflow: "hidden",
      }
    : {};
  const body =
    spans.length > 0 ? (
      spans.map((sp, i) => (
        <span
          key={i}
          className="MdSpn"
          style={{
            color: sp.color as string | undefined,
            fontSize: sp.size ? fontSizeCss(sp.size as string) : undefined,
            fontWeight: sp.weight === "bold" ? "bold" : undefined,
            textDecoration:
              sp.decoration === "underline"
                ? "underline"
                : sp.decoration === "line-through"
                  ? "line-through"
                  : undefined,
          }}
        >
          {sp.text ?? ""}
        </span>
      ))
    ) : (
      <>{c.text ?? ""}</>
    );
  return (
    <div
      className={cls}
      style={{
        fontSize: fontSizeCss(c.size as string) || "16px",
        color: c.color as string | undefined,
        top: spacingCss(c.offsetTop as string | undefined),
        marginTop: spacingCss(c.margin as string | undefined),
        ...flexStyle(c.flex),
        ...cp.style,
      }}
      onClick={cp.onClick}
    >
      <p style={pStyle}>{body}</p>
    </div>
  );
}

function FlexImageNode({ c }: { c: FlexComponent }) {
  const aspect = parseAspectRatio(c.aspectRatio as string | undefined);
  const cp = clickProps(c.action);
  const size = c.size as string | undefined;
  // size が px 直指定（"16px" 等）の場合は公式 Ex* キーワードにないため inline width にする
  const pxSize = /^\d+(\.\d+)?px$/.test(size ?? "") ? size : undefined;
  const sizeCls = size ? (EX_SIZE[size] ?? undefined) : "ExMd";
  return (
    <div
      className={cn(
        "MdImg",
        sizeCls,
        flexCls(c.flex),
        c.aspectMode !== "fit" ? "ExCover" : "ExFit",
        c.align === "start" ? "algS" : c.align === "end" ? "algE" : undefined,
      )}
      style={{
        borderRadius: spacingCss(c.cornerRadius as string | undefined),
        ...flexStyle(c.flex),
        ...cp.style,
      }}
      onClick={cp.onClick}
    >
      <div style={pxSize ? { width: pxSize } : undefined}>
        <a style={{ paddingBottom: `${(1 / aspect) * 100}%` }}>
          <span style={{ backgroundImage: `url('${c.url}')` }} />
        </a>
      </div>
    </div>
  );
}

function FlexIconNode({ c }: { c: FlexComponent }) {
  const cp = clickProps(c.action);
  return (
    <div
      className={cn("MdIco", EX_SIZE[c.size as string] ?? "ExMd")}
      style={cp.style}
      onClick={cp.onClick}
    >
      <span style={{ backgroundImage: `url('${c.url}')` }} />
    </div>
  );
}

function FlexButtonNode({ c }: { c: FlexComponent }) {
  const styleName = c.style || "link";
  const label = c.action?.label || (c.text as string) || "開く";
  const cls = cn(
    "MdBtn",
    styleName === "primary" ? "ExBtn1" : styleName === "secondary" ? "ExBtn2" : "ExBtnL",
    c.height === "sm" ? "ExSm" : undefined,
  );
  return (
    <div
      className={cls}
      style={{ ...marginStyle(c), ...(c.flex != null ? { flex: `0 0 ${c.flex}` } : {}) }}
    >
      <a
        onClick={(e) => {
          e.preventDefault();
          openFlexAction(c.action);
        }}
        style={{ cursor: "pointer", backgroundColor: c.color as string | undefined }}
      >
        <div>{label}</div>
      </a>
    </div>
  );
}

function FlexSeparatorNode({ c, horizontal }: { c: FlexComponent; horizontal: boolean }) {
  return (
    <div
      className={cn("MdSep", horizontal ? "MdSepB" : undefined)}
      style={{ borderColor: (c.color as string) || "#d4d6da" }}
    />
  );
}

function FlexVideoNode({ c }: { c: FlexComponent }) {
  const ratio = parseAspectRatio(c.aspectRatio as string | undefined);
  return (
    <div
      style={{ width: "100%", aspectRatio: String(ratio), position: "relative", ...marginStyle(c) }}
    >
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

function FlexNode({ c }: { c: FlexComponent }) {
  switch (c.type) {
    case "box":
      return <FlexBoxNode c={c} />;
    case "text":
      return <FlexTextNode c={c} />;
    case "button":
      return <FlexButtonNode c={c} />;
    case "image":
      return <FlexImageNode c={c} />;
    case "icon":
      return <FlexIconNode c={c} />;
    case "separator":
      return <FlexSeparatorNode c={c} horizontal={false} />;
    case "filler":
      return <div className="mdBxFiller" />;
    case "video":
      return <FlexVideoNode c={c} />;
    case "span":
      return <span className="MdSpn">{c.text ?? ""}</span>;
    default:
      return null;
  }
}

function bubbleBlock(
  key: "header" | "hero" | "body" | "footer",
  comp: FlexComponent | undefined,
  styles: FlexBubble["styles"],
  hasFooter: boolean,
): ReactNode {
  if (!comp) return null;
  const st = styles?.[key];
  return (
    <Fragment key={key}>
      {key !== "header" && st?.separator === true && (
        <div className="MdSep" style={{ borderColor: st.separatorColor || "#d4d6da" }} />
      )}
      <div
        className={cn(
          `t1${key.charAt(0).toUpperCase()}${key.slice(1)}`,
          key === "body" && hasFooter ? "ExHasFooter" : undefined,
        )}
      >
        <FlexNode c={comp} />
      </div>
    </Fragment>
  );
}

function FlexBubbleView({ bubble }: { bubble: FlexBubble }) {
  const size = bubble.size || "mega";
  const ly = LY[size] ?? "LyMe";
  const hasFooter = Boolean(bubble.footer);
  const card = (
    <div className="vfx">
      <div className={ly}>
        <div className={cn("T1", "fxLTR")} dir={bubble.direction === "rtl" ? "rtl" : "ltr"}>
          {bubbleBlock("header", bubble.header, bubble.styles, hasFooter)}
          {bubbleBlock("hero", bubble.hero, bubble.styles, hasFooter)}
          {bubbleBlock("body", bubble.body, bubble.styles, hasFooter)}
          {bubbleBlock("footer", bubble.footer, bubble.styles, hasFooter)}
          {!bubble.header && !bubble.hero && !bubble.body && !bubble.footer && (
            <div className="px-3 py-2 text-sm text-neutral-500">（空の Flex）</div>
          )}
        </div>
      </div>
    </div>
  );
  if (bubble.action) {
    const cp = clickProps(bubble.action);
    return (
      <button
        type="button"
        className="block border-0 bg-transparent p-0 text-left"
        onClick={cp.onClick}
      >
        {card}
      </button>
    );
  }
  return card;
}

/** 横スクロールをマウスで掴んでドラッグできるようにする（タッチはネイティブに任せる） */
function useGrabScroll(ref: React.RefObject<HTMLElement | null>) {
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
      className="vfx flex max-w-full cursor-grab select-none gap-2 overflow-x-auto pb-1 active:cursor-grabbing"
    >
      {items.map((b, i) => (
        <div key={i} className="shrink-0">
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
  return (
    <FlexBubbleView
      bubble={{
        type: "bubble",
        body: container as FlexComponent,
      }}
    />
  );
}
