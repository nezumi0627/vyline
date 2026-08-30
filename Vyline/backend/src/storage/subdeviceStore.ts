import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  if (!existsSync(FILE)) return (cache = { devices: [], pairings: [] });
  try {
    cache = JSON.parse(await readFile(FILE, "utf8")) as State;
    cache.devices ??= [];
    cache.pairings ??= [];
  } catch {
    cache = { devices: [], pairings: [] };
  }
  return cache;
}

async function save(state: State) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2), "utf8");
  cache = state;
}

export async function createPairing(accountId: string) {
  const state = await load();
  state.pairings = state.pairings.filter((p) => p.expiresAt > Date.now());
  const raw = token("vyp");
  state.pairings.push({
    id: randomBytes(12).toString("hex"),
    tokenHash: hash(raw),
    expiresAt: Date.now() + PAIRING_TTL_MS,
    accountId,
  });
  await save(state);
  return { token: raw, expiresAt: state.pairings.at(-1)!.expiresAt };
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
  const state = await load();
  const index = state.pairings.findIndex(
    (p) => p.tokenHash === hash(raw) && p.expiresAt > Date.now(),
  );
  if (index < 0) return null;
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
    if (existing.blocked) {
      await save(state);
      return null;
    }
    existing.accountId = accountId;
    existing.name = name.trim().slice(0, 80) || "サブデバイス";
    existing.platform = platform;
    existing.tokenHash = hash(rawSession);
    existing.lastSeenAt = new Date().toISOString();
    await save(state);
    return { device: toSafeDevice(existing), sessionToken: rawSession };
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
  await save(state);
  return { device: toSafeDevice(device), sessionToken: rawSession };
}

export async function listSubdevices() {
  const state = await load();
  const devices = mergeDuplicateDevices(state.devices);
  if (devices.length !== state.devices.length) {
    state.devices = devices;
    await save(state);
  }
  return devices.map(toSafeDevice);
}

async function resolveSubdeviceSession(
  raw: string,
  installationId?: string,
): Promise<Subdevice | null> {
  const state = await load();
  const device = state.devices.find((d) => d.tokenHash === hash(raw));
  if (!device || device.blocked) return null;
  if (!device.installationIdHash) {
    if (!isValidInstallationId(installationId)) return null;
    // One-time migration for a session created before installation binding existed.
    device.installationIdHash = hash(installationId);
    await save(state);
  } else if (
    !isValidInstallationId(installationId) ||
    device.installationIdHash !== hash(installationId)
  ) {
    return null;
  }
  return device;
}

/** Validates a subdevice session without updating lastSeenAt, and returns its account scope. */
export async function getSubdeviceSession(raw: string, installationId?: string) {
  const device = await resolveSubdeviceSession(raw, installationId);
  return device ? toSafeDevice(device) : null;
}

export async function authenticateSubdevice(raw: string, installationId?: string) {
  const device = await resolveSubdeviceSession(raw, installationId);
  if (!device) return null;
  const state = await load();
  device.lastSeenAt = new Date().toISOString();
  await save(state);
  return toSafeDevice(device);
}

export async function isSubdeviceSessionValid(raw: string, installationId?: string) {
  return Boolean(await resolveSubdeviceSession(raw, installationId));
}

export async function removeSubdevice(id: string) {
  const state = await load();
  const before = state.devices.length;
  state.devices = state.devices.filter((d) => d.id !== id);
  await save(state);
  return state.devices.length !== before;
}

export async function setSubdeviceBlocked(id: string, blocked: boolean) {
  const state = await load();
  const device = state.devices.find((d) => d.id === id);
  if (!device) return false;
  device.blocked = blocked;
  await save(state);
  return true;
}
