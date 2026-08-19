/**
 * LINE Desktop インストールパス解決
 * 唯一の正: %LOCALAPPDATA%\LINE
 */

import { join } from "node:path";
import { homedir } from "node:os";

export function localAppData(): string {
  return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
}

export function defaultLineRoot(override?: string): string {
  return override ?? process.env.VYLINE_LINE_ROOT ?? join(localAppData(), "LINE");
}

export function lineBinDir(lineRoot: string): string {
  return join(lineRoot, "bin");
}

export function lineDataDir(lineRoot: string): string {
  return join(lineRoot, "Data");
}

export function lineIniPath(lineRoot: string): string {
  return join(lineDataDir(lineRoot), "LINE.ini");
}

export function updateLogPath(lineRoot: string): string {
  return join(lineBinDir(lineRoot), "update_log.txt");
}

export function versionExePath(lineRoot: string, version: string): string {
  return join(lineBinDir(lineRoot), version, "LINE.exe");
}

export const UPDATE_INFO_URL = "https://desktop.line-scdn.net/win/v2/real/update_info.json";
