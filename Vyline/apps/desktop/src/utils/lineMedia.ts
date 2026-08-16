/**
 * LINE スタンプ / 絵文字 URL ヘルパ
 * CDN 直リンクではなく /api/cdn/line 経由でディスクキャッシュする。
 */

/** stickershop CDN → ローカルキャッシュプロキシ */
export function lineCdnProxy(url: string): string {
  if (!url.startsWith("https://")) return url;
  if (url.startsWith("/api/cdn/")) return url;
  return `/api/cdn/line?u=${encodeURIComponent(url)}`;
}

/** Android 向け静的スタンプ PNG */
export function lineStickerUrl(stickerId: string): string {
  return lineCdnProxy(
    `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/android/sticker.png`,
  );
}

/** アニメーションがある場合の APNG */
export function lineStickerAnimationUrl(stickerId: string): string {
  return lineCdnProxy(
    `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/ANDROID/sticker_animation.png`,
  );
}

export function extractStickerId(
  meta: Record<string, string | undefined> | null | undefined,
): string | null {
  if (!meta) return null;
  const id =
    meta.STKID ??
    meta.STICKER_ID ??
    meta.stickerId ??
    meta.STK_ID;
  return id && String(id).length > 0 ? String(id) : null;
}
