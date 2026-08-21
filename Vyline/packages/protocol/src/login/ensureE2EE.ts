/**
 * E2EE 自己鍵の検証・修復
 *
 * Desktop は過去の全自己鍵を keychain に持つ。Vyline も同じ鍵を揃えないと
 * ログイン前の履歴が復号できない。
 *
 * 方針:
 * 1. Desktop 抽出 JSON があれば全鍵を取り込む（履歴復号用）
 * 2. サーバ公開鍵と一致するローカル鍵はすべて残す
 * 3. 送信用 mid 鍵は「サーバ最新 keyId」と一致するものが望ましい
 *    （無い場合は一致する最新ローカル鍵を暫定使用。勝手な新規登録はしない）
 * 4. 新規 registerE2EEPublicKey は forceNewSenderKey / allowRegisterNewKey のときだけ
 *    （勝手に登録するとスマホ公式のレターシーリングが壊れる）
 */

import { join } from "node:path";
import type { BaseClient } from "@vyline/protocol/stack/base";
import type { Client } from "@vyline/protocol/stack";
import { createKeyPair, verifyE2EEKeyPair } from "../e2ee/primitives.js";
import {
  defaultDesktopE2EEKeysPath,
  importDesktopE2EEKeys,
  loadDesktopE2EEKeyDump,
} from "./importDesktopE2EE.js";

type AnyClient = Client | BaseClient;

type LocalKey = {
  keyId: number;
  privKey: string;
  pubKey: string;
  e2eeVersion?: string | number;
};

function asBase(client: AnyClient): BaseClient {
  return "base" in client ? (client as Client).base : (client as BaseClient);
}

function keyIdOf(key: { keyId?: number; 2?: number }): number {
  return Number(key.keyId ?? key[2]);
}

function keyDataOf(key: { keyData?: string | Uint8Array; 4?: string | Uint8Array }): Buffer {
  const data = key.keyData ?? key[4];
  if (data == null) return Buffer.alloc(0);
  return typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
}

export interface E2EEIdentityStatus {
  ok: boolean;
  repaired: boolean;
  keyId: number | null;
  matchedKeyIds: number[];
  serverLatestKeyId: number | null;
  reason: string;
  desktopKeysPath?: string | undefined;
}

function resolveDesktopKeysPath(desktopKeysPath?: string): string {
  if (desktopKeysPath) return desktopKeysPath;
  const candidates = [
    join(process.cwd(), "Vyline", "backend", "data", "desktop-e2ee-keys.json"),
    join(process.cwd(), "data", "desktop-e2ee-keys.json"),
    defaultDesktopE2EEKeysPath(),
  ];
  for (const p of candidates) {
    if (loadDesktopE2EEKeyDump(p)) return p;
  }
  return candidates[0] as string;
}

async function registerFreshSenderKey(base: BaseClient, mid: string): Promise<LocalKey> {
  const { privKey, pubKey } = createKeyPair();
  const registered = await base.talk.registerE2EEPublicKey({
    publicKey: {
      version: 1,
      keyId: 0,
      keyData: pubKey.toString("base64"),
      createdTime: Date.now(),
    },
  });
  const keyId = Number(registered.keyId ?? (registered as { 2?: number })[2]);
  const keyData: LocalKey = {
    keyId,
    privKey: Buffer.from(privKey).toString("base64"),
    pubKey: pubKey.toString("base64"),
    e2eeVersion: 1,
  };
  await base.storage.set(`e2eeKeys:${keyId}`, JSON.stringify(keyData));
  await base.storage.set(`e2eeKeys:${mid}`, JSON.stringify(keyData));
  base.log("vyline:e2ee", { phase: "fresh-sender-key", keyId });
  return keyData;
}

/**
 * サーバ登録済み公開鍵とローカル秘密鍵を揃え、
 * 履歴復号用の旧鍵 + 送信可能な最新鍵を維持する。
 */
export async function ensureValidE2EEIdentity(
  client: AnyClient,
  opts: {
    forceNewSenderKey?: boolean;
    /** true のときだけ、サーバ最新の秘密鍵が無い場合に新規登録する。既定 false */
    allowRegisterNewKey?: boolean;
    desktopKeysPath?: string | undefined;
  } = {},
): Promise<E2EEIdentityStatus> {
  const base = asBase(client);

  if (!base.profile?.mid) {
    await base.talk.getProfile();
  }
  const mid = base.profile?.mid;
  if (!mid) {
    return {
      ok: false,
      repaired: false,
      keyId: null,
      matchedKeyIds: [],
      serverLatestKeyId: null,
      reason: "no profile mid",
    };
  }

  let imported = 0;
  const dumpPath = resolveDesktopKeysPath(opts.desktopKeysPath);
  const dump = loadDesktopE2EEKeyDump(dumpPath);
  if (dump) {
    const result = await importDesktopE2EEKeys(base, dump);
    imported = result.imported;
    base.log("vyline:e2ee", {
      phase: "desktop-import-done",
      path: dumpPath,
      ...result,
    });
  }

  const serverKeys = await base.talk.getE2EEPublicKeys();
  const serverKeyIds = serverKeys
    .map((k: { keyId?: number; 2?: number }) => keyIdOf(k))
    .filter(Number.isFinite);
  const serverLatestKeyId = serverKeyIds.length > 0 ? Math.max(...serverKeyIds) : null;

  base.log("vyline:e2ee", {
    phase: "serverKeys",
    count: serverKeys.length,
    keyIds: serverKeyIds,
    latest: serverLatestKeyId,
  });

  const matched: LocalKey[] = [];

  for (const sk of serverKeys) {
    const keyId = keyIdOf(sk);
    const serverPub = keyDataOf(sk);
    const raw = await base.storage.get(`e2eeKeys:${keyId}`);
    if (!raw || typeof raw !== "string") continue;
    try {
      const local = JSON.parse(raw) as LocalKey;
      const priv = Buffer.from(local.privKey, "base64");
      if (!verifyE2EEKeyPair(priv, serverPub)) {
        base.log("vyline:e2ee", {
          phase: "mismatch",
          keyId,
          localPub: String(local.pubKey).slice(0, 24),
          serverPub: serverPub.toString("base64").slice(0, 24),
        });
        continue;
      }
      const normalized: LocalKey = {
        keyId,
        privKey: local.privKey,
        pubKey: serverPub.toString("base64"),
        e2eeVersion: local.e2eeVersion ?? 1,
      };
      await base.storage.set(`e2eeKeys:${keyId}`, JSON.stringify(normalized));
      matched.push(normalized);
    } catch {
      /* ignore corrupt */
    }
  }

  matched.sort((a, b) => a.keyId - b.keyId);
  const matchedKeyIds = matched.map((m) => m.keyId);

  // 自己公開鍵キャッシュを seed（グループ unwrap 用）
  try {
    const { seedSelfPublicKeyCache } = await import("./groupE2EE.js");
    await seedSelfPublicKeyCache(base);
  } catch {
    /* optional */
  }

  const hasLatestSender =
    serverLatestKeyId !== null && matched.some((m) => m.keyId === serverLatestKeyId);

  // 強制、または明示許可時のみ新規登録。既定ではスマホ公式を壊さない。
  const mayRegister = Boolean(opts.forceNewSenderKey) || Boolean(opts.allowRegisterNewKey);

  if (mayRegister && (opts.forceNewSenderKey || !hasLatestSender)) {
    try {
      const fresh = await registerFreshSenderKey(base, mid);
      base.log("vyline:e2ee", {
        phase: "sender-key-rotated",
        fresh: fresh.keyId,
        matchedKeyIds,
        imported,
        forced: Boolean(opts.forceNewSenderKey),
        previousLatest: serverLatestKeyId,
      });
      return {
        ok: true,
        repaired: true,
        keyId: fresh.keyId,
        matchedKeyIds: [...matchedKeyIds, fresh.keyId],
        serverLatestKeyId: fresh.keyId,
        desktopKeysPath: opts.desktopKeysPath,
        reason: opts.forceNewSenderKey
          ? `registered fresh sender key ${fresh.keyId} (forced)`
          : `registered fresh sender key ${fresh.keyId} (server latest ${serverLatestKeyId} had no local priv)`,
      };
    } catch (err) {
      base.log("vyline:e2ee", {
        phase: "fresh-failed",
        err: err instanceof Error ? err.message : String(err),
      });
      if (matched.length > 0) {
        const latest = matched[matched.length - 1]!;
        await base.storage.set(`e2eeKeys:${mid}`, JSON.stringify(latest));
        return {
          ok: false,
          repaired: imported > 0,
          keyId: latest.keyId,
          matchedKeyIds,
          serverLatestKeyId,
          desktopKeysPath: opts.desktopKeysPath,
          reason: `failed to register fresh sender key; fell back to ${latest.keyId}`,
        };
      }
      return {
        ok: false,
        repaired: imported > 0,
        keyId: null,
        matchedKeyIds,
        serverLatestKeyId,
        desktopKeysPath: opts.desktopKeysPath,
        reason: "failed to repair E2EE identity",
      };
    }
  }

  // サーバ最新がローカルに無い → 一致鍵の最新を mid に（新規登録しない）
  if (!hasLatestSender) {
    if (matched.length > 0) {
      const latest = matched[matched.length - 1]!;
      await base.storage.set(`e2eeKeys:${mid}`, JSON.stringify(latest));
      base.log("vyline:e2ee", {
        phase: "fallback-matched-sender-no-register",
        count: matched.length,
        keyIds: matchedKeyIds,
        sender: latest.keyId,
        serverLatestKeyId,
        imported,
      });
      return {
        ok: true,
        repaired: imported > 0,
        keyId: latest.keyId,
        matchedKeyIds,
        serverLatestKeyId,
        desktopKeysPath: opts.desktopKeysPath,
        reason: `no local priv for server latest ${serverLatestKeyId}; using matched ${latest.keyId} (no new register — protects phone Letter Sealing)`,
      };
    }
    return {
      ok: false,
      repaired: imported > 0,
      keyId: null,
      matchedKeyIds,
      serverLatestKeyId,
      desktopKeysPath: opts.desktopKeysPath,
      reason:
        "no matched local keys; refusing to auto-register (set allowRegisterNewKey to override)",
    };
  }

  // サーバ最新鍵の秘密鍵あり → それを mid 既定に
  const sender = matched.find((m) => m.keyId === serverLatestKeyId)!;
  await base.storage.set(`e2eeKeys:${mid}`, JSON.stringify(sender));
  base.log("vyline:e2ee", {
    phase: "matched-latest-sender",
    count: matched.length,
    keyIds: matchedKeyIds,
    sender: sender.keyId,
    imported,
  });
  return {
    ok: true,
    repaired: imported > 0,
    keyId: sender.keyId,
    matchedKeyIds,
    serverLatestKeyId,
    desktopKeysPath: opts.desktopKeysPath,
    reason:
      imported > 0
        ? `imported ${imported} desktop keys; sender=${sender.keyId}`
        : `sender=${sender.keyId}; ${matched.length} keys match server`,
  };
}
