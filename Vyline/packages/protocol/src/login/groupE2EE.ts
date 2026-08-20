/**
 * グループ E2EE 共有鍵 — Desktop/Android 準拠の (chatMid, groupKeyId) マルチキャッシュ
 *
 * 公式は ConcurrentHashMap(CacheKey(chatId, groupKeyId))。
 * プロトコルスタック既定は e2eeGroupKeys:{chatMid} が最新1本だけ → 履歴 BAD_DECRYPT の主因。
 *
 * 本モジュール:
 * - e2eeGroupKeys:{chatMid}:{groupKeyId} に複数保存
 * - アクティブ鍵を e2eeGroupKeys:{chatMid} にも書いてプロトコルスタック本体と互換
 * - getE2EEGroupSharedKey(by-id) で欠落を補完
 */

import { createDecipheriv } from "node:crypto";
import type { BaseClient } from "@vyline/protocol/stack/base";
import type { Client } from "@vyline/protocol/stack";
import { getSelfKeyByKeyId, getSelfKeyByMid } from "../e2ee/letterSealing.js";
import { selfPubCacheKey, peerPubCacheKey } from "../e2ee/pubCacheKeys.js";
import { generateSharedSecret, getSHA256Sum, xorHalves } from "../e2ee/primitives.js";

type AnyClient = Client | BaseClient;

export type GroupKeyMaterial = {
  privKey: string;
  keyId: number;
};

function asBase(client: AnyClient): BaseClient {
  return "base" in client ? (client as Client).base : (client as BaseClient);
}

function storageKey(chatMid: string, groupKeyId: number): string {
  return `e2eeGroupKeys:${chatMid}:${groupKeyId}`;
}

function chunkKeyId(chunk: string | Uint8Array | undefined): number | null {
  if (!chunk) return null;
  const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk);
  let value = 0;
  for (const b of bytes) value = value * 256 + b;
  return Number.isFinite(value) ? value : null;
}

/** メッセージ chunks[4] = グループ時の groupKeyId */
export function groupKeyIdFromMessage(msg: any): number | null {
  if (!Array.isArray(msg?.chunks) || !msg.chunks[4]) return null;
  return chunkKeyId(msg.chunks[4]);
}

export async function loadGroupKey(
  client: AnyClient,
  chatMid: string,
  groupKeyId: number,
): Promise<GroupKeyMaterial | null> {
  const base = asBase(client);
  const raw = await base.storage.get(storageKey(chatMid, groupKeyId));
  if (raw && typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as GroupKeyMaterial;
      if (j?.privKey && Number(j.keyId) === groupKeyId) return j;
    } catch {
      /* fallthrough */
    }
  }
  // protocol 単一キャッシュが一致していれば流用
  const legacy = await base.storage.get(`e2eeGroupKeys:${chatMid}`);
  if (legacy && typeof legacy === "string") {
    try {
      const j = JSON.parse(legacy) as GroupKeyMaterial;
      if (j?.privKey && Number(j.keyId) === groupKeyId) return j;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function storeGroupKey(
  client: AnyClient,
  chatMid: string,
  key: GroupKeyMaterial,
): Promise<void> {
  const base = asBase(client);
  const payload = JSON.stringify(key);
  await base.storage.set(storageKey(chatMid, key.keyId), payload);
  // protocol decrypt 経路が読む単一キーも同期
  await base.storage.set(`e2eeGroupKeys:${chatMid}`, payload);
}

/**
 * Desktop 自己鍵の pub を e2eePublicKeys:self:{keyId} に載せ、
 * 自分が creator のグループ鍵 unwrap で negotiate(最新のみ) に落ちないようにする。
 */
export async function seedSelfPublicKeyCache(client: AnyClient): Promise<number> {
  const base = asBase(client);
  const mid = base.profile?.mid;
  if (!mid) return 0;
  let n = 0;
  // storage に列挙 API が無いので、サーバ登録 + mid 既定から既知 ID を拾う
  const ids = new Set<number>();
  try {
    for (const sk of await base.talk.getE2EEPublicKeys()) {
      const id = Number((sk as { keyId?: number }).keyId);
      if (Number.isFinite(id)) ids.add(id);
    }
  } catch {
    /* ignore */
  }
  const midRaw = await base.storage.get(`e2eeKeys:${mid}`);
  if (midRaw && typeof midRaw === "string") {
    try {
      ids.add(Number((JSON.parse(midRaw) as { keyId: number }).keyId));
    } catch {
      /* ignore */
    }
  }
  // Desktop dump で取り込んだ典型レンジを軽く走査（存在するものだけ）
  for (const id of ids) {
    const raw = await base.storage.get(`e2eeKeys:${id}`);
    if (!raw || typeof raw !== "string") continue;
    try {
      const k = JSON.parse(raw) as { pubKey?: string };
      if (!k.pubKey) continue;
      await base.storage.set(selfPubCacheKey(id), k.pubKey);
      n += 1;
    } catch {
      /* ignore */
    }
  }
  return n;
}

async function listLocalSelfKeys(
  base: BaseClient,
): Promise<Array<{ keyId: number; privKey: string; pubKey: string }>> {
  const mid = base.profile?.mid;
  const ids = new Set<number>();
  if (mid) {
    const midRaw = await base.storage.get(`e2eeKeys:${mid}`);
    if (midRaw && typeof midRaw === "string") {
      try {
        ids.add(Number((JSON.parse(midRaw) as { keyId: number }).keyId));
      } catch {
        /* ignore */
      }
    }
  }
  try {
    for (const sk of await base.talk.getE2EEPublicKeys()) {
      const id = Number((sk as { keyId?: number }).keyId);
      if (Number.isFinite(id)) ids.add(id);
    }
  } catch {
    /* ignore */
  }
  // Desktop dump / 過去登録の典型レンジを軽く走査（storage に列挙 API が無い）
  // 既知 ID 周辺 ±20 を試すのはコストが高いので、サーバ登録分 + mid のみ。
  // 追加で storage に直接ある ID は呼び出し側で渡す。
  const out: Array<{ keyId: number; privKey: string; pubKey: string }> = [];
  for (const id of ids) {
    const raw = await base.storage.get(`e2eeKeys:${id}`);
    if (!raw || typeof raw !== "string") continue;
    try {
      const k = JSON.parse(raw) as { keyId?: number; privKey?: string; pubKey?: string };
      if (k.privKey) {
        out.push({
          keyId: Number(k.keyId ?? id),
          privKey: k.privKey,
          pubKey: k.pubKey ?? "",
        });
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function tryUnwrapWithPriv(
  selfPriv: Buffer,
  creatorKey: Buffer,
  encryptedSharedKey: Buffer,
): Buffer | null {
  try {
    const aesKey = generateSharedSecret(selfPriv, creatorKey);
    const aes_key = getSHA256Sum(Buffer.from(aesKey), "Key");
    const aes_iv = xorHalves(getSHA256Sum(Buffer.from(aesKey), "IV"));
    const decipher = createDecipheriv("aes-256-cbc", aes_key, aes_iv);
    const plainText = Buffer.concat([decipher.update(encryptedSharedKey), decipher.final()]);
    // Curve25519 スカラーは 32B。パディング残りを許容して先頭32Bを使う
    if (plainText.length < 32) return null;
    return plainText.subarray(0, 32);
  } catch {
    return null;
  }
}

async function unwrapSharedKey(base: BaseClient, shared: any): Promise<GroupKeyMaterial> {
  const groupKeyId = Number(shared.groupKeyId);
  const receiverKeyId = Number(shared.receiverKeyId);
  const creatorKeyId = Number(shared.creatorKeyId);
  const creator = String(shared.creator);
  const encryptedSharedKey = Buffer.from(shared.encryptedSharedKey);

  let creatorKey: Buffer;
  if (creator === base.profile?.mid) {
    let creatorSelf = await getSelfKeyByKeyId(base, creatorKeyId);
    if (!creatorSelf) creatorSelf = await getSelfKeyByMid(base, base.profile?.mid ?? "");
    if (!creatorSelf?.pubKey) {
      throw new Error(`missing self pubKey for creatorKeyId=${creatorKeyId}`);
    }
    creatorKey = Buffer.from(creatorSelf.pubKey, "base64");
    await base.storage.set(selfPubCacheKey(creatorKeyId), creatorSelf.pubKey);
  } else {
    creatorKey = await (base.e2ee as any).getE2EELocalPublicKey(creator, creatorKeyId);
  }

  // 1) サーバが示した receiverKeyId を優先
  let selfKey = await getSelfKeyByKeyId(base, receiverKeyId);
  if (!selfKey?.privKey) {
    const raw = await base.storage.get(`e2eeKeys:${receiverKeyId}`);
    if (raw && typeof raw === "string") {
      try {
        selfKey = JSON.parse(raw);
      } catch {
        selfKey = null;
      }
    }
  }

  if (selfKey?.privKey) {
    const plain = tryUnwrapWithPriv(
      Buffer.from(selfKey.privKey, "base64"),
      creatorKey,
      encryptedSharedKey,
    );
    if (plain) {
      return { privKey: plain.toString("base64"), keyId: groupKeyId };
    }
  }

  // 2) 指定鍵が無い／合わない → ローカル全自己鍵で総当り
  //    (他端末が鍵ローテしたあと dump が古い場合、近傍の旧鍵で開けることがある)
  const locals = await listLocalSelfKeys(base);
  // receiverKeyId 近傍の storage 直読みも追加（サーバ未登録の履歴鍵）
  for (const delta of [0, -1, -2, -3, -4, -5, 1, 2, 3, 4, 5]) {
    const id = receiverKeyId + delta;
    if (!Number.isFinite(id) || locals.some((k) => k.keyId === id)) continue;
    const raw = await base.storage.get(`e2eeKeys:${id}`);
    if (!raw || typeof raw !== "string") continue;
    try {
      const k = JSON.parse(raw) as { keyId?: number; privKey?: string; pubKey?: string };
      if (k.privKey) {
        locals.push({
          keyId: Number(k.keyId ?? id),
          privKey: k.privKey,
          pubKey: k.pubKey ?? "",
        });
      }
    } catch {
      /* ignore */
    }
  }

  for (const k of locals) {
    if (k.keyId === receiverKeyId) continue; // 既に試した
    const plain = tryUnwrapWithPriv(
      Buffer.from(k.privKey, "base64"),
      creatorKey,
      encryptedSharedKey,
    );
    if (plain) {
      base.log("vyline:group-e2ee", {
        phase: "unwrap-fallback-key",
        groupKeyId,
        expectedReceiverKeyId: receiverKeyId,
        usedKeyId: k.keyId,
      });
      return { privKey: plain.toString("base64"), keyId: groupKeyId };
    }
  }

  const have = locals.map((k) => k.keyId).sort((a, b) => a - b);
  throw new Error(
    `missing self privKey for group unwrap receiverKeyId=${receiverKeyId} (have=[${have.join(",")}])`,
  );
}

/**
 * 指定 groupKeyId の共有鍵を用意し、protocol 単一キャッシュにも載せる。
 */
export async function ensureGroupKeyById(
  client: AnyClient,
  chatMid: string,
  groupKeyId: number,
): Promise<GroupKeyMaterial> {
  const base = asBase(client);
  const cached = await loadGroupKey(client, chatMid, groupKeyId);
  if (cached) {
    await storeGroupKey(client, chatMid, cached);
    return cached;
  }

  let shared: any;
  try {
    shared = await base.talk.getE2EEGroupSharedKey({
      keyVersion: 2,
      chatMid,
      groupKeyId: Number(groupKeyId),
    });
  } catch (err) {
    base.log("vyline:group-e2ee", {
      phase: "get-by-id-failed",
      chatMid,
      groupKeyId,
      err: err instanceof Error ? err.message : String(err),
    });
    // last は ID が違うと汚染するので、ID 一致のときだけ採用
    shared = await base.talk.getLastE2EEGroupSharedKey({
      keyVersion: 2,
      chatMid,
    });
    if (Number(shared.groupKeyId) !== groupKeyId) {
      throw new Error(`group key ${groupKeyId} unavailable (last is ${shared.groupKeyId})`);
    }
  }

  const key = await unwrapSharedKey(base, shared);
  await storeGroupKey(client, chatMid, key);
  base.log("vyline:group-e2ee", {
    phase: "prepared",
    chatMid,
    groupKeyId: key.keyId,
  });
  return key;
}

/**
 * メッセージ群から必要な groupKeyId を集め、復号前に全部用意する。
 */
export async function prepareGroupKeysForMessages(
  client: AnyClient,
  chatMid: string,
  messages: any[],
): Promise<{ prepared: number; failed: number; keyIds: number[] }> {
  const isGroup = chatMid.startsWith("c") || chatMid.startsWith("r");
  if (!isGroup) return { prepared: 0, failed: 0, keyIds: [] };

  await seedSelfPublicKeyCache(client);

  const ids = new Set<number>();
  for (const msg of messages) {
    const id = groupKeyIdFromMessage(msg);
    if (id != null) ids.add(id);
  }

  // 誤フォールバックで汚染したキャッシュをプロセス内で一度だけ捨ててから再 unwrap
  const base = asBase(client);
  const wipeKey = `wiped:${chatMid}`;
  const g = globalThis as unknown as { __vylineGroupKeyWipe?: Set<string> };
  if (!g.__vylineGroupKeyWipe) {
    g.__vylineGroupKeyWipe = new Set();
  }
  const wiped = g.__vylineGroupKeyWipe;
  if (!wiped.has(wipeKey)) {
    await base.storage.delete(`e2eeGroupKeys:${chatMid}`).catch(() => undefined);
    for (const id of ids) {
      await base.storage.delete(storageKey(chatMid, id)).catch(() => undefined);
    }
    wiped.add(wipeKey);
  }

  const results = await Promise.all(
    [...ids].map(async (id) => {
      try {
        await ensureGroupKeyById(client, chatMid, id);
        return { ok: true as const, id };
      } catch (err) {
        asBase(client).log("vyline:group-e2ee", {
          phase: "prepare-failed",
          chatMid,
          groupKeyId: id,
          err: err instanceof Error ? err.message : String(err),
        });
        return { ok: false as const, id };
      }
    }),
  );
  const prepared = results.filter((r) => r.ok).length;
  const failed = results.length - prepared;
  const keyIds = results.filter((r) => r.ok).map((r) => r.id);
  return { prepared, failed, keyIds };
}

/**
 * プロトコルスタックの getE2EELocalPublicKey をパッチし、
 * - グループ: by-id キャッシュ優先。無い場合は API 取得のみ（tryRegisterE2EEGroupKey は呼ばない）
 * - ユーザー: getE2EEPublicKey(by-id) で履歴鍵を補完
 *
 * ただしサーバが E2EE_RECREATE_GROUP_KEY を返したときだけ
 * recreateE2EEGroupKey() 経由で明示登録する。
 */
export function patchGroupKeyLookup(client: AnyClient): void {
  const base = asBase(client);
  const e2ee = base.e2ee as any;
  if (e2ee.__vylineGroupKeyLookupPatchedV3) return;

  if (typeof e2ee.tryRegisterE2EEGroupKey === "function" && !e2ee.__vylineTryRegisterBlocked) {
    e2ee.__vylineOriginalTryRegisterE2EEGroupKey = e2ee.tryRegisterE2EEGroupKey.bind(e2ee);
    e2ee.tryRegisterE2EEGroupKey = async (mid: string) => {
      base.log("vyline:group-e2ee", {
        phase: "tryRegister-blocked",
        mid,
        reason: "refusing auto group-key register to protect Letter Sealing",
      });
      throw new Error(`tryRegisterE2EEGroupKey blocked for ${mid}`);
    };
    e2ee.__vylineTryRegisterBlocked = true;
  }

  const original = e2ee.getE2EELocalPublicKey.bind(e2ee);

  e2ee.getE2EELocalPublicKey = async (mid: string, keyId?: string | number) => {
    const isGroup = typeof mid === "string" && (mid.startsWith("c") || mid.startsWith("r"));
    if (isGroup) {
      const id = keyId != null && keyId !== "" ? Number(keyId) : Number.NaN;
      if (Number.isFinite(id)) {
        const raw = await base.storage.get(storageKey(mid, id));
        if (raw && typeof raw === "string") {
          try {
            const j = JSON.parse(raw) as GroupKeyMaterial;
            if (j?.privKey && Number(j.keyId) === id) {
              await base.storage.set(`e2eeGroupKeys:${mid}`, raw);
              return j;
            }
          } catch {
            /* fall through */
          }
        }
        // by-id API で用意（register なし）
        const prepared = await ensureGroupKeyById(client, mid, id);
        return prepared;
      }
      // keyId 無し: 単一キャッシュのみ。無ければ last を取得。
      // NOT_FOUND（共有鍵未作成）のときは送信経路向けに register する。
      const legacy = await base.storage.get(`e2eeGroupKeys:${mid}`);
      if (legacy && typeof legacy === "string") {
        try {
          return JSON.parse(legacy) as GroupKeyMaterial;
        } catch {
          /* fall through */
        }
      }
      try {
        const last = await base.talk.getLastE2EEGroupSharedKey({
          keyVersion: 2,
          chatMid: mid,
        });
        return ensureGroupKeyById(client, mid, Number(last.groupKeyId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const missing =
          msg.includes("no valid group key") ||
          (msg.includes("NOT_FOUND") && msg.toLowerCase().includes("group key"));
        if (!missing) throw err;
        const originalRegister = e2ee.__vylineOriginalTryRegisterE2EEGroupKey as
          | ((chatMid: string) => Promise<unknown>)
          | undefined;
        if (typeof originalRegister !== "function") throw err;
        base.log("vyline:group-e2ee", {
          phase: "register-on-missing-for-lookup",
          mid,
        });
        return recreateE2EEGroupKey(client, mid);
      }
    }

    // ユーザー履歴鍵: キャッシュ → by-id API → 元の negotiate
    const isUser = typeof mid === "string" && mid.startsWith("u");
    if (isUser && keyId != null && keyId !== "") {
      const id = Number(keyId);
      if (Number.isFinite(id)) {
        const cached =
          (await base.storage.get(peerPubCacheKey(mid, id))) ??
          (await base.storage.get(selfPubCacheKey(id)));
        if (cached && typeof cached === "string") {
          return Buffer.from(cached, "base64");
        }
        try {
          const pk = await base.talk.getE2EEPublicKey({
            mid,
            keyVersion: 1,
            keyId: id,
          });
          const keyData =
            (pk as { keyData?: Uint8Array | Buffer | string })?.keyData ??
            (pk as { 2?: Uint8Array | Buffer | string })?.[2];
          if (keyData) {
            const b64 =
              typeof keyData === "string"
                ? keyData
                : Buffer.from(keyData as Uint8Array).toString("base64");
            await base.storage.set(peerPubCacheKey(mid, id), b64);
            return Buffer.from(b64, "base64");
          }
        } catch (err) {
          base.log("vyline:group-e2ee", {
            phase: "getE2EEPublicKey-failed",
            mid,
            keyId: id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return original(mid, keyId);
  };

  e2ee.__vylineGroupKeyLookupPatchedV3 = true;
  base.log("vyline:group-e2ee", { phase: "lookup-patched-v3" });
}

/**
 * サーバが E2EE_RECREATE_GROUP_KEY を返したときだけ呼ぶ。
 * 新しいグループ共有鍵を登録し、ローカルキャッシュを最新化する。
 */
export async function recreateE2EEGroupKey(
  client: AnyClient,
  chatMid: string,
): Promise<GroupKeyMaterial> {
  const base = asBase(client);
  patchGroupKeyLookup(client);
  const e2ee = base.e2ee as any;
  const original = e2ee.__vylineOriginalTryRegisterE2EEGroupKey as
    | ((mid: string) => Promise<unknown>)
    | undefined;
  if (typeof original !== "function") {
    throw new Error("recreateE2EEGroupKey: original tryRegister unavailable");
  }

  await base.storage.delete(`e2eeGroupKeys:${chatMid}`).catch(() => undefined);
  base.log("vyline:group-e2ee", { phase: "recreate-start", chatMid });

  const registered = (await original(chatMid)) as {
    groupKeyId?: number;
    2?: number;
  };
  const groupKeyId = Number(registered?.groupKeyId ?? registered?.[2]);
  if (!Number.isFinite(groupKeyId)) {
    throw new Error("recreateE2EEGroupKey: missing groupKeyId in response");
  }

  // register 後に自分のエントリが storage に載る想定。無ければ by-id で取得
  const prepared = await ensureGroupKeyById(client, chatMid, groupKeyId);
  base.log("vyline:group-e2ee", {
    phase: "recreate-done",
    chatMid,
    groupKeyId: prepared.keyId,
  });
  return prepared;
}
