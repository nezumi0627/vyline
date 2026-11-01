import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./safeFile.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const FILE = join(DATA_DIR, "subdevices.json");
const PAIRING_TTL_MS = 2 * 60_000;
const INSTALLATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Subdevice = {
  id: string;
  accountId: string;
  name: string;
  platform: "ios" | "android" | "web" | "unknown";
  createdAt: string;
  lastSeenAt: string | null;
  blocked: boolean;
  tokenHash: string;
  /** Browser installation ID; hashed so the persisted registry is not fingerprint data. */
  installationIdHash?: string;
};

type Pairing = { id: string; tokenHash: string; expiresAt: number; accountId: string };
type State = { devices: Subdevice[]; pairings: Pairing[] };

let cache: State | null = null;
let loadInflight: Promise<State> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

export function isValidInstallationId(value: string | undefined): value is string {
  return Boolean(value && INSTALLATION_ID_RE.test(value));
}

function toSafeDevice({
  tokenHash: _tokenHash,
  installationIdHash: _installationIdHash,
  ...device
}: Subdevice) {
  return device;
}

function legacyDeviceKey(device: Subdevice): string {
  return `${device.accountId}|${device.platform}|${device.name.trim().toLocaleLowerCase("ja-JP")}`;
}

function mergeDuplicateDevices(devices: Subdevice[]): Subdevice[] {
  const result: Subdevice[] = [];
  const byInstallation = new Map<string, Subdevice>();
  const byLegacy = new Map<string, Subdevice>();
  for (const device of devices) {
    const key = device.installationIdHash ?? legacyDeviceKey(device);
    const map = device.installationIdHash ? byInstallation : byLegacy;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, device);
      result.push(device);
      continue;
    }
    // 旧形式で同じ端末が複数登録された場合は最新レコードへ統合する。
    const keep =
      (previous.lastSeenAt ?? previous.createdAt) >= (device.lastSeenAt ?? device.createdAt)
        ? previous
        : device;
    const drop = keep === previous ? device : previous;
    keep.blocked ||= drop.blocked;
    keep.lastSeenAt = keep.lastSeenAt ?? drop.lastSeenAt;
    const index = result.indexOf(previous);
    if (index >= 0) result[index] = keep;
    map.set(key, keep);
  }
  return result;
}

async function load(): Promise<State> {
  if (cache) return cache;
  if (!loadInflight) {
    const pending = (async () => {
      if (!existsSync(FILE)) return (cache = { devices: [], pairings: [] });
      try {
        const loaded = JSON.parse(await readFile(FILE, "utf8")) as State;
        loaded.devices ??= [];
        loaded.pairings ??= [];
        return (cache = loaded);
      } catch {
        return (cache = { devices: [], pairings: [] });
      }
    })();
    loadInflight = pending;
    void pending.finally(() => {
      if (loadInflight === pending) loadInflight = null;
    });
  }
  return loadInflight;
}

function mutate<T>(work: (draft: State) => { result: T; changed: boolean }): Promise<T> {
  const next = mutationQueue
    .catch(() => undefined)
    .then(async () => {
      const draft = structuredClone(await load());
      const { result, changed } = work(draft);
      if (!changed) return result;
      await writeJsonAtomic(FILE, draft);
      cache = draft;
      return result;
    });
  mutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function createPairing(accountId: string) {
  return mutate((state) => {
    const now = Date.now();
    state.pairings = state.pairings.filter((p) => p.expiresAt > now);
    const raw = token("vyp");
    const expiresAt = now + PAIRING_TTL_MS;
    state.pairings.push({
      id: randomBytes(12).toString("hex"),
      tokenHash: hash(raw),
      expiresAt,
      accountId,
    });
    return { result: { token: raw, expiresAt }, changed: true };
  });
}

export async function getPairing(raw: string) {
  const state = await load();
  const pairing = state.pairings.find((p) => p.tokenHash === hash(raw) && p.expiresAt > Date.now());
  return pairing ? { expiresAt: pairing.expiresAt } : null;
}

export async function completePairing(
  raw: string,
  name: string,
  platform: Subdevice["platform"],
  installationId: string,
) {
  if (!isValidInstallationId(installationId)) return null;
  return mutate<{ device: ReturnType<typeof toSafeDevice>; sessionToken: string } | null>(
    (state) => {
      const index = state.pairings.findIndex(
        (p) => p.tokenHash === hash(raw) && p.expiresAt > Date.now(),
      );
      if (index < 0) return { result: null, changed: false };
      const accountId = state.pairings[index]!.accountId;
      state.pairings.splice(index, 1);
      const rawSession = token("vys");
      const installationIdHash = hash(installationId);
      const normalizedName = name.trim().toLocaleLowerCase("ja-JP");
      const existing = state.devices.find(
        (device) =>
          device.installationIdHash === installationIdHash ||
          (!device.installationIdHash &&
            device.accountId === accountId &&
            device.platform === platform &&
            device.name.trim().toLocaleLowerCase("ja-JP") === normalizedName),
      );
      if (existing) {
        if (existing.blocked) return { result: null, changed: true };
        existing.accountId = accountId;
        existing.name = name.trim().slice(0, 80) || "サブデバイス";
        existing.platform = platform;
        existing.tokenHash = hash(rawSession);
        existing.lastSeenAt = new Date().toISOString();
        return {
          result: { device: toSafeDevice(existing), sessionToken: rawSession },
          changed: true,
        };
      }
      const device: Subdevice = {
        id: randomBytes(12).toString("hex"),
        name: name.trim().slice(0, 80) || "サブデバイス",
        platform,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        blocked: false,
        tokenHash: hash(rawSession),
        installationIdHash,
        accountId,
      };
      state.devices.push(device);
      return {
        result: { device: toSafeDevice(device), sessionToken: rawSession },
        changed: true,
      };
    },
  );
}

export async function listSubdevices() {
  return mutate((state) => {
    const devices = mergeDuplicateDevices(state.devices);
    const changed = devices.length !== state.devices.length;
    if (changed) state.devices = devices;
    return { result: devices.map(toSafeDevice), changed };
  });
}

function findSessionDevice(
  state: State,
  raw: string,
  installationId?: string,
): { device: Subdevice; installationIdHash?: string } | null {
  const device = state.devices.find((item) => item.tokenHash === hash(raw));
  if (!device || device.blocked) return null;
  if (!device.installationIdHash) {
    if (!isValidInstallationId(installationId)) return null;
    return { device, installationIdHash: hash(installationId) };
  }
  if (
    !isValidInstallationId(installationId) ||
    device.installationIdHash !== hash(installationId)
  ) {
    return null;
  }
  return { device };
}

async function resolveSubdeviceSession(
  raw: string,
  installationId?: string,
): Promise<Subdevice | null> {
  return mutate((state) => {
    const resolved = findSessionDevice(state, raw, installationId);
    if (!resolved) return { result: null, changed: false };
    if (resolved.installationIdHash) {
      resolved.device.installationIdHash = resolved.installationIdHash;
    }
    return { result: resolved.device, changed: Boolean(resolved.installationIdHash) };
  });
}

/** Validates a subdevice session without updating lastSeenAt, and returns its account scope. */
export async function getSubdeviceSession(raw: string, installationId?: string) {
  const device = await resolveSubdeviceSession(raw, installationId);
  return device ? toSafeDevice(device) : null;
}

export async function authenticateSubdevice(raw: string, installationId?: string) {
  return mutate((state) => {
    const resolved = findSessionDevice(state, raw, installationId);
    if (!resolved) return { result: null, changed: false };
    if (resolved.installationIdHash) {
      resolved.device.installationIdHash = resolved.installationIdHash;
    }
    resolved.device.lastSeenAt = new Date().toISOString();
    return { result: toSafeDevice(resolved.device), changed: true };
  });
}

export async function isSubdeviceSessionValid(raw: string, installationId?: string) {
  return Boolean(await resolveSubdeviceSession(raw, installationId));
}

export async function removeSubdevice(id: string) {
  return mutate((state) => {
    const before = state.devices.length;
    state.devices = state.devices.filter((device) => device.id !== id);
    const removed = state.devices.length !== before;
    return { result: removed, changed: removed };
  });
}

export async function setSubdeviceBlocked(id: string, blocked: boolean) {
  return mutate((state) => {
    const device = state.devices.find((item) => item.id === id);
    if (!device) return { result: false, changed: false };
    const changed = device.blocked !== blocked;
    device.blocked = blocked;
    return { result: true, changed };
  });
}
