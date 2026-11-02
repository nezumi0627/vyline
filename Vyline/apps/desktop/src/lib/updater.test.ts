import { describe, expect, test } from "bun:test";
import {
  checkForUpdates,
  clearUpdateCheckCache,
  detectUpdatePlatform,
  formatBuildVersion,
  isLocalHostname,
  isNewerVersion,
  isTrustedInstallerUrl,
  normalizeReleaseTag,
  selectReleaseAsset,
} from "./updater";

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
  test("accepts the actual v-prefixed GitHub release URL", () => {
    expect(
      isTrustedInstallerUrl(
        "https://github.com/nezumi0627/vyline/releases/download/v1.0.1/VylineSetup-1.0.1.exe",
        "0.6.0",
      ),
    ).toBe(false);
    expect(
      isTrustedInstallerUrl(
        "https://github.com/nezumi0627/vyline/releases/download/v1.0.1/VylineSetup-1.0.1.exe",
        "1.0.1",
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

describe("selectReleaseAsset", () => {
  const assets = [
    {
      name: "VylineSetup-1.0.1.exe",
      browser_download_url:
        "https://github.com/nezumi0627/vyline/releases/download/v1.0.1/VylineSetup-1.0.1.exe",
      digest: `sha256:${"a".repeat(64)}`,
    },
    {
      name: "Vyline-linux-x64-1.0.1.tar.gz",
      browser_download_url:
        "https://github.com/nezumi0627/vyline/releases/download/v1.0.1/Vyline-linux-x64-1.0.1.tar.gz",
      digest: `sha256:${"b".repeat(64)}`,
    },
  ];

  test("selects only the matching package for the current platform", () => {
    expect(selectReleaseAsset("windows", "1.0.1", assets)?.name).toBe("VylineSetup-1.0.1.exe");
    expect(selectReleaseAsset("linux", "1.0.1", assets)?.name).toBe(
      "Vyline-linux-x64-1.0.1.tar.gz",
    );
    expect(selectReleaseAsset("macos", "1.0.1", assets)).toBeNull();
  });

  test("does not trust release assets outside the canonical HTTPS tag path", () => {
    expect(
      selectReleaseAsset("windows", "1.0.1", [
        {
          name: "VylineSetup-1.0.1.exe",
          browser_download_url:
            "https://github.com.evil.invalid/nezumi0627/vyline/releases/download/v1.0.1/VylineSetup-1.0.1.exe",
        },
      ]),
    ).toBeNull();
  });
});

describe("formatBuildVersion", () => {
  test("shows the version and short Git commit in the requested form", () => {
    expect(formatBuildVersion("1.0.1", "abcdef123456")).toBe("V1.0.1(abcdef1)");
  });

  test("does not render invalid or missing hashes as build identities", () => {
    expect(formatBuildVersion("1.0.1", "unknown")).toBe("V1.0.1");
    expect(formatBuildVersion("1.0.1", "ab12")).toBe("V1.0.1");
  });
});

describe("detectUpdatePlatform", () => {
  test("recognizes supported user agent platform strings", () => {
    expect(detectUpdatePlatform("Mozilla Windows NT 10.0; Win64; x64")).toBe("windows");
    expect(detectUpdatePlatform("X11; Ubuntu; Linux x86_64")).toBe("linux");
    expect(detectUpdatePlatform("Macintosh; Intel Mac OS X")).toBe("macos");
    expect(detectUpdatePlatform("Android; Linux arm64")).toBe("unknown");
    expect(detectUpdatePlatform("X11; Linux aarch64")).toBe("unknown");
    expect(detectUpdatePlatform("Some other platform")).toBe("unknown");
  });
});

describe("isLocalHostname", () => {
  test("allows loopback addresses and rejects remote hosts", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("127.8.9.10")).toBe(true);
    expect(isLocalHostname("::1")).toBe(true);
    expect(isLocalHostname("vyline.example.com")).toBe(false);
    expect(isLocalHostname("192.168.1.20")).toBe(false);
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

test("clearUpdateCheckCache is safe before a release check", () => {
  expect(() => clearUpdateCheckCache()).not.toThrow();
});

test("forced update checks bypass the five-minute metadata cache", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  clearUpdateCheckCache();
  globalThis.fetch = (async () => {
    requests += 1;
    return Response.json({ tag_name: "v9.9.9", assets: [] });
  }) as unknown as typeof fetch;
  try {
    await checkForUpdates();
    await checkForUpdates();
    expect(requests).toBe(1);
    await checkForUpdates({ force: true });
    expect(requests).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    clearUpdateCheckCache();
  }
});
