/**
 * lineVersions — LINE Desktop のインストール版検出 / 最新版取得 / 対象版解決。
 *
 * LINE Desktop は以下で管理される:
 *   - 更新情報:  https://desktop.line-scdn.net/win/v2/real/update_info.json
 *   - 配信 ZIP:  {settings.baseUrl|lineUrl}/{version}/LINE.zip
 *                {shared.baseUrl}/{shared.version}/lib.zip
 *   - インストール版: %LOCALAPPDATA%\LINE\Data\LINE.ini の last_updated_version
 *                    と %LOCALAPPDATA%\LINE\bin\<version>\LINE.exe
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { release } from "node:os";
import { join } from "node:path";
import { lineBinDir, lineIniPath, versionExePath, defaultLineRoot } from "./paths.js";

export const UPDATE_INFO_URL = "https://desktop.line-scdn.net/win/v2/real/update_info.json";
const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;

export type UpdateType = "force" | "auto" | "silent";

export interface UpdateInfoEntry {
  region: string;
  target: string;
  os: string;
  systemType?: "x86" | "x64";
  version: string;
  shared_version?: string;
  type: UpdateType;
}

export interface UpdateInfo {
  settings: {
    baseUrl: string;
    lineUrl: string;
    fileName: string;
  };
  shared: {
    baseUrl: string;
    version: string;
    fileName: string;
  };
  infos: UpdateInfoEntry[];
}

/** 4 セグメント版比較。欠けているセグメントは 0 として扱う */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** "10.0" / "10.0.0.14393" を 4 セグメント tuple にする */
function parseVersionTuple(s: string): number[] {
  const parts = s.trim().split(".").map(Number);
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4);
}

/** v が [lo, hi] に含まれるか（lo/hi は省略形可、空は上限/下限なし） */
export function versionInRange(v: string, lo: string | null, hi: string | null): boolean {
  const pv = parseVersionTuple(v);
  if (lo && lo.trim() !== "") {
    const plo = parseVersionTuple(lo);
    for (let i = 0; i < 4; i++) {
      if (pv[i]! < plo[i]!) return false;
      if (pv[i]! > plo[i]!) break;
    }
  }
  if (hi && hi.trim() !== "") {
    const phi = parseVersionTuple(hi);
    for (let i = 0; i < 4; i++) {
      if (pv[i]! > phi[i]!) return false;
      if (pv[i]! < phi[i]!) break;
    }
  }
  return true;
}

function resolveRange(s: string): { lo: string | null; hi: string | null } {
  const idx = s.indexOf("~");
  if (idx < 0) return { lo: s.trim(), hi: s.trim() };
  return { lo: s.slice(0, idx).trim() || null, hi: s.slice(idx + 1).trim() || null };
}

/** Windows OS を LINE 形式 ("10.0.0.26100") で返す */
export function osVersionString(): string {
  const m = release().match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/);
  const major = m?.[1] ?? "10";
  const minor = m?.[2] ?? "0";
  const patch = m?.[3] ?? "0";
  const build = m?.[4] ?? patch;
  // Windows は release() が "10.0.26100" (3 セグメント) を返す → LINE 形式に整形
  return `${major}.${minor}.0.${build === "0" ? patch : build}`;
}

/** update_info.json を取得 */
export async function fetchUpdateInfo(url: string = UPDATE_INFO_URL): Promise<UpdateInfo> {
  const res = await fetch(url, { headers: { "User-Agent": "LineUpdater/1.0.1.93" } });
  if (!res.ok) throw new Error(`update_info 取得失敗: HTTP ${res.status} (${url})`);
  return (await res.json()) as UpdateInfo;
}

/**
 * 現在版に適用される更新対象エントリを解決する。
 * target 範囲に currentVersion が含まれ、os 範囲・systemType が一致する最も新しい対象を返す。
 */
export function resolveTargetVersion(
  info: UpdateInfo,
  currentVersion: string,
  osVersion: string,
  systemType: "x86" | "x64" = "x64",
): UpdateInfoEntry | null {
  let best: UpdateInfoEntry | null = null;
  for (const entry of info.infos) {
    if (entry.systemType && entry.systemType !== systemType) continue;
    const target = resolveRange(entry.target);
    if (!versionInRange(currentVersion, target.lo, target.hi)) continue;
    const os = resolveRange(entry.os);
    if (!versionInRange(osVersion, os.lo, os.hi)) continue;
    if (!best || compareVersions(entry.version, best.version) > 0) best = entry;
  }
  return best;
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

/**
 * bin/current/LINE.exe の実バージョンを返す。
 * LINE は起動時に bin/current をアクティブ版へ同期するため、
 * LINE.ini の last_updated_version より実際の稼働バージョンを反映する。
 */
export function currentExeVersion(lineRoot: string): string | null {
  const currentExe = join(lineBinDir(lineRoot), "current", "LINE.exe");
  if (!existsSync(currentExe)) return null;
  const r = Bun.spawnSync({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `(Get-Item -LiteralPath '${currentExe}').VersionInfo.FileVersion`,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const v = (r.stdout?.toString() ?? "").trim();
  return VERSION_RE.test(v) ? v : null;
}

export interface InstalledDesktop {
  version: string;
  exePath: string;
  iniPath: string;
  exeSize: number;
  exeSha256: string;
}

/** インストール済み LINE の検出（bin/current の稼働版 > INI > 最新 bin フォルダ） */
export function detectInstalledDesktop(lineRootOverride?: string): InstalledDesktop | null {
  const lineRoot = defaultLineRoot(lineRootOverride);
  const binDir = lineBinDir(lineRoot);
  const iniPath = lineIniPath(lineRoot);
  if (!existsSync(binDir)) return null;

  const versions = readdirSync(binDir)
    .filter((name) => VERSION_RE.test(name))
    .filter((name) => existsSync(versionExePath(lineRoot, name)));
  if (versions.length === 0) return null;

  const currentVer = currentExeVersion(lineRoot);
  const iniVer = readIniVersion(iniPath);

  // bin/current/LINE.exe が実在する場合（LINE 起動後にアクティブ版へ同期される）:
  // 対応する <version> フォルダが残っていればそれを、無ければ current 自体を使う。
  // LINE は起動時にバージョンフォルダを current へ統合して削除することがある。
  let version: string | null = null;
  let exePath: string | null = null;
  if (currentVer) {
    version = currentVer;
    exePath = versions.includes(currentVer)
      ? versionExePath(lineRoot, currentVer)
      : join(lineBinDir(lineRoot), "current", "LINE.exe");
  }
  if (!exePath || !existsSync(exePath)) {
    version = iniVer && versions.includes(iniVer)
      ? iniVer
      : versions.sort(compareVersions).at(-1)!;
    exePath = versionExePath(lineRoot, version);
  }
  if (!existsSync(exePath)) return null;

  return {
    version: version!,
    exePath,
    iniPath,
    exeSize: statSync(exePath).size,
    exeSha256: sha256File(exePath),
  };
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export interface InstalledVersion {
  version: string;
  exePath: string;
  exeSize: number;
  exeSha256: string;
  folderMtimeMs: number;
  /** bin/current が指す稼働中バージョンかどうか */
  isCurrent: boolean;
}

/** インストール済みバージョンの一覧（新しい順）。
 *  bin/<version>/LINE.exe が存在するものに加え、バージョンフォルダが統合された
 *  bin/current の稼働版も含める（exePath は bin/current/LINE.exe を指す）。 */
export function listInstalledVersions(lineRootOverride?: string): InstalledVersion[] {
  const lineRoot = defaultLineRoot(lineRootOverride);
  const binDir = lineBinDir(lineRoot);
  if (!existsSync(binDir)) return [];

  const currentVer = currentExeVersion(lineRoot);
  const currentExe = join(binDir, "current", "LINE.exe");

  const versions = readdirSync(binDir)
    .filter((name) => VERSION_RE.test(name))
    .filter((name) => existsSync(versionExePath(lineRoot, name)))
    .sort(compareVersions)
    .reverse()
    .map((version) => {
      const exePath = versionExePath(lineRoot, version);
      return {
        version,
        exePath,
        exeSize: statSync(exePath).size,
        exeSha256: sha256File(exePath),
        folderMtimeMs: statSync(join(binDir, version)).mtimeMs,
        isCurrent: version === currentVer,
      };
    });

  // バージョンフォルダが統合されて current にしか残っていない場合も一覧へ追加
  if (currentVer && !versions.some((v) => v.version === currentVer) && existsSync(currentExe)) {
    versions.unshift({
      version: currentVer,
      exePath: currentExe,
      exeSize: statSync(currentExe).size,
      exeSha256: sha256File(currentExe),
      folderMtimeMs: statSync(join(binDir, "current")).mtimeMs,
      isCurrent: true,
    });
  }

  return versions;
}

/** インストール済みバージョンから指定バージョンを検索 */
export function findInstalledVersion(
  lineRoot: string,
  version: string,
): InstalledVersion | null {
  return listInstalledVersions(lineRoot).find((v) => v.version === version) ?? null;
}

/** LINE 本体 ZIP の URL（version フォルダを含む形式） */
export function lineZipUrl(info: UpdateInfo, version: string): string {
  return `${info.settings.lineUrl}/${version}/${info.settings.fileName}`;
}

/** 共有ライブラリ lib.zip の URL */
export function sharedLibZipUrl(info: UpdateInfo, sharedVersion: string): string {
  return `${info.shared.baseUrl}/${sharedVersion}/${info.shared.fileName}`;
}
