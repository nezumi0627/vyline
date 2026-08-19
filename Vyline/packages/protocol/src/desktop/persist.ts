/**
 * プロファイル JSON の永続化
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopProfile } from "./types.js";
// 静的 JSON import。fs パス解決ではなくバンドラに埋め込ませることで、
// `bun build --compile` の単一実行ファイル（Electron 同梱バックエンドなど）でも
// 仮想 FS 上のパスズレ（ /$bunfs/... が "../.. " で ルートに崩れる）なしに読める。
import fallbackProfileJson from "../../data/desktop-profile.fallback.json" with { type: "json" };

const _here = dirname(fileURLToPath(import.meta.url));

export function defaultVylineDataDir(override?: string): string {
  if (override) return override;
  const legacy = process.env["VYLINE_DATA_DIR"]
    ? join(process.env["VYLINE_DATA_DIR"], "nezuline")
    : join(_here, "../../data/nezuline");
  const modern = process.env["VYLINE_DATA_DIR"]
    ? join(process.env["VYLINE_DATA_DIR"], "vyline")
    : join(_here, "../../.cache");
  // 旧ブランド (nezuline) キャッシュがあれば引き続き使う
  if (existsSync(join(legacy, "desktop-profile.json"))) return legacy;
  return modern;
}

export function profileJsonPath(dataDir: string): string {
  return join(dataDir, "desktop-profile.json");
}

export function loadFallbackProfile(): DesktopProfile {
  return fallbackProfileJson as unknown as DesktopProfile;
}

export function loadCachedProfile(dataDir: string): DesktopProfile | null {
  const path = profileJsonPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DesktopProfile;
  } catch {
    return null;
  }
}

export function saveProfile(dataDir: string, profile: DesktopProfile): void {
  mkdirSync(dataDir, { recursive: true });
  const path = profileJsonPath(dataDir);
  const tmp = `${path}.tmp`;
  const bak = `${path}.bak`;
  if (existsSync(path)) {
    try {
      copyFileSync(path, bak);
    } catch {
      /* ignore */
    }
  }
  writeFileSync(tmp, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadCachedOrFallback(dataDir: string): DesktopProfile {
  return loadCachedProfile(dataDir) ?? loadFallbackProfile();
}
