/**
 * updater.ts — Vyline アップデーター基盤
 *
 * GitHub Releases から最新バージョンをチェックし、
 * 更新があれば通知する。
 *
 * Windows 配布時は GitHub Release の Setup.exe を直接案内する。
 */

import { UPDATE_NOTES } from "./store";

const REPO_OWNER = "nezumi0627";
const REPO_NAME = "Vyline";
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  url: string | null;
  downloadUrl: string | null;
  /** GitHub's SHA-256 digest for the installer, when the release provides it. */
  downloadDigest: string | null;
  body: string | null;
  error: string | null;
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
  const prefix = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}/`;
  return value.startsWith(prefix) && value === `${prefix}VylineSetup-${tag}.exe`;
}

/** Keep release metadata untrusted until it matches the version format we ship. */
export function normalizeReleaseTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.replace(/^v/i, "");
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) ? tag : null;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = UPDATE_NOTES.version;
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
        body: null,
        error: `GitHub API returned ${res.status}`,
      };
    }
    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string; digest?: string }>;
    };
    const tag = normalizeReleaseTag(release.tag_name);
    const hasUpdate = tag != null && isNewerVersion(tag, current);
    const installer = release.assets?.find((asset) => asset.name === `VylineSetup-${tag}.exe`);
    const candidateUrl = installer?.browser_download_url ?? null;
    const downloadUrl =
      candidateUrl && tag && isTrustedInstallerUrl(candidateUrl, tag) ? candidateUrl : null;
    const downloadDigest =
      downloadUrl && /^sha256:[0-9a-f]{64}$/i.test(installer?.digest ?? "")
        ? installer!.digest!.toLowerCase()
        : null;
    return {
      currentVersion: current,
      latestVersion: tag,
      hasUpdate,
      url: release.html_url ?? null,
      downloadUrl,
      downloadDigest,
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
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/** 現在のバージョン文字列を取得 */
export function currentVersion(): string {
  return UPDATE_NOTES.version;
}
