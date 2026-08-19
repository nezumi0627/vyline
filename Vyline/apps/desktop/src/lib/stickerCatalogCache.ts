/**
 * スタンプ/絵文字カタログのフロント側キャッシュ（メモリ + localStorage）
 * パネルを開くたびに待ちたくないので stale-while-revalidate。
 */

export type CatalogItem = { id: string; url: string; alt?: string };
export type CatalogPack = {
  packageId: string;
  name: string;
  type: "sticker" | "emoji";
  tabUrl: string;
  items: CatalogItem[];
};

export type StickersCatalogCache = {
  premium: {
    active: boolean;
    planType?: string | number;
    onFreeTrial?: boolean;
  };
  stickerPacks: CatalogPack[];
  emojiPacks: CatalogPack[];
};

const MEM_TTL_MS = 30 * 60_000;
const DISK_TTL_MS = 24 * 60 * 60_000;

let mem: { accountId: string; at: number; data: StickersCatalogCache } | null = null;

function storageKey(accountId: string): string {
  return `vyline:stickers-catalog:v2:${accountId}`;
}

export function getCachedStickersCatalog(accountId: string): StickersCatalogCache | null {
  if (mem && mem.accountId === accountId && Date.now() - mem.at < MEM_TTL_MS) {
    return mem.data;
  }
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      at: number;
      data: StickersCatalogCache;
    };
    if (!parsed?.data?.stickerPacks || !parsed?.data?.emojiPacks) return null;
    if (Date.now() - parsed.at > DISK_TTL_MS) return null;
    mem = { accountId, at: parsed.at, data: parsed.data };
    return parsed.data;
  } catch {
    return null;
  }
}

export function isStickersCatalogFresh(accountId: string): boolean {
  if (mem?.accountId === accountId && Date.now() - mem.at < MEM_TTL_MS) {
    return true;
  }
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { at: number };
    return Date.now() - (parsed.at ?? 0) < MEM_TTL_MS;
  } catch {
    return false;
  }
}

export function setCachedStickersCatalog(accountId: string, data: StickersCatalogCache): void {
  mem = { accountId, at: Date.now(), data };
  try {
    localStorage.setItem(storageKey(accountId), JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota */
  }
}
