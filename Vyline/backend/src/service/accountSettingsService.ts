import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountSettings, LogLevel } from "@vyline/types";
import { safePathComponent, writeJsonAtomic } from "../storage/safeFile.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
export const SETUP_TOTAL_STEPS = 5;

export function defaultAccountSettings(): AccountSettings {
  return {
    schemaVersion: 1,
    setup: { completed: false, step: 0 },
    displayName: "",
    theme: { preset: "default", mode: "system" },
    notifications: { enabled: true, sounds: true },
    storage: { autoDownload: false },
    privacy: { showReadReceipts: true, includeMessageTextInLogs: false },
    debug: { enabled: true, retentionDays: 14, level: "info", allowAutoShare: false },
    handoff: {},
    performance: { reducedMotion: false, maxCachedMessages: 120 },
    layout: { initialTab: "home", compact: false },
    auth: { tokenRefreshLeadSeconds: 7 * 24 * 60 * 60 },
  };
}

function pathFor(mid: string): string {
  return join(DATA_DIR, "accounts", safePathComponent(mid), "settings.json");
}

function migrate(value: Partial<AccountSettings>): AccountSettings {
  const base = defaultAccountSettings();
  return {
    ...base,
    ...value,
    schemaVersion: 1,
    setup: { ...base.setup, ...(value.setup ?? {}) },
    theme: { ...base.theme, ...(value.theme ?? {}) },
    notifications: { ...base.notifications, ...(value.notifications ?? {}) },
    storage: { ...base.storage, ...(value.storage ?? {}) },
    privacy: { ...base.privacy, ...(value.privacy ?? {}), includeMessageTextInLogs: false },
    debug: { ...base.debug, ...(value.debug ?? {}) },
    handoff: { ...base.handoff, ...(value.handoff ?? {}) },
    performance: { ...base.performance, ...(value.performance ?? {}) },
    layout: { ...base.layout, ...(value.layout ?? {}) },
    auth: { ...base.auth, ...(value.auth ?? {}) },
  };
}

export async function loadAccountSettings(mid: string): Promise<AccountSettings> {
  const path = pathFor(mid);
  if (!existsSync(path)) return defaultAccountSettings();
  try {
    return migrate(JSON.parse(await readFile(path, "utf8")) as Partial<AccountSettings>);
  } catch {
    return defaultAccountSettings();
  }
}

export async function saveAccountSettings(
  mid: string,
  patch: Partial<AccountSettings>,
): Promise<AccountSettings> {
  const next = migrate({ ...(await loadAccountSettings(mid)), ...patch });
  await writeJsonAtomic(pathFor(mid), next);
  return next;
}

export async function updateSetup(
  mid: string,
  step: number,
  patch: Partial<AccountSettings>,
): Promise<AccountSettings> {
  const current = await loadAccountSettings(mid);
  const completed = step >= SETUP_TOTAL_STEPS;
  return saveAccountSettings(mid, {
    ...patch,
    setup: {
      ...current.setup,
      step: Math.max(0, Math.min(step, SETUP_TOTAL_STEPS)),
      completed,
      ...(completed ? { completedAt: new Date().toISOString() } : {}),
    },
  });
}

export function isLogLevel(value: unknown): value is LogLevel {
  return value === "error" || value === "warn" || value === "info" || value === "debug";
}
