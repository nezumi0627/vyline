/**
 * e2ee/letterSealing.ts — LINE "Letter Sealing" (E2EE) の Vyline 自前実装
 *
 * "Letter Sealing" は LINE 公式の E2EE 機能のブランド名。native 側 (unpacked_LINE.exe)
 * を検索しても専用クラスとしては存在せず、UI 文言リソースキー
 * `AuthorizeE2eeAboutLetterSealing` としてのみ見つかる
 * (source/desktop/recovered/native-search/LetterSealing/strings.json)。
 * 実体は native 側 `line::ChatSecurityServiceImpl::{encrypt,decrypt}E2EEMessageInternal`
 * (source/desktop/recovered/src/native/sendMessage/README.md) に相当し、
 * これは Vyline protocol の `E2EE` クラスと構造的に対応する
 * (spec version 0/1 チェック、contentType 分岐、AES-256-GCM 16byte タグ等)。
 *
 * 本モジュールはその暗号化/復号アルゴリズムを Vyline 自身のコードとして持つ。
 * アルゴリズム自体はサーバー/公式クライアントとの相互運用性のため変更しない
 * (salt=16B, nonce=12B, AES-256-GCM, AAD = to+from+senderKeyId+receiverKeyId+specVersion+contentType)。
 * プロトコルスタックとの違いは鍵解決層のみ:
 *
 * - 送信: 自己鍵は ensureValidE2EEIdentity が整えた `e2eeKeys:{mid}` を使用
 * - グループ受信: プロトコルスタックの単一キャッシュではなく Vyline の by-id 多重キャッシュ
 *   (login/groupE2EE.ts) を優先して解決する → 履歴・他端末との整合性を保つ
 *
 * これにより sendMessage は「e2ee:true を渡してプロトコルスタック内部の再帰的
 * encrypt-then-resend に任せる」実装から、「chunks を自前で組み立てて
 * 1回で送る」明示的な実装に置き換わる (service/lineService.ts sendMessage 参照)。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Client } from "@vyline/protocol/stack";
import type { BaseClient } from "@vyline/protocol/stack/base";
import { sharedKey } from "curve25519-js";
import { ensureGroupKeyById, loadGroupKey } from "../login/groupE2EE.js";
import { peerPubCacheKey } from "./pubCacheKeys.js";

export { selfPubCacheKey, peerPubCacheKey } from "./pubCacheKeys.js";

type AnyClient = Client | BaseClient;

/** Desktop は起動時に鍵をメモリ常駐 — storage I/O を避けるプロセス内キャッシュ */
const selfKeyMemByClient = new WeakMap<BaseClient, Map<number, SelfKeyData | null>>();
const peerPubMemByClient = new WeakMap<BaseClient, Map<string, Buffer>>();
/** E2EE 非対応 MID（公式アカウント等）を短時間キャッシュし、履歴 fetch のたびに negotiate を繰り返さない */
const NO_E2EE_PEER_TTL_MS = Number(process.env.VYLINE_NO_E2EE_PEER_TTL_MS ?? 300_000);
const noE2eePeerCache = new Map<string, number>();

function asBase(client: AnyClient): BaseClient {
  return "base" in client ? (client as Client).base : (client as BaseClient);
}

/** LINE ContentType enum の一部 (E2EE 対応分のみ)。 */
export const LETTER_SEALING_CONTENT_TYPE = {
  TEXT: 0,
  LOCATION: 15,
} as const;

export interface SelfKeyData {
  keyId: number;
  privKey: string; // base64
  pubKey: string; // base64
}

// ─── crypto primitives (protocol base/e2ee/mod.ts と bit-for-bit 互換) ────

function getIntBytes(i: number): Buffer {
  // プロトコルスタックは DataView.setInt32(0, i) を引数省略で呼ぶ = big-endian
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(i, 0);
  return buf;
}

function byte2int(buf: Buffer): number {
  let v = 0;
  for (const b of buf) v = v * 256 + b;
  return v;
}

function sha256Concat(...parts: (string | Buffer)[]): Buffer {
  const hash = createHash("sha256");
  for (const p of parts) hash.update(typeof p === "string" ? Buffer.from(p) : p);
  return hash.digest();
}

/** Curve25519 ECDH 共有鍵 */
export function generateSharedSecret(privKey: Buffer, pubKey: Buffer): Buffer {
  return Buffer.from(sharedKey(Uint8Array.from(privKey), Uint8Array.from(pubKey)));
}

export function generateAAD(
  to: string,
  from: string,
  senderKeyId: number,
  receiverKeyId: number,
  specVersion = 2,
  contentType = 0,
): Buffer {
  return Buffer.concat([
    Buffer.from(to),
    Buffer.from(from),
    getIntBytes(senderKeyId),
    getIntBytes(receiverKeyId),
    getIntBytes(specVersion),
    getIntBytes(contentType),
  ]);
}

function aesGcmEncrypt(data: Buffer, gcmKey: Buffer, nonce: Buffer, aad: Buffer): Buffer {
  const cipher = createCipheriv("aes-256-gcm", gcmKey, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]);
}

/** サーバー実装同様、autoPadding=true→false の順にフォールバックして復号を試みる */
function aesGcmDecrypt(message: Buffer, gcmKey: Buffer, nonce: Buffer, aad: Buffer): Buffer {
  const ciphertext = message.subarray(0, -16);
  const tag = message.subarray(-16);
  const attempt = (autoPadding: boolean) => {
    const decipher = createDecipheriv("aes-256-gcm", gcmKey, nonce);
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);
    decipher.setAutoPadding(autoPadding);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  };
  try {
    return attempt(true);
  } catch {
    return attempt(false);
  }
}

// ─── 自己鍵の解決 ────────────────────────────────────────────────

export async function getSelfKeyByKeyId(
  client: AnyClient,
  keyId: number,
): Promise<SelfKeyData | null> {
  const base = asBase(client);
  let mem = selfKeyMemByClient.get(base);
  if (!mem) {
    mem = new Map();
    selfKeyMemByClient.set(base, mem);
  }
  if (mem.has(keyId)) {
    const hit = mem.get(keyId);
    return hit ?? null;
  }

  const raw = await base.storage.get(`e2eeKeys:${keyId}`);
  if (!raw || typeof raw !== "string") {
    mem.set(keyId, null);
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SelfKeyData;
    if (parsed?.privKey) {
      const data = { keyId, privKey: parsed.privKey, pubKey: parsed.pubKey };
      mem.set(keyId, data);
      return data;
    }
  } catch {
    /* ignore corrupt cache */
  }
  mem.set(keyId, null);
  return null;
}

export async function getSelfKeyByMid(client: AnyClient, mid: string): Promise<SelfKeyData | null> {
  if (!mid) return null;
  const raw = await asBase(client).storage.get(`e2eeKeys:${mid}`);
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as SelfKeyData;
    if (parsed?.privKey) return parsed;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

async function listLocalSelfKeyMaterials(client: AnyClient): Promise<SelfKeyData[]> {
  const base = asBase(client);
  const mid = base.profile?.mid ?? "";
  const ids = new Set<number>();
  if (mid) {
    const midKey = await getSelfKeyByMid(client, mid);
    if (midKey) ids.add(midKey.keyId);
  }
  try {
    for (const sk of await base.talk.getE2EEPublicKeys()) {
      const id = Number((sk as { keyId?: number }).keyId);
      if (Number.isFinite(id)) ids.add(id);
    }
  } catch {
    /* ignore */
  }
  const out: SelfKeyData[] = [];
  for (const id of ids) {
    const k = await getSelfKeyByKeyId(client, id);
    if (k?.privKey) out.push(k);
  }
  return out;
}

async function resolvePeerPubKeyForUser(
  client: AnyClient,
  mid: string,
  keyId: number,
  opts: { skipCache?: boolean } = {},
): Promise<Buffer> {
  const base = asBase(client);
  const scopedKey = peerPubCacheKey(mid, keyId);
  const memKey = `${mid}:${keyId}`;

  // E2EE 非対応相手（公式アカウント等）は短時間スキップ。履歴 fetch のたびに negotiate を繰り返さない
  const missAt = noE2eePeerCache.get(mid);
  if (missAt != null && Date.now() - missAt < NO_E2EE_PEER_TTL_MS) {
    throw new Error(`Not support E2EE: ${mid}`);
  }

  if (!opts.skipCache) {
    let peerMem = peerPubMemByClient.get(base);
    if (!peerMem) {
      peerMem = new Map();
      peerPubMemByClient.set(base, peerMem);
    }
    const hit = peerMem.get(memKey);
    if (hit) return hit;

    const cached = await base.storage.get(scopedKey);
    if (cached && typeof cached === "string" && cached.length > 0) {
      const buf = Buffer.from(cached, "base64");
      peerMem.set(memKey, buf);
      return buf;
    }
    // 旧形式 e2eePublicKeys:{keyId} — 自分の keyId と衝突する場合は使わない
    const ownSelf = await getSelfKeyByKeyId(client, keyId);
    if (!ownSelf?.privKey) {
      const legacy = await base.storage.get(`e2eePublicKeys:${keyId}`);
      if (legacy && typeof legacy === "string" && legacy.length > 0) {
        const buf = Buffer.from(legacy, "base64");
        peerMem.set(memKey, buf);
        return buf;
      }
    }
  }

  // 履歴復号: negotiate は最新鍵のみ返すので、まず by-id で取る
  try {
    const pk = await base.talk.getE2EEPublicKey({
      mid,
      keyVersion: 1,
      keyId,
    });
    const keyData =
      (pk as { keyData?: Uint8Array | Buffer | string })?.keyData ??
      (pk as { 4?: Uint8Array | Buffer | string })?.[4];
    if (keyData) {
      const b64 =
        typeof keyData === "string"
          ? keyData
          : Buffer.from(keyData as Uint8Array).toString("base64");
      await base.storage.set(scopedKey, b64);
      const buf = Buffer.from(b64, "base64");
      rememberPeerPub(base, mid, keyId, buf);
      return buf;
    }
  } catch {
    /* fall through to negotiate */
  }

  const negotiated = await base.talk.negotiateE2EEPublicKey({ mid });
  if (Number(negotiated.specVersion) === -1) {
    noE2eePeerCache.set(mid, Date.now());
    throw new Error(`Not support E2EE: ${mid}`);
  }
  const publicKey = negotiated.publicKey as unknown as { keyId: number; keyData: Uint8Array };
  if (Number(publicKey.keyId) !== keyId) {
    throw new Error(
      `E2EE key id ${keyId} not found on ${mid} (server latest is ${publicKey.keyId})`,
    );
  }
  const buf = Buffer.from(publicKey.keyData);
  await base.storage.set(scopedKey, buf.toString("base64"));
  rememberPeerPub(base, mid, keyId, buf);
  return buf;
}

function normalizeChunk(c: string | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(c)) return c;
  if (c instanceof Uint8Array) return Buffer.from(c);
  // thrift binary は JS では binary-string (latin1) として来ることもある
  const asLatin1 = Buffer.from(c, "latin1");
  const asUtf8 = Buffer.from(c, "utf-8");
  return asLatin1.length === asUtf8.length && asLatin1.equals(asUtf8) ? asUtf8 : asLatin1;
}

function tryGcmDecryptJson(
  message: Buffer,
  gcmKey: Buffer,
  nonce: Buffer,
  aad: Buffer,
): Record<string, unknown> | null {
  try {
    const plain = aesGcmDecrypt(message, gcmKey, nonce, aad);
    return JSON.parse(plain.toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── 送信: chunks を組み立てる ───────────────────────────────────

export interface LetterSealingEnvelope {
  chunks: Buffer[];
  contentMetadata: Record<string, string>;
}

/**
 * text / location / 任意 JSON ペイロードを Letter Sealing (specVersion=2, AES-256-GCM)
 * で暗号化し、そのまま client.base.talk.sendMessage() に渡せる chunks を返す。
 *
 * DM 宛は毎回サーバーへ negotiateE2EEPublicKey する (相手の最新公開鍵を得るため、
 * これは公式クライアントも毎回行う正規の手順)。グループ/ルーム宛は Vyline 自前の
 * by-id 共有鍵キャッシュ (login/groupE2EE.ts) から解決する。
 */
export async function encryptLetterSealingMessage(
  client: AnyClient,
  params: {
    to: string;
    from: string;
    contentType: number;
    payload: Record<string, unknown>;
  },
): Promise<LetterSealingEnvelope> {
  const { to, from, contentType, payload } = params;

  const selfKey = await getSelfKeyByMid(client, from);
  if (!selfKey) {
    throw new Error(`NoE2EEKey: local self key not found for ${from}`);
  }
  const senderKeyId = selfKey.keyId;
  const privKey = Buffer.from(selfKey.privKey, "base64");

  const isGroupLike = to.startsWith("c") || to.startsWith("r");
  let receiverKeyId: number;
  let sharedSecret: Buffer;
  let specVersion = 2;

  if (isGroupLike) {
    // 送信は常にサーバ最新の groupKeyId を使う（古いキャッシュだと E2EE_RECREATE_GROUP_KEY）
    const last = await asBase(client).talk.getLastE2EEGroupSharedKey({
      keyVersion: 2,
      chatMid: to,
    });
    const group = await ensureGroupKeyById(client, to, Number(last.groupKeyId));
    receiverKeyId = group.keyId;
    const groupPrivKey = Buffer.from(group.privKey, "base64");
    const selfPub = Buffer.from(selfKey.pubKey, "base64");
    // 公式実装同様、グループ共有鍵(スカラー) x 自分の公開鍵 で ECDH する
    sharedSecret = generateSharedSecret(groupPrivKey, selfPub);
  } else {
    const negotiated = await asBase(client).talk.negotiateE2EEPublicKey({ mid: to });
    specVersion = Number(negotiated.specVersion);
    if (specVersion === -1) {
      throw new Error(`Not support E2EE: ${to}`);
    }
    const publicKey = negotiated.publicKey as unknown as { keyId: number; keyData: Uint8Array };
    receiverKeyId = Number(publicKey.keyId);
    sharedSecret = generateSharedSecret(privKey, Buffer.from(publicKey.keyData));
  }

  const salt = randomBytes(16);
  const gcmKey = sha256Concat(sharedSecret, salt, "Key");
  const aad = generateAAD(to, from, senderKeyId, receiverKeyId, specVersion, contentType);
  const nonce = randomBytes(12);
  const encData = aesGcmEncrypt(Buffer.from(JSON.stringify(payload)), gcmKey, nonce, aad);

  const chunks = [salt, encData, nonce, getIntBytes(senderKeyId), getIntBytes(receiverKeyId)];

  return {
    chunks,
    contentMetadata: {
      e2eeVersion: "2",
      contentType: String(contentType),
      e2eeMark: "2",
    },
  };
}

export function encryptLetterSealingText(
  client: AnyClient,
  to: string,
  from: string,
  text: string,
): Promise<LetterSealingEnvelope> {
  return encryptLetterSealingMessage(client, {
    to,
    from,
    contentType: LETTER_SEALING_CONTENT_TYPE.TEXT,
    payload: { text },
  });
}

// ─── 受信: chunks を復号する ─────────────────────────────────────

export interface LetterSealingDecryptResult {
  json: Record<string, unknown>;
}

/**
 * chunks (salt, encData+tag, nonce, senderKeyId, receiverKeyId) を復号する。
 * グループ鍵は Vyline の by-id キャッシュ (login/groupE2EE.ts) を直接参照する
 * (プロトコルスタック標準の単一キャッシュには依存しない)。
 *
 * DM では:
 * - AAD の to/from 候補を複数試す (msg.to 欠落・chatMid 取り違え対策)
 * - 自己鍵は envelope の keyId 優先。無ければローカル全鍵で総当り
 * - 相手公開鍵キャッシュが汚染されている場合は skipCache で再取得
 */
export async function decryptLetterSealingMessage(
  client: AnyClient,
  params: {
    to: string;
    from: string;
    isSelf: boolean;
    chunks: Array<string | Uint8Array>;
    specVersion?: number;
    contentType?: number;
    /** DM の AAD 取り違え対策用の追加 to 候補 (chatMid / myMid など) */
    altTo?: string[];
  },
): Promise<LetterSealingDecryptResult> {
  const base = asBase(client);
  const { from, isSelf } = params;
  const chunks = params.chunks.map((c) => normalizeChunk(c));
  const [salt, message, nonce, senderKeyIdBuf, receiverKeyIdBuf] = chunks;
  if (!salt || !message || !nonce || !senderKeyIdBuf || !receiverKeyIdBuf) {
    throw new Error("invalid Letter Sealing chunks (expected 5 elements)");
  }
  const senderKeyId = byte2int(senderKeyIdBuf);
  const receiverKeyId = byte2int(receiverKeyIdBuf);
  const specVersion = params.specVersion ?? 2;
  const contentType = params.contentType ?? 0;

  const toCandidates = [
    ...new Set(
      [params.to, ...(params.altTo ?? [])].filter((t) => typeof t === "string" && t.length > 0),
    ),
  ];

  for (const to of toCandidates) {
    const isGroupLike = to.startsWith("c") || to.startsWith("r");
    try {
      if (isGroupLike) {
        const group = await loadGroupKey(client, to, receiverKeyId);
        if (!group) continue;
        const privKey = Buffer.from(group.privKey, "base64");
        let peerPubKey: Buffer;
        if (isSelf) {
          const myMid = base.profile?.mid ?? "";
          const selfKey =
            (await getSelfKeyByKeyId(client, senderKeyId)) ??
            (await getSelfKeyByMid(client, myMid));
          if (!selfKey) continue;
          peerPubKey = Buffer.from(selfKey.pubKey, "base64");
        } else {
          peerPubKey = await resolvePeerPubKeyForUser(client, from, senderKeyId);
        }
        const sharedSecret = generateSharedSecret(privKey, peerPubKey);
        const gcmKey = sha256Concat(sharedSecret, salt, "Key");
        const aad = generateAAD(to, from, senderKeyId, receiverKeyId, specVersion, contentType);
        const json = tryGcmDecryptJson(message, gcmKey, nonce, aad);
        if (json) return { json };
        continue;
      }

      // ── DM ──
      const selfKeyId = isSelf ? senderKeyId : receiverKeyId;
      const peerMid = isSelf ? to : from;
      const peerKeyId = isSelf ? receiverKeyId : senderKeyId;

      const exact = await getSelfKeyByKeyId(client, selfKeyId);
      if (!exact?.privKey) {
        const locals = await listLocalSelfKeyMaterials(client);
        const have = locals.map((k) => k.keyId).sort((a, b) => a - b);
        throw new Error(
          `missing self privKey keyId=${selfKeyId} for DM decrypt (have=[${have.join(",")}]) — re-extract desktop-e2ee-keys.json from running LINE.exe`,
        );
      }
      const selfKeys: SelfKeyData[] = [exact];
      // exact が GCM 失敗したときだけ他鍵を試す（通常は exact で足りる）
      const locals = await listLocalSelfKeyMaterials(client);
      for (const k of locals) {
        if (!selfKeys.some((s) => s.keyId === k.keyId)) selfKeys.push(k);
      }

      let peerPubKey: Buffer | null = null;
      let peerErr: unknown;
      for (const skipCache of [false, true]) {
        try {
          peerPubKey = await resolvePeerPubKeyForUser(client, peerMid, peerKeyId, { skipCache });
          break;
        } catch (err) {
          peerErr = err;
        }
      }
      if (!peerPubKey) {
        throw peerErr instanceof Error
          ? peerErr
          : new Error(`missing peer pubKey ${peerKeyId} for ${peerMid}`);
      }

      for (const selfKey of selfKeys) {
        const privKey = Buffer.from(selfKey.privKey, "base64");
        const sharedSecret = generateSharedSecret(privKey, peerPubKey);
        const gcmKey = sha256Concat(sharedSecret, salt, "Key");
        const aad = generateAAD(to, from, senderKeyId, receiverKeyId, specVersion, contentType);
        const json = tryGcmDecryptJson(message, gcmKey, nonce, aad);
        if (json) {
          if (selfKey.keyId !== selfKeyId) {
            base.log("vyline:e2ee", {
              phase: "dm-decrypt-fallback-self-key",
              expectedSelfKeyId: selfKeyId,
              usedSelfKeyId: selfKey.keyId,
              to,
              from,
            });
          }
          return { json };
        }
      }
    } catch {
      /* try next to candidate */
    }
  }

  throw new Error(
    `Unsupported state or unable to authenticate data (senderKeyId=${senderKeyId}, receiverKeyId=${receiverKeyId}, to=${params.to}, from=${from}, contentType=${contentType})`,
  );
}

function rememberPeerPub(base: BaseClient, mid: string, keyId: number, buf: Buffer): void {
  let peerMem = peerPubMemByClient.get(base);
  if (!peerMem) {
    peerMem = new Map();
    peerPubMemByClient.set(base, peerMem);
  }
  peerMem.set(`${mid}:${keyId}`, buf);
}

function chunkToKeyId(chunk: unknown): number | null {
  if (chunk == null) return null;
  try {
    return byte2int(normalizeChunk(chunk as string | Uint8Array));
  } catch {
    return null;
  }
}

/**
 * Desktop 準拠: バッチ復号前に DM 相手公開鍵を並列プリフェッチ（メッセージ毎 RPC を避ける）
 */
export function invalidatePeerPubCache(client: AnyClient, mid: string, keyId: number): void {
  peerPubMemByClient.get(asBase(client))?.delete(`${mid}:${keyId}`);
}

export async function prefetchDmPeerKeysForMessages(
  client: AnyClient,
  myMid: string,
  messages: Array<{ from?: unknown; to?: unknown; chunks?: unknown[] }>,
): Promise<void> {
  if (!myMid) return;
  const needs = new Map<string, Set<number>>();
  const add = (mid: string, keyId: number) => {
    if (!mid.startsWith("u") || keyId <= 0) return;
    const set = needs.get(mid) ?? new Set<number>();
    set.add(keyId);
    needs.set(mid, set);
  };

  for (const msg of messages) {
    if (!Array.isArray(msg.chunks) || msg.chunks.length < 5) continue;
    const senderKeyId = chunkToKeyId(msg.chunks[3]);
    const receiverKeyId = chunkToKeyId(msg.chunks[4]);
    if (senderKeyId == null || receiverKeyId == null) continue;
    const from = String(msg.from ?? "");
    const to = String(msg.to ?? "");
    if (from === myMid) {
      if (to.startsWith("u")) add(to, receiverKeyId);
    } else if (from.startsWith("u")) {
      add(from, senderKeyId);
    }
  }

  const tasks: Promise<unknown>[] = [];
  for (const [mid, keyIds] of needs) {
    for (const keyId of keyIds) {
      tasks.push(resolvePeerPubKeyForUser(client, mid, keyId).catch(() => undefined));
    }
  }
  if (tasks.length > 0) await Promise.all(tasks);
}
