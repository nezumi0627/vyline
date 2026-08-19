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

const _here = dirname(fileURLToPath(import.meta.url));
const FALLBACK_PATH = join(_here, "../../data/desktop-profile.fallback.json");

export function defaultVylineDataDir(override?: string): string {
  if (override) return override;
  const legacy = process.env.VYLINE_DATA_DIR
    ? join(process.env.VYLINE_DATA_DIR, "nezuline")
    : join(_here, "../../data/nezuline");
  const modern = process.env.VYLINE_DATA_DIR
    ? join(process.env.VYLINE_DATA_DIR, "vyline")
    : join(_here, "../../.cache");
  // 旧ブランド (nezuline) キャッシュがあれば引き続き使う
  if (existsSync(join(legacy, "desktop-profile.json"))) return legacy;
  return modern;
}

export function profileJsonPath(dataDir: string): string {
  return join(dataDir, "desktop-profile.json");
}

export function loadFallbackProfile(): DesktopProfile {
  if (!existsSync(FALLBACK_PATH)) {
    throw new Error(
      `[Vyline] fallback profile が見つかりません: ${FALLBACK_PATH}\n  リポジトリに \`packages/protocol/data/desktop-profile.fallback.json\` が含まれているか確認してください。\n  復旧手順:\n    1. git の変更を最新化する (git pull) — このファイルは追跡対象です\n    2. Windows + LINE Desktop がインストール済みなら \`bun run dev:backend\` を再実行し自動検出させる\n    3. 手動で生成する場合は \`bun run vyline:find-native -- <name>\` 等の解析ツールを利用する\n  詳細: https://github.com/nezumi0627/vyline/issues/6`,
    );
  }
  return JSON.parse(readFileSync(FALLBACK_PATH, "utf8")) as DesktopProfile;
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
