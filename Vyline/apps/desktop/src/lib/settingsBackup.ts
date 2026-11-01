import type { Settings, VyTheme } from "@/lib/store-types";
import type { VyThemeId, VyThemeTokens } from "@/stores/themeStore";
import { betaFeatureIdForSetting } from "@/lib/betaConsent";

export type SettingsBackup = {
  format: "vyline-settings-backup";
  version: 2;
  exportedAt: string;
  settings: Settings;
  theme: VyTheme;
  visualTheme: { themeId: VyThemeId; custom: VyThemeTokens };
  hiddenChats?: string[];
  pinnedChats?: string[];
  mutedChats?: string[];
  customOrder?: string[];
  localNames?: Record<string, string>;
  sidebarWidth?: number;
};

export type ParsedSettingsBackup = Partial<SettingsBackup> & {
  disabledBetaFeatureIds?: string[];
};

export function createSettingsBackup(
  data: Omit<SettingsBackup, "format" | "version" | "exportedAt">,
): SettingsBackup {
  return {
    format: "vyline-settings-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    ...data,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    /^(#[\da-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg+-]+\)|oklch\([\d\s.,%/+-]+\)|transparent|currentColor)$/i.test(
      value,
    )
  );
}

function safeImage(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= 14_000_000 &&
      (/^https:\/\//i.test(value) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)))
  );
}

export function parseSettingsBackup(
  text: string,
  current: {
    settings: Settings;
    theme: VyTheme;
    visualTheme: { themeId: VyThemeId; custom: VyThemeTokens };
  },
): ParsedSettingsBackup {
  if (text.length > 15_000_000) throw new Error("設定バックアップは15MBまでです");
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || ![1, 2].includes(Number(raw.version)))
    throw new Error("対応していない設定バックアップです");
  if (
    raw.format !== undefined &&
    raw.format !== "vyline-settings-backup" &&
    raw.format !== "vyline-local-settings"
  ) {
    throw new Error("設定バックアップの形式が正しくありません");
  }
  const result: ParsedSettingsBackup = {};

  if (isRecord(raw.settings)) {
    const settings: Record<string, unknown> = {};
    const disabledBetaFeatureIds = Object.entries(raw.settings)
      .filter(([key, value]) => /^beta[A-Z]/.test(key) && value === true)
      .map(([key]) => betaFeatureIdForSetting(key));
    for (const [key, value] of Object.entries(raw.settings)) {
      if (!(key in current.settings)) continue;
      const expected = current.settings[key as keyof Settings];
      if (typeof expected !== typeof value) continue;
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      if (key === "fontScale" && typeof value === "number" && (value < 0.85 || value > 1.25))
        continue;
      if (
        key === "linkPreviewLimit" &&
        typeof value === "number" &&
        (value < 0 || value > 10 || !Number.isInteger(value))
      )
        continue;
      if (key === "animationMode" && !["vyline", "feather", "none"].includes(String(value)))
        continue;
      if (key === "chatSort" && !["recent", "unread", "custom"].includes(String(value))) continue;
      if (typeof value === "string" && value.length > 4096) continue;
      settings[key] = value;
    }
    // Beta flags are consented per installation and are never re-enabled by import.
    for (const key of Object.keys(settings)) {
      if (/^beta[A-Z]/.test(key)) settings[key] = false;
    }
    if (disabledBetaFeatureIds.length > 0) {
      result.disabledBetaFeatureIds = [...new Set(disabledBetaFeatureIds)];
    }
    result.settings = settings as Partial<Settings> as Settings;
  }

  if (isRecord(raw.theme)) {
    const theme = { ...current.theme } as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw.theme)) {
      if (!(key in theme)) continue;
      if (key === "radius") {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 64)
          theme[key] = value;
      } else if (key === "pattern") {
        if (value === 0 || value === 1) theme[key] = value;
      } else if (key === "chatImage") {
        if (safeImage(value)) theme[key] = value;
      } else if (
        typeof value === "string" &&
        value.length <= 128 &&
        (key === "id" || key === "name" || validColor(value))
      ) {
        theme[key] = value;
      }
    }
    result.theme = theme as VyTheme;
  }

  if (isRecord(raw.visualTheme)) {
    const input = raw.visualTheme;
    const themeId = input.themeId;
    const custom = isRecord(input.custom)
      ? ({ ...current.visualTheme.custom } as Record<string, unknown>)
      : null;
    if (custom) {
      for (const [key, value] of Object.entries(input.custom as Record<string, unknown>)) {
        if (!(key in custom)) continue;
        if (key === "messageRadiusPx") {
          if (typeof value === "number" && Number.isFinite(value) && value >= 4 && value <= 40)
            custom[key] = value;
        } else if (key === "chatBgImage") {
          if (safeImage(value)) custom[key] = value;
        } else if (validColor(value)) custom[key] = value;
      }
    }
    if (["telegram-night", "line-dark", "soft-day", "custom"].includes(String(themeId)) && custom) {
      result.visualTheme = {
        themeId: themeId as VyThemeId,
        custom: custom as unknown as VyThemeTokens,
      };
    }
  }

  for (const key of ["hiddenChats", "pinnedChats", "mutedChats", "customOrder"] as const) {
    const value = raw[key];
    if (
      Array.isArray(value) &&
      value.length <= 20_000 &&
      value.every((item) => typeof item === "string" && item.length <= 128)
    ) {
      result[key] = [...new Set(value)] as string[];
    }
  }
  if (isRecord(raw.localNames) && Object.keys(raw.localNames).length <= 20_000) {
    const localNames: Record<string, string> = {};
    for (const [id, name] of Object.entries(raw.localNames)) {
      if (id.length <= 128 && typeof name === "string" && name.length <= 100) localNames[id] = name;
    }
    result.localNames = localNames;
  }
  if (typeof raw.sidebarWidth === "number" && Number.isFinite(raw.sidebarWidth)) {
    result.sidebarWidth = Math.min(600, Math.max(260, raw.sidebarWidth));
  }
  if (
    !result.settings &&
    !result.theme &&
    !result.visualTheme &&
    !result.hiddenChats &&
    !result.pinnedChats &&
    !result.mutedChats &&
    !result.customOrder &&
    !result.localNames &&
    result.sidebarWidth === undefined
  ) {
    throw new Error("復元できる設定が含まれていません");
  }
  return result;
}
