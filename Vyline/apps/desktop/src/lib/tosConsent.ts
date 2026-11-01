import { getPersistedRaw, setPersistedRaw } from "./indexedDbStorage.js";

const CONSENT_KEY = "vyline:tos-consent-v4";
let consentCache = false;

export async function hydrateTosConsent(): Promise<void> {
  consentCache = (await getPersistedRaw(CONSENT_KEY)) === "1";
}

export function hasTosConsent(): boolean {
  if (consentCache) return true;
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export async function setTosConsent(): Promise<void> {
  consentCache = true;
  try {
    await setPersistedRaw(CONSENT_KEY, "1");
  } catch {
    /* Consent is effective for this session. */
  }
}
