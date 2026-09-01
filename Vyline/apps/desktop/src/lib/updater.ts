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
const REPO_NAME = "vyline";
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  url: string | null;
  downloadUrl: string | null;
  body: string | null;
  error: string | null;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = UPDATE_NOTES.version;
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) {
      return {
        currentVersion: current,
        latestVersion: null,
        hasUpdate: false,
        url: null,
        downloadUrl: null,
        body: null,
        error: `GitHub API returned ${res.status}`,
      };
    }
    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const tag = release.tag_name?.replace(/^v/, "") ?? null;
    const hasUpdate = tag != null && tag !== current;
    const downloadUrl =
      release.assets?.find((asset) => asset.name === `VylineSetup-${tag}.exe`)
        ?.browser_download_url ?? null;
    return {
      currentVersion: current,
      latestVersion: tag,
      hasUpdate,
      url: release.html_url ?? null,
      downloadUrl,
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
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 現在のバージョン文字列を取得 */
export function currentVersion(): string {
  return UPDATE_NOTES.version;
}
