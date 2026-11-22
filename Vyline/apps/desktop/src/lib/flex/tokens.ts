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
