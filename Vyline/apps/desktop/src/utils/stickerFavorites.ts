/**
 * スタンプ / 絵文字のお気に入り（IndexedDB 永続）
 */
import { getPersistedValue, setPersistedValue } from "../lib/indexedDbStorage.js";

export type StickerFavorite = {
  type: "sticker" | "emoji";
  packageId: string;
  id: string;
  url: string;
  name?: string;
};

const KEY = (accountId: string) => `vyline:stickerFavorites:${accountId}`;
const memory = new Map<string, StickerFavorite[]>();

export function loadStickerFavorites(accountId: string): StickerFavorite[] {
  const cached = memory.get(accountId);
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const favorites = Array.isArray(parsed) ? parsed : [];
    memory.set(accountId, favorites);
    return favorites;
  } catch {
    return [];
  }
}

export async function hydrateStickerFavorites(accountId: string): Promise<void> {
  if (!accountId || memory.has(accountId)) return;
  try {
    const parsed = await getPersistedValue<unknown>(KEY(accountId));
    if (Array.isArray(parsed)) memory.set(accountId, parsed as StickerFavorite[]);
  } catch {
    /* Keep the localStorage compatibility path. */
  }
}

export function saveStickerFavorites(accountId: string, favs: StickerFavorite[]): void {
  memory.set(accountId, favs);
  try {
    void setPersistedValue(KEY(accountId), favs);
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
