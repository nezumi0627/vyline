/**
 * LINE Desktop インストール版の検出
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  defaultLineRoot,
  lineBinDir,
  lineIniPath,
  updateLogPath,
  versionExePath,
} from "./paths.js";

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;

export interface InstalledDesktop {
  version: string;
  exePath: string;
  iniPath: string;
  updateLogPath: string;
  exeSize: number;
  exeSha256: string;
  folderMtimeMs: number;
}

function readIniVersion(iniPath: string): string | null {
  if (!existsSync(iniPath)) return null;
  const buf = readFileSync(iniPath);
  let text: string;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString("utf16le");
  } else if (buf.includes(0) && buf.length > 4) {
    text = buf.toString("utf16le");
  } else {
    text = buf.toString("utf8");
  }
  const m = text.match(/last_updated_version\s*=\s*(\d+\.\d+\.\d+\.\d+)/i);
  return m?.[1] ?? null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function detectInstalledDesktop(lineRootOverride?: string): InstalledDesktop | null {
  const lineRoot = defaultLineRoot(lineRootOverride);
  const binDir = lineBinDir(lineRoot);
  const iniPath = lineIniPath(lineRoot);
  const logPath = updateLogPath(lineRoot);

  if (!existsSync(binDir)) return null;

  const versions = readdirSync(binDir)
    .filter((name) => VERSION_RE.test(name))
    .filter((name) => existsSync(versionExePath(lineRoot, name)));

  if (versions.length === 0) return null;

  const iniVer = readIniVersion(iniPath);
  const version =
    iniVer && versions.includes(iniVer) ? iniVer : versions.sort(compareVersions).at(-1)!;

  const exePath = versionExePath(lineRoot, version);
  if (!existsSync(exePath)) return null;

  const st = statSync(exePath);
  return {
    version,
    exePath,
    iniPath,
    updateLogPath: logPath,
    exeSize: st.size,
    exeSha256: sha256File(exePath),
    folderMtimeMs: st.mtimeMs,
  };
}

/** update_log: "osVersion: 26.3.0.3916, 10.0.0.26100" */
export function readUpdateLogOsHint(logPath: string): {
  appVersion?: string;
  osVersion?: string;
} {
  if (!existsSync(logPath)) return {};
  const text = readFileSync(logPath, "utf8");
  const m = text.match(/osVersion:\s*(\d+\.\d+\.\d+\.\d+),\s*(\d+\.\d+\.\d+\.\d+)/i);
  if (!m?.[1] || !m[2]) return {};
  return { appVersion: m[1], osVersion: m[2] };
}

export { compareVersions, readIniVersion };
