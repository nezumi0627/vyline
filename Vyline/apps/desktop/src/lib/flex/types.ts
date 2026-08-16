/** LINE Flex Message / RICH Message の表示用型（Messaging API 準拠） */

export type FlexSizeKeyword =
  | "xxs"
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "xxl"
  | "3xl"
  | "4xl"
  | "5xl"
  | "full"
  | "none";

export type FlexBubbleSize = "nano" | "micro" | "kilo" | "mega" | "giga" | "hecto" | "deca";

export type FlexAction = {
  type?: string;
  label?: string;
  uri?: string;
  text?: string;
  data?: string;
  [key: string]: unknown;
};

export type FlexComponent = {
  type: string;
  layout?: "horizontal" | "vertical" | "baseline";
  contents?: FlexComponent[];
  text?: string;
  url?: string;
  previewUrl?: string;
  size?: string;
  flex?: number;
  weight?: "regular" | "bold";
  color?: string;
  align?: "start" | "end" | "center";
  gravity?: "top" | "bottom" | "center";
  wrap?: boolean;
  maxLines?: number;
  style?: "link" | "primary" | "secondary";
  height?: string;
  aspectRatio?: string;
  aspectMode?: "cover" | "fit";
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: string;
  cornerRadius?: string;
  margin?: string;
  spacing?: string;
  paddingAll?: string;
  paddingTop?: string;
  paddingBottom?: string;
  paddingStart?: string;
  paddingEnd?: string;
  position?: "relative" | "absolute";
  offsetTop?: string;
  offsetBottom?: string;
  offsetStart?: string;
  offsetEnd?: string;
  action?: FlexAction;
  actions?: FlexAction[];
  decoration?: "none" | "underline" | "line-through";
  lineSpacing?: string;
  adjustMode?: string;
  scaling?: boolean;
  animated?: boolean;
  altContent?: FlexComponent;
  [key: string]: unknown;
};

export type FlexBubble = {
  type: "bubble";
  size?: FlexBubbleSize;
  direction?: "ltr" | "rtl";
  header?: FlexComponent;
  hero?: FlexComponent;
  body?: FlexComponent;
  footer?: FlexComponent;
  styles?: {
    header?: { backgroundColor?: string; separator?: boolean; separatorColor?: string };
    hero?: { backgroundColor?: string; separator?: boolean; separatorColor?: string };
    body?: { backgroundColor?: string; separator?: boolean; separatorColor?: string };
    footer?: { backgroundColor?: string; separator?: boolean; separatorColor?: string };
  };
  action?: FlexAction;
};

export type FlexCarousel = {
  type: "carousel";
  contents: FlexBubble[];
};

export type FlexContainer = FlexBubble | FlexCarousel | FlexComponent;

/** Desktop RICH (contentType=17) — MARKUP_JSON */
export type RichMarkup = {
  canvas?: { width?: number; height?: number; initialScene?: string };
  images?: Record<string, { x?: number; y?: number; w?: number; h?: number }>;
  actions?: Record<
    string,
    {
      type?: string;
      text?: string;
      params?: { linkUri?: string; [key: string]: unknown };
    }
  >;
  scenes?: Record<
    string,
    {
      draws?: Array<{ x?: number; y?: number; w?: number; h?: number; image?: string }>;
      listeners?: Array<{
        type?: string;
        action?: string;
        params?: number[];
      }>;
      video?: {
        videoUri?: string;
        previewUri?: string;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
      };
    }
  >;
};
