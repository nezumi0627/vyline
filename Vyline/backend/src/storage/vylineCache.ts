/**
 * VylineCache — プロフィール / グループの高速キャッシュ（Vyline ブランド）
 *
 * mid → { name, icon, status, music, birthday, background }
 * chatMid → { name, icon, members[] }
 *
 * 読み込み時にディスクから即 hydrate → 画面に mid 生出しを避ける。
 */

import { VylineStorage } from "./vylineStorage.js";
import { childLogger } from "../logger.js";

const log = childLogger("VylineCache");

export type VylineProfileLite = {
  mid: string;
  displayName: string;
  thumbnailUrl?: string;
  statusMessage?: string;
  musicProfile?: string;
  /** "YYYY-MM-DD" or "MM-DD" */
  birthday?: string;
  backgroundUrl?: string;
  phoneticName?: string;
  updatedAt: number;
};

export type VylineMemberLite = {
  mid: string;
  displayName: string;
  thumbnailUrl?: string;
};

export type VylineGroupLite = {
  chatMid: string;
  name: string;
  thumbnailUrl?: string;
  memberMids: string[];
  members: VylineMemberLite[];
  updatedAt: number;
};

type VylineCacheDb = {
  version: 1;
  profiles: Record<string, VylineProfileLite>;
  groups: Record<string, VylineGroupLite>;
};

function emptyDb(): VylineCacheDb {
  return { version: 1, profiles: {}, groups: {} };
}

const storage = new VylineStorage<VylineCacheDb>("cache", emptyDb);

const PROFILE_TTL_MS = Number(process.env.VYLINE_PROFILE_TTL_MS ?? 86_400_000);
const GROUP_TTL_MS = Number(process.env.VYLINE_GROUP_TTL_MS ?? 3_600_000);

function looksLikeMid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[ucr][0-9a-f]{32}$/i.test(value.trim());
}

function isFresh(updatedAt: number, ttl: number): boolean {
  return Date.now() - updatedAt < ttl;
}

function pickStr(v: string | undefined | null): string | undefined {
  if (v == null || v === "") return undefined;
  return v;
}

export type VylineProfileInput = {
  mid: string;
  displayName: string;
  thumbnailUrl?: string;
  statusMessage?: string;
  musicProfile?: string;
  birthday?: string;
  backgroundUrl?: string;
  phoneticName?: string;
  updatedAt?: number;
};

export type VylineGroupInput = {
  chatMid: string;
  name: string;
  thumbnailUrl?: string;
  memberMids: string[];
  members: VylineMemberLite[];
  updatedAt?: number;
};

export async function vylineLoadCache(accountId: string): Promise<VylineCacheDb> {
  return storage.load(accountId);
}

export async function vylineGetProfile(
  accountId: string,
  mid: string,
): Promise<VylineProfileLite | null> {
  const db = await storage.load(accountId);
  return db.profiles[mid] ?? null;
}

export async function vylineGetProfiles(
  accountId: string,
  mids: string[],
): Promise<Map<string, VylineProfileLite>> {
  const db = await storage.load(accountId);
  const out = new Map<string, VylineProfileLite>();
  for (const mid of mids) {
    const p = db.profiles[mid];
    if (p) out.set(mid, p);
  }
  return out;
}

/** 表示名が使えるエントリだけ（mid 生出し回避用） */
export async function vylineResolvedNameMap(
  accountId: string,
): Promise<Map<string, { name: string; thumbnailUrl?: string }>> {
  const db = await storage.load(accountId);
  const out = new Map<string, { name: string; thumbnailUrl?: string }>();
  for (const [mid, p] of Object.entries(db.profiles)) {
    if (p.displayName && !looksLikeMid(p.displayName)) {
      const hit: { name: string; thumbnailUrl?: string } = { name: p.displayName };
      if (p.thumbnailUrl) hit.thumbnailUrl = p.thumbnailUrl;
      out.set(mid, hit);
    }
  }
  for (const [mid, g] of Object.entries(db.groups)) {
    if (g.name && !looksLikeMid(g.name)) {
      const hit: { name: string; thumbnailUrl?: string } = { name: g.name };
      if (g.thumbnailUrl) hit.thumbnailUrl = g.thumbnailUrl;
      out.set(mid, hit);
    }
  }
  return out;
}

function mergeProfile(
  prev: VylineProfileLite | undefined,
  entry: VylineProfileInput,
  now: number,
): VylineProfileLite {
  const name = entry.displayName?.trim() ?? "";
  const nextName =
    name && !looksLikeMid(name)
      ? name
      : prev?.displayName && !looksLikeMid(prev.displayName)
        ? prev.displayName
        : name || entry.mid;

  const next: VylineProfileLite = {
    mid: entry.mid,
    displayName: nextName,
    updatedAt: entry.updatedAt ?? now,
  };
  const thumb = pickStr(entry.thumbnailUrl) ?? pickStr(prev?.thumbnailUrl);
  if (thumb) next.thumbnailUrl = thumb;
  const status =
    entry.statusMessage !== undefined ? pickStr(entry.statusMessage) : pickStr(prev?.statusMessage);
  if (status) next.statusMessage = status;
  const music =
    entry.musicProfile !== undefined ? pickStr(entry.musicProfile) : pickStr(prev?.musicProfile);
  if (music) next.musicProfile = music;
  const birthday = entry.birthday !== undefined ? pickStr(entry.birthday) : pickStr(prev?.birthday);
  if (birthday) next.birthday = birthday;
  const bg =
    entry.backgroundUrl !== undefined ? pickStr(entry.backgroundUrl) : pickStr(prev?.backgroundUrl);
  if (bg) next.backgroundUrl = bg;
  const phonetic =
    entry.phoneticName !== undefined ? pickStr(entry.phoneticName) : pickStr(prev?.phoneticName);
  if (phonetic) next.phoneticName = phonetic;
  return next;
}

export async function vylinePutProfile(
  accountId: string,
  entry: VylineProfileInput,
): Promise<void> {
  if (!entry.mid) return;
  await storage.mutate(accountId, (db) => {
    db.profiles[entry.mid] = mergeProfile(db.profiles[entry.mid], entry, Date.now());
  });
}

export async function vylinePutProfiles(
  accountId: string,
  entries: VylineProfileInput[],
): Promise<void> {
  if (entries.length === 0) return;
  const now = Date.now();
  await storage.mutate(accountId, (db) => {
    for (const entry of entries) {
      if (!entry.mid) continue;
      db.profiles[entry.mid] = mergeProfile(db.profiles[entry.mid], entry, now);
    }
  });
  log.debug({ accountId, count: entries.length }, "VylineCache profiles put");
}

export async function vylineGetGroup(
  accountId: string,
  chatMid: string,
): Promise<VylineGroupLite | null> {
  const db = await storage.load(accountId);
  return db.groups[chatMid] ?? null;
}

export async function vylinePutGroup(accountId: string, entry: VylineGroupInput): Promise<void> {
  if (!entry.chatMid) return;
  await storage.mutate(accountId, (db) => {
    const prev = db.groups[entry.chatMid];
    const name = entry.name?.trim() ?? "";
    const next: VylineGroupLite = {
      chatMid: entry.chatMid,
      name:
        name && !looksLikeMid(name)
          ? name
          : prev?.name && !looksLikeMid(prev.name)
            ? prev.name
            : name || entry.chatMid,
      memberMids: entry.memberMids?.length ? entry.memberMids : (prev?.memberMids ?? []),
      members: entry.members?.length ? entry.members : (prev?.members ?? []),
      updatedAt: entry.updatedAt ?? Date.now(),
    };
    const thumb = pickStr(entry.thumbnailUrl) ?? pickStr(prev?.thumbnailUrl);
    if (thumb) next.thumbnailUrl = thumb;
    db.groups[entry.chatMid] = next;
  });
}

export function vylineProfileNeedsRefresh(entry: VylineProfileLite | null | undefined): boolean {
  if (!entry) return true;
  if (!entry.displayName || looksLikeMid(entry.displayName)) return true;
  if (!entry.thumbnailUrl) return true;
  return !isFresh(entry.updatedAt, PROFILE_TTL_MS);
}

export function vylineGroupNeedsRefresh(entry: VylineGroupLite | null | undefined): boolean {
  if (!entry) return true;
  if (!entry.memberMids.length) return true;
  // 一部だけプロフィール取得に失敗したキャッシュも再取得する。
  // 「全員MID」の場合だけを弾くと、数人だけ未解決の状態がTTL中ずっと残る。
  if (entry.members.length < entry.memberMids.length) return true;
  if (entry.members.some((member) => !member.displayName || looksLikeMid(member.displayName))) {
    return true;
  }
  return !isFresh(entry.updatedAt, GROUP_TTL_MS);
}

export async function vylineFlush(accountId: string): Promise<void> {
  await storage.flush(accountId);
}
