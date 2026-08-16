/**
 * NezuUpdater ↔ backend ブリッジ
 *
 * 起動時に Desktop プロファイルを確定し、更新を監視する。
 */

import {
  createNezuUpdater,
  type DesktopProfile,
  type NezuUpdater,
} from "@vyline/nezuline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("nezu");
const _dir = dirname(fileURLToPath(import.meta.url));

let updater: NezuUpdater | null = null;
let profile: DesktopProfile | null = null;

function dataDir(): string {
  const root = process.env["VYLINE_DATA_DIR"] ?? join(_dir, "../../data");
  return join(root, "nezuline");
}

export async function initNezuProfile(): Promise<DesktopProfile> {
  updater = createNezuUpdater({
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
    "NezuUpdater Desktop profile ready",
  );

  if (process.env["NEZU_DISABLE_WATCH"] !== "1") {
    updater.watch((next, reason) => {
      profile = next;
      log.warn(
        {
          reason,
          appVersion: next.identity.appVersion,
          xLineApplication: next.identity.xLineApplication,
        },
        "LINE Desktop updated — Nezu profile refreshed",
      );
    });
  }

  return profile;
}

export function getNezuProfile(): DesktopProfile {
  if (!profile) {
    throw new Error("NezuUpdater not initialized — call initNezuProfile() first");
  }
  return profile;
}

export function getNezuUpdater(): NezuUpdater | null {
  return updater;
}

export async function refreshNezuProfile(): Promise<DesktopProfile> {
  if (!updater) throw new Error("NezuUpdater not initialized");
  profile = await updater.refresh();
  return profile;
}
