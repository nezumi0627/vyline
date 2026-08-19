/** LINE Flex Message 描画の公式値を移植。
 *  source: LINE Flex Simulator が返す公式 CSS
 *  (static.line-scdn.net/line_flexible_msg/{rev}/css/sp/main.css) の実測値。
 */

const SPACING: Record<string, string> = {
  none: "0px",
  xs: "2px",
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  xxl: "20px",
};

const FONT: Record<string, string> = {
  xxs: "11px",
  xs: "13px",
  sm: "14px",
  md: "16px",
  lg: "19px",
  xl: "22px",
  xxl: "29px",
  "3xl": "35px",
  "4xl": "48px",
  "5xl": "74px",
};

/** bubble 幅（LINE 公式仕様値。シミュレータ sp CSS はモバイル用に大きめのため、Desktop 準拠の公式値を使用） */
export const BUBBLE_WIDTH: Record<string, number> = {
  nano: 120,
  micro: 160,
  kilo: 220,
  mega: 300,
  giga: 300,
  hecto: 240,
  deca: 280,
};

/** bubble 角丸（公式 .T1 + サイズ別） */
export const BUBBLE_RADIUS: Record<string, number> = {
  nano: 10,
  micro: 10,
  kilo: 10,
  mega: 17,
  giga: 17,
  hecto: 10,
  deca: 10,
};

/** ブロックの既定 padding（px）。ブロックのルート box が自身の padding を持つ場合は使われない。
 *  公式 CSS: .t1Header/.t1Body/.t1Footer > .MdBx の padding（サイズ別） */
export type BlockPad = { top: number; right: number; bottom: number; left: number };

const P = (v: number): BlockPad => ({ top: v, right: v, bottom: v, left: v });

export const BLOCK_PAD: Record<
  string,
  { header: BlockPad; body: BlockPad; bodyFooterBottom: number; footer: BlockPad }
> = {
  nano: { header: P(10), body: P(10), bodyFooterBottom: 10, footer: P(10) },
  micro: { header: P(10), body: P(10), bodyFooterBottom: 10, footer: P(10) },
  kilo: { header: P(13), body: P(13), bodyFooterBottom: 17, footer: P(10) },
  hecto: {
    header: { top: 11, right: 14, bottom: 13, left: 14 },
    body: { top: 11, right: 14, bottom: 13, left: 14 },
    bodyFooterBottom: 17,
    footer: P(10),
  },
  deca: {
    header: { top: 11, right: 14, bottom: 13, left: 14 },
    body: { top: 11, right: 14, bottom: 13, left: 14 },
    bodyFooterBottom: 17,
    footer: P(10),
  },
  mega: {
    header: P(20),
    body: { top: 19, right: 20, bottom: 20, left: 20 },
    bodyFooterBottom: 10,
    footer: P(10),
  },
  giga: {
    header: P(20),
    body: { top: 19, right: 20, bottom: 20, left: 20 },
    bodyFooterBottom: 10,
    footer: P(10),
  },
};

export function spacingCss(value?: string | null): string | undefined {
  if (value == null || value === "") return undefined;
  if (SPACING[value] != null) return SPACING[value];
  if (/^-?\d+(\.\d+)?(px|%)?$/.test(value)) {
    return value.endsWith("px") || value.endsWith("%") ? value : `${value}px`;
  }
  return value;
}

export function fontSizeCss(value?: string | null): string | undefined {
  if (value == null || value === "") return undefined;
  if (FONT[value] != null) return FONT[value];
  if (/^\d+(\.\d+)?(px|%)?$/.test(value)) {
    return value.endsWith("px") || value.endsWith("%") ? value : `${value}px`;
  }
  return value;
}

/** image size → 幅（公式 MdImg.Ex*）。size 未指定時は md=100px */
export function imageSizeCss(size?: string | null): string {
  const map: Record<string, string> = {
    xxs: "40px",
    xs: "60px",
    sm: "80px",
    md: "100px",
    lg: "120px",
    xl: "140px",
    xxl: "160px",
    "3xl": "180px",
    "4xl": "200px",
    "5xl": "220px",
    full: "100%",
  };
  return map[size ?? ""] ?? "100px";
}

/** icon size → 辺長（公式 MdIco: 1em × 1em、サイズは font-size） */
export function iconSizeCss(size?: string | null): string {
  const map: Record<string, string> = {
    xxs: "11px",
    xs: "13px",
    sm: "14px",
    md: "16px",
    lg: "19px",
    xl: "22px",
    xxl: "29px",
    "3xl": "35px",
    "4xl": "48px",
    "5xl": "74px",
  };
  return map[size ?? ""] ?? "16px";
}

export function parseAspectRatio(ratio?: string | null): number {
  if (!ratio) return 1;
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m) return 1;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return 1;
  return w / h;
}

export function openFlexAction(
  action?: {
    type?: string;
    uri?: string;
    text?: string;
    label?: string;
  } | null,
): void {
  if (!action) return;
  const t = (action.type ?? "").toLowerCase();
  if (t === "uri" && action.uri) {
    window.open(action.uri, "_blank", "noopener,noreferrer");
    return;
  }
  if (t === "clipboard" && typeof action.text === "string") {
    void navigator.clipboard?.writeText(action.text);
  }
  // message / postback は受信クライアントでは送信できないため無視
}
