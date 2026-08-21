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

/**
 * LINE の picturePath / pictureStatus（ハッシュ or /から始まるパス）を
 * プロフィール CDN のフル URL に変換し、ディスクキャッシュプロキシを通す。
 * すでにフル URL の場合はプロフィール CDN のみプロキシに通す（他 CDN は素通し）。
 */
export function lineAvatarUrl(path?: string | null): string | undefined {
  if (!path || path.trim() === "") return undefined;
  let s = path.trim();
  // 過去のキャッシュ等に存在する https://profile.line-scdn.net//xxx の二重スラッシュを正規化
  s = s.replace(/^(https?:\/\/[^/]+\/)\/(?=\/)/, "$1");
  if (s.startsWith("http://") || s.startsWith("https://")) {
    if (s.includes("profile.line-scdn.net") || s.includes("static.line-scdn.net")) {
      return lineCdnProxy(s);
    }
    return s;
  }
  const cleaned = s.startsWith("/") ? s : `/${s}`;
  return lineCdnProxy(`https://profile.line-scdn.net${cleaned}`);
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
  const id = meta.CSSTKID ?? meta.STKID ?? meta.STICKER_ID ?? meta.stickerId ?? meta.STK_ID;
  return id && String(id).length > 0 ? String(id) : null;
}

/**
 * 画像取得失敗時に壊れた画像アイコンを出さない共通ハンドラ。
 * 要素を非表示にする（フォールバック文字やプレースホルダは呼び出し側が用意）。
 */
export function hideBrokenMedia(e: {
  currentTarget: HTMLImageElement;
}): void {
  const el = e.currentTarget;
  el.onerror = null; // 再帰防止
  el.style.display = "none";
  const fallback = el.nextElementSibling as HTMLElement | null;
  if (fallback) fallback.style.display = "flex";
}
