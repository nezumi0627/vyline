export const ACCOUNT_SCHEMA_VERSION = 1 as const;
export const HANDOFF_FORMAT = "vyline-handoff" as const;
export const HANDOFF_VERSION = 1 as const;
export type Platform = "desktop" | "web";
export type LogLevel = "error" | "warn" | "info" | "debug";

export interface SavedThemeSetting {
  id: string;
  name: string;
  /** Serialized VyTheme JSON. Kept opaque here to avoid coupling @vyline/types to @vyline/themes. */
  theme: string;
  updatedAt: string;
}

export interface AccountSettings {
  schemaVersion: typeof ACCOUNT_SCHEMA_VERSION;
  setup: { completed: boolean; step: number; completedAt?: string };
  displayName: string;
  theme: {
    preset: string;
    mode: "system" | "light" | "dark";
    savedThemes?: SavedThemeSetting[];
    activeSavedThemeId?: string;
  };
  notifications: { enabled: boolean; sounds: boolean };
  storage: { mediaPath?: string; cachePath?: string; autoDownload: boolean };
  privacy: { showReadReceipts: boolean; includeMessageTextInLogs: false };
  debug: { enabled: boolean; retentionDays: number; level: LogLevel; allowAutoShare: boolean };
  handoff: { lastImportedAt?: string; lastExportedAt?: string };
  performance: { reducedMotion: boolean; maxCachedMessages: number };
  layout: { initialTab: "home" | "chat" | "settings"; compact: boolean };
  auth: { tokenRefreshLeadSeconds: number };
  tosAcceptedAt?: string;
}

export interface HandoffManifest {
  format: typeof HANDOFF_FORMAT;
  version: typeof HANDOFF_VERSION;
  handoffId: string;
  source: { platform: Platform; appVersion: string; schemaVersion: number };
  createdAt: string;
  account: { midHash: string };
  files: Array<{ path: string; sha256: string; size: number }>;
  encryption: { mode: "none" | "password" | "os-keychain" };
}

export interface DebugContext {
  appVersion: string;
  buildNumber: string;
  platform: Platform;
  runtime: string;
  os: string;
  error?: { name: string; message: string; stack?: string };
  http?: { status: number; method: string; route: string };
  connection?: { state: string; latencyMs?: number };
  performance?: { memoryMb?: number; cpuPercent?: number; durationMs?: number };
  account?: { count: number; midHash?: string };
  screen?: string;
}
