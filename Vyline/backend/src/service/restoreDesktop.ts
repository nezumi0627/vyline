/**
 * service/restoreDesktop.ts
 *
 * source/desktop と backend/data の dump を再取り込みし、
 * できるだけ Desktop 由来の状態を Vyline に復元する。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DesktopProfile,
  ensureValidE2EEIdentity,
  importDesktopE2EEKeys,
  loadDesktopE2EEKeyDump,
  seedSelfPublicKeyCache,
  detectInstalledDesktop,
} from "@vyline/protocol";
import { childLogger } from "../logger.js";
import { getClient } from "../line/clientManager.js";
import { refreshVylineProfile } from "../vyline/profileBridge.js";

const log = childLogger("service:restore-desktop");
const _dir = dirname(fileURLToPath(import.meta.url));

function backendDataDir(): string {
  if (process.env["VYLINE_DATA_DIR"]) return process.env["VYLINE_DATA_DIR"];
  return join(_dir, "../../data");
}

function vylineProfileCachePath(): string {
  return join(backendDataDir(), "vyline", "desktop-profile.json");
}

function resolveDesktopKeysPath(): string | null {
  const candidates = [
    join(process.cwd(), "source", "desktop", "e2ee", "desktop-e2ee-keys.json"),
    join(process.cwd(), "Vyline", "backend", "data", "desktop-e2ee-keys.json"),
    join(process.cwd(), "data", "desktop-e2ee-keys.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0] ?? null;
}

function resolveSourceProfilePath(): string | null {
  const candidates = [
    join(process.cwd(), "source", "desktop", "profile", "cachedProfile.present.json"),
    join(process.cwd(), "source", "desktop", "profile", "cachedProfile.json"),
    join(process.cwd(), "source", "desktop", "profile", "fallbackProfile.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadSourceProfile(): { path: string; profile: DesktopProfile } | null {
  const path = resolveSourceProfilePath();
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DesktopProfile>;
    if (!parsed?.identity || !parsed?.defaultHeaders || !parsed?.source) return null;
    return { path, profile: parsed as DesktopProfile };
  } catch (err) {
    log.warn({ path, err }, "failed to parse source desktop profile");
    return null;
  }
}

export async function getRestoreStatus(accountId: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");

  const keysPath = resolveDesktopKeysPath();
  const dump = keysPath ? loadDesktopE2EEKeyDump(keysPath) : null;
  const desktop = detectInstalledDesktop();
  const sourceProfile = loadSourceProfile();

  let mid: string | null = null;
  let serverKeyIds: number[] = [];
  let matched = 0;
  try {
    await client.base.talk.getProfile();
    mid = client.base.profile?.mid ?? null;
    const serverKeys = await client.base.talk.getE2EEPublicKeys();
    serverKeyIds = serverKeys.map((k: { keyId?: number; 2?: number }) => Number(k.keyId ?? k[2]));
    for (const keyId of serverKeyIds) {
      const raw = await client.base.storage.get(`e2eeKeys:${keyId}`);
      if (raw && typeof raw === "string") matched += 1;
    }
  } catch (err) {
    log.warn({ accountId, err }, "restore status probe failed");
  }

  return {
    accountId,
    mid,
    desktopInstalled: Boolean(desktop?.version),
    desktopVersion: desktop?.version ?? null,
    sourceDesktopDumpDir: join(process.cwd(), "source", "desktop"),
    keysFile: keysPath,
    keysFileExists: Boolean(keysPath && existsSync(keysPath)),
    dumpKeyCount: dump?.keys?.length ?? 0,
    dumpExtractedAt: dump?.extractedAt ?? null,
    sourceProfilePath: sourceProfile?.path ?? null,
    sourceProfileExists: Boolean(sourceProfile),
    serverKeyCount: serverKeyIds.length,
    localMatchedServerKeys: matched,
  };
}

export async function restoreFromDesktop(accountId: string) {
  const client = getClient(accountId);
  if (!client) throw new Error("not logged in");

  const keysPath = resolveDesktopKeysPath();
  if (!keysPath || !existsSync(keysPath)) {
    throw new Error(
      "desktop-e2ee-keys.json が見つかりません。source/desktop/e2ee/ か Vyline/backend/data/ に dump を置いてください。",
    );
  }

  const dump = loadDesktopE2EEKeyDump(keysPath);
  if (!dump?.keys?.length) {
    throw new Error("desktop-e2ee-keys.json に有効な鍵がありません");
  }

  const restoredProfile = loadSourceProfile();
  let restoredProfileCachePath: string | null = null;
  if (restoredProfile) {
    restoredProfileCachePath = vylineProfileCachePath();
    mkdirSync(dirname(restoredProfileCachePath), { recursive: true });
    writeFileSync(
      restoredProfileCachePath,
      `${JSON.stringify(restoredProfile.profile, null, 2)}\n`,
      "utf8",
    );
  }

  // Desktop プロファイル再スキャン（UA / X-Line-Application）
  let profileRefresh: unknown = null;
  try {
    profileRefresh = await refreshVylineProfile();
  } catch (err) {
    log.warn({ err }, "vyline profile refresh failed (continuing)");
  }

  const imported = await importDesktopE2EEKeys(client, dump);
  const seeded = await seedSelfPublicKeyCache(client);
  const identity = await ensureValidE2EEIdentity(client, { forceNewSenderKey: false });

  log.info(
    {
      accountId,
      imported: imported.imported,
      skipped: imported.skipped,
      seeded,
      identity,
    },
    "desktop restore completed",
  );

  return {
    keysPath,
    imported: imported.imported,
    skipped: imported.skipped,
    keyIds: imported.keyIds,
    seededPublicKeys: seeded,
    identity,
    restoredProfilePath: restoredProfile?.path ?? null,
    restoredProfileCachePath,
    profileRefresh,
    hint: "チャットを開き直すと、復元できた履歴が復号表示されます。まだ失敗する分は鍵世代が dump に無い可能性があります。",
  };
}
