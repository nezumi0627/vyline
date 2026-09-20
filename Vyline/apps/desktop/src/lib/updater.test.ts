import { describe, expect, test } from "bun:test";
import { isNewerVersion, isTrustedInstallerUrl, normalizeReleaseTag } from "./updater";

describe("isNewerVersion", () => {
  test("orders stable releases after prereleases", () => {
    expect(isNewerVersion("0.6.0", "0.6.0-beta")).toBe(true);
    expect(isNewerVersion("0.6.0-beta", "0.6.0")).toBe(false);
  });

  test("does not offer an older or equal release", () => {
    expect(isNewerVersion("0.5.9", "0.6.0-beta")).toBe(false);
    expect(isNewerVersion("v0.6.0-beta", "0.6.0-beta")).toBe(false);
  });

  test("rejects malformed versions instead of prompting an unsafe update", () => {
    expect(isNewerVersion("latest", "0.6.0-beta")).toBe(false);
    expect(isNewerVersion("0.7", "0.6.0-beta")).toBe(false);
  });
});

describe("isTrustedInstallerUrl", () => {
  test("accepts only the expected GitHub release installer", () => {
    expect(
      isTrustedInstallerUrl(
        "https://github.com/nezumi0627/Vyline/releases/download/0.6.0/VylineSetup-0.6.0.exe",
        "0.6.0",
      ),
    ).toBe(true);
    expect(isTrustedInstallerUrl("https://evil.example/VylineSetup-0.6.0.exe", "0.6.0")).toBe(
      false,
    );
    expect(
      isTrustedInstallerUrl(
        "https://github.com/nezumi0627/Vyline/releases/download/0.6.0/other.exe",
        "0.6.0",
      ),
    ).toBe(false);
  });
});

describe("normalizeReleaseTag", () => {
  test("accepts semver release tags with an optional v prefix", () => {
    expect(normalizeReleaseTag("v0.8.0-beta")).toBe("0.8.0-beta");
    expect(normalizeReleaseTag("0.8.0")).toBe("0.8.0");
  });

  test("rejects arbitrary release metadata", () => {
    expect(normalizeReleaseTag("latest")).toBeNull();
    expect(normalizeReleaseTag(undefined)).toBeNull();
  });
});
