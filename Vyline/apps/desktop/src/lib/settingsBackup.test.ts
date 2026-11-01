import { describe, expect, test } from "bun:test";
import type { Settings, VyTheme } from "@/lib/store-types";
import type { VyThemeTokens } from "@/stores/themeStore";
import { parseSettingsBackup } from "./settingsBackup";

describe("settings backup import", () => {
  const current = {
    settings: {
      fontScale: 0.9,
      proxyEnabled: false,
      betaBlockedListSqliteSync: false,
      linkPreviewLimit: 3,
    } as Settings,
    theme: { id: "line-dark", name: "LINE Dark", bg: "#111111", radius: 16 } as VyTheme,
    visualTheme: {
      themeId: "line-dark" as const,
      custom: { accent: "#06c755", surface0: "#111111", messageRadiusPx: 16 },
    } as unknown as { themeId: "line-dark"; custom: VyThemeTokens },
  };

  test("restores settings and theme colors while ignoring unknown and unsafe fields", () => {
    const result = parseSettingsBackup(
      JSON.stringify({
        version: 2,
        settings: { fontScale: 1.2, proxyEnabled: true, arbitrary: "injected" },
        theme: { bg: "url(javascript:alert(1))", radius: 999 },
        visualTheme: { themeId: "custom", custom: { accent: "#ff00aa", messageRadiusPx: 999 } },
        sidebarWidth: 900,
      }),
      current,
    );

    expect(result.settings?.fontScale).toBe(1.2);
    expect((result.settings as Record<string, unknown>).arbitrary).toBeUndefined();
    expect(result.theme?.bg).toBe("#111111");
    expect(result.theme?.radius).toBe(16);
    expect(result.visualTheme?.custom.accent).toBe("#ff00aa");
    expect(result.visualTheme?.custom.messageRadiusPx).toBe(16);
    expect(result.sidebarWidth).toBe(600);
  });

  test("rejects unsupported versions and oversized files", () => {
    expect(() => parseSettingsBackup('{"version":999}', current)).toThrow();
    expect(() => parseSettingsBackup('{"format":"other","version":2}', current)).toThrow();
    expect(() => parseSettingsBackup(" ".repeat(15_000_001), current)).toThrow();
  });

  test("never re-enables beta features from an imported settings backup", () => {
    const result = parseSettingsBackup(
      JSON.stringify({
        version: 2,
        settings: { betaBlockedListSqliteSync: true },
      }),
      current,
    );

    expect(result.settings?.betaBlockedListSqliteSync).toBe(false);
    expect(result.disabledBetaFeatureIds).toEqual(["blocked-list-sqlite-sync"]);
  });

  test("restores only URL preview limits from zero through ten", () => {
    const result = parseSettingsBackup(
      JSON.stringify({
        version: 2,
        settings: { linkPreviewLimit: 7 },
      }),
      current,
    );
    const invalid = parseSettingsBackup(
      JSON.stringify({
        version: 2,
        settings: { linkPreviewLimit: 11 },
      }),
      current,
    );

    expect(result.settings?.linkPreviewLimit).toBe(7);
    expect(invalid.settings?.linkPreviewLimit).toBeUndefined();
  });
});
