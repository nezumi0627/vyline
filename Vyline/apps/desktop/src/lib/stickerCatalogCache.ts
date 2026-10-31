/**
 * スタンプ/絵文字カタログのフロント側キャッシュ（メモリ + IndexedDB）
 * パネルを開くたびに待ちたくないので stale-while-revalidate。
 */
import { getPersistedValue, setPersistedValue } from "./indexedDbStorage.js";

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
const MEM_MAX_ACCOUNTS = 8;

const mem = new Map<string, { at: number; data: StickersCatalogCache }>();

function remember(accountId: string, entry: { at: number; data: StickersCatalogCache }): void {
  mem.delete(accountId);
  mem.set(accountId, entry);
  while (mem.size > MEM_MAX_ACCOUNTS) {
    const oldest = mem.keys().next().value;
    if (oldest === undefined) break;
    mem.delete(oldest);
  }
}

export async function hydrateStickersCatalog(accountId: string): Promise<void> {
  if (!accountId) return;
  const beforeRead = mem.get(accountId);
  if (beforeRead && Date.now() - beforeRead.at <= DISK_TTL_MS) return;
  try {
    const parsed = await getPersistedValue<{ at: number; data: StickersCatalogCache }>(storageKey(accountId));
    if (!parsed) return;
    if (
      mem.get(accountId) === beforeRead &&
      parsed?.data?.stickerPacks &&
      parsed?.data?.emojiPacks &&
      Date.now() - parsed.at <= DISK_TTL_MS
    ) {
      remember(accountId, { at: parsed.at, data: parsed.data });
    }
  } catch {
    /* Keep the localStorage compatibility path available. */
  }
}

function storageKey(accountId: string): string {
  return `vyline:stickers-catalog:v2:${accountId}`;
}

export function getCachedStickersCatalog(accountId: string): StickersCatalogCache | null {
  const cached = mem.get(accountId);
  if (cached && Date.now() - cached.at <= DISK_TTL_MS) {
    remember(accountId, cached);
    return cached.data;
  }
  if (cached) mem.delete(accountId);
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      at: number;
      data: StickersCatalogCache;
    };
    if (!parsed?.data?.stickerPacks || !parsed?.data?.emojiPacks) return null;
    if (Date.now() - parsed.at > DISK_TTL_MS) return null;
    remember(accountId, { at: parsed.at, data: parsed.data });
    return parsed.data;
  } catch {
    return null;
  }
}

export function isStickersCatalogFresh(accountId: string): boolean {
  const cached = mem.get(accountId);
  if (cached && Date.now() - cached.at < MEM_TTL_MS) {
    return true;
  }
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey(accountId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { at: number };
    return Date.now() - (parsed.at ?? 0) < MEM_TTL_MS;
  } catch {
    return false;
  }
}

export function setCachedStickersCatalog(accountId: string, data: StickersCatalogCache): void {
  const at = Date.now();
  remember(accountId, { at, data });
  try {
    void setPersistedValue(storageKey(accountId), { at, data });
  } catch {
    /* quota */
  }
}
