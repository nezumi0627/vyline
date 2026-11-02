/**
 * updater.ts — Vyline アップデーター基盤
 *
 * GitHub Releases から最新バージョンをチェックし、
 * 更新があれば対応OSの公式成果物とリリース情報を案内する。
 */

import { UPDATE_NOTES } from "./store";

const REPO_OWNER = "nezumi0627";
const REPO_NAME = "Vyline";
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const UPDATE_CHECK_CACHE_MS = 5 * 60_000;

let cachedUpdate: { at: number; info: UpdateInfo } | null = null;
let updateCheckInflight: Promise<UpdateInfo> | null = null;

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
  isLocalInstall: boolean;
  body: string | null;
  error: string | null;
}

export type UpdatePlatform = "windows" | "linux" | "macos" | "unknown";
export const BUILD_COMMIT_SHA =
  typeof __VYLINE_COMMIT_SHA__ === "string" ? __VYLINE_COMMIT_SHA__ : "unknown";

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  digest?: string;
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

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Return true only when the release is newer than the installed version. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (value: string) => {
    const withoutBuild = value.replace(/^v/i, "").split("+", 1)[0];
    const [core, ...pre] = (withoutBuild ?? "").split("-");
    const numbers = (core ?? "").split(".").map((part) => Number.parseInt(part, 10));
    if (numbers.length !== 3 || numbers.some((part) => !Number.isSafeInteger(part) || part < 0)) {
      return null;
    }
    return { numbers, pre };
  };
  const left = parse(latest);
  const right = parse(current);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i]! > right.numbers[i]!;
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return left.pre.length === 0 && right.pre.length > 0;
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const a = left.pre[i];
    const b = right.pre[i];
    if (a === undefined) return true;
    if (b === undefined) return false;
    if (a === b) continue;
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return Number(a) > Number(b);
    if (aNum !== bNum) return !aNum;
    return a > b;
  }
  return false;
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
): SelectedReleaseAsset | null {
  const name =
    platform === "windows"
      ? `VylineSetup-${version}.exe`
      : platform === "linux"
        ? `Vyline-linux-x64-${version}.tar.gz`
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
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) ? tag : null;
}

async function fetchUpdateInfo(): Promise<UpdateInfo> {
  const current = UPDATE_NOTES.version;
  const isLocalInstall = typeof location === "undefined" || isLocalHostname(location.hostname);
  const platform =
    !isLocalInstall || typeof navigator === "undefined"
      ? "unknown"
      : detectUpdatePlatform(`${navigator.userAgent} ${navigator.platform}`);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_API, {
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
        isLocalInstall,
        body: null,
        error: `GitHub API returned ${res.status}`,
      };
    }
    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      assets?: ReleaseAsset[];
    };
    const tag = normalizeReleaseTag(release.tag_name);
    const hasUpdate = tag != null && isNewerVersion(tag, current);
    const asset = tag
      ? hasUpdate
        ? selectReleaseAsset(platform, tag, release.assets ?? [])
        : null
      : null;
    return {
      currentVersion: current,
      latestVersion: tag,
      hasUpdate,
      url: release.html_url ?? null,
      downloadUrl: asset?.browser_download_url ?? null,
      downloadDigest: asset?.digest ?? null,
      downloadName: asset?.name ?? null,
      platform,
      isLocalInstall,
      body: release.body ?? null,
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

/** Avoid repeating the same release request while settings is revisited. */
export async function checkForUpdates(options: { force?: boolean } = {}): Promise<UpdateInfo> {
  const now = Date.now();
  if (!options.force && cachedUpdate && now - cachedUpdate.at < UPDATE_CHECK_CACHE_MS) {
    return cachedUpdate.info;
  }
  if (updateCheckInflight) return updateCheckInflight;

  const task = fetchUpdateInfo();
  updateCheckInflight = task;
  try {
    const info = await task;
    cachedUpdate = { at: Date.now(), info };
    return info;
  } finally {
    if (updateCheckInflight === task) updateCheckInflight = null;
  }
}

/** Used by tests and explicit user-triggered rechecks. */
export function clearUpdateCheckCache(): void {
  cachedUpdate = null;
}

/** 現在のバージョン文字列を取得 */
export function currentVersion(): string {
  return UPDATE_NOTES.version;
}
