/**
 * VylineUpdater ↔ backend ブリッジ
 *
 * 起動時に Desktop プロファイルを確定し、更新を監視する。
 */

import { createVylineUpdater, type DesktopProfile, type VylineUpdater } from "@vyline/protocol";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("vyline");
const _dir = dirname(fileURLToPath(import.meta.url));

let updater: VylineUpdater | null = null;
let profile: DesktopProfile | null = null;

function dataDir(): string {
  const root = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
  const modern = join(root, "vyline");
  const legacy = join(root, "nezuline");
  // 旧ブランド (nezuline) キャッシュがあれば引き続き使う
  if (existsSync(join(legacy, "desktop-profile.json"))) return legacy;
  return modern;
}

export async function initVylineProfile(): Promise<DesktopProfile> {
  updater = createVylineUpdater({
    dataDir: dataDir(),
    preferRuntimeDump: true,
    logger: {
      info: (...a) => log.info(a.join(" ")),
      warn: (...a) => log.warn(a.join(" ")),
      error: (...a) => log.error(a.join(" ")),
      debug: (...a) => log.debug(a.join(" ")),
    },
  });

  const result = await updater.detect();
  profile = result.profile;

  log.info(
    {
      appVersion: profile.identity.appVersion,
      userAgent: profile.identity.userAgent,
      xLineApplication: profile.identity.xLineApplication,
      method: profile.source.detectionMethod,
      fromCache: result.fromCache,
      refreshed: result.refreshed,
      usedFallback: result.usedFallback,
    },
    "VylineUpdater Desktop profile ready",
  );

  if (process.env.VYLINE_DISABLE_WATCH !== "1") {
    updater.watch((next, reason) => {
      profile = next;
      log.warn(
        {
          reason,
          appVersion: next.identity.appVersion,
          xLineApplication: next.identity.xLineApplication,
        },
        "LINE Desktop updated — Vyline profile refreshed",
      );
    });
  }

  return profile;
}

export function getVylineProfile(): DesktopProfile {
  if (!profile) {
    throw new Error("VylineUpdater not initialized — call initVylineProfile() first");
  }
  return profile;
}

export function getVylineUpdater(): VylineUpdater | null {
  return updater;
}

export async function refreshVylineProfile(): Promise<DesktopProfile> {
  if (!updater) throw new Error("VylineUpdater not initialized");
  profile = await updater.refresh();
  return profile;
}
