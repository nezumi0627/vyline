import { describe, expect, test } from "bun:test";
import { PRODUCT_VERSION } from "./productVersion";
import {
  checkForUpdates,
  clearUpdateCheckCache,
  detectUpdateArchitecture,
  detectUpdatePlatform,
  formatBuildVersion,
  getUpdateChannel,
  getVersionReleaseUrl,
  isLocalHostname,
  isNewerVersion,
  isTrustedInstallerUrl,
  normalizeReleaseTag,
  isTrustedReleasePageUrl,
  releaseChannel,
  selectReleaseAsset,
  selectReleaseForChannel,
  shouldShowUpdateNotification,
} from "./updater";

const [currentMajor, currentMinor, currentPatch] = PRODUCT_VERSION.split("-")[0]
  .split(".")
  .map(Number);
const newerStableVersion = `${currentMajor}.${currentMinor}.${currentPatch + 1}`;
const newerBetaVersion = `${currentMajor}.${currentMinor + 1}.0-beta.1`;

describe("update channels", () => {
  const releases = [
    { tag_name: "v2.0.0", prerelease: false, draft: false },
    { tag_name: "v2.1.0-beta.2", prerelease: true, draft: false },
    { tag_name: "v2.1.0-beta.10", prerelease: true, draft: false },
    { tag_name: "v9.0.0-beta.1", prerelease: true, draft: true },
    { tag_name: "latest", prerelease: true, draft: false },
  ];

  test("Beta is opt-in and its feed never includes Stable releases", () => {
    expect(getUpdateChannel(false)).toBe("stable");
    expect(getUpdateChannel(true)).toBe("beta");
    expect(selectReleaseForChannel(releases, "stable")?.tag_name).toBe("v2.0.0");
    expect(selectReleaseForChannel(releases, "beta")?.tag_name).toBe("v2.1.0-beta.10");
  });

  test("update notification visibility follows the separate notification preference", () => {
    expect(shouldShowUpdateNotification(true, { hasUpdate: true, error: null })).toBe(true);
    expect(shouldShowUpdateNotification(false, { hasUpdate: true, error: null })).toBe(false);
    expect(shouldShowUpdateNotification(true, { hasUpdate: false, error: "offline" })).toBe(false);
  });
});

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

  test("compares full SemVer numeric and prerelease precedence", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("1.2.0-beta.10", "1.2.0-beta.2")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2.0-rc.1")).toBe(true);
    expect(isNewerVersion("1.2.1", "1.2.0")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.0+build.2", "1.2.0+build.1")).toBe(false);
  });

  test("rejects invalid SemVer including numeric identifier leading zeroes", () => {
    expect(isNewerVersion("01.2.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.0-beta.01", "1.2.0-beta.1")).toBe(false);
    expect(isNewerVersion("1.2.0-", "1.2.0")).toBe(false);
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
    expect(selectReleaseAsset("windows", "1.0.1", assets, "arm64")).toBeNull();
    expect(selectReleaseAsset("linux", "1.0.1", assets)?.name).toBe(
      "Vyline-linux-x64-1.0.1.tar.gz",
    );
    expect(selectReleaseAsset("linux", "1.0.1", assets, "arm64")).toBeNull();
    const macAssets = [
      {
        name: "Vyline-macos-arm64-1.0.1.zip",
        browser_download_url:
          "https://github.com/nezumi0627/Vyline/releases/download/v1.0.1/Vyline-macos-arm64-1.0.1.zip",
      },
      {
        name: "Vyline-macos-x64-1.0.1.zip",
        browser_download_url:
          "https://github.com/nezumi0627/Vyline/releases/download/v1.0.1/Vyline-macos-x64-1.0.1.zip",
      },
    ];
    expect(selectReleaseAsset("macos", "1.0.1", macAssets, "arm64")?.name).toBe(
      "Vyline-macos-arm64-1.0.1.zip",
    );
    expect(selectReleaseAsset("macos", "1.0.1", macAssets, "x64")?.name).toBe(
      "Vyline-macos-x64-1.0.1.zip",
    );
    expect(selectReleaseAsset("macos", "1.0.1", macAssets)).toBeNull();
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

describe("detectUpdateArchitecture", () => {
  test("uses explicit architecture hints and fails closed for ambiguous macOS user agents", () => {
    expect(detectUpdateArchitecture("Macintosh", "arm", "64")).toBe("arm64");
    expect(detectUpdateArchitecture("Macintosh", "x86", "64")).toBe("x64");
    expect(detectUpdateArchitecture("Macintosh; Intel Mac OS X")).toBe("unknown");
    expect(detectUpdateArchitecture("Windows x64")).toBe("x64");
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
    expect(normalizeReleaseTag("v1.2.0-rc.1+build.7")).toBe("1.2.0-rc.1+build.7");
  });

  test("rejects arbitrary release metadata", () => {
    expect(normalizeReleaseTag("latest")).toBeNull();
    expect(normalizeReleaseTag(undefined)).toBeNull();
    expect(normalizeReleaseTag("v01.2.3")).toBeNull();
  });
});

describe("release URLs", () => {
  test("accepts only the exact trusted release page for the displayed version", () => {
    expect(
      isTrustedReleasePageUrl(
        "https://github.com/nezumi0627/Vyline/releases/tag/v1.2.0-beta.2",
        "1.2.0-beta.2",
      ),
    ).toBe(true);
    expect(
      isTrustedReleasePageUrl(
        "https://github.com.evil.invalid/nezumi0627/Vyline/releases/tag/v1.2.0",
        "1.2.0",
      ),
    ).toBe(false);
  });

  test("falls back to the changelog when the release is missing or does not match", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        tag_name: "v9.9.9",
        html_url: "https://github.com/nezumi0627/Vyline/releases/tag/v9.9.9",
      })) as unknown as typeof fetch;
    try {
      expect(await getVersionReleaseUrl("1.2.0")).toBe(
        "https://github.com/nezumi0627/Vyline/blob/main/CHANGELOG.md",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns the current version's release page when its tag matches", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        tag_name: "v1.2.0-rc.1",
        html_url: "https://github.com/nezumi0627/Vyline/releases/tag/v1.2.0-rc.1",
      })) as unknown as typeof fetch;
    try {
      expect(await getVersionReleaseUrl("1.2.0-rc.1")).toBe(
        "https://github.com/nezumi0627/Vyline/releases/tag/v1.2.0-rc.1",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to the changelog when the release API is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      expect(await getVersionReleaseUrl("1.2.0-beta.2")).toBe(
        "https://github.com/nezumi0627/Vyline/blob/main/CHANGELOG.md",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("releaseChannel", () => {
  test("identifies alpha, beta, and release candidate versions", () => {
    expect(releaseChannel("1.2.0-alpha.1")).toBe("Alpha");
    expect(releaseChannel("1.2.0-beta.2")).toBe("Beta");
    expect(releaseChannel("1.2.0-rc.1")).toBe("RC");
    expect(releaseChannel("1.2.0")).toBeNull();
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

test("latest prerelease metadata is an error and never becomes an update notice", async () => {
  const originalFetch = globalThis.fetch;
  clearUpdateCheckCache();
  globalThis.fetch = (async () =>
    Response.json({
      tag_name: "v9.9.9-beta.1",
      prerelease: true,
      assets: [],
    })) as unknown as typeof fetch;
  try {
    const info = await checkForUpdates({ force: true });
    expect(info.hasUpdate).toBe(false);
    expect(info.error).not.toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    clearUpdateCheckCache();
  }
});

test("Beta update checks use only the prerelease feed and keep their cache separate", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  clearUpdateCheckCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/releases/latest")) {
      return Response.json({
        tag_name: `v${newerStableVersion}`,
        prerelease: false,
        html_url: `https://github.com/nezumi0627/Vyline/releases/tag/v${newerStableVersion}`,
        assets: [],
      });
    }
    return Response.json([
      { tag_name: "v8.0.0", prerelease: false },
      {
        tag_name: `v${newerBetaVersion}`,
        prerelease: true,
        html_url: `https://github.com/nezumi0627/Vyline/releases/tag/v${newerBetaVersion}`,
        assets: [],
      },
      { tag_name: "v9.9.9-beta.1", prerelease: true, draft: true },
    ]);
  }) as unknown as typeof fetch;
  try {
    const beta = await checkForUpdates({ force: true, channel: "beta" });
    const stable = await checkForUpdates({ force: true, channel: "stable" });
    expect(beta.channel).toBe("beta");
    expect(beta.latestVersion).toBe(newerBetaVersion);
    expect(beta.hasUpdate).toBe(true);
    expect(stable.channel).toBe("stable");
    expect(stable.latestVersion).toBe(newerStableVersion);
    expect(urls).toEqual([
      "https://api.github.com/repos/nezumi0627/Vyline/releases?per_page=100",
      "https://api.github.com/repos/nezumi0627/Vyline/releases/latest",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    clearUpdateCheckCache();
  }
});

test("an empty Beta feed is not reported as an API error", async () => {
  const originalFetch = globalThis.fetch;
  clearUpdateCheckCache();
  globalThis.fetch = (async () => Response.json([])) as unknown as typeof fetch;
  try {
    const info = await checkForUpdates({ force: true, channel: "beta" });
    expect(info.latestVersion).toBeNull();
    expect(info.error).toBeNull();
    expect(shouldShowUpdateNotification(true, info)).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    clearUpdateCheckCache();
  }
});

test("a malformed Beta response remains an update-check error", async () => {
  const originalFetch = globalThis.fetch;
  clearUpdateCheckCache();
  globalThis.fetch = (async () => Response.json({ releases: [] })) as unknown as typeof fetch;
  try {
    const info = await checkForUpdates({ force: true, channel: "beta" });
    expect(info.latestVersion).toBeNull();
    expect(info.error).not.toBeNull();
    expect(shouldShowUpdateNotification(true, info)).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    clearUpdateCheckCache();
  }
});

test("a newer stable release is advertised with its validated release page", async () => {
  const originalFetch = globalThis.fetch;
  clearUpdateCheckCache();
  globalThis.fetch = (async () =>
    Response.json({
      tag_name: `v${newerStableVersion}`,
      prerelease: false,
      draft: false,
      html_url: `https://github.com/nezumi0627/Vyline/releases/tag/v${newerStableVersion}`,
      assets: [],
    })) as unknown as typeof fetch;
  try {
    const info = await checkForUpdates({ force: true });
    expect(info.hasUpdate).toBe(true);
    expect(info.latestVersion).toBe(newerStableVersion);
    expect(info.url).toBe(
      `https://github.com/nezumi0627/Vyline/releases/tag/v${newerStableVersion}`,
    );
    expect(info.downloadUrl).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    clearUpdateCheckCache();
  }
});

test("a beta installation is not offered an older stable version", () => {
  expect(isNewerVersion("1.2.0", "1.2.0-beta.2")).toBe(true);
  expect(isNewerVersion("1.1.9", "1.2.0-beta.2")).toBe(false);
});
