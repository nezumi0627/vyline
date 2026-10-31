import { getPersistedRaw, indexedDbStateStorage, setPersistedRaw } from "./indexedDbStorage.js";

const KEY = "vyline:subdevice-session";
let cached: string | null | undefined;
let version = 0;

export async function getSubdeviceSessionToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const readVersion = version;
  const token = await getPersistedRaw(KEY);
  if (version !== readVersion) return cached ?? null;
  cached = token;
  return token;
}

export async function setSubdeviceSessionToken(token: string | null): Promise<void> {
  version++;
  cached = token;
  if (token === null) {
    try { await indexedDbStateStorage.removeItem(KEY); } catch { /* local fallback was removed */ }
  } else {
    await setPersistedRaw(KEY, token);
  }
}
