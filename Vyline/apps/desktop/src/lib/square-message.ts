export type SquareStickerInput = {
  contentType?: string | number;
  contentMetadata?: Record<string, string> | null;
};

/** Build a sticker URL only from numeric IDs and a fixed LINE CDN origin. */
export function getSquareStickerUrl(message: SquareStickerInput): string | null {
  if (message.contentType !== "STICKER" && message.contentType !== 7) return null;
  const metadata = message.contentMetadata;
  const stickerId = metadata?.CSSTKID || metadata?.STKID;
  if (!stickerId || !/^\d{1,20}$/.test(stickerId)) return null;
  const filename = metadata?.STKOPT === "A" ? "sticker_animation.png" : "sticker.png";
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/android/${filename}`;
}
