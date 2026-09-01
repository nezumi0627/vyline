import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountSettings, LogLevel, SavedThemeSetting } from "@vyline/types";
import { safePathComponent, writeJsonAtomic } from "../storage/safeFile.js";

const DEFAULT_DATA_DIR = join(import.meta.dir, "..", "..", "data");
export const SETUP_TOTAL_STEPS = 5;
const MAX_SAVED_THEMES = 24;
const MAX_SAVED_THEME_BYTES = 16 * 1024;
const SAVED_THEME_ID = /^[A-Za-z0-9_-]{1,80}$/;

function sanitizeSavedThemes(value: unknown): SavedThemeSetting[] {
  if (!Array.isArray(value)) return [];
  const out: SavedThemeSetting[] = [];
  for (const raw of value) {
    if (out.length >= MAX_SAVED_THEMES) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 64) : "";
    const theme = typeof item.theme === "string" ? item.theme : "";
    const updatedAt =
      typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt))
        ? new Date(item.updatedAt).toISOString()
        : new Date(0).toISOString();
    if (!SAVED_THEME_ID.test(id) || !name || !theme || theme.length > MAX_SAVED_THEME_BYTES) continue;
    try {
      const parsed = JSON.parse(theme) as Record<string, unknown>;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.accent !== "string" ||
        typeof parsed.bg !== "string" ||
        typeof parsed.msgIn !== "string" ||
        typeof parsed.msgOut !== "string"
      )
        continue;
    } catch {
      continue;
    }
    out.push({ id, name, theme, updatedAt });
  }
  return out;
}

export function defaultAccountSettings(): AccountSettings {
  return {
    schemaVersion: 1,
    setup: { completed: false, step: 0 },
    displayName: "",
    theme: { preset: "default", mode: "system", savedThemes: [] },
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
  const dataDir = process.env.VYLINE_DATA_DIR ?? DEFAULT_DATA_DIR;
  return join(dataDir, "accounts", safePathComponent(mid), "settings.json");
}

function migrate(value: Partial<AccountSettings>): AccountSettings {
  const base = defaultAccountSettings();
  const rawTheme = (value.theme ?? {}) as Partial<AccountSettings["theme"]>;
  const {
    savedThemes: rawSavedThemes,
    activeSavedThemeId: rawActiveSavedThemeId,
    ...themeRest
  } = rawTheme;
  const savedThemes = sanitizeSavedThemes(rawSavedThemes);
  const activeSavedThemeId =
    typeof rawActiveSavedThemeId === "string" &&
    savedThemes.some((entry) => entry.id === rawActiveSavedThemeId)
      ? rawActiveSavedThemeId
      : undefined;
  return {
    ...base,
    ...value,
    schemaVersion: 1,
    setup: { ...base.setup, ...(value.setup ?? {}) },
    theme: {
      ...base.theme,
      ...themeRest,
      savedThemes,
      ...(activeSavedThemeId ? { activeSavedThemeId } : {}),
    },
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
