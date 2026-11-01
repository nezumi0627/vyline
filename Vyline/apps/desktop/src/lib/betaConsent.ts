import { getPersistedValue, setPersistedValue } from "./indexedDbStorage.js";

const CONSENT_KEY = "vyline:beta-feature-consent-v1";
export const BETA_CONSENT_TERMS_VERSION = "2026-11-01";

export type BetaConsentDecision = "accepted" | "declined" | "withdrawn" | "disabled_by_restore";
export type BetaConsentEvent = {
  featureId: string;
  decision: BetaConsentDecision;
  enabled: boolean;
  occurredAt: string;
  featureVersion: string;
  termsVersion: string;
  appVersion?: string;
};

type ConsentLedger = { schemaVersion: 2; events: BetaConsentEvent[] };
const emptyLedger = (): ConsentLedger => ({ schemaVersion: 2, events: [] });
let ledger = emptyLedger();

function normalizeLedger(value: unknown): ConsentLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyLedger();
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion === 2 && Array.isArray(raw.events)) {
    const events = raw.events.filter((event): event is BetaConsentEvent => {
      if (!event || typeof event !== "object") return false;
      const item = event as Record<string, unknown>;
      return (
        typeof item.featureId === "string" &&
        ["accepted", "declined", "withdrawn", "disabled_by_restore"].includes(
          String(item.decision),
        ) &&
        typeof item.enabled === "boolean" &&
        typeof item.occurredAt === "string"
      );
    });
    return { schemaVersion: 2, events };
  }

  // Migrate the earlier one-time consent map without discarding its timestamps.
  const migrated = emptyLedger();
  for (const [featureId, record] of Object.entries(raw)) {
    if (!record || typeof record !== "object") continue;
    const item = record as Record<string, unknown>;
    if (typeof item.consentedAt !== "string") continue;
    migrated.events.push({
      featureId,
      decision: "accepted",
      enabled: true,
      occurredAt: item.consentedAt,
      featureVersion: typeof item.version === "string" ? item.version : "1",
      termsVersion: "legacy",
    });
  }
  return migrated;
}

export async function hydrateBetaConsent(): Promise<void> {
  const stored = await getPersistedValue<unknown>(CONSENT_KEY);
  if (stored !== undefined && stored !== null) {
    ledger = normalizeLedger(stored);
    return;
  }
  try {
    const legacy = localStorage.getItem(CONSENT_KEY);
    if (legacy) {
      ledger = normalizeLedger(JSON.parse(legacy));
      await setPersistedValue(CONSENT_KEY, ledger);
      return;
    }
  } catch {
    // Consent history remains empty if local migration data is malformed.
  }
  ledger = emptyLedger();
}

export function hasBetaFeatureConsent(featureId: string): boolean {
  return ledger.events.some(
    (event) => event.featureId === featureId && event.decision === "accepted",
  );
}

export function getBetaFeatureConsentHistory(): BetaConsentEvent[] {
  return ledger.events.map((event) => ({ ...event }));
}

export async function recordBetaFeatureDecision(
  featureId: string,
  decision: BetaConsentDecision,
  options: { featureVersion?: string; appVersion?: string } = {},
): Promise<boolean> {
  const event: BetaConsentEvent = {
    featureId,
    decision,
    enabled: decision === "accepted",
    occurredAt: new Date().toISOString(),
    featureVersion: options.featureVersion ?? "1",
    termsVersion: BETA_CONSENT_TERMS_VERSION,
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
  };
  const next: ConsentLedger = { schemaVersion: 2, events: [...ledger.events, event] };
  if (!(await setPersistedValue(CONSENT_KEY, next))) return false;
  ledger = next;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("vyline:beta-consent-updated"));
  return true;
}

/** Backward-compatible entry point for callers that only record acceptance. */
export function recordBetaFeatureConsent(featureId: string): Promise<boolean> {
  return recordBetaFeatureDecision(featureId, "accepted");
}

export async function disableEnabledBetaSettingsForRestore(
  settings: object,
  disable: (key: string) => void,
  appVersion?: string,
): Promise<void> {
  for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
    if (!/^beta[A-Z]/.test(key) || value !== true) continue;
    const featureId = key === "betaBlockedListSqliteSync" ? "blocked-list-sqlite-sync" : key;
    await recordBetaFeatureDecision(featureId, "disabled_by_restore", { appVersion });
    disable(key);
  }
}
