/**
 * VylineUpdater — LINE Desktop 更新追従
 *
 * ソース・オブ・トゥルースは Windows LINE Desktop のみ。
 * 優先順: ランタイムメモリ → インストール版 + OS 合成 → キャッシュ → fallback
 */

import { detectInstalledDesktop, readUpdateLogOsHint } from "../desktop/version.js";
import {
  buildIdentity,
  applyIdentityToProfile,
  detectSystemVersion,
  detectNtSuffix,
} from "../desktop/identity.js";
import { dumpRuntimeIdentity, extractFromExe } from "../desktop/extract.js";
import {
  defaultVylineDataDir,
  loadCachedOrFallback,
  loadCachedProfile,
  loadFallbackProfile,
  saveProfile,
} from "../desktop/persist.js";
import { defaultLineRoot, UPDATE_INFO_URL } from "../desktop/paths.js";
import { startWatcher } from "./watcher.js";
import type {
  DesktopProfile,
  DetectResult,
  VylineUpdaterOptions,
  WatchHandle,
  WatchReason,
} from "../desktop/types.js";

function logOf(opts: VylineUpdaterOptions) {
  return opts.logger ?? console;
}

function normalizeOsFromUpdateLog(osVersion?: string): string | undefined {
  // update_log: 10.0.0.26100 → header では 10.0.26100
  if (!osVersion) return undefined;
  const p = osVersion.split(".");
  if (p.length === 4) return `${p[0]}.${p[1]}.${p[3]}`;
  if (p.length === 3) return osVersion;
  return osVersion;
}

export class VylineUpdater {
  #opts: VylineUpdaterOptions;
  #dataDir: string;
  #profile: DesktopProfile | null = null;
  #watch: WatchHandle | null = null;

  constructor(options: VylineUpdaterOptions = {}) {
    this.#opts = {
      preferRuntimeDump: true,
      allowFallback: true,
      pollIntervalMs: 30_000,
      debounceMs: 2_000,
      ...options,
    };
    this.#dataDir = defaultVylineDataDir(options.dataDir);
  }

  getProfile(): DesktopProfile | null {
    return this.#profile;
  }

  async detect(): Promise<DetectResult> {
    const log = logOf(this.#opts);
    const cached = loadCachedProfile(this.#dataDir);

    if (process.platform !== "win32") {
      this.#profile = cached ?? loadFallbackProfile();
      log.warn("[VylineUpdater] non-Windows — using cached/fallback Desktop profile");
      return {
        profile: this.#profile,
        fromCache: Boolean(cached),
        refreshed: false,
        usedFallback: !cached,
      };
    }

    const installed = detectInstalledDesktop(this.#opts.lineRoot);
    if (!installed) {
      this.#profile = cached ?? loadFallbackProfile();
      log.warn("[VylineUpdater] LINE Desktop not found — using cached/fallback");
      return {
        profile: this.#profile,
        fromCache: Boolean(cached),
        refreshed: false,
        usedFallback: !cached,
      };
    }

    if (
      cached &&
      cached.identity.appVersion === installed.version &&
      cached.source.exeSha256 === installed.exeSha256
    ) {
      this.#profile = cached;
      log.info(`[VylineUpdater] cache hit Desktop ${cached.identity.appVersion}`);
      return {
        profile: cached,
        fromCache: true,
        refreshed: false,
        usedFallback: false,
      };
    }

    const profile = await this.refresh();
    return {
      profile,
      fromCache: false,
      refreshed: true,
      usedFallback: false,
    };
  }

  async refresh(): Promise<DesktopProfile> {
    const log = logOf(this.#opts);
    const prev = this.#profile ?? loadCachedProfile(this.#dataDir);
    const base = prev ?? loadFallbackProfile();
    const installed = detectInstalledDesktop(this.#opts.lineRoot);

    if (!installed) {
      this.#profile = loadCachedOrFallback(this.#dataDir);
      return this.#profile;
    }

    const osHint = readUpdateLogOsHint(installed.updateLogPath);
    const systemVersion = normalizeOsFromUpdateLog(osHint.osVersion) ?? detectSystemVersion();
    const ntSuffix = detectNtSuffix(Number.parseInt(systemVersion.split(".")[2] ?? "0", 10));

    let identity = buildIdentity(installed.version, systemVersion, ntSuffix);
    let method: DesktopProfile["source"]["detectionMethod"] = "scan";
    const notes: string[] = [`installed=${installed.version}`, `exe=${installed.exePath}`];
    let samples: string[] = [];

    // 1) ランタイムメモリ優先 (Desktop 実ヘッダー)
    if (this.#opts.preferRuntimeDump !== false) {
      const runtime = dumpRuntimeIdentity();
      notes.push(...runtime.notes);
      samples = runtime.samples;
      if (runtime.identity) {
        identity = runtime.identity;
        method = "runtime";
        notes.push("identity from live LINE.exe memory");
      }
    }

    // 2) PE 部分スキャン (Themida では synthetic になりやすい)
    if (method !== "runtime") {
      const pe = extractFromExe(installed.exePath, installed.version);
      notes.push(...pe.notes);
      samples = [...samples, ...pe.samples];
      if (pe.identity && pe.method !== "synthetic") {
        identity = pe.identity;
        method = "scan";
      } else {
        // インストール版 + OS で Desktop 形式を合成
        identity = buildIdentity(installed.version, systemVersion, ntSuffix);
        method = "scan";
        notes.push("synthesized Desktop identity (Themida-safe path)");
      }
    }

    // CDN 最新版チェック (情報のみ)
    try {
      const cdn = await this.#fetchCdnLatest();
      if (cdn && cdn !== installed.version) {
        notes.push(`CDN latest=${cdn} (installed=${installed.version})`);
      }
    } catch (err) {
      notes.push(`CDN check failed: ${String(err)}`);
    }

    let profile = applyIdentityToProfile(base, identity, method);
    profile = {
      ...profile,
      source: {
        platform: "win32",
        exePath: installed.exePath,
        exeSha256: installed.exeSha256,
        exeSize: installed.exeSize,
        iniPath: installed.iniPath,
        detectedAt: new Date().toISOString(),
        detectionMethod: method,
      },
      hosts: {
        ...profile.hosts,
        updateInfo: UPDATE_INFO_URL,
        legy: "legy-jp.line-apps.com",
        front: "front.line-apps.com",
      },
      fingerprints: {
        ...profile.fingerprints,
        runtimeSamples: samples.slice(0, 20),
      },
      quality: {
        complete: true,
        missing: [],
        mergedFromPrevious: Boolean(prev),
        notes,
      },
    };

    saveProfile(this.#dataDir, profile);
    this.#profile = profile;
    log.info(`[VylineUpdater] refreshed Desktop profile ${identity.appVersion} via ${method}`);
    log.debug?.(`[VylineUpdater] UA=${identity.userAgent} XLA=${identity.xLineApplication}`);
    return profile;
  }

  watch(onChange: (profile: DesktopProfile, reason: WatchReason) => void): WatchHandle {
    this.#watch?.stop();
    const lineRoot = defaultLineRoot(this.#opts.lineRoot);
    this.#watch = startWatcher(
      {
        lineRoot,
        pollIntervalMs: this.#opts.pollIntervalMs ?? 30_000,
        debounceMs: this.#opts.debounceMs ?? 2_000,
      },
      async (reason) => {
        const profile = await this.refresh();
        onChange(profile, reason);
      },
    );
    return this.#watch;
  }

  async #fetchCdnLatest(): Promise<string | null> {
    const res = await fetch(UPDATE_INFO_URL, {
      headers: { "user-agent": "VylineUpdater/0.1" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      updates?: Array<{ version?: string }>;
    };
    const versions =
      json.updates?.map((u) => u.version).filter((v): v is string => Boolean(v)) ?? [];
    if (versions.length === 0) return null;
    return (
      versions
        .sort((a, b) => {
          const pa = a.split(".").map(Number);
          const pb = b.split(".").map(Number);
          for (let i = 0; i < 4; i++) {
            const d = (pa[i] ?? 0) - (pb[i] ?? 0);
            if (d !== 0) return d;
          }
          return 0;
        })
        .at(-1) ?? null
    );
  }
}

export function createVylineUpdater(options?: VylineUpdaterOptions): VylineUpdater {
  return new VylineUpdater(options);
}
