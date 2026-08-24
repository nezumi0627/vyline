import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const FILE = join(DATA_DIR, "subdevices.json");
const PAIRING_TTL_MS = 2 * 60_000;

export type Subdevice = {
  id: string;
  accountId: string;
  name: string;
  platform: "ios" | "android" | "web" | "unknown";
  createdAt: string;
  lastSeenAt: string | null;
  blocked: boolean;
  tokenHash: string;
};

type Pairing = { id: string; tokenHash: string; expiresAt: number; accountId: string };
type State = { devices: Subdevice[]; pairings: Pairing[] };

let cache: State | null = null;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

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

export async function completePairing(raw: string, name: string, platform: Subdevice["platform"]) {
  const state = await load();
  const index = state.pairings.findIndex(
    (p) => p.tokenHash === hash(raw) && p.expiresAt > Date.now(),
  );
  if (index < 0) return null;
  const accountId = state.pairings[index]!.accountId;
  state.pairings.splice(index, 1);
  const rawSession = token("vys");
  const device: Subdevice = {
    id: randomBytes(12).toString("hex"),
    name: name.trim().slice(0, 80) || "サブデバイス",
    platform,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    blocked: false,
    tokenHash: hash(rawSession),
    accountId,
  };
  state.devices.push(device);
  await save(state);
  return { device: { ...device, tokenHash: undefined }, sessionToken: rawSession };
}

export async function listSubdevices() {
  const state = await load();
  return state.devices.map(({ tokenHash: _tokenHash, ...device }) => device);
}

export async function authenticateSubdevice(raw: string) {
  const state = await load();
  const device = state.devices.find((d) => d.tokenHash === hash(raw));
  if (!device || device.blocked) return null;
  device.lastSeenAt = new Date().toISOString();
  await save(state);
  const { tokenHash: _tokenHash, ...safe } = device;
  return safe;
}

export async function isSubdeviceSessionValid(raw: string) {
  const state = await load();
  const device = state.devices.find((d) => d.tokenHash === hash(raw));
  return Boolean(device && !device.blocked);
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
