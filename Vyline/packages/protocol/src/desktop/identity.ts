/**
 * Desktop identity 合成
 *
 * LINE.exe メモリ HEX 確認済み:
 *   X-Line-Application: DESKTOPWIN<TAB>{appVer}<TAB>WINDOWS<TAB>{sysVer}-{nt}
 *   User-Agent:         DESKTOP:WINDOWS:{sysVer}-{nt}({appVer})
 *
 * ※ ASCII 表示でドットに見えるが、実バイトは 0x09 (TAB)
 */

import { release as osRelease } from "node:os";
import type { DesktopIdentity, DesktopProfile } from "./types.js";

/** Win11 は build >= 22000 */
export function detectNtSuffix(build?: number): string {
  const b = build ?? Number.parseInt(osRelease().split(".")[2] ?? "0", 10);
  return b >= 22000 ? "11NT" : "10NT";
}

/** os.release() "10.0.26100" → "10.0.26100" */
export function detectSystemVersion(): string {
  const parts = osRelease().split(".");
  const major = parts[0] ?? "10";
  const minor = parts[1] ?? "0";
  const build = parts[2] ?? "0";
  return `${major}.${minor}.${build}`;
}

export function buildXLineApplication(
  appVersion: string,
  systemVersion: string,
  ntSuffix: string,
): string {
  // Desktop 実測: TAB 区切り 4 フィールド
  return `DESKTOPWIN\t${appVersion}\tWINDOWS\t${systemVersion}-${ntSuffix}`;
}

export function buildUserAgent(
  appVersion: string,
  systemVersion: string,
  ntSuffix: string,
): string {
  return `DESKTOP:WINDOWS:${systemVersion}-${ntSuffix}(${appVersion})`;
}

export function buildIdentity(
  appVersion: string,
  systemVersion = detectSystemVersion(),
  ntSuffix = detectNtSuffix(),
): DesktopIdentity {
  return {
    appVersion,
    device: "DESKTOPWIN",
    systemName: "WINDOWS",
    systemVersion,
    ntSuffix,
    userAgent: buildUserAgent(appVersion, systemVersion, ntSuffix),
    xLineApplication: buildXLineApplication(appVersion, systemVersion, ntSuffix),
  };
}

export function buildDefaultHeaders(identity: DesktopIdentity): Record<string, string> {
  return {
    "user-agent": identity.userAgent,
    "x-line-application": identity.xLineApplication,
    "x-lal": "ja_JP",
    "x-lpv": "1",
    "x-lap": "5",
    "content-type": "application/x-thrift",
    "accept-encoding": "gzip",
  };
}

export function applyIdentityToProfile(
  base: DesktopProfile,
  identity: DesktopIdentity,
  method: DesktopProfile["source"]["detectionMethod"],
): DesktopProfile {
  return {
    ...base,
    source: {
      ...base.source,
      detectedAt: new Date().toISOString(),
      detectionMethod: method,
    },
    identity,
    defaultHeaders: buildDefaultHeaders(identity),
    quality: {
      ...base.quality,
      complete: Boolean(identity.appVersion && identity.userAgent),
      missing: identity.appVersion ? [] : ["appVersion"],
    },
  };
}

/** ランタイム文字列から identity をパース (TAB または誤表示ドット両対応) */
export function parseRuntimeApplicationHeader(raw: string): DesktopIdentity | null {
  // DESKTOPWIN\t26.3.0.3916\tWINDOWS\t10.0.26100-11NT
  const tab = raw.match(
    /DESKTOPWIN[\t.](\d+\.\d+\.\d+\.\d+)[\t.]WINDOWS[\t.](\d+\.\d+\.\d+)-(\d+NT)/i,
  );
  if (!tab?.[1] || !tab[2] || !tab[3]) return null;
  return buildIdentity(tab[1], tab[2], tab[3]);
}

export function parseRuntimeUserAgent(raw: string): DesktopIdentity | null {
  // DESKTOP:WINDOWS:10.0.26100-11NT(26.3.0.3916)
  const m = raw.match(/DESKTOP:WINDOWS:(\d+\.\d+\.\d+)-(\d+NT)\((\d+\.\d+\.\d+\.\d+)\)/i);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return buildIdentity(m[3], m[1], m[2]);
}
