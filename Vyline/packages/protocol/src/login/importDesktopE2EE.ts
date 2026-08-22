/**
 * Desktop 稼働中メモリ / 抽出済み JSON から E2EE 自己鍵を取り込む
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BaseClient } from "@vyline/protocol/stack/base";
import type { Client } from "@vyline/protocol/stack";
import { verifyE2EEKeyPair } from "../e2ee/primitives.js";
import { selfPubCacheKey } from "../e2ee/pubCacheKeys.js";

type AnyClient = Client | BaseClient;

export interface DesktopE2EEKey {
  keyId: number | string;
  privKey: string;
  pubKey: string;
  e2eeVersion?: number | string;
}

export interface DesktopE2EEKeyDump {
  mid?: string;
  extractedAt?: string;
  keys: DesktopE2EEKey[];
}

function asBase(client: AnyClient): BaseClient {
  return "base" in client ? (client as Client).base : (client as BaseClient);
}

/** 既定の抽出ファイルパス */
export function defaultDesktopE2EEKeysPath(dataDir?: string): string {
  const dir = dataDir ?? process.env.VYLINE_DATA_DIR ?? join(process.cwd(), "data");
  return join(dir, "desktop-e2ee-keys.json");
}

export function loadDesktopE2EEKeyDump(path: string): DesktopE2EEKeyDump | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as DesktopE2EEKeyDump;
    if (!raw?.keys?.length) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Desktop 抽出鍵を protocol storage にマージする。
 * 既存の一致する鍵は残し、サーバ公開鍵と一致するものだけ採用する。
 */
export async function importDesktopE2EEKeys(
  client: AnyClient,
  dump: DesktopE2EEKeyDump,
): Promise<{ imported: number; skipped: number; keyIds: number[] }> {
  const base = asBase(client);
  if (!base.profile?.mid) await base.talk.getProfile();
  const mid = base.profile?.mid;

  let serverKeys: Array<{
    keyId?: number;
    2?: number;
    keyData?: string | Uint8Array;
    4?: string | Uint8Array;
  }> = [];
  try {
    serverKeys = await base.talk.getE2EEPublicKeys();
  } catch {
    /* offline import: verify local only */
  }

  const serverById = new Map<number, Buffer>();
  for (const sk of serverKeys) {
    const id = Number(sk.keyId ?? sk[2]);
    const data = sk.keyData ?? sk[4];
    if (Number.isFinite(id) && data) {
      serverById.set(id, typeof data === "string" ? Buffer.from(data) : Buffer.from(data));
    }
  }

  let imported = 0;
  let skipped = 0;
  const keyIds: number[] = [];
  let latestServerMatched: DesktopE2EEKey | null = null;

  for (const key of dump.keys) {
    const keyId = Number(key.keyId);
    if (!Number.isFinite(keyId) || !key.privKey || !key.pubKey) {
      skipped += 1;
      continue;
    }
    const priv = Buffer.from(key.privKey, "base64");
    const pub = Buffer.from(key.pubKey, "base64");
    if (!verifyE2EEKeyPair(priv, pub)) {
      base.log("vyline:e2ee", { phase: "desktop-import-bad-pair", keyId });
      skipped += 1;
      continue;
    }
    const serverPub = serverById.get(keyId);
    // サーバに無い keyId も履歴復号用に保存するが、mid 既定には使わない
    if (serverPub && !verifyE2EEKeyPair(priv, serverPub)) {
      base.log("vyline:e2ee", { phase: "desktop-import-server-mismatch", keyId });
      skipped += 1;
      continue;
    }

    const payload = {
      keyId,
      privKey: key.privKey,
      pubKey: serverPub ? serverPub.toString("base64") : key.pubKey,
      e2eeVersion: key.e2eeVersion ?? 1,
    };
    await base.storage.set(`e2eeKeys:${keyId}`, JSON.stringify(payload));
    // 自分が creator のグループ鍵 unwrap 用（peer キャッシュと keyId 衝突しないよう self 名前空間）
    await base.storage.set(selfPubCacheKey(keyId), payload.pubKey);
    imported += 1;
    keyIds.push(keyId);
    if (serverPub) {
      if (!latestServerMatched || keyId > Number(latestServerMatched.keyId)) {
        latestServerMatched = payload;
      }
    }
    base.log("vyline:e2ee", {
      phase: "desktop-import",
      keyId,
      onServer: Boolean(serverPub),
    });
  }

  // mid キーはサーバ登録済み＆一致する最大 keyId（送信時の sender key）
  if (mid && latestServerMatched) {
    await base.storage.set(`e2eeKeys:${mid}`, JSON.stringify(latestServerMatched));
  }

  return { imported, skipped, keyIds };
}
