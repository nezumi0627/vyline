/** LINE Flex サイズ／余白キーワード → CSS（公式 layout ドキュメント準拠の近似） */

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
  xxl: "26px",
  "3xl": "29px",
  "4xl": "32px",
  "5xl": "40px",
};

/** bubble 幅（LINE Messaging API 準拠 + Desktop 実測） */
export const BUBBLE_WIDTH: Record<string, number> = {
  nano: 120,
  micro: 160,
  kilo: 220,
  mega: 300,
  giga: 300,
  /** LINE 新サイズ（未対応クライアントは kilo 扱い） */
  hecto: 240,
  deca: 280,
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

/** image / icon size → 幅（親に対する % または px） */
export function imageSizeCss(size?: string | null): string {
  if (!size || size === "md") return "60%";
  if (size === "full") return "100%";
  const map: Record<string, string> = {
    xxs: "40px",
    xs: "60px",
    sm: "80px",
    lg: "80%",
    xl: "90%",
    xxl: "95%",
    "3xl": "100%",
    "4xl": "100%",
    "5xl": "100%",
  };
  return map[size] ?? spacingCss(size) ?? "60%";
}

export function iconSizeCss(size?: string | null): string {
  const map: Record<string, string> = {
    xxs: "16px",
    xs: "20px",
    sm: "24px",
    md: "28px",
    lg: "32px",
    xl: "36px",
    xxl: "40px",
    "3xl": "44px",
    "4xl": "48px",
    "5xl": "52px",
  };
  if (!size) return map.md!;
  return map[size] ?? spacingCss(size) ?? map.md!;
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

export function openFlexAction(action?: {
  type?: string;
  uri?: string;
  text?: string;
  label?: string;
} | null): void {
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
