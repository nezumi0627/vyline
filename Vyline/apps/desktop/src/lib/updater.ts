/**
 * updater.ts — Vyline アップデーター基盤
 *
 * GitHub Releases から最新バージョンをチェックし、
 * 更新があれば対応OSの公式成果物とリリース情報を案内する。
 */

import { UPDATE_NOTES } from "./store";

const REPO_OWNER = "nezumi0627";
const REPO_NAME = "Vyline";
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const UPDATE_CHECK_CACHE_MS = 5 * 60_000;

const cachedUpdates = new Map<UpdateChannel, { at: number; info: UpdateInfo }>();
const updateChecksInflight = new Map<UpdateChannel, Promise<UpdateInfo>>();

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  url: string | null;
  downloadUrl: string | null;
  /** GitHub's SHA-256 digest for the installer, when the release provides it. */
  downloadDigest: string | null;
  downloadName: string | null;
  platform: UpdatePlatform;
  architecture: UpdateArchitecture;
  channel: UpdateChannel;
  isLocalInstall: boolean;
  body: string | null;
  error: string | null;
}

export type UpdatePlatform = "windows" | "linux" | "macos" | "unknown";
export type UpdateArchitecture = "x64" | "arm64" | "unknown";
export type UpdateChannel = "stable" | "beta";
export type ReleaseChannel = "Alpha" | "Beta" | "RC" | "Pre-release" | null;

export function getUpdateChannel(receiveBetaUpdates: boolean): UpdateChannel {
  return receiveBetaUpdates ? "beta" : "stable";
}

export function shouldShowUpdateNotification(
  enabled: boolean,
  info: Pick<UpdateInfo, "hasUpdate" | "error">,
): boolean {
  return enabled && info.hasUpdate && !info.error;
}

export function releaseChannel(version: string): ReleaseChannel {
  const pre = parseSemVer(version)?.pre;
  if (!pre?.length) return null;
  const label = pre[0]!.toLowerCase();
  if (label === "alpha") return "Alpha";
  if (label === "beta") return "Beta";
  if (label === "rc") return "RC";
  return "Pre-release";
}
export const BUILD_COMMIT_SHA =
  typeof __VYLINE_COMMIT_SHA__ === "string" ? __VYLINE_COMMIT_SHA__ : "unknown";

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  digest?: string;
}

export interface ReleaseMetadata {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  assets?: ReleaseAsset[];
  prerelease?: boolean;
  draft?: boolean;
}

export function selectReleaseForChannel(
  releases: ReleaseMetadata[],
  channel: UpdateChannel,
): ReleaseMetadata | null {
  const candidates = releases.filter((release) => {
    const version = normalizeReleaseTag(release.tag_name);
    const parsed = version ? parseSemVer(version) : null;
    if (!parsed || release.draft === true) return false;
    return channel === "beta"
      ? parsed.pre.length > 0 && release.prerelease === true
      : parsed.pre.length === 0 && release.prerelease !== true;
  });
  candidates.sort((left, right) => {
    const a = normalizeReleaseTag(left.tag_name)!;
    const b = normalizeReleaseTag(right.tag_name)!;
    if (isNewerVersion(a, b)) return -1;
    if (isNewerVersion(b, a)) return 1;
    return 0;
  });
  return candidates[0] ?? null;
}

interface SelectedReleaseAsset {
  name: string;
  browser_download_url: string;
  digest: string | null;
}

export function formatBuildVersion(version: string, sha: string): string {
  const shortSha = /^[\da-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null;
  return `V${version}${shortSha ? `(${shortSha})` : ""}`;
}

export function detectUpdatePlatform(platform: string): UpdatePlatform {
  const value = platform.toLowerCase();
  if (/windows|win32/.test(value)) {
    return /win64|x64|amd64|wow64/.test(value) ? "windows" : "unknown";
  }
  if (/macintosh|mac os|macos|darwin/.test(value)) return "macos";
  if (/android|aarch64|arm64|armv\d/.test(value)) return "unknown";
  if (/linux|x11|ubuntu/.test(value)) {
    return /x86_64|x64|amd64/.test(value) ? "linux" : "unknown";
  }
  return "unknown";
}

export function detectUpdateArchitecture(
  platform: string,
  architectureHint = "",
  bitnessHint = "",
): UpdateArchitecture {
  const value = `${platform} ${architectureHint}`.toLowerCase();
  if (
    /arm64|aarch64|apple silicon/.test(value) ||
    (architectureHint === "arm" && bitnessHint === "64")
  )
    return "arm64";
  if (/x86_64|x64|amd64|win64|wow64/.test(value)) return "x64";
  if (/^x86$/.test(architectureHint) && bitnessHint === "64") return "x64";
  if (/macintosh|mac os|macos|darwin|macintel/.test(value)) return "unknown";
  if (/arm|aarch64/.test(value)) return "arm64";
  return "unknown";
}

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Return true only when the release is newer than the installed version. */
export function isNewerVersion(latest: string, current: string): boolean {
  const left = parseSemVer(latest);
  const right = parseSemVer(current);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i]! > right.numbers[i]!;
  }
  if (!left.pre.length || !right.pre.length) {
    return !left.pre.length && right.pre.length > 0;
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const a = left.pre[i];
    const b = right.pre[i];
    if (a === undefined) return true;
    if (b === undefined) return false;
    if (a === b) continue;
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return BigInt(a) > BigInt(b);
    if (aNum !== bNum) return !aNum;
    return a > b;
  }
  return false;
}

interface ParsedSemVer {
  numbers: [number, number, number];
  pre: string[];
}

function parseSemVer(value: string): ParsedSemVer | null {
  const normalized = value.replace(/^v/i, "");
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      normalized,
    );
  if (!match) return null;
  const numbers = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (numbers.some((part) => !Number.isSafeInteger(part))) return null;
  const pre = match[4]?.split(".") ?? [];
  if (pre.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0")))
    return null;
  return { numbers: [...numbers], pre };
}

export function isTrustedInstallerUrl(value: string, tag: string): boolean {
  return isTrustedReleaseAssetUrl(value, tag, `VylineSetup-${tag}.exe`);
}

function isTrustedReleaseAssetUrl(value: string, version: string, assetName: string): boolean {
  try {
    const url = new URL(value);
    const expectedPath = `/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}/${assetName}`;
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname.toLowerCase() === expectedPath.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function selectReleaseAsset(
  platform: UpdatePlatform,
  version: string,
  assets: ReleaseAsset[],
  architecture: UpdateArchitecture = "unknown",
): SelectedReleaseAsset | null {
  const name =
    platform === "windows" && architecture !== "arm64"
      ? `VylineSetup-${version}.exe`
      : platform === "linux" && architecture !== "arm64"
        ? `Vyline-linux-x64-${version}.tar.gz`
        : platform === "macos" && architecture !== "unknown"
          ? `Vyline-macos-${architecture}-${version}.zip`
          : null;
  if (!name) return null;
  const asset = assets.find((item) => item.name === name);
  const downloadUrl = asset?.browser_download_url;
  if (!asset || !downloadUrl || !isTrustedReleaseAssetUrl(downloadUrl, version, name)) return null;
  const digest = /^sha256:[\da-f]{64}$/i.test(asset.digest ?? "")
    ? asset.digest!.toLowerCase()
    : null;
  return { name, browser_download_url: downloadUrl, digest };
}

/** Keep release metadata untrusted until it matches the version format we ship. */
export function normalizeReleaseTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.replace(/^v/i, "");
  return parseSemVer(tag) ? tag : null;
}

async function fetchUpdateInfo(channel: UpdateChannel): Promise<UpdateInfo> {
  const current = UPDATE_NOTES.version;
  const isLocalInstall = typeof location === "undefined" || isLocalHostname(location.hostname);
  const platform =
    !isLocalInstall || typeof navigator === "undefined"
      ? "unknown"
      : detectUpdatePlatform(`${navigator.userAgent} ${navigator.platform}`);
  const architecture =
    !isLocalInstall || typeof navigator === "undefined"
      ? "unknown"
      : await detectBrowserArchitecture(`${navigator.userAgent} ${navigator.platform}`);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const url = channel === "stable" ? `${RELEASES_API}/latest` : `${RELEASES_API}?per_page=100`;
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        currentVersion: current,
        latestVersion: null,
        hasUpdate: false,
        url: null,
        downloadUrl: null,
        downloadDigest: null,
        downloadName: null,
        platform,
        architecture,
        channel,
        isLocalInstall,
        body: null,
        error: `GitHub API returned ${res.status}`,
      };
    }
    const payload = await res.json();
    if (channel === "beta" && !Array.isArray(payload))
      throw new Error("GitHub returned an invalid release list");
    const releases = channel === "beta" ? payload : [payload];
    const release = selectReleaseForChannel(releases as ReleaseMetadata[], channel);
    const tag = release ? normalizeReleaseTag(release.tag_name) : null;
    if (!release && channel === "stable") {
      return {
        currentVersion: current,
        latestVersion: null,
        hasUpdate: false,
        url: null,
        downloadUrl: null,
        downloadDigest: null,
        downloadName: null,
        platform,
        architecture,
        channel,
        isLocalInstall,
        body: null,
        error: "GitHub did not return a valid stable release",
      };
    }
    const hasUpdate = tag != null && isNewerVersion(tag, current);
    const asset =
      tag && hasUpdate
        ? selectReleaseAsset(platform, tag, release?.assets ?? [], architecture)
        : null;
    return {
      currentVersion: current,
      latestVersion: tag,
      hasUpdate,
      url:
        release && tag && isTrustedReleasePageUrl(release.html_url, tag) ? release.html_url : null,
      downloadUrl: asset?.browser_download_url ?? null,
      downloadDigest: asset?.digest ?? null,
      downloadName: asset?.name ?? null,
      platform,
      architecture,
      isLocalInstall,
      body: typeof release?.body === "string" ? release.body : null,
      channel,
      error: null,
    };
  } catch (err) {
    return {
      currentVersion: current,
      latestVersion: null,
      hasUpdate: false,
      url: null,
      downloadUrl: null,
      downloadDigest: null,
      downloadName: null,
      platform,
      architecture,
      channel,
      isLocalInstall,
      body: null,
      error: controller.signal.aborted
        ? `update check timed out after ${UPDATE_CHECK_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function detectBrowserArchitecture(platformText: string): Promise<UpdateArchitecture> {
  const userAgentData = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues?: (
          hints: string[],
        ) => Promise<{ architecture?: string; bitness?: string }>;
      };
    }
  ).userAgentData;
  try {
    const details = await userAgentData?.getHighEntropyValues?.(["architecture", "bitness"]);
    return detectUpdateArchitecture(platformText, details?.architecture, details?.bitness);
  } catch {
    return detectUpdateArchitecture(platformText);
  }
}

export function isTrustedReleasePageUrl(value: unknown, version: string): value is string {
  if (typeof value !== "string" || !parseSemVer(version)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname.toLowerCase() ===
        `/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${version}`.toLowerCase()
    );
  } catch {
    return false;
  }
}

export async function getVersionReleaseUrl(version: string): Promise<string> {
  const fallback = `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/CHANGELOG.md`;
  if (!parseSemVer(version)) return fallback;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${encodeURIComponent(`v${version}`)}`,
      { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return fallback;
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = normalizeReleaseTag(release.tag_name);
    return tag === version && isTrustedReleasePageUrl(release.html_url, tag)
      ? release.html_url
      : fallback;
  } catch {
    return fallback;
  }
}

/** Avoid repeating each channel's release request while settings is revisited. */
export async function checkForUpdates(
  options: { force?: boolean; channel?: UpdateChannel } = {},
): Promise<UpdateInfo> {
  const channel = options.channel ?? "stable";
  const now = Date.now();
  const cachedUpdate = cachedUpdates.get(channel);
  if (!options.force && cachedUpdate && now - cachedUpdate.at < UPDATE_CHECK_CACHE_MS) {
    return cachedUpdate.info;
  }
  const inflight = updateChecksInflight.get(channel);
  if (inflight) return inflight;

  const task = fetchUpdateInfo(channel);
  updateChecksInflight.set(channel, task);
  try {
    const info = await task;
    cachedUpdates.set(channel, { at: Date.now(), info });
    return info;
  } finally {
    if (updateChecksInflight.get(channel) === task) updateChecksInflight.delete(channel);
  }
}

/** Used by tests and explicit user-triggered rechecks. */
export function clearUpdateCheckCache(): void {
  cachedUpdates.clear();
}

/** 現在のバージョン文字列を取得 */
export function currentVersion(): string {
  return UPDATE_NOTES.version;
}
