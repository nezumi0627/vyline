/**
 * Vyline クライアント側キャッシュ — mid → name / icon の即時解決
 * localStorage: vyline-profile-cache:{accountId}
 */

import { looksLikeMid, type ContactInfo } from "./mappers.js";

export type VylineClientProfile = {
  mid: string;
  displayName: string;
  thumbnailUrl?: string;
  statusMessage?: string;
  musicProfile?: string;
  birthday?: string;
  backgroundUrl?: string;
  updatedAt: number;
};

type VylineClientDb = {
  version: 1;
  profiles: Record<string, VylineClientProfile>;
};

function key(accountId: string): string {
  return `vyline-profile-cache:${accountId}`;
}

function empty(): VylineClientDb {
  return { version: 1, profiles: {} };
}

export function vylineClientLoad(accountId: string): VylineClientDb {
  if (!accountId || typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as VylineClientDb;
    if (!parsed?.profiles) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

export function vylineClientSave(accountId: string, db: VylineClientDb): void {
  if (!accountId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key(accountId), JSON.stringify(db));
  } catch {
    /* quota */
  }
}

export function vylineClientPut(
  accountId: string,
  entry: Omit<VylineClientProfile, "updatedAt"> & { updatedAt?: number },
): void {
  const db = vylineClientLoad(accountId);
  const prev = db.profiles[entry.mid];
  const name = entry.displayName?.trim() ?? "";
  db.profiles[entry.mid] = {
    mid: entry.mid,
    displayName:
      name && !looksLikeMid(name)
        ? name
        : prev?.displayName && !looksLikeMid(prev.displayName)
          ? prev.displayName
          : name || entry.mid,
    thumbnailUrl: entry.thumbnailUrl || prev?.thumbnailUrl,
    statusMessage: entry.statusMessage !== undefined ? entry.statusMessage : prev?.statusMessage,
    musicProfile: entry.musicProfile !== undefined ? entry.musicProfile : prev?.musicProfile,
    birthday: entry.birthday !== undefined ? entry.birthday : prev?.birthday,
    backgroundUrl: entry.backgroundUrl !== undefined ? entry.backgroundUrl : prev?.backgroundUrl,
    updatedAt: entry.updatedAt ?? Date.now(),
  };
  vylineClientSave(accountId, db);
}

export function vylineClientPutMany(
  accountId: string,
  entries: Array<Omit<VylineClientProfile, "updatedAt">>,
): void {
  if (!entries.length) return;
  const db = vylineClientLoad(accountId);
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.mid) continue;
    const prev = db.profiles[entry.mid];
    const name = entry.displayName?.trim() ?? "";
    db.profiles[entry.mid] = {
      mid: entry.mid,
      displayName:
        name && !looksLikeMid(name)
          ? name
          : prev?.displayName && !looksLikeMid(prev.displayName)
            ? prev.displayName
            : name || entry.mid,
      thumbnailUrl: entry.thumbnailUrl || prev?.thumbnailUrl,
      statusMessage: entry.statusMessage !== undefined ? entry.statusMessage : prev?.statusMessage,
      musicProfile: entry.musicProfile !== undefined ? entry.musicProfile : prev?.musicProfile,
      birthday: entry.birthday !== undefined ? entry.birthday : prev?.birthday,
      backgroundUrl: entry.backgroundUrl !== undefined ? entry.backgroundUrl : prev?.backgroundUrl,
      updatedAt: now,
    };
  }
  vylineClientSave(accountId, db);
}

export function vylineClientToContactMap(accountId: string): Map<string, ContactInfo> {
  const db = vylineClientLoad(accountId);
  const out = new Map<string, ContactInfo>();
  for (const [mid, p] of Object.entries(db.profiles)) {
    if (p.displayName && !looksLikeMid(p.displayName)) {
      out.set(mid, { name: p.displayName, thumbnailUrl: p.thumbnailUrl });
    } else if (p.thumbnailUrl) {
      out.set(mid, { thumbnailUrl: p.thumbnailUrl });
    }
  }
  return out;
}

export function parseMusicProfile(raw: string | undefined | null): {
  title?: string;
  artist?: string;
  raw: string;
} | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  try {
    const j = JSON.parse(s) as Record<string, unknown>;
    return {
      title:
        typeof j.title === "string" ? j.title : typeof j.name === "string" ? j.name : undefined,
      artist:
        typeof j.artist === "string"
          ? j.artist
          : typeof j.artistName === "string"
            ? j.artistName
            : undefined,
      raw: s,
    };
  } catch {
    return { raw: s, title: s.length > 40 ? `${s.slice(0, 40)}…` : s };
  }
}
