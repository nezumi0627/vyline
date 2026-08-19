/**
 * DesktopProfile — LINE Desktop Windows から得た identity
 *
 * 実ランタイム (LINE.exe メモリ) で確認済み形式:
 *   x-line-application: DESKTOPWIN.{appVer}.WINDOWS.{sysVer}-{ntSuffix}
 *   user-agent:         DESKTOP:WINDOWS:{sysVer}-{ntSuffix}({appVer})
 *
 * モバイルの tab 区切り形式とは別物。Desktop 専用。
 */

export type DetectionMethod = "scan" | "cache" | "fallback" | "runtime";

export interface EndpointFingerprint {
  host: string;
  path: string;
  hits: number;
}

export interface HeaderFingerprint {
  name: string;
  sample?: string;
  required: boolean;
}

export interface DesktopIdentity {
  /** 例: 26.3.0.3916 */
  appVersion: string;
  device: "DESKTOPWIN";
  systemName: "WINDOWS";
  /** 例: 10.0.26100 */
  systemVersion: string;
  /** 例: 11NT (Win11) / 10NT (Win10) */
  ntSuffix: string;
  /** DESKTOP:WINDOWS:10.0.26100-11NT(26.3.0.3916) */
  userAgent: string;
  /** DESKTOPWIN.26.3.0.3916.WINDOWS.10.0.26100-11NT */
  xLineApplication: string;
}

export interface DesktopProfile {
  schemaVersion: 1;
  source: {
    platform: "win32";
    exePath: string;
    exeSha256: string;
    exeSize: number;
    iniPath: string;
    detectedAt: string;
    detectionMethod: DetectionMethod;
  };
  identity: DesktopIdentity;
  hosts: {
    legy: string;
    front: string;
    updateInfo: string;
  };
  defaultHeaders: Record<string, string>;
  fingerprints: {
    endpoints: EndpointFingerprint[];
    headerNames: HeaderFingerprint[];
    strings: Record<string, string[]>;
    runtimeSamples: string[];
  };
  quality: {
    complete: boolean;
    missing: string[];
    mergedFromPrevious: boolean;
    notes: string[];
  };
}

export type WatchReason =
  | "bin-folder-changed"
  | "update-log-changed"
  | "ini-changed"
  | "manual-refresh"
  | "cdn-check";

export interface DetectResult {
  profile: DesktopProfile;
  fromCache: boolean;
  refreshed: boolean;
  usedFallback: boolean;
}

export interface WatchHandle {
  stop(): void;
}

export interface VylineUpdaterOptions {
  dataDir?: string;
  lineRoot?: string;
  pollIntervalMs?: number;
  debounceMs?: number;
  allowFallback?: boolean;
  /** 起動中 LINE.exe からメモリ文字列を読む (Windows) */
  preferRuntimeDump?: boolean;
  logger?: Pick<Console, "info" | "warn" | "error" | "debug">;
}
