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
  return (
    ((await storage.getCacheEntries(accountId, "profiles", [mid])).get(mid) as
      | VylineProfileLite
      | undefined) ?? null
  );
}

export async function vylineGetProfiles(
  accountId: string,
  mids: string[],
): Promise<Map<string, VylineProfileLite>> {
  const out = new Map<string, VylineProfileLite>();
  const profiles = await storage.getCacheEntries(accountId, "profiles", mids);
  for (const [mid, value] of profiles) {
    const p = value as VylineProfileLite;
    if (p) out.set(mid, p);
  }
  return out;
}

/** チャット一覧が必要とするキャッシュだけをSQLiteからまとめて読む。 */
export async function vylineGetChatCacheEntries(
  accountId: string,
  mids: string[],
): Promise<{ profiles: Map<string, VylineProfileLite>; groups: Map<string, VylineGroupLite> }> {
  const [profiles, groups] = await Promise.all([
    storage.getCacheEntries(accountId, "profiles", mids),
    storage.getCacheEntries(accountId, "groups", mids),
  ]);
  return {
    profiles: new Map([...profiles].map(([mid, value]) => [mid, value as VylineProfileLite])),
    groups: new Map([...groups].map(([mid, value]) => [mid, value as VylineGroupLite])),
  };
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
  const previous = await storage.getCacheEntries(accountId, "profiles", [entry.mid]);
  const value = mergeProfile(
    previous.get(entry.mid) as VylineProfileLite | undefined,
    entry,
    Date.now(),
  );
  await storage.putCacheEntries(accountId, "profiles", [{ key: entry.mid, value }]);
}

export async function vylinePutProfiles(
  accountId: string,
  entries: VylineProfileInput[],
): Promise<void> {
  if (entries.length === 0) return;
  const now = Date.now();
  const mids = [...new Set(entries.map((entry) => entry.mid).filter(Boolean))];
  const previous = await storage.getCacheEntries(accountId, "profiles", mids);
  const updates = new Map<string, VylineProfileLite>();
  for (const entry of entries) {
    if (!entry.mid) continue;
    const old =
      updates.get(entry.mid) ?? (previous.get(entry.mid) as VylineProfileLite | undefined);
    updates.set(entry.mid, mergeProfile(old, entry, now));
  }
  await storage.putCacheEntries(
    accountId,
    "profiles",
    [...updates].map(([key, value]) => ({ key, value })),
  );
  log.debug({ accountId, count: entries.length }, "VylineCache profiles put");
}

export async function vylineGetGroup(
  accountId: string,
  chatMid: string,
): Promise<VylineGroupLite | null> {
  return (
    ((await storage.getCacheEntries(accountId, "groups", [chatMid])).get(chatMid) as
      | VylineGroupLite
      | undefined) ?? null
  );
}

export async function vylinePutGroup(accountId: string, entry: VylineGroupInput): Promise<void> {
  if (!entry.chatMid) return;
  const previous = await storage.getCacheEntries(accountId, "groups", [entry.chatMid]);
  const prev = previous.get(entry.chatMid) as VylineGroupLite | undefined;
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
  await storage.putCacheEntries(accountId, "groups", [{ key: entry.chatMid, value: next }]);
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
  // メンバー名がすべてMIDのままなら再取得（前回の取得失敗を示す）
  const resolvedCount = entry.members.filter(
    (m) => !/^[ucr][0-9a-f]{32}$/i.test(m.displayName),
  ).length;
  if (resolvedCount === 0 && entry.members.length > 0) return true;
  return !isFresh(entry.updatedAt, GROUP_TTL_MS);
}

export async function vylineFlush(accountId: string): Promise<void> {
  await storage.flush(accountId);
}
