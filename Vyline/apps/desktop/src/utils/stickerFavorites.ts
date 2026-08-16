/**
 * スタンプ / 絵文字のお気に入り（localStorage 永続）
 */

export type StickerFavorite = {
  type: "sticker" | "emoji";
  packageId: string;
  id: string;
  url: string;
  name?: string;
};

const KEY = (accountId: string) => `vyline:stickerFavorites:${accountId}`;

export function loadStickerFavorites(accountId: string): StickerFavorite[] {
  try {
    const raw = localStorage.getItem(KEY(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStickerFavorites(accountId: string, favs: StickerFavorite[]): void {
  try {
    localStorage.setItem(KEY(accountId), JSON.stringify(favs));
  } catch {
    /* quota / private mode */
  }
}

export function toggleStickerFavorite(
  accountId: string,
  fav: StickerFavorite,
): { favorites: StickerFavorite[]; added: boolean } {
  const cur = loadStickerFavorites(accountId);
  const idx = cur.findIndex((f) => f.type === fav.type && f.id === fav.id);
  let next: StickerFavorite[];
  let added: boolean;
  if (idx >= 0) {
    next = cur.filter((_, i) => i !== idx);
    added = false;
  } else {
    next = [...cur, fav];
    added = true;
  }
  saveStickerFavorites(accountId, next);
  return { favorites: next, added };
}

/** スタンプ / 絵文字の LINE Store URL */
export function lineStoreUrl(type: "sticker" | "emoji", packageId: string): string {
  const product = type === "sticker" ? "stickershop" : "sticonshop";
  return `https://store.line.me/${product}/product/${packageId}`;
}
