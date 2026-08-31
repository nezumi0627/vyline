/**
 * service/lineService.ts
 *
 * Vyline protocol client を直接触る Service 層。
 * HTTP の概念を持たない純粋なビジネスロジック。
 * BFF (api/) はここを呼ぶだけ。
 */

import type {
  Chat,
  Message,
  MessageReaction,
  MessageContentMeta,
  LineProfile,
  LineBirthday,
  CallRoute,
} from "@vyline/types";
import { canUnsendMessage } from "@vyline/types";
import { LINEStruct } from "@vyline/protocol/stack/thrift";
import { childLogger } from "../logger.js";
import { fetchTrustedLineMediaDownloadUrl } from "./lineMediaDownloadUrl.js";
import {
  getClient,
  enqueueTalkRpcBackground,
  runTalkFetchUrgent,
  runTalkRpcImmediate,
  runSendRpc,
} from "../line/clientManager.js";
import {
  drainTalkEvents,
  pushTalkEvent,
  clearTalkEvents,
  type TalkPollEvent,
} from "../line/talkEventBuffer.js";
import type { VylineClient } from "@vyline/protocol";
import { peerPubCacheKey, selfPubCacheKey } from "@vyline/protocol/e2ee/pubCacheKeys";
import {
  vylineGetGroup,
  vylineGetProfile,
  vylineGetProfiles,
  vylineGroupNeedsRefresh,
  vylineLoadCache,
  vylineProfileNeedsRefresh,
  vylinePutGroup,
  vylinePutProfile,
  vylinePutProfiles,
  vylineResolvedNameMap,
} from "../storage/vylineCache.js";
import { updateSessionMeta } from "../storage/tokenStore.js";
import { VylineStorage } from "../storage/vylineStorage.js";
import { banCreateGroup, isCreateGroupBanned } from "../storage/featureLocks.js";
import { checkStickerGiftEligibility } from "./liffFeatures.js";
import { isReadOperationType, isReceiveMessageOperationType } from "./talkOperationTypes.js";
import {
  ensureValidE2EEIdentity,
  prepareGroupKeysForMessages,
  ensureGroupKeyById,
  groupKeyIdFromMessage,
  patchGroupKeyLookup,
  recreateE2EEGroupKey,
  encryptLetterSealingMessage,
  decryptLetterSealingMessage,
  prefetchDmPeerKeysForMessages,
  invalidatePeerPubCache,
  LETTER_SEALING_CONTENT_TYPE,
  downloadObsMessageResponse as vylineDownloadObsResponse,
  wrapSession,
  type ProfileUpdateInput,
  type ContactRenameInput,
} from "@vyline/protocol";
import {
  getMessages,
  findStoredMessageById,
  getStoredChats,
  getStoredMessages,
  getBootstrapPayload,
  getCacheMeta,
  upsertChats,
  upsertMessages,
  markStoredMessagesReadThrough,
  compareMessagesNewestFirst,
  markMessageRevoked,
  restoreRevokedMessage,
  getMessageHistory,
  warmAccountCache,
  saveBoxOrder,
  isUnresolvedLastMessagePreview,
  shouldPreserveResolvedLastMessagePreview,
  type BootstrapPayload,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";

export { restoreRevokedMessage, getMessageHistory } from "../storage/chatStore.js";
import { CallNotAllowedError, callAllowlistHint, isAllowedCallTarget } from "../call/allowlist.js";
import { appendMessageLog, type MessageLogEntry } from "../storage/messageLog.js";
import {
  importMediaStorageFile,
  writeMediaStorageProducedFile,
  writeMediaStorageStream,
  type MediaStorageStat,
} from "../storage/mediaStorage.js";
import { dispatchPluginMessage } from "../line/pluginRuntime.js";
import { isChatLocked, loadLockedChats, setChatLocked } from "../storage/chatLockStore.js";
import { MediaSendUploadError } from "./mediaSendStaging.js";

export { CallNotAllowedError, callAllowlistHint };
export type { CallSessionSnapshot } from "../call/callManager.js";

export class ChatLockedError extends Error {
  readonly code = "CHAT_LOCKED";

  constructor() {
    super("このチャットはロック中のため操作できません");
    this.name = "ChatLockedError";
  }
}

export async function assertChatUnlocked(accountId: string, chatMid: string): Promise<void> {
  if (await isChatLocked(accountId, chatMid)) throw new ChatLockedError();
}

export { loadLockedChats, setChatLocked };

const log = childLogger("service:line");

type CombinationStickerLayoutInfo = {
  width: number;
  height: number;
  rotation: number;
  x: number;
  y: number;
};

type CombinationStickerStickerInfo = {
  stickerId: number;
  productId: number;
  stickerHash: string;
  stickerOptions: string;
  stickerVersion: number;
};

type CombinationStickerLayout = {
  layoutInfo: CombinationStickerLayoutInfo;
  stickerInfo: CombinationStickerStickerInfo;
};

type CombinationStickerMetadata = {
  version: number;
  canvasWidth: number;
  canvasHeight: number;
  stickerLayouts: CombinationStickerLayout[];
};

type CombinationStickerStickerData = {
  packageId: string;
  stickerId: string;
  version: number;
};

// ─── helpers ──────────────────────────────────

export function detectChatKind(mid: string): Chat["kind"] {
  if (mid.startsWith("c")) return "group";
  if (mid.startsWith("r")) return "room";
  if (mid.startsWith("u")) return "direct";
  return "unknown";
}

/**
 * LINE の pictureStatus (ハッシュ文字列) をアイコン URL に変換する。
 * 空・未設定なら null を返す。
 * すでに https:// で始まる場合はそのまま返す。
 */
export function pictureStatusToUrl(s: string | undefined | null): string | null {
  if (!s || s.trim() === "") return null;
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  const cleaned = s.startsWith("/") ? s.slice(1) : s;
  return `https://profile.line-scdn.net/${cleaned}`;
}

/** プロフィール背景（OBS myhome / cover） */
export function backgroundObjToUrl(objId: string | undefined | null): string | null {
  if (!objId || !String(objId).trim()) return null;
  const s = String(objId).trim();
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  return `https://obs.line-apps.com/r/myhome/h/${s}`;
}

// ─── プロフィール背景（他ユーザー）────────────────

/** home/profile から背景 URL を抽出するキー候補 */
const HOME_BACKGROUND_KEYS = [
  "backgroundUrl",
  "backgroundURL",
  "background",
  "bgUrl",
  "bgURL",
  "coverUrl",
  "coverImageUrl",
  "homeBackgroundUrl",
  "profileBackgroundUrl",
] as const;

/** home/profile レスポンス内を再帰走査して背景画像 URL を探す（防御的） */
function extractBackgroundUrl(value: unknown, depth = 0): string | null {
  if (depth > 12 || value == null) return null;
  if (typeof value === "string") {
    const s = value.trim();
    if (/^\/(?:myhome|mh|hm)\//i.test(s)) {
      return `https://obs.line-scdn.net${s}`;
    }
    if (/^[a-z0-9_-]{8,}$/i.test(s) && !s.includes(" ")) {
      const maybe = backgroundObjToUrl(s);
      if (maybe) return maybe;
    }
    if (
      /^https?:\/\//i.test(s) &&
      (s.includes("myhome") ||
        s.includes("line-scdn.net") ||
        /\.(png|jpe?g|webp|gif)(\?|$)/i.test(s))
    ) {
      return s;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = extractBackgroundUrl(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of HOME_BACKGROUND_KEYS) {
      const v = obj[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) {
        return v.trim();
      }
      const nested = extractBackgroundUrl(v, depth + 1);
      if (nested) return nested;
    }
    for (const [, v] of Object.entries(obj)) {
      const hit = extractBackgroundUrl(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

const homeBackgroundCache = new Map<string, { at: number; url: string }>();
const HOME_BACKGROUND_CACHE_MS = 30 * 60 * 1000; // 30 分
const HOME_BACKGROUND_RPC_TIMEOUT_MS = 6_000;

/**
 * 相手のプロフィール背景（カバー画像）URL を取得する。
 *
 * 実データは HOME チャネルの home/cover API が正解（live-verified 2026-08-21）:
 *   GET gw.line.naver.jp/hm/api/v1/home/cover.json?homeId=<mid>
 *   ヘッダ X-Line-ChannelToken = issueChannelToken(HOME).channelAccessToken
 * レスポンス:
 *   { code:0, result:{ coverObsInfo:{ objectId, obsNamespace:"c", serviceName:"myhome" }, isDefaultCover:false } }
 * 画像 URL: https://obs.line-apps.com/r/myhome/<obsNamespace>/<objectId>
 *
 * 注: ルーティングは MYHOME_RENEWAL(/hm)。HOMEAPI(/ma) や MYHOME(/mh) は 401/404 になる。
 * チャネルトークンは voom.call("HOME", ...) が自動で発行する(channelAccessToken を使用)。
 * 失敗時は null（タイムアウト・権限なし・未設定などは静かに握りつぶす）。
 */
async function fetchHomeProfileBackgroundUrl(
  accountId: string,
  targetMid: string,
): Promise<string | null> {
  if (!targetMid.startsWith("u")) return null;
  const key = `${accountId}:${targetMid}`;
  const cached = homeBackgroundCache.get(key);
  if (cached && Date.now() - cached.at < HOME_BACKGROUND_CACHE_MS) {
    return cached.url || null;
  }
  try {
    const client = requireClient(accountId);
    const res = await withTimeout(
      client.voom.call("HOME", {
        routing: "MYHOME_RENEWAL",
        path: `/api/v1/home/cover.json?homeId=${encodeURIComponent(targetMid)}`,
      }),
      HOME_BACKGROUND_RPC_TIMEOUT_MS,
      "homeCover",
    );
    const result = (res as { result?: unknown }).result as
      | {
          coverObsInfo?: { objectId?: string; obsNamespace?: string };
          isDefaultCover?: boolean;
        }
      | null
      | undefined;
    const info = result?.coverObsInfo;
    // isDefaultCover=true は LINE の既定カバー（未設定）とみなし表示しない
    if (info?.objectId && result?.isDefaultCover !== true) {
      const ns = info.obsNamespace || "c";
      const url = `https://obs.line-apps.com/r/myhome/${ns}/${info.objectId}`;
      homeBackgroundCache.set(key, { at: Date.now(), url });
      return url;
    }
    homeBackgroundCache.set(key, { at: Date.now(), url: "" });
    return null;
  } catch (err) {
    log.debug({ accountId, targetMid, err }, "home cover background fetch failed");
    homeBackgroundCache.set(key, { at: Date.now(), url: "" });
    return null;
  }
}

function formatBirthdayDisplay(b: {
  year?: string;
  day?: string;
  yearEnabled?: boolean;
  dayEnabled?: boolean;
}): LineBirthday | null {
  const dayRaw = (b.day ?? "").replace(/[^0-9]/g, "");
  if (dayRaw.length < 4 && !(b.dayEnabled ?? true)) return null;
  if (dayRaw.length < 4) return null;
  const mm = dayRaw.slice(0, 2);
  const dd = dayRaw.slice(2, 4);
  const year = (b.year ?? "").replace(/[^0-9]/g, "").slice(0, 4);
  const yearOn = b.yearEnabled ?? Boolean(year);
  const display =
    yearOn && year.length === 4
      ? `${year}年${Number(mm)}月${Number(dd)}日`
      : `${Number(mm)}月${Number(dd)}日`;
  const out: LineBirthday = {
    day: `${mm}${dd}`,
    display,
    yearEnabled: yearOn,
    dayEnabled: b.dayEnabled ?? true,
  };
  if (yearOn && year) out.year = year;
  return out;
}

/** contentMetadata を string map に正規化（FLEX_JSON が object のとき stringify） */
export function normalizeContentMetadata(meta: unknown): MessageContentMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const out: MessageContentMeta = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    else {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
    }
  }
  return out;
}

// ─── E2EE: グループ鍵（Desktop/Android 準拠 by-id）──────────

const groupKeyWarm = new Set<string>();
/** warm 失敗済み（秘密鍵欠落など）。毎回 API 連打しない */
const groupKeyWarmFailed = new Set<string>();
/** warm 進行中。同時呼び出しの重複を防ぐ */
const groupKeyWarmInflight = new Map<string, Promise<void>>();
/** DM 公開鍵キャッシュ掃除を msg ごとに繰り返さない */
const dmPubKeyCleared = new Set<string>();

async function ensureGroupE2EEKey(
  client: NonNullable<ReturnType<typeof getClient>>,
  chatMid: string,
): Promise<void> {
  const isGroupLike = chatMid.startsWith("c") || chatMid.startsWith("r");
  if (!isGroupLike) return;
  if (groupKeyWarm.has(chatMid) || groupKeyWarmFailed.has(chatMid)) return;

  // 同時呼び出しの重複抑制
  const inflight = groupKeyWarmInflight.get(chatMid);
  if (inflight) return inflight;

  const task: Promise<void> = (async () => {
    try {
      // 最新鍵だけ先に温める（履歴は prepareGroupKeysForMessages が by-id で補完）
      const last = await client.base.talk.getLastE2EEGroupSharedKey({
        keyVersion: 2,
        chatMid,
      });
      await ensureGroupKeyById(client, chatMid, Number(last.groupKeyId));
      groupKeyWarm.add(chatMid);
      groupKeyWarmFailed.delete(chatMid);
      log.debug({ chatMid, groupKeyId: Number(last.groupKeyId) }, "e2ee group key warmed");
    } catch (err) {
      groupKeyWarmFailed.add(chatMid);
      const msg = err instanceof Error ? err.message : String(err);
      // E2EE 未設定グループは NOT_FOUND が正常。WARN 連打を避ける
      const expectedMissing =
        msg.includes("NOT_FOUND") ||
        msg.includes("no valid group key") ||
        msg.includes("there is no valid group key");
      if (expectedMissing || isRetryPlainError(msg)) {
        log.debug({ chatMid, err: msg }, "ensureGroupE2EEKey: no group key (skip)");
        if (isRetryPlainError(msg)) noE2eePeers.add(chatMid);
      } else {
        log.warn(
          { chatMid, err: msg },
          "ensureGroupE2EEKey warm failed (will not retry until key cache cleared)",
        );
      }
    } finally {
      groupKeyWarmInflight.delete(chatMid);
    }
  })();

  groupKeyWarmInflight.set(chatMid, task);
  return task;
}

// ─── E2EE decrypt ─────────────────────────────

function chunkKeyId(chunk: string | Uint8Array | undefined): number | null {
  if (!chunk) return null;
  const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk);
  let value = 0;
  for (const b of bytes) value = value * 256 + b;
  return Number.isFinite(value) ? value : null;
}

/**
 * Vyline 自前の Letter Sealing 実装 (protocol/e2ee/letterSealing.ts) で先に復号を試み、
 * 失敗したら protocol fallback (client.base.e2ee.decryptE2EEMessage) にフォールバックする。
 * 自前実装はグループ鍵を by-id マルチキャッシュから直接引くため、プロトコルスタックの単一
 * キャッシュ実装より履歴復号に強いことがある。失敗しても既存の実装がそのまま
 * セーフティネットになるため、回帰リスクはない。
 */
async function decryptViaLetterSealingOrProtocol(
  client: NonNullable<ReturnType<typeof getClient>>,
  chatMid: string,
  msg: any,
  isSelf: boolean,
): Promise<any> {
  try {
    const rawCt = msg.contentType;
    let contentType = 0;
    if (rawCt === "LOCATION" || rawCt === 15 || rawCt === "15") contentType = 15;
    else if (typeof rawCt === "number" && Number.isFinite(rawCt)) contentType = rawCt;
    else if (rawCt === "NONE" || rawCt === "0" || rawCt === 0) contentType = 0;
    else if (rawCt === "IMAGE" || rawCt === "1") contentType = 1;
    else if (rawCt === "VIDEO" || rawCt === "2") contentType = 2;
    else if (rawCt === "AUDIO" || rawCt === "3") contentType = 3;
    else if (rawCt === "FILE" || rawCt === "14") contentType = 14;
    else if (rawCt === "STICKER" || rawCt === "7") contentType = 7;
    else if (rawCt === "RICH" || rawCt === "17" || rawCt === 17) contentType = 17;
    else if (rawCt === "FLEX" || rawCt === "22" || rawCt === 22) contentType = 22;
    else if (rawCt === "POSTNOTIFICATION" || rawCt === "16" || rawCt === 16) contentType = 16;
    else {
      const metaCt = Number(msg.contentMetadata?.contentType);
      if (Number.isFinite(metaCt)) contentType = metaCt;
    }

    const specVersion = Number(msg.contentMetadata?.e2eeVersion ?? 2);
    const myMid = client.base.profile?.mid ?? "";
    const to = String(msg.to ?? chatMid);
    const from = String(msg.from ?? "");
    const altTo = [chatMid, myMid, to].filter((t) => t && t !== to);

    const result = await decryptLetterSealingMessage(client, {
      to,
      from,
      isSelf,
      chunks: msg.chunks,
      specVersion,
      contentType,
      altTo,
    });
    if (contentType === LETTER_SEALING_CONTENT_TYPE.LOCATION) {
      return { ...msg, location: result.json.location };
    }
    const meta: Record<string, string> = { ...msg.contentMetadata };
    for (const [k, v] of Object.entries(result.json)) {
      if (k === "text") continue;
      meta[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return {
      ...msg,
      text: typeof result.json.text === "string" ? result.json.text : "",
      contentMetadata: meta,
    };
  } catch (letterErr) {
    const errMsg = letterErr instanceof Error ? letterErr.message : String(letterErr);
    // GCM 失敗時のみ protocol に 1 回フォールバック（letterSealing 再試行は decryptE2EEMessageSafe 側）
    if (errMsg.includes("missing self privKey")) {
      throw letterErr instanceof Error ? letterErr : new Error(errMsg);
    }
    if (errMsg.includes("unable to authenticate") || errMsg.includes("Unsupported state")) {
      throw letterErr instanceof Error ? letterErr : new Error(errMsg);
    }
    log.debug(
      {
        chatMid,
        msgId: String(msg?.id),
        err: errMsg,
      },
      "letterSealing decrypt failed — falling back to protocol",
    );
    const decrypted = await client.base.e2ee.decryptE2EEMessage(msg as never);
    return { ...msg, ...decrypted };
  }
}

async function decryptE2EEMessageSafe(
  client: NonNullable<ReturnType<typeof getClient>>,
  accountId: string,
  chatMid: string,
  msg: any,
): Promise<any> {
  if (!msg?.chunks || !Array.isArray(msg.chunks) || msg.chunks.length === 0) return msg;

  // contentMetadata が無い場合は初期化
  msg.contentMetadata = msg.contentMetadata ?? {};

  // contentType が数値で来る場合は文字列に正規化
  // decryptE2EEMessage の分岐は "NONE" 文字列、AAD は数値 0 が正しい。
  // 文字列 "NONE" は getIntBytes 経由で 0 になるので分岐用に NONE を維持する。
  const ct = msg.contentType;
  if (ct === 0 || ct === "0") msg.contentType = "NONE";
  else if (ct === 15 || ct === "15") msg.contentType = "LOCATION";
  else if (ct === 16 || ct === "16") msg.contentType = "POSTNOTIFICATION";
  else if (typeof ct === "number") {
    // その他数値はそのまま AAD に使えるよう decryptE2EEDataMessage 経路へ
  }
  // e2eeVersion が無い場合はデフォルト "2" をセット
  if (!msg.contentMetadata.e2eeVersion) {
    msg.contentMetadata.e2eeVersion = "2";
  }

  const isGroupLike = chatMid.startsWith("c") || chatMid.startsWith("r");
  if (isGroupLike) {
    await ensureGroupE2EEKey(client, chatMid);
  }

  // 自分が送ったグループ履歴: プロトコルスタックは mid 既定の「最新」pub を使うため、
  // envelope の senderKeyId に合わせて一時的に mid 鍵を差し替える
  const myMidForSwap = client.base.profile?.mid;
  const isSelf = Boolean(myMidForSwap && String(msg.from) === myMidForSwap);
  const senderKeyIdForSwap = chunkKeyId(msg.chunks?.[3]);
  let swappedMidKey: string | null = null;
  if (isGroupLike && isSelf && senderKeyIdForSwap != null && myMidForSwap) {
    try {
      const byId = await client.base.storage.get(`e2eeKeys:${senderKeyIdForSwap}`);
      if (byId && typeof byId === "string") {
        const prev = await client.base.storage.get(`e2eeKeys:${myMidForSwap}`);
        swappedMidKey = typeof prev === "string" ? prev : null;
        await client.base.storage.set(`e2eeKeys:${myMidForSwap}`, byId);
      }
    } catch {
      /* ignore */
    }
  }

  try {
    try {
      return await decryptViaLetterSealingOrProtocol(client, chatMid, msg, isSelf);
    } catch (firstErr) {
      const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const isMissingKey = firstMsg.includes("missing self privKey");
      const isAuthFail =
        firstMsg.includes("BAD_DECRYPT") ||
        firstMsg.includes("OPENSSL") ||
        firstMsg.includes("unable to authenticate") ||
        firstMsg.includes("Unsupported state");
      if (isMissingKey) {
        // 秘密鍵が無いメッセージはリトライしても復旧しない（dump 再抽出が必要）
        log.warn(
          { accountId, chatMid, msgId: String(msg.id), err: firstMsg },
          "E2EE missing self key — skip retry",
        );
        return msg;
      }
      if (!isAuthFail) throw firstErr;

      log.warn(
        { accountId, chatMid, msgId: String(msg.id) },
        "E2EE auth fail — clearing key cache and retrying",
      );

      const senderKeyId = chunkKeyId(msg.chunks?.[3]);
      const receiverKeyId = chunkKeyId(msg.chunks?.[4]);
      const peerMid = isSelf ? String(msg.to ?? chatMid) : String(msg.from ?? chatMid);
      const peerKeyId = isSelf ? receiverKeyId : senderKeyId;
      const groupKeyId = isGroupLike ? groupKeyIdFromMessage(msg) : null;
      try {
        if (!isGroupLike) {
          const clearKey = `dm:${chatMid}`;
          if (!dmPubKeyCleared.has(clearKey)) {
            if (peerMid.startsWith("u") && peerKeyId !== null) {
              invalidatePeerPubCache(client, peerMid, peerKeyId);
              await client.base.storage.delete(peerPubCacheKey(peerMid, peerKeyId));
            }
            if (peerMid.startsWith("u") && senderKeyId !== null) {
              invalidatePeerPubCache(client, peerMid, senderKeyId);
              await client.base.storage.delete(peerPubCacheKey(peerMid, senderKeyId));
            }
            if (peerMid.startsWith("u") && receiverKeyId !== null) {
              invalidatePeerPubCache(client, peerMid, receiverKeyId);
            }
            dmPubKeyCleared.add(clearKey);
          }
        } else {
          if (senderKeyId !== null) {
            await client.base.storage.delete(selfPubCacheKey(senderKeyId));
            await client.base.storage.delete(`e2eePublicKeys:${senderKeyId}`);
          }
          // グループ専用。USER チャットで呼ぶと disallowed chatType: USER になる
          const isGroup = chatMid.startsWith("c") || chatMid.startsWith("r");
          if (isGroup) {
            await client.base.storage.delete(`e2eeGroupKeys:${chatMid}`);
            groupKeyWarm.delete(chatMid);
            groupKeyWarmFailed.delete(chatMid);
            if (groupKeyId != null) {
              await client.base.storage
                .delete(`e2eeGroupKeys:${chatMid}:${groupKeyId}`)
                .catch(() => undefined);
              await ensureGroupKeyById(client, chatMid, groupKeyId);
            } else {
              await ensureGroupE2EEKey(client, chatMid);
            }
          }
        }
      } catch (cacheErr) {
        log.warn({ accountId, chatMid, cacheErr }, "e2ee cache clear failed");
      }

      try {
        return await decryptViaLetterSealingOrProtocol(client, chatMid, msg, isSelf);
      } catch (retryErr) {
        try {
          const decrypted = await client.base.e2ee.decryptE2EEMessage(msg as never);
          return { ...msg, ...decrypted };
        } catch (protoErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const protoMsg = protoErr instanceof Error ? protoErr.message : String(protoErr);
          log.warn(
            { accountId, chatMid, msgId: String(msg.id), retryErr: retryMsg, protoErr: protoMsg },
            "E2EE decrypt retry failed — returning raw msg",
          );
          return msg;
        }
      }
    }
  } finally {
    if (swappedMidKey != null && myMidForSwap) {
      await client.base.storage
        .set(`e2eeKeys:${myMidForSwap}`, swappedMidKey)
        .catch(() => undefined);
    }
  }
}

// ─── myMid / profile cache ────────────────────
// encryptE2EEMessage は client.profile?.mid を参照するため、
// 送信前に getProfile() を呼んで client.profile をセットしておく必要がある。

const CONTACT_PROFILE_CACHE_MS = Number(process.env.VYLINE_CONTACT_CACHE_MS ?? 300_000);
/** getContactsV3 は混雑時に遅い。短すぎるとチャンク全滅 → 個人取得の嵐になる */
const CONTACT_RPC_TIMEOUT_MS = Number(process.env.VYLINE_CONTACT_RPC_TIMEOUT_MS ?? 8_000);
const CONTACT_BATCH_CHUNK = Number(process.env.VYLINE_CONTACT_BATCH_CHUNK ?? 4);
const CONTACT_INDIVIDUAL_TIMEOUT_MS = Number(
  process.env.VYLINE_CONTACT_INDIVIDUAL_TIMEOUT_MS ?? 2_500,
);
const MY_PROFILE_CACHE_MS = Number(process.env.VYLINE_MY_PROFILE_CACHE_MS ?? 120_000);
const MY_PROFILE_RPC_TIMEOUT_MS = Number(process.env.VYLINE_MY_PROFILE_RPC_TIMEOUT_MS ?? 10_000);
/** getChat が失敗したグループ（退出済み等）— セッション中は再試行しない */
const groupProfileMiss = new Set<string>();
const contactProfileCache = new Map<string, { at: number; profile: LineProfile }>();
/** 同一 MID への並行 contact RPC を 1 本にまとめる（フロント複数経路が同時に叩いても RPC チェーンは 1 回） */
const contactProfileInflight = new Map<string, Promise<LineProfile | null>>();
/** 解決失敗 MID を短時間スキップ（公式アカウント等で毎回 getContactsV3→V2→getTargetProfiles の遅い連鎖を繰り返さない） */
const CONTACT_PROFILE_MISS_MS = Number(process.env.VYLINE_CONTACT_MISS_CACHE_MS ?? 60_000);
const contactProfileMiss = new Map<string, number>();
const myProfileCache = new Map<string, { at: number; profile: LineProfile }>();
const myMidCache = new Map<string, string>();
type PremiumStatus = {
  active: boolean;
  planType?: string | number;
  validUntil?: number;
  onFreeTrial?: boolean;
  willExpire?: boolean;
};
const premiumStatusCache = new Map<string, { at: number; premium: PremiumStatus }>();
const PREMIUM_STATUS_CACHE_MS = Number(process.env.VYLINE_PREMIUM_STATUS_CACHE_MS ?? 10 * 60_000);

/** Desktop: 起動時に鍵検証済み — 毎リクエスト getE2EEPublicKeys を避ける */
const e2eeIdentityEnsuredAt = new Map<string, number>();
const E2EE_ENSURE_TTL_MS = Number(process.env.VYLINE_E2EE_ENSURE_TTL_MS ?? 300_000);

async function ensureE2EEIdentityCached(
  client: NonNullable<ReturnType<typeof getClient>>,
  accountId: string,
  opts?: { forceNewSenderKey?: boolean; allowRegisterNewKey?: boolean; force?: boolean },
): Promise<void> {
  const now = Date.now();
  const last = e2eeIdentityEnsuredAt.get(accountId) ?? 0;
  if (!opts?.force && !opts?.forceNewSenderKey && now - last < E2EE_ENSURE_TTL_MS) {
    return;
  }
  await ensureValidE2EEIdentity(client, opts);
  e2eeIdentityEnsuredAt.set(accountId, now);
}

const READ_RANGE_TIMEOUT_MS = Number(process.env.VYLINE_READ_RANGE_TIMEOUT_MS ?? 10_000);
const READ_MEMBERS_TIMEOUT_MS = Number(process.env.VYLINE_READ_MEMBERS_TIMEOUT_MS ?? 8_000);

/** ECONNRESET などの一時的エラーで最大2回リトライ */
async function withRetryOnReset<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isReset = msg.includes("ECONNRESET") || msg.includes("socket connection was closed");
      if (isReset && attempt < 1) {
        log.debug({ label, attempt }, "retrying on connection reset");
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
const READ_RANGE_MIN_INTERVAL_MS = Number(process.env.VYLINE_READ_RANGE_MIN_INTERVAL_MS ?? 60_000);
const READ_RANGE_CIRCUIT_MS = Number(process.env.VYLINE_READ_RANGE_CIRCUIT_MS ?? 180_000);

type ReadRangeCacheEntry = {
  at: number;
  ranges: Array<{ chatId?: string; ranges?: unknown }>;
  failStreak: number;
};

const readRangeStorage = new VylineStorage<Record<string, ReadRangeCacheEntry>>(
  "readRanges",
  () => ({}),
);
/** fetchMessagesInner のバックグラウンド既読 RPC をチャットごとに間引く（毎 fetch で force 実行しない） */
const READ_RANGE_BG_MS = Number(process.env.VYLINE_READ_RANGE_BG_MS ?? 60_000);
const readRangeBgAt = new Map<string, number>();

type ChatsCacheEntry = { at: number; chats: Chat[] };
const chatsCache = new Map<string, ChatsCacheEntry>();
const CHATS_CACHE_MS = Number(process.env.VYLINE_CHATS_CACHE_MS ?? 60_000);
const CHAT_PREVIEW_WARM_MAX_ATTEMPTS = 2;
const chatPreviewWarmAttempts = new Map<string, number>();

type MessageBoxesCacheEntry = {
  at: number;
  boxes: any[];
};
const messageBoxesCache = new Map<string, MessageBoxesCacheEntry>();
const MESSAGE_BOXES_CACHE_MS = Number(process.env.VYLINE_MESSAGE_BOXES_CACHE_MS ?? 20_000);
/** getMessageBoxes がハング/遅延してもメッセージ表示をブロックしないよう打ち切る */
const MESSAGE_BOXES_TIMEOUT_MS = Number(process.env.VYLINE_MESSAGE_BOXES_TIMEOUT_MS ?? 5_000);
/** 全ボックス取得（ページングあり）は /S4 RPC を最大 10 本消費するため長めにキャッシュ
 *  （メッセージ同期の /S4 キューをブロックしない） */
const MESSAGE_BOXES_FULL_CACHE_MS = Number(
  process.env.VYLINE_MESSAGE_BOXES_FULL_CACHE_MS ?? 300_000,
);
/** チャットごとの MessageBox lastDeliveredMessageId キャッシュ
 *  — getMessageBoxes 全体取得を回避し、個別チャットのメッセージ取得を高速化 */
type BoxCursorCacheEntry = {
  at: number;
  endMessageId: any;
};
const boxCursorCache = new Map<string, BoxCursorCacheEntry>();
const BOX_CURSOR_CACHE_MS = Number(process.env.VYLINE_BOX_CURSOR_CACHE_MS ?? 30_000);
/** チャットの boxId 解決失敗を短時間スキップ（getMessageBoxes のハングを繰り返さない） */
const boxCursorMiss = new Map<string, number>();
const BOX_CURSOR_MISS_MS = Number(process.env.VYLINE_BOX_CURSOR_MISS_MS ?? 15_000);
const DELTA_RPC_TIMEOUT_MS = Number(process.env.VYLINE_DELTA_RPC_TIMEOUT_MS ?? 12_000);
const TALK_FETCH_TIMEOUT_MS = Number(process.env.VYLINE_TALK_FETCH_TIMEOUT_MS ?? 45_000);

function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("timed out") ||
    msg.includes("TimeoutError") ||
    (err instanceof Error && err.name === "TimeoutError")
  );
}

async function fetchPreviousMessagesRpc(
  client: NonNullable<ReturnType<typeof getClient>>,
  boxId: string,
  endMessageId: any,
  limit: number,
  timeoutMs = TALK_FETCH_TIMEOUT_MS,
): Promise<any[]> {
  const talk = client.base.talk;
  return withTimeout(
    talk.client.request.request(
      LINEStruct.getPreviousMessagesV2WithRequest_args({
        request: {
          messageBoxId: boxId,
          endMessageId,
          messagesCount: limit,
        },
      }),
      "getPreviousMessagesV2WithRequest",
      talk.protocolType,
      true,
      talk.requestPath,
      {},
      timeoutMs,
    ),
    timeoutMs,
    "getPreviousMessagesV2WithRequest",
  );
}

/** Desktop 準拠: activeOnly + lastMessagesPerMessageBoxCount=1 でサーバ側最新順 */
const DESKTOP_MESSAGE_BOX_LIST_REQUEST = {
  activeOnly: true,
  withUnreadCount: true,
  lastMessagesPerMessageBoxCount: 1,
} as const;

/**
 * Desktop 準拠: 全メッセージボックスを取得（activeOnly=false）。
 * プレフィックス別（c/u/r）に minChatId/maxChatId でページングし、
 * 最後に最新メッセージ順へソートして返す。
 */
async function fetchAllMessageBoxes(
  client: NonNullable<ReturnType<typeof getClient>>,
): Promise<any[]> {
  const all: any[] = [];
  const prefixes = ["c", "u", "r"];
  for (const p of prefixes) {
    // プレフィックス単位の失敗は許容（1 系統が落ちても他でカバー）
    try {
      let min = `${p}00000000000000000000000000000000`;
      const max = `${p}fffffffffffffffffffffffffffffff`;
      for (let i = 0; i < 12; i++) {
        const res = await client.base.talk.getMessageBoxes({
          messageBoxListRequest: {
            activeOnly: false,
            withUnreadCount: true,
            lastMessagesPerMessageBoxCount: 1,
            minChatId: min,
            maxChatId: max,
          },
        });
        const pageBoxes = res.messageBoxes ?? [];
        all.push(...pageBoxes);
        if (!res.hasNext || pageBoxes.length === 0) break;
        min = String((pageBoxes.at(-1) as { id?: unknown })?.id ?? max);
      }
    } catch (err) {
      log.debug({ prefix: p, err }, "fetchAllMessageBoxes prefix failed");
    }
  }
  return all.sort((a, b) => {
    const ta = Number(
      (a as { lastDeliveredMessageId?: { deliveredTime?: unknown } }).lastDeliveredMessageId
        ?.deliveredTime ?? 0,
    );
    const tb = Number(
      (b as { lastDeliveredMessageId?: { deliveredTime?: unknown } }).lastDeliveredMessageId
        ?.deliveredTime ?? 0,
    );
    return tb - ta;
  });
}

function messageBoxesCacheKey(accountId: string, forChats: boolean): string {
  return forChats ? `${accountId}:chats` : `${accountId}:all`;
}

async function fetchMessageBoxesCached(
  accountId: string,
  client: NonNullable<ReturnType<typeof getClient>>,
  opts?: { force?: boolean; forChats?: boolean },
): Promise<any[]> {
  const forChats = opts?.forChats ?? false;
  const key = messageBoxesCacheKey(accountId, forChats);
  const now = Date.now();
  const cached = messageBoxesCache.get(key);
  const ttl = forChats ? MESSAGE_BOXES_FULL_CACHE_MS : MESSAGE_BOXES_CACHE_MS;
  if (!opts?.force && cached && now - cached.at < ttl) {
    return cached.boxes;
  }
  const boxes = forChats
    ? await fetchAllMessageBoxes(client)
    : (await client.base.talk.getMessageBoxes({ messageBoxListRequest: {} })).messageBoxes;
  messageBoxesCache.set(key, { at: now, boxes });

  if (forChats && boxes.length > 0) {
    void saveBoxOrder(
      accountId,
      boxes.map((b: { id: string }) => String(b.id)),
    ).catch(() => undefined);
  }

  return boxes;
}

function invalidateMessageBoxesCache(accountId: string): void {
  messageBoxesCache.delete(messageBoxesCacheKey(accountId, true));
  messageBoxesCache.delete(messageBoxesCacheKey(accountId, false));
}

function invalidateBoxCursorCache(accountId: string, chatMid?: string): void {
  if (chatMid) {
    boxCursorCache.delete(`${accountId}:${chatMid}`);
    boxCursorMiss.delete(`${accountId}:${chatMid}`);
  } else {
    // アカウント全体のボックスキャッシュをクリア
    for (const key of boxCursorCache.keys()) {
      if (key.startsWith(`${accountId}:`)) boxCursorCache.delete(key);
    }
    for (const key of boxCursorMiss.keys()) {
      if (key.startsWith(`${accountId}:`)) boxCursorMiss.delete(key);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

async function resolveMyMid(
  client: NonNullable<ReturnType<typeof getClient>>,
  accountId: string,
): Promise<string> {
  const cached = myMidCache.get(accountId);
  if (cached) return cached;
  const fromBase = client.base.profile?.mid;
  if (fromBase) {
    const mid = String(fromBase);
    myMidCache.set(accountId, mid);
    return mid;
  }
  const profile = await withTimeout(
    client.base.talk.getProfile(),
    READ_RANGE_TIMEOUT_MS,
    "getProfile",
  );
  const mid = String(profile.mid);
  myMidCache.set(accountId, mid);
  return mid;
}

/** Keepメモ: 自分自身（mid === myMid）の直接トークに isSelf を立てる */
async function markSelfChats(accountId: string, chats: Chat[]): Promise<Chat[]> {
  const client = getClient(accountId);
  if (!client) return chats;
  try {
    const myMid = await resolveMyMid(client, accountId);
    if (!myMid) return chats;
    let changed = false;
    const out = chats.map((c) => {
      if (c.kind === "direct" && c.mid === myMid && !c.isSelf) {
        changed = true;
        return { ...c, isSelf: true };
      }
      return c;
    });
    return changed ? out : chats;
  } catch (err) {
    log.debug({ accountId, err }, "markSelfChats failed — skipping");
    return chats;
  }
}

// ─── public API ───────────────────────────────

export class NotLoggedInError extends Error {
  constructor(accountId: string) {
    super(`not logged in: ${accountId}`);
    this.name = "NotLoggedInError";
  }
}

function requireClient(accountId: string) {
  const client = getClient(accountId);
  if (!client) throw new NotLoggedInError(accountId);
  return client;
}

async function fetchPremiumStatus(accountId: string): Promise<PremiumStatus> {
  const now = Date.now();
  const cached = premiumStatusCache.get(accountId);
  if (cached && now - cached.at < PREMIUM_STATUS_CACHE_MS) {
    return cached.premium;
  }

  const client = requireClient(accountId);
  let premium: PremiumStatus = { active: false };
  try {
    const status = (await client.base.request.request(
      LINEStruct.getPremiumStatus_args({ req: {} as never }),
      "getPremiumStatus",
      4,
      true,
      "/EXT/line-premium/common/thrift/status",
    )) as {
      active?: boolean;
      planType?: string | number;
      validUntil?: number | bigint;
      onFreeTrial?: boolean;
      willExpire?: boolean;
    };
    premium = {
      active: Boolean(status?.active),
      onFreeTrial: Boolean(status?.onFreeTrial),
      willExpire: Boolean(status?.willExpire),
    };
    if (status?.planType != null) premium.planType = status.planType;
    if (status?.validUntil != null) premium.validUntil = Number(status.validUntil);
  } catch (err) {
    log.debug(
      { accountId, err: err instanceof Error ? err.message : String(err) },
      "getPremiumStatus failed",
    );
  }

  premiumStatusCache.set(accountId, { at: Date.now(), premium });
  void updateSessionMeta(accountId, { premium });
  return premium;
}

/** 自分のプロフィール取得（メモリ / base.profile / Vyline 優先、RPC は短タイムアウト） */
export async function fetchProfile(accountId: string): Promise<LineProfile> {
  // Refresh token before making profile requests to ensure it's valid
  const authService = require("../auth/mod.js").AuthService;
  await authService.tryRefreshToken(accountId);

  const now = Date.now();
  const mem = myProfileCache.get(accountId);
  if (mem && now - mem.at < MY_PROFILE_CACHE_MS) {
    if (mem.profile.premium) return mem.profile;
    const premium =
      premiumStatusCache.get(accountId)?.premium ?? (await fetchPremiumStatus(accountId));
    const next = { ...mem.profile, premium };
    myProfileCache.set(accountId, { at: mem.at, profile: next });
    return next;
  }

  const client = requireClient(accountId);

  const mapRaw = (
    raw: {
      mid?: string;
      userid?: string;
      displayName?: string;
      phoneticName?: string;
      pictureStatus?: string;
      picturePath?: string;
      statusMessage?: string;
      musicProfile?: string;
      videoProfile?: string;
      profileId?: string;
      backgroundUrl?: string;
    },
    birthday: LineBirthday | null = null,
    premium: PremiumStatus | null = null,
  ): LineProfile => {
    // ふりがな / profileId / pictureStatus / birthday は backend で保持しておく。
    // 現在の UI では出さないが、将来の再表示やデバッグ用にレスポンス形は残す。
    const pictureStatus = String(raw.pictureStatus ?? raw.picturePath ?? "");
    const thumbnailUrl = pictureStatusToUrl(pictureStatus) ?? "";
    const out: LineProfile = {
      mid: String(raw.mid ?? ""),
      userid: String(raw.userid ?? ""),
      displayName: String(raw.displayName ?? ""),
      phoneticName: String(raw.phoneticName ?? ""),
      pictureStatus,
      thumbnailUrl,
      statusMessage: String(raw.statusMessage ?? ""),
      picturePath: String(raw.picturePath ?? ""),
      musicProfile: String(raw.musicProfile ?? ""),
      videoProfile: String(raw.videoProfile ?? ""),
      profileId: String(raw.profileId ?? ""),
      backgroundUrl: raw.backgroundUrl || extractBackgroundUrl(raw) || undefined,
      birthday,
      ...(premium ? { premium } : {}),
    };
    return out;
  };

  // ログイン時に載っている base.profile で即返す（RPC 待ちを避ける）
  const baseProf = client.base.profile as
    | {
        mid?: string;
        userid?: string;
        displayName?: string;
        phoneticName?: string;
        pictureStatus?: string;
        picturePath?: string;
        statusMessage?: string;
        musicProfile?: string;
        videoProfile?: string;
        profileId?: string;
      }
    | undefined;

  const persistAndReturn = (out: LineProfile): LineProfile => {
    if (out.mid) {
      myMidCache.set(accountId, out.mid);
      myProfileCache.set(accountId, { at: Date.now(), profile: out });
      const put: {
        mid: string;
        displayName: string;
        thumbnailUrl?: string;
        statusMessage?: string;
        musicProfile?: string;
        birthday?: string;
        phoneticName?: string;
        backgroundUrl?: string;
      } = {
        mid: out.mid,
        displayName: out.displayName,
        statusMessage: out.statusMessage,
        musicProfile: out.musicProfile,
        phoneticName: out.phoneticName,
      };
      if (out.thumbnailUrl) put.thumbnailUrl = out.thumbnailUrl;
      if (out.birthday?.display) put.birthday = out.birthday.display;
      if (out.backgroundUrl) put.backgroundUrl = out.backgroundUrl;
      void vylinePutProfile(accountId, put);
      if (out.premium) void updateSessionMeta(accountId, { premium: out.premium });
    }
    return out;
  };

  // 裏で新鮮な getProfile を走らせつつ、手元があれば先に返す
  const refreshInBg = () => {
    void runTalkRpcImmediate(accountId, async () => {
      try {
        const profile = await withTimeout(
          client.base.talk.getProfile(),
          MY_PROFILE_RPC_TIMEOUT_MS,
          "getProfile.bg",
        );
        const premium = await fetchPremiumStatus(accountId);
        let birthday: LineBirthday | null = mem?.profile.birthday ?? null;
        try {
          const ext = await withTimeout(
            client.base.talk.getExtendedProfile({ syncReason: "INTERNAL" }),
            2_500,
            "getExtendedProfile.bg",
          );
          const b = ext?.birthday;
          if (b) {
            birthday = formatBirthdayDisplay({
              year: b.year,
              day: b.day,
              yearEnabled: b.yearEnabled,
              dayEnabled: b.dayEnabled,
            });
          }
        } catch {
          /* optional */
        }
        persistAndReturn(mapRaw(profile as never, birthday, premium));
      } catch (err) {
        log.debug({ accountId, err }, "fetchProfile background refresh failed");
      }
    });
  };

  if (mem && now - mem.at < MY_PROFILE_CACHE_MS * 3) {
    refreshInBg();
    return mem.profile;
  }

  if (baseProf?.mid && baseProf.displayName) {
    const quick = mapRaw(baseProf, mem?.profile.birthday ?? null, mem?.profile.premium ?? null);
    persistAndReturn(quick);
    refreshInBg();
    return quick;
  }

  // Vyline ディスク（自分 mid が分かっている場合）
  const knownMid = myMidCache.get(accountId) ?? baseProf?.mid;
  if (knownMid) {
    const profile = await vylineGetProfile(accountId, String(knownMid));
    if (profile?.displayName) {
      const mapped = lineProfileFromVyline(profile);
      mapped.premium =
        premiumStatusCache.get(accountId)?.premium ?? (await fetchPremiumStatus(accountId));
      myProfileCache.set(accountId, { at: now, profile: mapped });
      refreshInBg();
      return mapped;
    }
  }

  try {
    const profile = await withTimeout(
      client.base.talk.getProfile(),
      MY_PROFILE_RPC_TIMEOUT_MS,
      "getProfile",
    );
    const premium = await fetchPremiumStatus(accountId);
    let birthday: LineBirthday | null = null;
    try {
      const ext = await withTimeout(
        client.base.talk.getExtendedProfile({ syncReason: "INTERNAL" }),
        2_500,
        "getExtendedProfile",
      );
      const b = ext?.birthday;
      if (b) {
        birthday = formatBirthdayDisplay({
          year: b.year,
          day: b.day,
          yearEnabled: b.yearEnabled,
          dayEnabled: b.dayEnabled,
        });
      }
    } catch (err) {
      log.debug({ accountId, err }, "getExtendedProfile skipped");
    }

    const out = persistAndReturn(mapRaw(profile as never, birthday, premium));
    log.debug({ accountId, mid: out.mid, hasThumb: Boolean(out.thumbnailUrl) }, "profile fetched");
    return out;
  } catch (err) {
    log.debug({ accountId, err }, "fetchProfile timed out — fallback");
    if (mem) return mem.profile;
    if (baseProf?.mid) {
      const premium = await fetchPremiumStatus(accountId).catch(() => null);
      return persistAndReturn(mapRaw(baseProf, null, premium));
    }
    throw err;
  }
}

type ContactV3Like = {
  targetUserMid?: string;
  targetProfileDetail?: {
    profileName?: string;
    pictureStatus?: string;
    profileId?: string;
    statusMessage?: { text?: string };
  };
  friendDetail?: { user?: { overriddenName?: string } };
  userType?: number;
};

function buildProfileDetail(input: {
  profileName?: string;
  pictureStatus?: string;
  profileId?: string;
  statusMessage?: string | { text?: string } | null;
}): NonNullable<ContactV3Like["targetProfileDetail"]> {
  const detail: NonNullable<ContactV3Like["targetProfileDetail"]> = {
    profileName: input.profileName ?? "",
    pictureStatus: input.pictureStatus ?? "",
    profileId: input.profileId ?? "",
  };
  if (typeof input.statusMessage === "string" && input.statusMessage) {
    detail.statusMessage = { text: input.statusMessage };
  } else if (
    input.statusMessage &&
    typeof input.statusMessage === "object" &&
    input.statusMessage.text
  ) {
    detail.statusMessage = { text: input.statusMessage.text };
  }
  return detail;
}

function statusMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text?: string }).text ?? "");
  }
  return "";
}

/** userType（Thrift enum は "BOT"/"USER" 文字列 or 数値 2/1）→ 数値 */
function userTypeToNum(value: unknown): number | null {
  if (value === "BOT" || value === 2) return 2;
  if (value === "USER" || value === 1) return 1;
  return null;
}

function mapContactV3Like(raw: ContactV3Like, fallbackMid: string): LineProfile {
  const pd = raw.targetProfileDetail ?? {};
  const overriddenName = raw.friendDetail?.user?.overriddenName;
  const displayName = String(overriddenName || pd.profileName || fallbackMid);
  const thumbnailUrl = pictureStatusToUrl(pd.pictureStatus) ?? "";
  const out: LineProfile = {
    mid: String(raw.targetUserMid ?? fallbackMid),
    displayName,
    thumbnailUrl,
    pictureStatus: String(pd.pictureStatus ?? ""),
    statusMessage: statusMessageText(pd.statusMessage),
    userid: "",
    profileId: String(pd.profileId ?? ""),
    phoneticName: "",
    picturePath: "",
    musicProfile: "",
    videoProfile: "",
  };
  // 公式アカウント判定: userType=BOT(2)（Thrift は文字列 enum で返る）
  const ut = userTypeToNum((raw as { userType?: unknown }).userType);
  if (ut != null) out.userType = ut;
  return out;
}

function lineProfileFromVyline(c: {
  mid: string;
  displayName: string;
  phoneticName?: string;
  thumbnailUrl?: string;
  statusMessage?: string;
  musicProfile?: string;
  birthday?: string;
  backgroundUrl?: string;
}): LineProfile {
  const profile: LineProfile = {
    mid: c.mid,
    userid: "",
    displayName: c.displayName,
    phoneticName: c.phoneticName ?? "",
    pictureStatus: "",
    thumbnailUrl: c.thumbnailUrl ?? "",
    statusMessage: c.statusMessage ?? "",
    picturePath: "",
    musicProfile: c.musicProfile ?? "",
    videoProfile: "",
    profileId: "",
    birthday: c.birthday ? { display: c.birthday, day: "" } : null,
  };
  if (c.backgroundUrl) profile.backgroundUrl = c.backgroundUrl;
  return profile;
}

/** getContactsV3 をバッチで叩いて VylineCache に載せる（小チャンク・長め timeout・失敗時は stale 許可） */
export async function fetchContactsBatch(
  accountId: string,
  mids: string[],
): Promise<Map<string, LineProfile>> {
  // Refresh token before making contact requests to ensure it's valid
  const authService = require("../auth/mod.js").AuthService;
  await authService.tryRefreshToken(accountId);

  const unique = [...new Set(mids.filter((m) => m.startsWith("u")))];
  const out = new Map<string, LineProfile>();
  if (unique.length === 0) return out;

  const cached = await vylineGetProfiles(accountId, unique);
  const needRpc: string[] = [];
  for (const mid of unique) {
    const c = cached.get(mid);
    if (c && !vylineProfileNeedsRefresh(c)) {
      out.set(mid, lineProfileFromVyline(c));
    } else if (c) {
      // stale でも名前があるなら先に載せる（RPC 失敗時のフォールバック）
      out.set(mid, lineProfileFromVyline(c));
      needRpc.push(mid);
    } else {
      needRpc.push(mid);
    }
  }

  if (needRpc.length === 0) return out;

  const client = requireClient(accountId);
  const CHUNK = Math.max(4, Math.min(CONTACT_BATCH_CHUNK, 20));
  const toPut: Array<{
    mid: string;
    displayName: string;
    thumbnailUrl?: string;
    statusMessage?: string;
  }> = [];

  for (let i = 0; i < needRpc.length; i += CHUNK) {
    const chunk = needRpc.slice(i, i + CHUNK);
    let chunkOk = false;
    try {
      const res = await withTimeout(
        client.base.relation.getContactsV3({ mids: chunk }),
        CONTACT_RPC_TIMEOUT_MS,
        "getContactsV3.batch",
      );
      for (const raw of res.responses ?? []) {
        const mapped = mapContactV3Like(
          raw as ContactV3Like,
          String((raw as ContactV3Like).targetUserMid ?? ""),
        );
        if (!mapped.mid) continue;
        out.set(mapped.mid, mapped);
        chunkOk = true;
        const put: {
          mid: string;
          displayName: string;
          thumbnailUrl?: string;
          statusMessage?: string;
        } = { mid: mapped.mid, displayName: mapped.displayName };
        if (mapped.thumbnailUrl) put.thumbnailUrl = mapped.thumbnailUrl;
        if (mapped.statusMessage) put.statusMessage = mapped.statusMessage;
        toPut.push(put);
        contactProfileCache.set(`${accountId}:${mapped.mid}`, {
          at: Date.now(),
          profile: mapped,
        });
      }
    } catch (err) {
      log.debug(
        {
          accountId,
          chunk: chunk.length,
          err: err instanceof Error ? err.message : String(err),
        },
        "fetchContactsBatch chunk failed — trying individual",
      );
    }

    // チャンク失敗時は個人取得でフォールバック
    if (!chunkOk) {
      for (const mid of chunk) {
        // キャッシュから既に取得済みならスキップ
        if (out.has(mid)) continue;
        try {
          const raw = await withTimeout(
            client.base.relation.getContactsV3({ mids: [mid] }),
            CONTACT_INDIVIDUAL_TIMEOUT_MS,
            "getContactsV3.individual",
          );
          const first = raw.responses?.[0] as ContactV3Like | undefined;
          if (first?.targetUserMid) {
            const mapped = mapContactV3Like(first, String(first.targetUserMid));
            if (mapped.mid) {
              out.set(mapped.mid, mapped);
              const put: {
                mid: string;
                displayName: string;
                thumbnailUrl?: string;
                statusMessage?: string;
              } = { mid: mapped.mid, displayName: mapped.displayName };
              if (mapped.thumbnailUrl) put.thumbnailUrl = mapped.thumbnailUrl;
              if (mapped.statusMessage) put.statusMessage = mapped.statusMessage;
              toPut.push(put);
              contactProfileCache.set(`${accountId}:${mapped.mid}`, {
                at: Date.now(),
                profile: mapped,
              });
            }
          }
        } catch {
          /* individual also failed — leave as MID */
        }
      }
    }
  }

  // getContactsV3 は有効メンバーでも 0 応答で落とすことがある（Desktop 差分）
  // → getContactsV2 / getTargetProfiles / getContact の連鎖で解決する
  const stillMissing = needRpc.filter((mid) => {
    const p = out.get(mid);
    return !p || !p.displayName || /^[ucr][0-9a-f]{32}$/i.test(p.displayName);
  });
  for (const mid of stillMissing) {
    try {
      const raw = await withTimeout(
        resolveUserContactV3Like(client, mid, { skipV3: true }),
        CONTACT_INDIVIDUAL_TIMEOUT_MS,
        "contactsFallback",
      );
      if (!raw?.targetUserMid) continue;
      const mapped = mapContactV3Like(raw, mid);
      if (!mapped.mid || !mapped.displayName) continue;
      out.set(mapped.mid, mapped);
      const put: {
        mid: string;
        displayName: string;
        thumbnailUrl?: string;
        statusMessage?: string;
      } = { mid: mapped.mid, displayName: mapped.displayName };
      if (mapped.thumbnailUrl) put.thumbnailUrl = mapped.thumbnailUrl;
      if (mapped.statusMessage) put.statusMessage = mapped.statusMessage;
      toPut.push(put);
      contactProfileCache.set(`${accountId}:${mapped.mid}`, {
        at: Date.now(),
        profile: mapped,
      });
    } catch {
      /* fallback also failed — leave as MID */
    }
  }

  if (toPut.length) void vylinePutProfiles(accountId, toPut);
  return out;
}

/**
 * チャット一覧の mid を VylineCache で即解決し、不足分を裏でバッチ取得。
 */
export async function applyVylineCacheToChats(accountId: string, chats: Chat[]): Promise<Chat[]> {
  // Refresh token before making cache operations to ensure it's valid
  const authService = require("../auth/mod.js").AuthService;
  await authService.tryRefreshToken(accountId);

  const nameMap = await vylineResolvedNameMap(accountId);
  // 直接トーク相手のステメ・背景は VylineCache プロフィールから補完
  const mids = chats.filter((c) => c.kind === "direct").map((c) => c.mid);
  const profileMap = mids.length ? await vylineGetProfiles(accountId, mids) : new Map();
  const resolved: Chat[] = chats.map((c) => {
    const hit = nameMap.get(c.mid);
    const nameLooksMid = !c.name || /^[ucr][0-9a-f]{32}$/i.test(c.name) || c.name === "(No Name)";
    const next: Chat = {
      ...c,
      name: nameLooksMid ? (hit?.name ?? c.name) : c.name,
    };
    if (!c.thumbnailUrl && hit?.thumbnailUrl) next.thumbnailUrl = hit?.thumbnailUrl;
    const p = profileMap.get(c.mid);
    if (p) {
      if (p.statusMessage) next.statusMessage = p.statusMessage;
      if (p.backgroundUrl) next.backgroundUrl = p.backgroundUrl;
    }
    return next;
  });

  const needWarm = resolved
    .filter((c) => {
      const badName = !c.name || /^[ucr][0-9a-f]{32}$/i.test(c.name) || c.name === "(No Name)";
      return badName || !c.thumbnailUrl;
    })
    .map((c) => c.mid)
    .slice(0, 120);

  if (needWarm.length > 0) {
    void (async () => {
      try {
        const users = needWarm.filter((m) => m.startsWith("u"));
        const groups = needWarm.filter((m) => m.startsWith("c") || m.startsWith("r"));
        if (users.length) await fetchContactsBatch(accountId, users);
        // グループは getChat が重い＆退出済みで失敗しやすいので少数だけ温める
        for (const g of groups.slice(0, 8)) {
          try {
            await fetchContactProfile(accountId, g);
          } catch {
            /* skip */
          }
        }
      } catch (err) {
        log.debug({ accountId, err }, "VylineCache warm failed");
      }
    })();
  }

  return resolved;
}

/** 起動用: VylineCache 全体 */
export async function loadVylineProfileCache(accountId: string) {
  const db = await vylineLoadCache(accountId);
  return { profiles: db.profiles, groups: db.groups };
}

/**
 * グループメンバー一覧（VylineCache + getChats(withMembers) + バッチプロフィール）
 */
export async function fetchChatMembersDetailed(
  accountId: string,
  chatMid: string,
): Promise<{
  chatMid: string;
  name: string;
  thumbnailUrl?: string;
  members: Array<{
    mid: string;
    displayName: string;
    thumbnailUrl?: string;
    statusMessage?: string;
  }>;
  fromCache?: boolean;
}> {
  // Refresh token before making member list request
  const authService = require("../auth/mod.js").AuthService;
  await authService.tryRefreshToken(accountId);

  const cached = await vylineGetGroup(accountId, chatMid);
  if (cached && !vylineGroupNeedsRefresh(cached) && cached.members.length > 0) {
    const members = cached.members.map((m) => {
      const row: { mid: string; displayName: string; thumbnailUrl?: string } = {
        mid: m.mid,
        displayName: m.displayName,
      };
      if (m.thumbnailUrl) row.thumbnailUrl = m.thumbnailUrl;
      return row;
    });
    const out: {
      chatMid: string;
      name: string;
      thumbnailUrl?: string;
      members: typeof members;
      fromCache: true;
    } = { chatMid, name: cached.name, members, fromCache: true };
    if (cached.thumbnailUrl) out.thumbnailUrl = cached.thumbnailUrl;
    return out;
  }

  const memberMids = await fetchChatMemberMids(accountId, chatMid);

  // メンバーが取得できずキャッシュにデータがある場合はキャッシュを使う
  if (memberMids.length === 0 && cached?.members.length) {
    const cachedMembers = cached.members.map((m) => {
      const row: { mid: string; displayName: string; thumbnailUrl?: string } = {
        mid: m.mid,
        displayName: m.displayName,
      };
      if (m.thumbnailUrl) row.thumbnailUrl = m.thumbnailUrl;
      return row;
    });
    const out = { chatMid, name: cached.name, members: cachedMembers, fromCache: true };
    if (cached.thumbnailUrl) (out as { thumbnailUrl?: string }).thumbnailUrl = cached.thumbnailUrl;
    return out;
  }

  let name = cached?.name ?? chatMid;
  let thumbnailUrl = cached?.thumbnailUrl;
  try {
    const groupProf = await fetchContactProfile(accountId, chatMid);
    if (groupProf) {
      name = groupProf.displayName || name;
      thumbnailUrl = groupProf.thumbnailUrl || thumbnailUrl;
    }
  } catch {
    /* skip */
  }

  const profiles = await fetchContactsBatch(accountId, memberMids);
  const members = memberMids.map((mid) => {
    const p = profiles.get(mid);
    const row: {
      mid: string;
      displayName: string;
      thumbnailUrl?: string;
      statusMessage?: string;
    } = {
      mid,
      displayName:
        p?.displayName && !/^[ucr][0-9a-f]{32}$/i.test(p.displayName) ? p.displayName : mid,
    };
    if (p?.thumbnailUrl) row.thumbnailUrl = p.thumbnailUrl;
    if (p?.statusMessage) row.statusMessage = p.statusMessage;
    return row;
  });

  const groupPut: {
    chatMid: string;
    name: string;
    thumbnailUrl?: string;
    memberMids: string[];
    members: Array<{ mid: string; displayName: string; thumbnailUrl?: string }>;
  } = {
    chatMid,
    name,
    memberMids,
    members: members.map((m) => {
      const row: { mid: string; displayName: string; thumbnailUrl?: string } = {
        mid: m.mid,
        displayName: m.displayName,
      };
      if (m.thumbnailUrl) row.thumbnailUrl = m.thumbnailUrl;
      return row;
    }),
  };
  if (thumbnailUrl) groupPut.thumbnailUrl = thumbnailUrl;

  // メンバー名がすべてMIDのままならキャッシュを汚染しない（要再試行）
  const resolvedCount = members.filter((m) => !/^[ucr][0-9a-f]{32}$/i.test(m.displayName)).length;
  const allUnresolved = memberMids.length > 0 && resolvedCount === 0;
  if (!allUnresolved) {
    void vylinePutGroup(accountId, groupPut);
  } else {
    log.debug(
      { accountId, chatMid, memberMids: memberMids.length },
      "fetchChatMembersDetailed: all profiles unresolved — skip cache write",
    );
  }

  const result: {
    chatMid: string;
    name: string;
    thumbnailUrl?: string;
    members: typeof members;
  } = { chatMid, name, members };
  if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl;
  return result;
}

export type CommonGroupInfo = {
  chatMid: string;
  name: string;
  thumbnailUrl?: string;
  memberMids: string[];
};

/**
 * 指定ユーザーと共通のグループを VylineCache（groups DB）から一括読みで返す。
 * メモリ DB の一括走査なので RPC なしで即返る（未読込グループも対象）。
 */
export async function getCommonGroupsForUser(
  accountId: string,
  targetMid: string,
  opts?: { excludeChatMid?: string },
): Promise<CommonGroupInfo[]> {
  const db = await vylineLoadCache(accountId);
  const hits: CommonGroupInfo[] = [];
  for (const group of Object.values(db.groups)) {
    if (!group || !Array.isArray(group.memberMids)) continue;
    if (!group.memberMids.includes(targetMid)) continue;
    if (opts?.excludeChatMid && group.chatMid === opts.excludeChatMid) continue;
    if (group.memberMids.length === 0) continue;
    const info: CommonGroupInfo = {
      chatMid: group.chatMid,
      name: group.name || group.chatMid,
      memberMids: group.memberMids,
    };
    if (group.thumbnailUrl) info.thumbnailUrl = group.thumbnailUrl;
    hits.push(info);
  }
  // 直近の参加順（name 昇順・安定）に並べる
  hits.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return hits;
}

/** 友達以外（グループメンバー等）も含め u* プロフィールを段階的に解決 */
async function resolveUserContactV3Like(
  client: ReturnType<typeof requireClient>,
  targetMid: string,
  opts?: { skipV3?: boolean },
): Promise<ContactV3Like | null> {
  // getContactsV3 がハング/空で既に失敗した相手には再試行しない（別エンドポイントへ）
  if (!opts?.skipV3) {
    try {
      const res = await client.base.relation.getContactsV3({ mids: [targetMid] });
      const raw = res.responses?.[0] as ContactV3Like | undefined;
      if (raw?.targetUserMid) return raw;
    } catch (err) {
      log.debug({ targetMid, err }, "getContactsV3 failed, trying fallback");
    }
  }

  try {
    const res2 = await client.base.talk.getContactsV2({ mids: [targetMid] });
    const entry = res2.contacts?.[targetMid];
    if (entry) {
      const e = entry as {
        displayName?: string;
        displayNameOverridden?: string;
        pictureStatus?: string;
        statusMessage?: string;
      };
      const profileName = e.displayName ?? e.displayNameOverridden ?? "";
      const pictureStatus = e.pictureStatus ?? "";
      const statusMessage = e.statusMessage ?? "";
      // 名前/アイコン等が空の entry（userStatus のみ）は成功扱いせず次へ
      if (profileName || pictureStatus || statusMessage) {
        return {
          targetUserMid: targetMid,
          targetProfileDetail: buildProfileDetail({
            profileName,
            pictureStatus,
            statusMessage,
          }),
        };
      }
    }
  } catch (err) {
    log.debug({ targetMid, err }, "getContactsV2 failed, trying fallback");
  }

  try {
    const res = await client.base.relation.getTargetProfiles({
      request: {
        targetUsers: [{ targetUserMid: targetMid }],
        syncReason: "INTERNAL",
      },
    });
    const raw = res.responses?.[0];
    if (raw?.targetUserMid) {
      const pd = raw.targetProfileDetail;
      const out: ContactV3Like = {
        targetUserMid: raw.targetUserMid,
        targetProfileDetail: buildProfileDetail({
          profileName: pd?.profileName ?? "",
          pictureStatus: pd?.pictureStatus ?? "",
          profileId: pd?.profileId ?? "",
          statusMessage: statusMessageText(pd?.statusMessage),
        }),
      };
      const ut = userTypeToNum((raw as { userType?: unknown }).userType);
      if (ut != null) out.userType = ut;
      return out;
    }
  } catch (err) {
    log.debug({ targetMid, err }, "getTargetProfiles failed, trying fallback");
  }

  try {
    const contact = await client.base.talk.getContact({ mid: targetMid });
    if (contact?.mid) {
      return {
        targetUserMid: contact.mid,
        targetProfileDetail: buildProfileDetail({
          profileName: contact.displayNameOverridden || contact.displayName || "",
          pictureStatus: contact.pictureStatus ?? "",
          statusMessage: contact.statusMessage ?? "",
        }),
      };
    }
  } catch {
    // "no contact" は通常（非接触メンバー）。静かに次へ。
  }

  return null;
}

/**
 * 相手のプロフィール取得 (アイコン URL など)。
 * GetContactV3Response 構造:
 *   targetUserMid
 *   targetProfileDetail.{ profileName, pictureStatus, profileId }
 *   friendDetail.user.overriddenName  (友達リネーム)
 */
export async function fetchContactProfile(
  accountId: string,
  targetMid: string,
): Promise<LineProfile | null> {
  const cacheKey = `${accountId}:${targetMid}`;
  const now = Date.now();

  const cached = contactProfileCache.get(cacheKey);
  if (cached && now - cached.at < CONTACT_PROFILE_CACHE_MS) {
    if (targetMid.startsWith("u") && !cached.profile.backgroundUrl) {
      const next = { ...cached.profile };
      try {
        const bg = await fetchHomeProfileBackgroundUrl(accountId, targetMid);
        if (bg) {
          next.backgroundUrl = bg;
          contactProfileCache.set(cacheKey, { at: Date.now(), profile: next });
          return next;
        }
      } catch {
        /* optional */
      }
    }
    return cached.profile;
  }

  // 直近で解決失敗した相手は短時間スキップ（同じ遅い RPC チェーンを繰り返さない）
  const missAt = contactProfileMiss.get(cacheKey);
  if (missAt != null && now - missAt < CONTACT_PROFILE_MISS_MS) {
    return cached?.profile ?? null;
  }

  // 同一 MID への並行呼び出しは 1 本の in-flight にまとめる（フロントの複数経路が同時に叩いても 1 回の RPC）
  const inflight = contactProfileInflight.get(cacheKey);
  if (inflight) return inflight;

  const task = (async (): Promise<LineProfile | null> => {
    // Vyline ディスクキャッシュ（起動直後の mid 生出し回避）
    const vylineHit = await vylineGetProfile(accountId, targetMid);
    if (vylineHit && !vylineProfileNeedsRefresh(vylineHit)) {
      const profile = lineProfileFromVyline(vylineHit);
      if (targetMid.startsWith("u") && !profile.backgroundUrl) {
        try {
          const bg = await fetchHomeProfileBackgroundUrl(accountId, targetMid);
          if (bg) profile.backgroundUrl = bg;
        } catch {
          /* optional */
        }
      }
      contactProfileCache.set(cacheKey, { at: Date.now(), profile });
      return profile;
    }

    try {
      // バックグラウンドキューに載せると profile/履歴と渋滞するので即時 + 短 timeout
      const profile = await withTimeout(
        fetchContactProfileInner(accountId, targetMid),
        CONTACT_RPC_TIMEOUT_MS,
        "fetchContactProfile",
      );
      if (profile) {
        contactProfileCache.set(cacheKey, { at: Date.now(), profile });
        contactProfileMiss.delete(cacheKey);
        const put: {
          mid: string;
          displayName: string;
          thumbnailUrl?: string;
          statusMessage?: string;
          musicProfile?: string;
          birthday?: string;
          backgroundUrl?: string;
          phoneticName?: string;
        } = {
          mid: profile.mid,
          displayName: profile.displayName,
          statusMessage: profile.statusMessage,
          musicProfile: profile.musicProfile,
          phoneticName: profile.phoneticName,
        };
        if (profile.thumbnailUrl) put.thumbnailUrl = profile.thumbnailUrl;
        if (profile.birthday?.display) put.birthday = profile.birthday.display;
        if (profile.backgroundUrl) put.backgroundUrl = profile.backgroundUrl;
        void vylinePutProfile(accountId, put);
        return profile;
      }
      contactProfileMiss.set(cacheKey, Date.now());
      return cached?.profile ?? null;
    } catch (err) {
      log.debug(
        { accountId, targetMid, err: err instanceof Error ? err.message : String(err) },
        "fetchContactProfile timed out — using cache if any",
      );
      contactProfileMiss.set(cacheKey, Date.now());
      if (vylineHit) {
        return lineProfileFromVyline(vylineHit);
      }
      return cached?.profile ?? null;
    }
  })();

  contactProfileInflight.set(cacheKey, task);
  const cleanup = () => {
    contactProfileInflight.delete(cacheKey);
  };
  task.then(cleanup, cleanup);
  return task;
}

async function fetchContactProfileInner(
  accountId: string,
  targetMid: string,
): Promise<LineProfile | null> {
  const client = requireClient(accountId);
  try {
    if (targetMid.startsWith("u")) {
      const raw = await resolveUserContactV3Like(client, targetMid);
      if (!raw) return null;
      const profile = mapContactV3Like(raw, targetMid);
      // getProfile / contact raw に背景が入ることがあるのでまずそこを優先する。
      const rawBackground = extractBackgroundUrl(raw);
      if (rawBackground) profile.backgroundUrl = rawBackground;

      // プロフィール背景は homeProfile API も別途試す（失敗許容の保険）
      try {
        const bg = await fetchHomeProfileBackgroundUrl(accountId, targetMid);
        if (bg) profile.backgroundUrl = bg;
      } catch {
        /* optional */
      }
      return profile;
    }

    // 退出・キック済みグループは getChat が壊れた応答を返すことがある
    if (groupProfileMiss.has(`${accountId}:${targetMid}`)) {
      const cached = await vylineGetProfile(accountId, targetMid);
      return cached ? lineProfileFromVyline(cached) : null;
    }

    // まずローカル chats / Vyline から（RPC 渋滞を避ける）
    try {
      const localChats = await getStoredChats(accountId);
      const hit = localChats.find((c) => c.mid === targetMid);
      if (hit?.name || hit?.thumbnailUrl) {
        return {
          mid: targetMid,
          displayName: hit.name || targetMid,
          thumbnailUrl: hit.thumbnailUrl ?? "",
          pictureStatus: "",
          statusMessage: "",
          userid: "",
          profileId: "",
          phoneticName: "",
          picturePath: "",
          musicProfile: "",
          videoProfile: "",
        };
      }
    } catch {
      /* continue */
    }

    // グループ/ルーム
    const chat = await withTimeout(
      client.getChat(targetMid),
      Math.min(CONTACT_RPC_TIMEOUT_MS, 2000),
      "getChat.profile",
    );
    if (!chat?.raw || !(chat.raw as { chatMid?: string }).chatMid) {
      groupProfileMiss.add(`${accountId}:${targetMid}`);
      return null;
    }
    const rawChat = chat.raw as unknown as Record<string, unknown>;
    const ps = String(rawChat.pictureStatus ?? "");
    const thumbnailUrl = pictureStatusToUrl(ps) ?? "";
    return {
      mid: String(rawChat.chatMid ?? targetMid),
      displayName: String(chat.name ?? ""),
      thumbnailUrl,
      pictureStatus: ps,
      statusMessage: "",
      userid: "",
      profileId: "",
      phoneticName: "",
      picturePath: "",
      musicProfile: "",
      videoProfile: "",
    } as LineProfile;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (targetMid.startsWith("c") || targetMid.startsWith("r")) {
      groupProfileMiss.add(`${accountId}:${targetMid}`);
    }
    // タイムアウト・未参加は DEBUG（WARN 連打しない）
    if (
      msg.includes("timed out") ||
      msg.includes("Timeout") ||
      msg.includes("chatMid") ||
      msg.includes("NOT_AUTHORIZED") ||
      msg.includes("NOT_FOUND")
    ) {
      log.debug({ accountId, targetMid, err: msg }, "fetchContactProfile skipped");
    } else {
      log.debug({ accountId, targetMid, err: msg }, "fetchContactProfile failed");
    }
    return null;
  }
}

/** メッセージを既読にする（最新メッセージ ID を渡す） */
export async function markAsRead(
  accountId: string,
  chatMid: string,
  lastMessageId?: string,
): Promise<void> {
  // Refresh token before making read request
  const authService = require("../auth/mod.js").AuthService;
  await authService.tryRefreshToken(accountId);

  const client = requireClient(accountId);
  let messageId = lastMessageId?.trim() || "";
  // 楽観的送信の仮 ID はサーバに送れない
  if (messageId.startsWith("pending_")) messageId = "";

  if (!messageId) {
    try {
      const boxesResult = await withRetryOnReset(
        () => client.base.talk.getMessageBoxes({ messageBoxListRequest: {} }),
        "markAsRead.getMessageBoxes",
      );
      const box = boxesResult.messageBoxes.find((b: { id: string }) => b.id === chatMid) as
        | { lastDeliveredMessageId?: { messageId?: string | bigint | number } }
        | undefined;
      const rawId = box?.lastDeliveredMessageId?.messageId;
      if (rawId != null && String(rawId).trim() !== "") {
        messageId = String(rawId);
      }
    } catch {
      /* fall through */
    }
  }

  if (!messageId) {
    log.debug({ accountId, chatMid }, "markAsRead skipped: no valid lastMessageId");
    return;
  }

  try {
    await client.base.talk.sendChatChecked({
      seq: await client.base.getReqseq(),
      chatMid,
      lastMessageId: messageId,
      sessionId: 0,
    });
    await markStoredMessagesReadThrough(accountId, chatMid, messageId);
    // サーバ側未読を即時0にするためキャッシュを無効化（次の getMessageBoxes / getChats で新鮮な unreadCount を取得）
    try {
      invalidateMessageBoxesCache(accountId);
      chatsCache.delete(accountId);
      invalidateBoxCursorCache(accountId, chatMid);
    } catch {}
    log.info({ accountId, chatMid, lastMessageId: messageId }, "chat marked as read");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 接続エラー・タイムアウトは再スローしない（非クリティカル）
    if (/connection|timeout|connect|ECONN|ENET|ETIMEDOUT/i.test(msg)) {
      log.warn({ accountId, chatMid, errMsg: msg }, "markAsRead skipped (network)");
      return;
    }
    log.warn({ accountId, chatMid, err }, "markAsRead failed");
    throw err;
  }
}

export type ReadTarget = { chatMid: string; lastMessageId: string };

/** getMessageBoxes の結果から通常トークの既読送信対象を抽出する。 */
export function readTargetsFromMessageBoxes(
  boxes: ReadonlyArray<{
    id: string;
    unreadCount?: string | number | bigint;
    lastDeliveredMessageId?: { messageId?: string | number | bigint };
  }>,
  chatMids?: ReadonlySet<string>,
): ReadTarget[] {
  return boxes.flatMap((box) => {
    if (chatMids && !chatMids.has(box.id)) return [];
    if (Number(box.unreadCount ?? 0) <= 0) return [];
    const messageId = String(box.lastDeliveredMessageId?.messageId ?? "").trim();
    return messageId ? [{ chatMid: box.id, lastMessageId: messageId }] : [];
  });
}

/** 複数チャットを既読にする。LINE側に通常トーク用bulk APIはないため順次送信する。 */
export async function markAsReadBatch(
  accountId: string,
  targets: readonly ReadTarget[],
): Promise<number> {
  let count = 0;
  for (const target of targets) {
    await markAsRead(accountId, target.chatMid, target.lastMessageId);
    count++;
  }
  return count;
}

/** 未読の通常トークを全て既読にする。Squareのbulk APIは通常トークには使えない。 */
export async function markAllAsRead(
  accountId: string,
  chatMids?: readonly string[],
): Promise<number> {
  const client = requireClient(accountId);
  const boxesResult = await withRetryOnReset(
    () => client.base.talk.getMessageBoxes({ messageBoxListRequest: {} }),
    "markAllAsRead.getMessageBoxes",
  );
  const allowed = chatMids ? new Set(chatMids) : undefined;
  return markAsReadBatch(accountId, readTargetsFromMessageBoxes(boxesResult.messageBoxes, allowed));
}

/**
 * 既読レンジ取得。DM の seen 判定やグループ既読補強に使う。
 * 失敗しても空配列（呼び出し側で無視可）。
 */
export async function fetchReadRanges(
  accountId: string,
  chatMid: string,
  opts?: { force?: boolean },
): Promise<Array<{ chatId?: string; ranges?: unknown }>> {
  const now = Date.now();
  const cacheDict = await readRangeStorage.load(accountId);
  const cached = cacheDict[chatMid];

  if (!opts?.force && cached) {
    if (cached.failStreak >= 3 && now - cached.at < READ_RANGE_CIRCUIT_MS) {
      return cached.ranges;
    }
    if (now - cached.at < READ_RANGE_MIN_INTERVAL_MS) {
      return cached.ranges;
    }
  }

  const client = requireClient(accountId);
  const talk = client.base.talk;

  try {
    // 型付きTalk APIを使う。raw requestへ手動で syncReason を渡すと、
    // 実装差分によって success list を正しく復号できず空レンジになる。
    const res = await enqueueTalkRpcBackground(accountId, () =>
      withTimeout(
        talk.getMessageReadRange({ chatIds: [chatMid] }),
        READ_RANGE_TIMEOUT_MS,
        "getMessageReadRange",
      ),
    );

    const ranges = normalizeMessageReadRanges(res);

    cacheDict[chatMid] = { at: now, ranges, failStreak: 0 };
    void readRangeStorage.replace(accountId, cacheDict);
    return ranges;
  } catch (err) {
    const failStreak = (cached?.failStreak ?? 0) + 1;
    const fallback = cached?.ranges ?? [];
    cacheDict[chatMid] = { at: now, ranges: fallback, failStreak };
    void readRangeStorage.replace(accountId, cacheDict);
    if (failStreak === 1 || failStreak % 10 === 0) {
      log.debug(
        { accountId, chatMid, failStreak, err },
        "getMessageReadRange failed (using cache/backoff)",
      );
    }
    return fallback;
  }
}

/** getMessageReadRange の生レスポンスを、実装内で扱う配列へ正規化する。 */
export function normalizeMessageReadRanges(
  res: unknown,
): Array<{ chatId?: string; ranges?: unknown }> {
  if (Array.isArray(res)) return res as Array<{ chatId?: string; ranges?: unknown }>;
  if (!res || typeof res !== "object") return [];
  const wrapped = res as { success?: unknown; messageReadRanges?: unknown };
  const candidate = wrapped.success ?? wrapped.messageReadRanges;
  return Array.isArray(candidate)
    ? (candidate as Array<{ chatId?: string; ranges?: unknown }>)
    : [];
}

type ReadRangeRow = Record<string, unknown>;

/** Thrift 復号後: 配列または { "0": row } のどちらも来る */
function asReadRangeRows(value: unknown): ReadRangeRow[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is ReadRangeRow => v != null && typeof v === "object");
  }
  if (value && typeof value === "object") {
    const row = value as ReadRangeRow;
    if (row.endMessageId != null || row.lastMessageId != null || row.startMessageId != null) {
      return [row];
    }
    return Object.values(value as Record<string, unknown>).filter(
      (v): v is ReadRangeRow => v != null && typeof v === "object",
    );
  }
  return [];
}

/** 名前付き / 数値フィールド (2=endMessageId) 両対応 */
function endMessageIdFromRow(row: ReadRangeRow): string | number | bigint | undefined {
  const v = row.endMessageId ?? row.lastMessageId ?? row[2];
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "string") return v;
  return undefined;
}

function toBigIntId(id: string | number | bigint | undefined): bigint | null {
  if (id == null || id === "") return null;
  try {
    return BigInt(String(id));
  } catch {
    return null;
  }
}

/** 相手の既読ウォーターマーク（messageId 数値比較用の最大値）を推定 */
export function peerReadUpToMessageId(
  ranges: Array<{ chatId?: string; ranges?: unknown }>,
  chatMid: string,
  myMid: string,
): string | null {
  const entry = ranges.find((r) => String(r.chatId ?? "") === chatMid) ?? ranges[0];
  if (!entry?.ranges) return null;

  let best: bigint | null = null;
  const consider = (id: string | number | bigint | undefined) => {
    const n = toBigIntId(id);
    if (n == null) return;
    if (best == null || n > best) best = n;
  };

  const raw = entry.ranges;
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const row = r as ReadRangeRow & { memberMid?: string };
      if (row.memberMid && row.memberMid === myMid) continue;
      consider(endMessageIdFromRow(row));
    }
  } else if (raw && typeof raw === "object") {
    for (const [mid, list] of Object.entries(raw as Record<string, unknown>)) {
      if (mid === myMid) continue;
      for (const row of asReadRangeRows(list)) {
        consider(endMessageIdFromRow(row));
      }
    }
  }
  return best === null ? null : String(best);
}

type MemberReadWatermark = { mid: string; upTo: bigint };

/** ranges → メンバーごとの既読ウォーターマーク（自分除外） */
export function memberReadWatermarks(
  ranges: Array<{ chatId?: string; ranges?: unknown }>,
  chatMid: string,
  myMid: string,
): MemberReadWatermark[] {
  const entry = ranges.find((r) => String(r.chatId ?? "") === chatMid) ?? ranges[0];
  if (!entry?.ranges) return [];

  const out: MemberReadWatermark[] = [];
  const push = (mid: string, id: string | number | bigint | undefined) => {
    if (!mid || mid === myMid) return;
    const n = toBigIntId(id);
    if (n == null) return;
    const existing = out.find((x) => x.mid === mid);
    if (!existing) out.push({ mid, upTo: n });
    else if (n > existing.upTo) existing.upTo = n;
  };

  const raw = entry.ranges;
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const row = r as ReadRangeRow & { memberMid?: string };
      if (row.memberMid) push(row.memberMid, endMessageIdFromRow(row));
    }
  } else if (raw && typeof raw === "object") {
    for (const [mid, list] of Object.entries(raw as Record<string, unknown>)) {
      for (const row of asReadRangeRows(list)) {
        push(mid, endMessageIdFromRow(row));
      }
    }
  }
  return out;
}

/** 自分の送信メッセージにグループ既読数・既読者 mid を付与 */
export function attachGroupReadReceipts(
  messages: Message[],
  watermarks: MemberReadWatermark[],
): void {
  if (watermarks.length === 0) return;
  for (const m of messages) {
    if (!m.isMyMessage) continue;
    let msgId: bigint;
    try {
      msgId = BigInt(m.id);
    } catch {
      continue;
    }
    const readers = watermarks.filter((w) => w.upTo >= msgId).map((w) => w.mid);
    if (readers.length === 0) {
      if (m.readCount == null) m.readCount = 0;
      continue;
    }
    // 別ポーリングで得た既読者を失わない。既読は後から巻き戻らないため単調に保持する。
    const mergedReaders = [...new Set([...(m.readBy ?? []), ...readers])];
    if (m.readCount == null || mergedReaders.length > m.readCount) {
      m.readCount = mergedReaders.length;
    }
    m.readBy = mergedReaders;
  }
}

/** 既読レンジをメッセージ配列に適用（DM seen / グループ readBy） */
export function applyReadReceiptsToMessages(
  messages: Message[],
  ranges: Array<{ chatId?: string; ranges?: unknown }>,
  chatMid: string,
  myMid: string,
): void {
  if (chatMid.startsWith("u")) {
    const upTo = peerReadUpToMessageId(ranges, chatMid, myMid);
    if (!upTo) return;
    const upToN = BigInt(upTo);
    for (const m of messages) {
      if (!m.isMyMessage) continue;
      try {
        if (BigInt(m.id) <= upToN) m.seen = true;
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (chatMid.startsWith("c") || chatMid.startsWith("r")) {
    const marks = memberReadWatermarks(ranges, chatMid, myMid);
    attachGroupReadReceipts(messages, marks);
  }
}

/** グループメンバー mid 一覧 — TalkService_getChats(withMembers) */
export async function fetchChatMemberMids(accountId: string, chatMid: string): Promise<string[]> {
  if (!chatMid.startsWith("c") && !chatMid.startsWith("r")) return [];
  const client = requireClient(accountId);
  try {
    // Desktop 準拠: getChat 単体ではなく getChats 一覧 API でメンバー付き取得
    const res = await withTimeout(
      client.base.talk.getChats({
        chatMids: [chatMid],
        withMembers: true,
        withInvitees: true,
      }),
      READ_MEMBERS_TIMEOUT_MS,
      "getChats.members",
    );
    const chat = (res as { chats?: unknown[] })?.chats?.[0] as
      | {
          extra?: {
            groupExtra?: { memberMids?: unknown };
            peerExtra?: unknown;
          };
        }
      | undefined;
    if (!chat) return [];

    const mids = chat.extra?.groupExtra?.memberMids;
    if (Array.isArray(mids)) return mids.map(String).filter((m) => m.startsWith("u"));
    if (mids && typeof mids === "object") {
      // GroupExtra.memberMids: Record<mid, joinedAt>
      return Object.keys(mids as Record<string, unknown>).filter((k) => k.startsWith("u"));
    }
    return [];
  } catch (err) {
    log.debug({ accountId, chatMid, err }, "fetchChatMemberMids failed");
    return [];
  }
}

/** 軽量既読更新（ポーリング用） — 失敗時は空を返し HTTP 500 にしない */
export type ReadReceiptsResult = {
  /** メッセージID → 既読状態 */
  receipts: Record<string, { seen?: boolean; readCount?: number; readBy?: string[] }>;
  /** DM: 相手が既読した自分のメッセージID の最大値（これを超えない id は全て既読） */
  peerReadUpTo?: string;
  /** グループ/ルーム: メンバーごとの既読ウォーターマーク */
  memberReadWatermarks?: Array<{ mid: string; upTo: string }>;
};

export async function getReadReceiptsForChat(
  accountId: string,
  chatMid: string,
  messageIds: string[],
  opts?: { force?: boolean },
): Promise<ReadReceiptsResult> {
  try {
    // Refresh token before making read receipt requests
    const authService = require("../auth/mod.js").AuthService;
    await authService.tryRefreshToken(accountId);

    const client = requireClient(accountId);
    const myMid = await resolveMyMid(client, accountId);
    const ranges = await fetchReadRanges(accountId, chatMid, { force: opts?.force === true });
    const out: Record<string, { seen?: boolean; readCount?: number; readBy?: string[] }> = {};

    if (chatMid.startsWith("u")) {
      const upTo = peerReadUpToMessageId(ranges, chatMid, myMid);
      if (upTo) {
        const upToN = BigInt(upTo);
        for (const id of messageIds) {
          try {
            if (BigInt(id) <= upToN) out[id] = { seen: true };
          } catch {
            /* ignore */
          }
        }
      }
      return upTo ? { receipts: out, peerReadUpTo: upTo } : { receipts: out };
    }

    if (chatMid.startsWith("c") || chatMid.startsWith("r")) {
      const marks = memberReadWatermarks(ranges, chatMid, myMid);
      for (const id of messageIds) {
        try {
          const msgId = BigInt(id);
          const readers = marks.filter((w) => w.upTo >= msgId).map((w) => w.mid);
          out[id] = { readCount: readers.length, readBy: readers };
        } catch {
          /* ignore */
        }
      }
      return {
        receipts: out,
        memberReadWatermarks: marks.map((m) => ({ mid: m.mid, upTo: String(m.upTo) })),
      };
    }
    return { receipts: out };
  } catch (err) {
    log.debug({ accountId, chatMid, err }, "getReadReceiptsForChat failed");
    return { receipts: {} };
  }
}

/**
 * チャット一覧取得。
 * グループ/ルーム: client.fetchJoinedChats()
 * 友達 (direct): client.fetchUsers()
 */
function previewFromBoxMessage(msg: any | undefined): string {
  if (!msg) return "";
  const meta = (msg.contentMetadata ?? null) as Record<string, unknown> | null;
  const alt = meta && typeof meta.ALT_TEXT === "string" ? meta.ALT_TEXT.trim() : "";
  if (alt) return alt.length > 60 ? `${alt.slice(0, 60)}…` : alt;
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  // LINE 絵文字（sticon）のみの本文はプレースホルダ文字のまま出さず「絵文字」と表示
  const stripped = text.replace(/[￼�$]/g, "");
  if (text && stripped) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  if (text && !stripped) return "絵文字";
  const ct = String(msg.contentType ?? "NONE");
  const hasChunks = Array.isArray(msg.chunks) && msg.chunks.length > 0;
  switch (ct) {
    case "IMAGE":
    case "1":
      return "写真";
    case "VIDEO":
    case "2":
      return "動画";
    case "AUDIO":
    case "3":
      return "音声";
    case "STICKER":
    case "7":
      return "スタンプ";
    case "FILE":
    case "14":
      return "ファイル";
    case "LOCATION":
    case "15":
      return "位置情報";
    case "CALL":
    case "6":
      return "通話";
    case "CONTACT":
    case "13":
      return "連絡先";
    case "RICH":
    case "17":
      return "リッチメッセージ";
    case "FLEX":
    case "22":
      return "Flexメッセージ";
    case "UNSENT":
    case "UNSEND":
      return "取り消し済みのメッセージ";
    case "E2EE_UNAVAILABLE":
      return "暗号化メッセージ";
    case "NONE":
    case "0":
      return hasChunks ? "暗号化メッセージ" : "";
    default:
      return hasChunks ? "暗号化メッセージ" : ct ? `(${ct})` : "";
  }
}

function boxMeta(box: any | undefined): {
  lastMessageTime: number;
  lastMessagePreview: string;
  lastMessageId?: string;
  unreadCount?: number;
} {
  if (!box) return { lastMessageTime: 0, lastMessagePreview: "" };
  const last =
    Array.isArray(box.lastMessages) && box.lastMessages.length > 0
      ? box.lastMessages[0]
      : undefined;
  const fromMsg = last?.deliveredTime != null ? Number(last.deliveredTime) : 0;
  const fromBox = Number(box.lastDeliveredMessageId?.deliveredTime ?? 0n);
  const boxId = box.lastDeliveredMessageId?.messageId;
  const meta: {
    lastMessageTime: number;
    lastMessagePreview: string;
    lastMessageId?: string;
    unreadCount?: number;
  } = {
    lastMessageTime: Math.max(fromMsg, fromBox),
    lastMessagePreview: previewFromBoxMessage(last),
  };
  if (boxId != null) meta.lastMessageId = String(boxId);
  if (box.unreadCount != null) {
    meta.unreadCount =
      typeof box.unreadCount === "number" ? box.unreadCount : Number(box.unreadCount);
  }
  return meta;
}

function chatFromMessageBox(
  box: any,
  groupByMid: Map<string, { mid: string; name: string; raw?: Record<string, unknown> }>,
  userByMid: Map<
    string,
    {
      mid: string;
      displayName: string;
      thumbnailUrl: string;
      userType?: number;
      statusMessage?: string;
    }
  >,
  joinedChatsKnown = true,
): Chat {
  const mid = String(box.id);
  const meta = boxMeta(box);
  const kind = detectChatKind(mid);

  if (kind === "group" || kind === "room") {
    const group = groupByMid.get(mid);
    // joinedChats の取得自体が失敗した場合は「退出済み」と誤判定しない。
    const left = joinedChatsKnown ? !group : false;
    const raw = group?.raw ?? {};
    const ps = String(raw.pictureStatus ?? raw.picturePath ?? "");
    const chat: Chat = {
      mid,
      name: group?.name ?? mid,
      hasMessages: true,
      kind,
      lastMessageTime: meta.lastMessageTime,
      lastMessagePreview: meta.lastMessagePreview,
      thumbnailUrl: pictureStatusToUrl(ps) ?? "",
      left,
    };
    if (meta.lastMessageId) chat.lastMessageId = meta.lastMessageId;
    if (meta.unreadCount != null) chat.unreadCount = meta.unreadCount;
    return chat;
  }

  const user = userByMid.get(mid);
  const chat: Chat = {
    mid,
    name: user?.displayName ?? mid,
    hasMessages: true,
    kind: kind === "direct" ? "direct" : "unknown",
    lastMessageTime: meta.lastMessageTime,
    lastMessagePreview: meta.lastMessagePreview,
    thumbnailUrl: user?.thumbnailUrl ?? "",
  };
  if (user?.userType === 2) chat.isOfficial = true;
  if (user?.statusMessage && kind === "direct") chat.statusMessage = user.statusMessage;
  if (meta.lastMessageId) chat.lastMessageId = meta.lastMessageId;
  if (meta.unreadCount != null) chat.unreadCount = meta.unreadCount;
  return chat;
}

export async function fetchBootstrap(accountId: string): Promise<BootstrapPayload> {
  requireClient(accountId);
  const payload = await getBootstrapPayload(accountId);
  if (payload.chats.length > 0) {
    payload.chats = await markSelfChats(accountId, payload.chats);
  }
  return payload;
}

export async function warmLineCache(accountId: string): Promise<void> {
  // セッション/プロフィール等の軽量キャッシュだけを温める。
  // メッセージ履歴の一括インデックスは暗黙実行しない。
  await warmAccountCache(accountId);
}

export async function fetchChats(
  accountId: string,
  opts?: { light?: boolean; force?: boolean; refresh?: boolean },
): Promise<Chat[]> {
  const chats = await fetchChatsCore(accountId, opts);
  const enriched = await applyVylineCacheToChats(accountId, chats);
  return markSelfChats(accountId, enriched);
}

async function fetchChatsCore(
  accountId: string,
  opts?: { light?: boolean; force?: boolean; refresh?: boolean },
): Promise<Chat[]> {
  const now = Date.now();
  const memCached = chatsCache.get(accountId);

  if (!opts?.force) {
    const local = await getStoredChats(accountId);
    if (local.length > 0) {
      const meta = await getCacheMeta(accountId);
      const chatsAge = meta.chatsSyncedAt
        ? now - Date.parse(meta.chatsSyncedAt)
        : Number.POSITIVE_INFINITY;
      // SQLite上のfreshnessを正本にする。プロセス再起動でmemory cacheが空でも、
      // disk cacheが新鮮なら同じchat一覧RPCをやり直さない。
      const needsBg = Boolean(opts?.refresh) || chatsAge > CHATS_CACHE_MS;

      if (needsBg) {
        const syncPromise = enqueueTalkRpcBackground(accountId, async () => {
          const fresh = await fetchChatsInner(accountId, {
            light: opts?.light ?? true,
          });
          chatsCache.set(accountId, { at: Date.now(), chats: fresh });
          return fresh;
        });

        // refresh=true: 最大 3s 待って新鮮な一覧を返す（失敗時はローカル）
        if (opts?.refresh) {
          try {
            const raced = await Promise.race([
              syncPromise.then((c) => ({ ok: true as const, c })),
              new Promise<{ ok: false }>((resolve) =>
                setTimeout(() => resolve({ ok: false }), 3_000),
              ),
            ]);
            if (raced.ok) return raced.c;
          } catch (err) {
            log.debug({ accountId, err }, "refresh chats sync failed — local");
          }
          return local;
        }

        void syncPromise.catch((err) => {
          log.debug({ accountId, err }, "background chats sync failed");
        });
      }
      if (memCached && now - memCached.at < CHATS_CACHE_MS) {
        return memCached.chats;
      }
      if (chatsAge <= CHATS_CACHE_MS) {
        chatsCache.set(accountId, { at: now, chats: local });
      }
      return local;
    }
  }

  if (!opts?.force && memCached && now - memCached.at < CHATS_CACHE_MS) {
    return memCached.chats;
  }

  try {
    const chats = await enqueueTalkRpcBackground(accountId, () => fetchChatsInner(accountId, opts));
    chatsCache.set(accountId, { at: now, chats });
    return chats;
  } catch (err) {
    if (memCached) {
      log.debug({ accountId, err }, "fetchChats failed — returning memory cache");
      return memCached.chats;
    }
    const local = await getStoredChats(accountId);
    if (local.length > 0) {
      log.debug({ accountId, err }, "fetchChats failed — returning disk cache");
      return local;
    }
    throw err;
  }
}

async function fetchChatsInner(accountId: string, opts?: { light?: boolean }): Promise<Chat[]> {
  const client = requireClient(accountId);
  let joinedChatsFetchFailed = false;

  const [messageBoxes, joinedChats, users] = await Promise.all([
    fetchMessageBoxesCached(accountId, client, { forChats: true }),
    client.fetchJoinedChats().catch((err) => {
      joinedChatsFetchFailed = true;
      log.warn({ accountId, err }, "fetchJoinedChats failed — preserving cached groups");
      return [] as Awaited<ReturnType<VylineClient["fetchJoinedChats"]>>;
    }),
    client.fetchUsers().catch((err) => {
      log.warn({ accountId, err }, "fetchUsers failed — skipping friends");
      return [] as Awaited<ReturnType<VylineClient["fetchUsers"]>>;
    }),
  ]);

  const groupByMid = new Map<
    string,
    { mid: string; name: string; raw?: Record<string, unknown> }
  >();
  for (const chat of joinedChats) {
    const raw = (chat as unknown as { raw?: Record<string, unknown> }).raw ?? {};
    groupByMid.set(chat.mid, { mid: chat.mid, name: chat.name, raw });

    // getChats(withMembers) で既に付いている memberMids をキャッシュへ
    try {
      const extra = raw.extra as { groupExtra?: { memberMids?: unknown } } | undefined;
      const mm = extra?.groupExtra?.memberMids;
      let memberMids: string[] = [];
      if (Array.isArray(mm)) memberMids = mm.map(String).filter((m) => m.startsWith("u"));
      else if (mm && typeof mm === "object") {
        memberMids = Object.keys(mm as Record<string, unknown>).filter((k) => k.startsWith("u"));
      }
      if (memberMids.length > 0) {
        const ps = String(raw.pictureStatus ?? raw.picturePath ?? "");
        const thumb = pictureStatusToUrl(ps);
        void vylinePutGroup(accountId, {
          chatMid: chat.mid,
          name: chat.name,
          ...(thumb ? { thumbnailUrl: thumb } : {}),
          memberMids,
          members: memberMids.map((mid) => ({ mid, displayName: mid })),
        });
      }
    } catch {
      /* optional */
    }
  }

  const userByMid = new Map<
    string,
    {
      mid: string;
      displayName: string;
      thumbnailUrl: string;
      userType?: number;
      statusMessage?: string;
    }
  >();
  for (const user of users) {
    const mid = user.mid;
    if (!mid) continue;
    const raw = user.raw as {
      targetProfileDetail?: {
        profileName?: string;
        pictureStatus?: string;
        statusMessage?: { text?: string } | string;
      };
      friendDetail?: { user?: { overriddenName?: string } };
      userType?: unknown;
    };
    const overriddenName = raw.friendDetail?.user?.overriddenName;
    const profileName = raw.targetProfileDetail?.profileName;
    const displayName = overriddenName || profileName || "(No Name)";
    const entry: {
      mid: string;
      displayName: string;
      thumbnailUrl: string;
      userType?: number;
      statusMessage?: string;
    } = {
      mid,
      displayName,
      thumbnailUrl: pictureStatusToUrl(raw.targetProfileDetail?.pictureStatus) ?? "",
    };
    const ut = userTypeToNum(raw.userType);
    if (ut != null) entry.userType = ut;
    const sm = raw.targetProfileDetail?.statusMessage;
    const smText = typeof sm === "string" ? sm : (sm as { text?: string } | undefined)?.text;
    if (smText) entry.statusMessage = smText;
    userByMid.set(mid, entry);
  }

  const activeBoxIds = new Set(messageBoxes.map((b: { id: string }) => b.id));
  const boxById = new Map(messageBoxes.map((b: { id: string }) => [b.id, b]));
  const seen = new Set<string>();
  const result: Chat[] = [];

  // Desktop 準拠: getMessageBoxes の返却順 = 最新メッセージ順（再ソートしない）
  for (const box of messageBoxes) {
    const chat = chatFromMessageBox(box, groupByMid, userByMid, !joinedChatsFetchFailed);
    seen.add(chat.mid);
    result.push(chat);
  }

  // メッセージ未送信のグループは末尾（時刻 0 → 名前順）
  const tail: Chat[] = [];
  for (const chat of joinedChats) {
    if (seen.has(chat.mid)) continue;
    const raw = (chat as unknown as { raw?: Record<string, unknown> }).raw ?? {};
    const ps = String(raw.pictureStatus ?? raw.picturePath ?? "");
    tail.push({
      mid: chat.mid,
      name: chat.name,
      hasMessages: activeBoxIds.has(chat.mid),
      kind: detectChatKind(chat.mid),
      lastMessageTime: 0,
      lastMessagePreview: "",
      thumbnailUrl: pictureStatusToUrl(ps) ?? "",
    });
    seen.add(chat.mid);
  }

  // 友だちでトーク未開始も末尾
  for (const user of users) {
    const mid = user.mid;
    if (!mid || seen.has(mid)) continue;
    const profile = userByMid.get(mid)!;
    tail.push({
      mid,
      name: profile.displayName,
      hasMessages: activeBoxIds.has(mid),
      kind: "direct",
      lastMessageTime: 0,
      lastMessagePreview: "",
      thumbnailUrl: profile.thumbnailUrl,
    });
    seen.add(mid);
  }

  tail.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  result.push(...tail);

  // 公式（BOT）判定: userByMid に無い直接トーク相手は getContactsV3 で userType を取得
  // （fetchUsers はユーザー友達のみで、公式/ボットは含まれない）
  const needType = result
    .filter((c) => c.kind === "direct" && c.mid.startsWith("u") && !userByMid.has(c.mid))
    .map((c) => c.mid)
    .slice(0, 60);
  if (needType.length) {
    for (let i = 0; i < needType.length; i += 10) {
      try {
        const res = await client.base.relation.getContactsV3({ mids: needType.slice(i, i + 10) });
        for (const r of res.responses ?? []) {
          const mid = String((r as { targetUserMid?: unknown }).targetUserMid);
          if (!mid) continue;
          const ut = userTypeToNum((r as { userType?: unknown }).userType);
          if (ut !== 2) continue;
          const c = result.find((x) => x.mid === mid);
          if (c) c.isOfficial = true;
        }
      } catch {
        /* 公式判定はベストエフォート */
      }
    }
  }

  // chatdb に同じ最終メッセージの復号済みプレビューがある場合は、
  // getMessageBoxes の E2EE プレースホルダで巻き戻さない。
  const storedPreviewChats = await getStoredChats(accountId);
  const storedByMid = new Map(storedPreviewChats.map((chat) => [chat.mid, chat]));
  for (const chat of result) {
    const stored = storedByMid.get(chat.mid);
    if (stored?.lastMessagePreview && shouldPreserveResolvedLastMessagePreview(stored, chat)) {
      chat.lastMessagePreview = stored.lastMessagePreview;
    }
  }

  // E2EE の最終メッセージは text が空。light=true でも履歴全体は読まず、
  // 各トークの最後の1件だけを有限バッチで復号して一覧プレビューを温める。
  // これを light で無効化すると「そのトークを開くまで暗号化メッセージ」のままになる。
  const toEnrich = result.filter((chat) => {
    if (!isUnresolvedLastMessagePreview(chat.lastMessagePreview)) return false;
    const box = boxById.get(chat.mid) as { lastMessages?: unknown[] } | undefined;
    const last = box?.lastMessages?.[0] as { chunks?: unknown[]; text?: string } | undefined;
    if (
      !Array.isArray(last?.chunks) ||
      last.chunks.length === 0 ||
      (typeof last.text === "string" && last.text.trim())
    ) {
      return false;
    }
    const cursor = chat.lastMessageId || String(chat.lastMessageTime || 0);
    const warmKey = `${accountId}:${chat.mid}:${cursor}`;
    return (chatPreviewWarmAttempts.get(warmKey) ?? 0) < CHAT_PREVIEW_WARM_MAX_ATTEMPTS;
  });
  for (const chat of toEnrich) {
    const cursor = chat.lastMessageId || String(chat.lastMessageTime || 0);
    const warmKey = `${accountId}:${chat.mid}:${cursor}`;
    chatPreviewWarmAttempts.set(warmKey, (chatPreviewWarmAttempts.get(warmKey) ?? 0) + 1);
  }

  // 一覧応答自体はブロックしない。4秒/12秒後の有限 refresh と次回 bootstrap が
  // この永続化結果を拾う。Promise.all 全件投げは避け、有限バッチで処理する。
  const previewBatchSize = opts?.light ? 6 : 8;
  if (toEnrich.length > 0) {
    void (async () => {
      try {
        try {
          await ensureE2EEIdentityCached(client, accountId);
        } catch {
          /* individual decrypt may still succeed */
        }
        const myMid = await resolveMyMid(client, accountId).catch(() => "");
        for (let i = 0; i < toEnrich.length; i += previewBatchSize) {
          const batch = toEnrich.slice(i, i + previewBatchSize);
          await Promise.all(
            batch.map(async (chat) => {
              const box = boxById.get(chat.mid) as { lastMessages?: unknown[] } | undefined;
              const last = box?.lastMessages?.[0] as any;
              if (!last) return;
              try {
                await ensureGroupE2EEKey(client, chat.mid);
                const dec = await decryptE2EEMessageSafe(client, accountId, chat.mid, last);
                const preview = previewFromBoxMessage(dec);
                if (!preview || isUnresolvedLastMessagePreview(preview)) return;
                const from = String((dec as { from?: unknown } | null | undefined)?.from ?? "");
                chat.lastMessagePreview = myMid && from === myMid ? `あなた: ${preview}` : preview;
              } catch {
                /* keep cached/fallback preview */
              }
            }),
          );
        }
        await upsertChats(
          accountId,
          result.map((c) => {
            const row: StoredChat = {
              mid: c.mid,
              name: c.name,
              kind: c.kind,
              hasMessages: c.hasMessages,
              updatedAt: new Date().toISOString(),
            };
            if (c.lastMessageTime) row.lastMessageTime = c.lastMessageTime;
            if (c.lastMessageId) row.lastMessageId = c.lastMessageId;
            if (c.lastMessagePreview) row.lastMessagePreview = c.lastMessagePreview;
            if (c.thumbnailUrl) row.thumbnailUrl = c.thumbnailUrl;
            if (c.unreadCount != null) row.unreadCount = c.unreadCount;
            if (c.isOfficial) row.isOfficial = true;
            return row;
          }),
        );
      } catch {
        /* プレビュー復号はベストエフォート */
      }
    })();
  }

  await upsertChats(
    accountId,
    result.map((c) => {
      const row: StoredChat = {
        mid: c.mid,
        name: c.name,
        kind: c.kind,
        hasMessages: c.hasMessages,
        updatedAt: new Date().toISOString(),
      };
      if (c.lastMessageTime) row.lastMessageTime = c.lastMessageTime;
      if (c.lastMessageId) row.lastMessageId = c.lastMessageId;
      if (c.lastMessagePreview) row.lastMessagePreview = c.lastMessagePreview;
      if (c.thumbnailUrl) row.thumbnailUrl = c.thumbnailUrl;
      if (c.unreadCount != null) row.unreadCount = c.unreadCount;
      if (c.isOfficial) row.isOfficial = true;
      return row;
    }),
    { boxOrder: messageBoxes.map((b: { id: string }) => String(b.id)) },
  );

  // VylineCache にも友達名・アイコンを載せる
  for (const user of users) {
    const mid = user.mid;
    if (!mid) continue;
    const u = userByMid.get(mid);
    if (u?.displayName) {
      void vylinePutProfile(accountId, {
        mid,
        displayName: u.displayName,
        thumbnailUrl: u.thumbnailUrl,
      });
    }
  }
  for (const chat of joinedChats) {
    const g = groupByMid.get(chat.mid);
    if (!g) continue;
    const ps = String(g.raw?.pictureStatus ?? g.raw?.picturePath ?? "");
    const thumb = pictureStatusToUrl(ps);
    const put: {
      chatMid: string;
      name: string;
      thumbnailUrl?: string;
      memberMids: string[];
      members: [];
    } = {
      chatMid: chat.mid,
      name: g.name || chat.mid,
      memberMids: [],
      members: [],
    };
    if (thumb) put.thumbnailUrl = thumb;
    void vylinePutGroup(accountId, put);
  }

  // 通常RPCに現れない復元済みチャットも一覧から消さない。
  // upsertChats は復元名・種別・最新履歴を保持するため、ここでディスク順を正本にして
  // live-only の left / official / profile 情報だけ重ねる。
  const storedChats = await getStoredChats(accountId);
  const liveByMid = new Map(result.map((chat) => [chat.mid, chat]));
  const mergedResult = storedChats.map((stored) => {
    const live = liveByMid.get(stored.mid);
    if (!live) return stored;
    const storedTime = stored.lastMessageTime ?? 0;
    const liveTime = live.lastMessageTime ?? 0;
    const useStoredLast = storedTime > liveTime;
    const liveNameIsFallback = !live.name || live.name === live.mid || live.name === "(No Name)";
    return {
      ...stored,
      ...live,
      name: liveNameIsFallback && stored.name ? stored.name : live.name,
      kind: live.kind === "unknown" ? stored.kind : live.kind,
      hasMessages: stored.hasMessages || live.hasMessages,
      lastMessageTime: Math.max(storedTime, liveTime),
      ...(useStoredLast && stored.lastMessageId
        ? { lastMessageId: stored.lastMessageId }
        : live.lastMessageId
          ? { lastMessageId: live.lastMessageId }
          : stored.lastMessageId
            ? { lastMessageId: stored.lastMessageId }
            : {}),
      ...(useStoredLast && stored.lastMessagePreview
        ? { lastMessagePreview: stored.lastMessagePreview }
        : live.lastMessagePreview
          ? { lastMessagePreview: live.lastMessagePreview }
          : stored.lastMessagePreview
            ? { lastMessagePreview: stored.lastMessagePreview }
            : {}),
      ...(stored.restoredHistory || live.restoredHistory ? { restoredHistory: true } : {}),
    };
  });

  log.debug(
    {
      accountId,
      count: mergedResult.length,
      activeBoxes: messageBoxes.length,
      friends: users.length,
      groups: joinedChats.length,
      restoredOnly: mergedResult.filter((chat) => !liveByMid.has(chat.mid)).length,
    },
    "chats fetched (desktop messageBox order + restored history)",
  );
  return mergedResult;
}

/** 復号済み Thrift メッセージ → API Message */
export function mapDecodedRawToMessage(msg: Record<string, unknown>, myMid: string): Message {
  const hasChunks = Array.isArray(msg.chunks) && msg.chunks.length > 0;
  const rawText = msg.text;
  const text = typeof rawText === "string" ? rawText : rawText == null ? null : String(rawText);
  const contentType = String(msg.contentType);
  const meta = normalizeContentMetadata(msg.contentMetadata);
  const failedE2EE = hasChunks && !text && (contentType === "NONE" || contentType === "0");

  let normalizedType = failedE2EE ? "E2EE_UNAVAILABLE" : contentType;
  let normalizedText = failedE2EE ? null : text;

  if (!failedE2EE) {
    const unsentMeta =
      Boolean(meta?.UNSENT) ||
      Boolean(meta?.UNSEND) ||
      String(meta?.REPLACE ?? "")
        .toUpperCase()
        .includes("UNSEND");
    const unsentEmpty =
      !text &&
      !hasChunks &&
      (contentType === "NONE" || contentType === "0") &&
      !meta?.STKID &&
      !meta?.OID &&
      !meta?.DOWNLOAD_URL &&
      !meta?.SID;
    if (unsentMeta || unsentEmpty) {
      normalizedType = "UNSENT";
      normalizedText = null;
    }
  }

  const readCount =
    msg.readCount != null && Number.isFinite(Number(msg.readCount))
      ? Number(msg.readCount)
      : (msg as Record<string, unknown>)[23] != null &&
          Number.isFinite(Number((msg as Record<string, unknown>)[23]))
        ? Number((msg as Record<string, unknown>)[23])
        : undefined;

  const out: Message = {
    id: String(msg.id),
    from: String(msg.from),
    to: String(msg.to),
    text: normalizedText,
    contentType: normalizedType,
    createdTime: Number(msg.createdTime),
    isMyMessage: String(msg.from) === myMid,
    contentMetadata: meta ?? null,
  };
  if (readCount != null) out.readCount = readCount;
  if (msg.relatedMessageId) out.relatedMessageId = String(msg.relatedMessageId);
  // 動くスタンプ: contentMetadata.STKOPT="A" で判定（animation URL の存在と一致）
  if (meta?.STKOPT === "A") out.stickerAnimated = true;
  // くっつきスタンプ: スタンプに位置固定マーカーがある場合（プロトコル未確定のため保守的に判定）
  if (
    meta?.STKSTICKER !== undefined ||
    meta?.STICKER_STICKY !== undefined ||
    meta?.STK_ATTACH !== undefined
  ) {
    out.stickerSticky = true;
  }

  // 絵文字リアクション（Thrift Reaction[] → 簡略形）
  if (Array.isArray(msg.reactions) && msg.reactions.length) {
    const reactions: MessageReaction[] = [];
    for (const r of msg.reactions as Array<Record<string, unknown>>) {
      const fromMid = String(r.fromUserMid ?? "");
      const rawType = (r.reactionType as Record<string, unknown> | undefined)
        ?.predefinedReactionType;
      const type = Number(rawType);
      if (!fromMid || !Number.isFinite(type)) continue;
      const at = Number(r.atMillis);
      reactions.push({
        fromMid,
        atMillis: Number.isFinite(at) ? at : Number(msg.createdTime),
        type,
      });
    }
    if (reactions.length) out.reactions = reactions;
  }
  return out;
}

function chatMidFromRaw(msg: Record<string, unknown>, myMid: string): string {
  const from = String(msg.from ?? "");
  const to = String(msg.to ?? "");
  if (to.startsWith("c") || to.startsWith("r")) return to;
  return from === myMid ? to : from;
}

/** チャット名をローカルキャッシュから解決（log 用・RPC はしない） */
const chatNameCache = new Map<string, { at: number; name: string | undefined }>();
const CHAT_NAME_CACHE_TTL_MS = 60_000;

async function resolveChatNameCached(
  accountId: string,
  chatMid: string,
): Promise<string | undefined> {
  const cached = chatNameCache.get(chatMid);
  if (cached && Date.now() - cached.at < CHAT_NAME_CACHE_TTL_MS) return cached.name;
  let name: string | undefined;
  try {
    const chats = await getStoredChats(accountId);
    const chat = chats.find((c) => c.mid === chatMid);
    if (chat?.name) name = chat.name;
    if (!name && (chatMid.startsWith("c") || chatMid.startsWith("r"))) {
      const group = await vylineGetGroup(accountId, chatMid);
      if (group?.name) name = group.name;
    }
  } catch {
    /* log は best-effort */
  }
  chatNameCache.set(chatMid, { at: Date.now(), name });
  return name;
}

/** Message → 詳細ログエントリ生成（メディア情報も含む） */
function buildMessageLogEntry(
  accountId: string,
  chatMid: string,
  message: Message,
  senderName?: string,
): MessageLogEntry {
  const meta = message.contentMetadata ?? {};
  const kind: "message" | "announcement" =
    message.contentType === "CHATEVENT" || meta.eventType ? "announcement" : "message";
  const media: MessageLogEntry["media"] | undefined = (() => {
    const t = message.contentType;
    if (t === "IMAGE" || t === "VIDEO" || t === "AUDIO" || t === "FILE") {
      return {
        contentType: t,
        mediaId: message.id,
        ...(meta.attachmentName ? { attachmentName: meta.attachmentName } : {}),
        ...(meta.DURATION ? { durationMillis: Number(meta.DURATION) } : {}),
        ...(meta.fileSize ? { fileSize: Number(meta.fileSize) } : {}),
      };
    }
    if (t === "STICKER") {
      return {
        contentType: t,
        ...(meta.STKID ? { stickerId: meta.STKID } : {}),
        ...(meta.STKPKGID ? { packageId: meta.STKPKGID } : {}),
      };
    }
    return undefined;
  })();
  return {
    ts: new Date(message.createdTime).toISOString(),
    tsMillis: message.createdTime,
    accountId,
    kind,
    direction: message.isMyMessage ? "out" : "in",
    chatMid,
    senderMid: message.from,
    ...(senderName ? { senderName } : {}),
    contentType: message.contentType,
    text: message.text,
    ...(media ? { media } : {}),
    ...(meta.eventType || message.contentType === "CHATEVENT"
      ? { locKey: meta.eventType ?? "CHATEVENT" }
      : {}),
  };
}

/** 非同期でチャット名解決 → ログ追記（失敗しても無視） */
function logMessageAsync(accountId: string, chatMid: string, message: Message): void {
  void (async () => {
    try {
      const name = await resolveChatNameCached(accountId, chatMid);
      appendMessageLog(buildMessageLogEntry(accountId, chatMid, message, name));
    } catch {
      /* best-effort */
    }
  })();
}

/** fetchOps で取得した Operation を全て処理してバッファへ流す */
export async function processFetchedOperations(
  accountId: string,
  ops: Array<{
    type?: string | number;
    param1?: string;
    param2?: string;
    param3?: string;
    message?: unknown;
    revision?: number | bigint;
  }>,
): Promise<void> {
  for (const op of ops) {
    try {
      await processSingleOperation(accountId, op);
    } catch (err) {
      log.debug({ accountId, err, opType: op.type }, "operation processing error");
    }
  }
}

async function processSingleOperation(
  accountId: string,
  op: {
    type?: string | number;
    param1?: string;
    param2?: string;
    param3?: string;
    message?: unknown;
    revision?: number | bigint;
  },
): Promise<void> {
  const client = requireClient(accountId);
  const myMid = await resolveMyMid(client, accountId);
  const type = String(op.type ?? "");

  // メッセージ系 — op.message があれば直接処理
  if (isReceiveMessageOperationType(type)) {
    if (op.message) {
      const raw = op.message as Record<string, unknown>;
      const chatMid = chatMidFromRaw(raw, myMid);
      let message = mapDecodedRawToMessage(raw, myMid);
      try {
        if (raw.contentMetadata && (raw.contentMetadata as Record<string, unknown>).e2eeVersion) {
          const decrypted = await decryptE2EEMessageSafe(client, accountId, chatMid, raw);
          if (decrypted) message = decrypted;
        }
      } catch {
        /* 復号失敗は平文のまま */
      }
      pushTalkEvent(accountId, { kind: "message", chatMid, message });
      invalidateBoxCursorCache(accountId, chatMid);
      await upsertMessages(accountId, chatMid, [
        { ...message, chatMid, savedAt: new Date().toISOString() },
      ]);
      logMessageAsync(accountId, chatMid, message);
      dispatchPluginMessage(accountId, {
        id: String(message.id),
        chatId: chatMid,
        authorId: String(message.from),
        text: typeof message.text === "string" ? message.text : null,
        contentType: String(message.contentType),
        createdAt: Number(message.createdTime),
      });
    }
    return;
  }

  // メッセージ取消
  if (
    type === "DESTROY_MESSAGE" ||
    type === "7" ||
    type === "NOTIFIED_DESTROY_MESSAGE" ||
    type === "8"
  ) {
    const messageId = String(op.param1 ?? "");
    const chatMid = String(op.param2 ?? "");
    if (messageId && /^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "revoke", chatMid, messageId });
      void markMessageRevoked(accountId, chatMid, messageId).catch(() => undefined);
    }
    return;
  }

  // 既読通知
  if (isReadOperationType(type)) {
    const chatMid = String(op.param1 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "read", chatMid });
    }
    return;
  }

  // リアクション
  if (
    type === "SEND_REACTION" ||
    type === "58" ||
    type === "NOTIFIED_SEND_REACTION" ||
    type === "55" ||
    type === "NOTIFIED_GCS_REACTION" ||
    type === "65" ||
    type === "48"
  ) {
    const messageId = String(op.param1 ?? "");
    const chatMid = String(op.param2 ?? "");
    if (messageId && /^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "reaction", chatMid, messageId });
    }
    return;
  }

  // 着信通話
  if (type === "NOTIFIED_RECEIVED_CALL" || type === "3") {
    const chatMid = String(op.param1 ?? "");
    const callerMid = String(op.param2 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, {
        kind: "call:incoming",
        chatMid,
        callerMid,
        callType: "audio",
      });
      log.info({ accountId, chatMid, callerMid }, "incoming call");
    }
    return;
  }

  // 通話キャンセル
  if (type === "NOTIFIED_CANCEL_CALL" || type === "NOTIFIED_MISSED_CALL" || type === "4") {
    const chatMid = String(op.param1 ?? "");
    const callerMid = String(op.param2 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "call:cancel", chatMid, callerMid });
    }
    return;
  }

  // 通話終了
  if (type === "NOTIFIED_CALL_STATUS" || type === "5") {
    const chatMid = String(op.param1 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "call:end", chatMid });
    }
    return;
  }

  // チャットメンバー変更（招待、参加、退出、キック）
  if (type === "NOTIFIED_INVITE_INTO_CHAT" || type === "33") {
    const chatMid = String(op.param1 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "membership", chatMid, event: "invited" });
    }
    return;
  }
  if (
    type === "NOTIFIED_ACCEPT_CHAT_INVITATION" ||
    type === "NOTIFIED_JOIN_CHAT" ||
    type === "35"
  ) {
    const chatMid = String(op.param1 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "membership", chatMid, event: "joined" });
    }
    return;
  }
  if (
    type === "NOTIFIED_LEAVE_CHAT" ||
    type === "32" ||
    type === "NOTIFIED_KICKOUT_FROM_CHAT" ||
    type === "34"
  ) {
    const chatMid = String(op.param1 ?? "");
    const targetMid = String(op.param2 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      const event = type === "NOTIFIED_KICKOUT_FROM_CHAT" || type === "34" ? "kicked" : "left";
      pushTalkEvent(accountId, { kind: "membership", chatMid, event, targetMid });
    }
    return;
  }

  // チャット情報更新（グループ名変更等）
  if (type === "NOTIFIED_UPDATE_CHAT" || type === "13") {
    const chatMid = String(op.param1 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "chat:update", chatMid });
    }
    return;
  }

  // アナウンス（CHATEVENT）
  if (type === "CHATEVENT_NOTIFIED_ANNOUNCE" || type === "NOTIFIED_UPDATE_CHAT_ROOM_ANNOUNCEMENT") {
    const chatMid = String(op.param1 ?? "");
    const text = String(op.param3 ?? op.param2 ?? "");
    if (/^[ucr]/.test(chatMid)) {
      pushTalkEvent(accountId, { kind: "announce", chatMid, text });
    }
    return;
  }
}

export function detachFetchOps(accountId: string): void {
  clearTalkEvents(accountId);
}

export function pollTalkEvents(
  accountId: string,
  cursor: number,
): { cursor: number; events: TalkPollEvent[]; reset: boolean; seq: number } {
  requireClient(accountId);
  return drainTalkEvents(accountId, cursor);
}

/** afterMessageId より新しいメッセージのみ（軽量 delta — 既読・鍵準備省略） */
export async function fetchMessagesSince(
  accountId: string,
  chatMid: string,
  afterMessageId: string,
  limit = 15,
): Promise<Message[]> {
  // ローカルキャッシュに新しければ RPC しない（Push を殺さない）
  try {
    const local = await getStoredMessages(accountId, chatMid, limit);
    const after = BigInt(afterMessageId);
    const newer = local.filter((m) => {
      try {
        return BigInt(m.id) > after;
      } catch {
        return false;
      }
    });
    if (newer.length > 0) return newer;
  } catch {
    /* fall through */
  }

  // delta は Push を切らず background キューで短タイムアウト
  return enqueueTalkRpcBackground(accountId, async () => {
    try {
      const batch = await fetchMessagesInner(accountId, chatMid, limit, {
        lite: true,
        delta: true,
        deltaAfterId: afterMessageId,
      });
      try {
        const after = BigInt(afterMessageId);
        // 新しいメッセージ + 既存メッセージへのリアクション更新（reactions を持つもの）を通す
        return batch.filter((m) => {
          try {
            if (BigInt(m.id) > after) return true;
          } catch {
            return true;
          }
          return (m.reactions?.length ?? 0) > 0;
        });
      } catch {
        return batch;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout =
        msg.includes("timed out") ||
        msg.includes("TimeoutError") ||
        (err instanceof Error && err.name === "TimeoutError");
      if (isTimeout) {
        log.debug({ accountId, chatMid, afterMessageId, err: msg }, "delta fetch timed out");
        return [];
      }
      throw err;
    }
  });
}

/** メッセージ履歴取得 (E2EE 対応)。before* 指定でより古いページを取得 */
export async function fetchMessages(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: {
    beforeMessageId?: string;
    beforeDeliveredTime?: number;
    lite?: boolean;
    delta?: boolean;
    force?: boolean;
    localOnly?: boolean;
  },
): Promise<Message[]> {
  const isPagination = Boolean(opts?.beforeMessageId);
  const isSpecial = opts?.lite || opts?.delta;

  if (opts?.localOnly) {
    const localOptions = {
      ...(opts.beforeMessageId ? { beforeMessageId: opts.beforeMessageId } : {}),
      ...(opts.beforeDeliveredTime != null
        ? { beforeDeliveredTime: opts.beforeDeliveredTime }
        : {}),
    };
    return getStoredMessages(accountId, chatMid, limit, localOptions);
  }

  if (!opts?.force && !isPagination && !isSpecial) {
    const local = await getStoredMessages(accountId, chatMid, limit);
    if (local.length > 0) {
      // local-first は本当に local-only にする。表示要求に便乗した履歴RPCは発火させない。
      // 新着は push / delta、明示同期は force 経路が担当する。
      return local;
    }
  }

  return runTalkFetchUrgent(accountId, () => fetchMessagesInner(accountId, chatMid, limit, opts));
}

async function fetchMessagesInner(
  accountId: string,
  chatMid: string,
  limit: number,
  opts?: {
    beforeMessageId?: string;
    beforeDeliveredTime?: number;
    lite?: boolean;
    delta?: boolean;
    /** delta 用: afterMessageId 既知の場合は getMessageBoxes を飛ばして合成カーソルで最新を取得 */
    deltaAfterId?: string;
  },
): Promise<Message[]> {
  const client = requireClient(accountId);
  const t0 = Date.now();
  const timings: string[] = [];
  const mark = (label: string) => timings.push(`${label}=${Date.now() - t0}ms`);

  // messageBoxId は通常 chatMid と同じ。ページング時は getMessageBoxes を省略して高速化
  let endMessageId: any;
  let boxId = chatMid;

  if (opts?.deltaAfterId) {
    // delta は「最新 N 件」を取得して after でフィルタするため、
    // getMessageBoxes によるカーソル解決を省略して合成カーソルで即座に取る（リアクション高速化）
    boxId = chatMid;
    endMessageId = {
      messageId: BigInt(Date.now()) * 1000n,
      deliveredTime: BigInt(Date.now()),
    };
  } else if (opts?.beforeMessageId) {
    endMessageId = {
      messageId: BigInt(opts.beforeMessageId),
      deliveredTime: BigInt(
        opts.beforeDeliveredTime != null && opts.beforeDeliveredTime > 0
          ? opts.beforeDeliveredTime
          : 0,
      ),
    };
  } else {
    const cacheKey = `${accountId}:${chatMid}`;
    const now = Date.now();
    const missAt = boxCursorMiss.get(cacheKey);
    if (missAt != null && now - missAt < BOX_CURSOR_MISS_MS) {
      // 最近空ボックスだった — getMessageBoxes をスキップして chatMid で合成カーソル
      boxId = chatMid;
      endMessageId = {
        messageId: BigInt(Date.now()) * 1000n,
        deliveredTime: BigInt(Date.now()),
      };
    } else {
      const cachedBox = boxCursorCache.get(cacheKey);
      if (cachedBox && now - cachedBox.at < BOX_CURSOR_CACHE_MS) {
        endMessageId = cachedBox.endMessageId;
        mark("boxCursorCache");
      } else {
        let messageBoxes: any[] = [];
        try {
          messageBoxes = await withTimeout(
            fetchMessageBoxesCached(accountId, client),
            MESSAGE_BOXES_TIMEOUT_MS,
            "getMessageBoxes",
          );
          mark("messageBoxes");
        } catch (err) {
          // getMessageBoxes が遅い/失敗しても表示を空にしない — chatMid を boxId にして最新を取る
          log.debug(
            { accountId, chatMid, err: err instanceof Error ? err.message : String(err) },
            "getMessageBoxes slow/failed — using chatMid as boxId",
          );
          messageBoxes = [];
        }
        const box = messageBoxes.find((b: { id: string }) => b.id === chatMid);
        if (box) {
          endMessageId = (box as { lastDeliveredMessageId?: unknown }).lastDeliveredMessageId;
          boxCursorCache.set(cacheKey, { at: now, endMessageId });
        } else {
          boxCursorMiss.set(cacheKey, now);
          const cached = await getStoredMessages(accountId, chatMid, limit);
          if (cached.length > 0) {
            log.debug({ accountId, chatMid, count: cached.length }, "messages from cache (no box)");
            return cached;
          }
          // box が無い/取得失敗でも chatMid を boxId にした合成カーソルで最新を取得（空表示を防ぐ）
          boxId = chatMid;
          endMessageId = {
            messageId: BigInt(Date.now()) * 1000n,
            deliveredTime: BigInt(Date.now()),
          };
        }
      }
    }
  }

  let rawMessages: unknown[];
  try {
    rawMessages = await fetchPreviousMessagesRpc(
      client,
      boxId,
      endMessageId,
      limit,
      opts?.delta ? DELTA_RPC_TIMEOUT_MS : TALK_FETCH_TIMEOUT_MS,
    );
    mark("rpc");
  } catch (err) {
    if (isTimeoutError(err)) {
      const cached = await getStoredMessages(accountId, chatMid, limit);
      if (cached.length > 0) {
        log.warn(
          { accountId, chatMid, count: cached.length },
          "message fetch timed out — returning cache",
        );
        return cached;
      }
    }
    throw err;
  }

  // E2EE 送受信に必要な profile / 自己鍵を先にロード
  const myMid = await resolveMyMid(client, accountId);
  const isGroupChat = chatMid.startsWith("c") || chatMid.startsWith("r");
  if (!opts?.lite) {
    try {
      await ensureE2EEIdentityCached(client, accountId);
    } catch (err) {
      log.warn({ accountId, err }, "E2EE identity ensure failed");
    }
  }

  if (!opts?.lite && !opts?.delta) {
    await ensureGroupE2EEKey(client, chatMid);
  }

  // Desktop/Android 準拠: 履歴 batch の groupKeyId を並列で用意（DM はスキップ）
  if (!opts?.lite && isGroupChat) {
    try {
      const prep = await prepareGroupKeysForMessages(client, chatMid, rawMessages as unknown[]);
      if (prep.prepared > 0 || prep.failed > 0) {
        log.info({ accountId, chatMid, ...prep }, "group e2ee keys prepared for message batch");
      }
    } catch (err) {
      log.warn({ accountId, chatMid, err }, "prepareGroupKeysForMessages failed");
    }
  }

  const decryptFailures: string[] = [];

  try {
    patchGroupKeyLookup(client);
  } catch {
    /* ignore */
  }

  if (!isGroupChat) {
    try {
      await prefetchDmPeerKeysForMessages(
        client,
        myMid,
        rawMessages as Array<{ from?: unknown; to?: unknown; chunks?: unknown[] }>,
      );
    } catch {
      /* optional */
    }
  }

  const decryptOne = async (msg: Record<string, unknown>) => {
    const hasChunks = Array.isArray(msg.chunks) && msg.chunks.length > 0;
    if (!hasChunks) return msg;

    try {
      const gk = groupKeyIdFromMessage(msg);
      if (gk != null && (chatMid.startsWith("c") || chatMid.startsWith("r"))) {
        await ensureGroupKeyById(client, chatMid, gk);
      }
    } catch {
      /* decrypt 側で失敗ログ */
    }

    try {
      return await decryptE2EEMessageSafe(client, accountId, chatMid, msg);
    } catch (err) {
      decryptFailures.push(String(msg.id));
      log.debug(
        {
          accountId,
          chatMid,
          msgId: String(msg.id),
          err: err instanceof Error ? err.message : String(err),
        },
        "decrypt failed",
      );
      return msg;
    }
  };

  const decoded = await Promise.all(
    (rawMessages as unknown as Record<string, unknown>[]).map((msg) => decryptOne(msg)),
  );

  if (decryptFailures.length > 0) {
    log.warn(
      { accountId, chatMid, count: decryptFailures.length },
      "some messages could not be decrypted",
    );
  }

  const messages: Message[] = decoded.map((msg) => mapDecodedRawToMessage(msg, myMid));

  // 既読: DM は seen、グループ/ルームは readCount + readBy（lite delta では省略）
  // getMessageReadRange は遅いのでメッセージ表示をブロックしない（キャッシュ即時適用 → 裏で更新）
  if (!opts?.lite && !opts?.delta) {
    try {
      const cacheDict = await readRangeStorage.load(accountId);
      const cached = cacheDict[chatMid]?.ranges ?? [];
      applyReadReceiptsToMessages(messages, cached, chatMid, myMid);
    } catch (err) {
      log.debug({ accountId, chatMid, err }, "attach cached read receipts failed");
    }
    const bgKey = `${accountId}:${chatMid}`;
    const bgNow = Date.now();
    const bgLast = readRangeBgAt.get(bgKey);
    if (bgLast == null || bgNow - bgLast > READ_RANGE_BG_MS) {
      readRangeBgAt.set(bgKey, bgNow);
      void (async () => {
        try {
          const ranges = await fetchReadRanges(accountId, chatMid, { force: true });
          applyReadReceiptsToMessages(messages, ranges, chatMid, myMid);
          // バックグラウンド取得結果も必ずアカウント別 chatdb に保存する。
          await upsertMessages(
            accountId,
            chatMid,
            messages.map((m) => ({ ...m, chatMid, savedAt: new Date().toISOString() })),
          );
          if (chatMid.startsWith("c") || chatMid.startsWith("r")) {
            const readerMids = new Set<string>();
            for (const m of messages) {
              for (const mid of m.readBy ?? []) readerMids.add(mid);
            }
            const memberMids = await fetchChatMemberMids(accountId, chatMid);
            for (const mid of memberMids) readerMids.add(mid);
            await Promise.allSettled(
              [...readerMids].slice(0, 40).map((mid) => fetchContactProfile(accountId, mid)),
            );
          }
        } catch (err) {
          log.debug({ accountId, chatMid, err }, "attach read receipts (bg) failed");
        }
      })();
    }
  }

  await upsertMessages(
    accountId,
    chatMid,
    messages.map((m) => ({ ...m, chatMid, savedAt: new Date().toISOString() })),
  );
  for (const m of messages) logMessageAsync(accountId, chatMid, m);

  // messageBox カーソル遅延で送信直後の行がネット結果に無いことがある。
  // upsert 済みローカルとマージした一覧を返す（表示から消えないように）。
  const merged = await getStoredMessages(accountId, chatMid, Math.max(limit, messages.length));
  const byId = new Map<string, Message>();
  for (const m of merged) byId.set(m.id, m);
  for (const m of messages) {
    const prev = byId.get(m.id);
    const combined = prev ? { ...prev, ...m } : m;
    if (prev?.history?.length && !combined.history?.length) {
      combined.history = prev.history;
    }
    byId.set(m.id, combined);
  }
  const out = [...byId.values()].sort(compareMessagesNewestFirst).slice(0, limit);

  log.debug(
    {
      accountId,
      chatMid,
      count: out.length,
      network: messages.length,
      before: opts?.beforeMessageId ?? null,
    },
    "messages fetched",
  );
  mark("done");
  log.info(
    { accountId, chatMid, timings: timings.join(" "), total: Date.now() - t0 },
    "TT-msg-fetch-timing",
  );
  return out;
}

export interface SendMessageOptions {
  /** 返信先メッセージ ID。指定すると LINE の「返信」機能として送られる (見た目だけの引用ではない) */
  relatedMessageId?: string;
  /** REPLACE（絵文字）等の本文置換メタデータ */
  contentMetadata?: Record<string, string>;
  /** ミュート（サイレント）送信: contentMetadata に NOTIFICATION_DISABLED="true" を付与 */
  mute?: boolean;
}

/**
 * メッセージ送信 (Letter Sealing E2EE 対応)。
 *
 * @vyline/protocol の encryptLetterSealingMessage で自前に暗号化した chunks を
 * 直接 sendMessage に渡す (プロトコルスタック標準の「e2ee:true を渡して内部で再帰的に
 * encrypt-then-resend する」実装には依存しない)。失敗した場合は sender key
 * ローテート → プレーンテキストの順にフォールバックする。
 */
function isSenderKeyError(errMsg: string): boolean {
  return errMsg.includes("E2EE_UPDATE_SENDER_KEY") || errMsg.includes("invalid sender key");
}

function isGroupKeyRecreateError(errMsg: string): boolean {
  return errMsg.includes("E2EE_RECREATE_GROUP_KEY") || errMsg.includes("old group key");
}

/** グループにまだ共有鍵が無い（初回 E2EE 送信前） */
function isMissingGroupKeyError(errMsg: string): boolean {
  const lower = errMsg.toLowerCase();
  return (
    errMsg.includes("no valid group key") ||
    (errMsg.includes("NOT_FOUND") &&
      (lower.includes("group key") ||
        lower.includes("groupsharedkey") ||
        lower.includes("e2eegroupsharedkey")))
  );
}

function isRetryPlainError(errMsg: string): boolean {
  const lower = errMsg.toLowerCase();
  return errMsg.includes("E2EE_RETRY_PLAIN") || lower.includes("member settings off");
}

/**
 * グループ宛送信前: 最新共有鍵を用意。無ければ新規 register。
 * （uploadMediaByE2EE / Letter Sealing は鍵無しだと NOT_FOUND で落ちる）
 */
async function ensureGroupKeyReadyForSend(
  client: NonNullable<ReturnType<typeof getClient>>,
  accountId: string,
  chatMid: string,
): Promise<void> {
  if (!(chatMid.startsWith("c") || chatMid.startsWith("r"))) return;

  groupKeyWarm.delete(chatMid);
  groupKeyWarmFailed.delete(chatMid);

  try {
    const last = await client.base.talk.getLastE2EEGroupSharedKey({
      keyVersion: 2,
      chatMid,
    });
    await ensureGroupKeyById(client, chatMid, Number(last.groupKeyId));
    groupKeyWarm.add(chatMid);
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isRetryPlainError(msg)) {
      noE2eePeers.add(chatMid);
      log.debug({ accountId, chatMid, err: msg }, "ensureGroupKeyReadyForSend: retry plain");
      return;
    }
    if (!isMissingGroupKeyError(msg)) {
      log.warn({ accountId, chatMid, err: msg }, "ensureGroupKeyReadyForSend: getLast failed");
      throw err;
    }
  }

  log.info({ accountId, chatMid }, "no group E2EE key — registering new shared key for send");
  await recreateE2EEGroupKey(client, chatMid);
  groupKeyWarm.delete(chatMid);
  groupKeyWarmFailed.delete(chatMid);
  groupKeyWarm.add(chatMid);
}

function isE2EESendError(errMsg: string): boolean {
  return (
    errMsg.includes("E2EE") ||
    errMsg.includes("BAD_DECRYPT") ||
    errMsg.includes("OPENSSL") ||
    errMsg.includes("Not support E2EE") ||
    errMsg.includes("NoE2EEKey") ||
    errMsg.includes("Invalid mid") ||
    errMsg.includes("invalid sender key")
  );
}

const noE2eePeers = new Set<string>();

function markNoE2eePeer(chatMid: string, errMsg: string): void {
  if (
    errMsg.includes("Not support E2EE") ||
    errMsg.includes("NoE2EEKey") ||
    errMsg.includes("E2EE_RETRY_PLAIN")
  ) {
    noE2eePeers.add(chatMid);
  }
}

async function rememberSentRaw(
  accountId: string,
  chatMid: string,
  myMid: string,
  sent: any,
): Promise<Message | null> {
  if (!sent || typeof sent !== "object") return null;
  try {
    const raw = sent as Record<string, unknown>;
    const message = mapDecodedRawToMessage(raw, myMid);
    await upsertMessages(accountId, chatMid, [
      { ...message, chatMid, savedAt: new Date().toISOString() },
    ]);
    logMessageAsync(accountId, chatMid, message);
    return message;
  } catch (err) {
    log.debug({ accountId, chatMid, err }, "rememberSentRaw failed");
    return null;
  }
}

export async function sendMessage(
  accountId: string,
  chatMid: string,
  text: string,
  opts: SendMessageOptions = {},
): Promise<Message | null> {
  await assertChatUnlocked(accountId, chatMid);
  // ブロック中の友だちには送信しない（サーバ側でも防ぐ）
  if (chatMid.startsWith("u")) {
    const blocked = await fetchBlockedContactIds(accountId);
    if (blocked.includes(chatMid)) {
      log.info({ accountId, chatMid }, "send blocked: user is blocked");
      return null;
    }
  }
  return runSendRpc(accountId, async () => {
    const client = requireClient(accountId);

    const myMid = await resolveMyMid(client, accountId);
    const isGroupLike = chatMid.startsWith("c") || chatMid.startsWith("r");
    let skipE2ee = noE2eePeers.has(chatMid);
    try {
      await ensureE2EEIdentityCached(client, accountId);
    } catch (err) {
      log.warn({ accountId, err }, "E2EE ensure before send failed");
    }

    if (isGroupLike && !skipE2ee) {
      try {
        // キャッシュを活かす: 既に warm 済みなら API をスキップ
        await ensureGroupE2EEKey(client, chatMid);
        // ensureGroupKeyReadyForSend は内部で groupKeyWarm をクリアするため、
        // warm 失敗時のみ（＝鍵不在時のみ）新規 register する
        if (groupKeyWarmFailed.has(chatMid)) {
          groupKeyWarmFailed.delete(chatMid);
          await ensureGroupKeyReadyForSend(client, accountId, chatMid);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("E2EE_RETRY_PLAIN")) {
          // サーバーが「このグループは E2EE 無効なので平文で送れ」と指示している。
          // ensureGroupKeyReadyForSend 内の register で例外になるため、ここで受けて
          // 平文パスへ落とす（以降このグループは noE2eePeers で E2EE をスキップ）。
          log.info(
            { accountId, chatMid, err: msg },
            "group E2EE disabled by server — sending plain",
          );
          skipE2ee = true;
        } else {
          throw err;
        }
      }
    }

    const relatedMessageId = opts.relatedMessageId;
    const relatedOpt = relatedMessageId ? { relatedMessageId } : {};

    // ミュート送信: NOTIFICATION_DISABLED="true" を contentMetadata に付与 (HAR 実値確認: 21 bytes)
    const baseContentMetadata: Record<string, string> = { ...opts.contentMetadata };
    if (opts.mute) {
      baseContentMetadata.NOTIFICATION_DISABLED = "true";
    }

    const tryE2eeSend = async () => {
      const envelope = await encryptLetterSealingMessage(client, {
        to: chatMid,
        from: myMid,
        contentType: LETTER_SEALING_CONTENT_TYPE.TEXT,
        payload: { text },
      });
      return client.base.talk.sendMessage({
        to: chatMid,
        contentType: "NONE",
        // REPLACE（絵文字）等のメタデータを E2EE エンベロープと併せて渡す（本文は暗号化済み、置換情報は平文）
        contentMetadata: { ...envelope.contentMetadata, ...baseContentMetadata },
        chunks: envelope.chunks,
        e2ee: true,
        ...relatedOpt,
      });
    };

    const finish = async (sent: unknown, e2ee: boolean): Promise<Message | null> => {
      invalidateMessageBoxesCache(accountId);
      invalidateBoxCursorCache(accountId, chatMid);
      chatsCache.delete(accountId);
      // plain 送信時 text が thrift 戻りに無いことがあるので補完
      if (sent && typeof sent === "object") {
        const raw = sent as Record<string, unknown>;
        if (raw.text == null && text) raw.text = text;
        if (relatedMessageId && !raw.relatedMessageId) raw.relatedMessageId = relatedMessageId;
      }
      const remembered = await rememberSentRaw(accountId, chatMid, myMid, sent);
      log.info(
        { accountId, chatMid, e2ee, relatedMessageId },
        e2ee ? "message sent" : "message sent (plain)",
      );
      return remembered;
    };

    if (skipE2ee) {
      const sent = await client.base.talk.sendMessage({
        to: chatMid,
        text,
        ...(Object.keys(baseContentMetadata).length > 0
          ? { contentMetadata: baseContentMetadata }
          : {}),
        e2ee: false,
        ...relatedOpt,
      });
      return await finish(sent, false);
    }

    try {
      const sent = await tryE2eeSend();
      return await finish(sent, true);
    } catch (err) {
      let errMsg = err instanceof Error ? err.message : String(err);
      markNoE2eePeer(chatMid, errMsg);

      if (isSenderKeyError(errMsg)) {
        log.warn(
          { accountId, chatMid, errMsg },
          "invalid sender key — rotating E2EE sender key and retrying",
        );
        try {
          const status = await ensureValidE2EEIdentity(client, {
            forceNewSenderKey: true,
          });
          log.info({ accountId, ...status }, "E2EE sender key rotated");
          const sent = await tryE2eeSend();
          return await finish(sent, true);
        } catch (retryErr) {
          log.warn(
            {
              accountId,
              chatMid,
              retryErr: retryErr instanceof Error ? retryErr.message : String(retryErr),
            },
            "e2ee send after sender-key rotate failed",
          );
          err = retryErr;
          errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          markNoE2eePeer(chatMid, errMsg);
        }
      }

      if (
        (isGroupKeyRecreateError(errMsg) || isMissingGroupKeyError(errMsg)) &&
        (chatMid.startsWith("c") || chatMid.startsWith("r"))
      ) {
        log.warn(
          { accountId, chatMid, errMsg },
          "old/missing group key — recreating E2EE group shared key and retrying",
        );
        try {
          await recreateE2EEGroupKey(client, chatMid);
          groupKeyWarm.delete(chatMid);
          groupKeyWarmFailed.delete(chatMid);
          const sent = await tryE2eeSend();
          return await finish(sent, true);
        } catch (retryErr) {
          log.warn(
            {
              accountId,
              chatMid,
              retryErr: retryErr instanceof Error ? retryErr.message : String(retryErr),
            },
            "e2ee send after group-key recreate failed",
          );
          err = retryErr;
          errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        }
      }

      const finalMsg = err instanceof Error ? err.message : String(err);
      markNoE2eePeer(chatMid, finalMsg);
      if (!isE2EESendError(finalMsg) && !isSenderKeyError(errMsg)) {
        throw err;
      }

      // グループ鍵再作成が必要なのに失敗した場合は plain に落とさない（暗号化ポリシー）
      if (
        isGroupKeyRecreateError(finalMsg) ||
        isGroupKeyRecreateError(errMsg) ||
        isMissingGroupKeyError(finalMsg) ||
        isMissingGroupKeyError(errMsg)
      ) {
        throw err;
      }

      log.warn({ accountId, chatMid, errMsg: finalMsg }, "e2ee send failed, retrying without e2ee");
      try {
        const sent = await client.base.talk.sendMessage({
          to: chatMid,
          text,
          ...(Object.keys(baseContentMetadata).length > 0
            ? { contentMetadata: baseContentMetadata }
            : {}),
          e2ee: false,
          ...relatedOpt,
        });
        return await finish(sent, false);
      } catch (plainErr) {
        log.error({ accountId, chatMid, plainErr, errMsg: finalMsg }, "plain send also failed");
        throw plainErr;
      }
    }
  });
}

export type MediaSendType = "image" | "video" | "audio" | "file" | "gif";
export type MediaSendSource = {
  path: string;
  sizeBytes: number;
};
export type MediaBatchItem = {
  path: string;
  sizeBytes: number;
  mimeType?: string;
  filename?: string;
  mediaType?: MediaSendType;
};

/** スクショ／画像など E2EE メディア送信 */
/** メディア送信は E2EE 鍵整備 + OBS アップロード + プレビューで時間がかかるため通常より長め */
const MEDIA_SEND_TIMEOUT_MS = 90_000;
const MEDIA_FLOW_REQSEQ = 1;
const mediaFlowCache = new Map<string, { flowMap: Record<string, number>; expiresAt: number }>();
const configuredMediaSendConcurrency = Number(process.env.VYLINE_MEDIA_SEND_CONCURRENCY ?? 1);
const MEDIA_SEND_CONCURRENCY = Number.isSafeInteger(configuredMediaSendConcurrency)
  ? Math.min(4, Math.max(1, configuredMediaSendConcurrency))
  : 1;
const MEDIA_SEND_QUEUE_MAX = 16;
const mediaSendQueue: Array<{
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}> = [];
let activeMediaSends = 0;

function drainMediaSendQueue(): void {
  while (activeMediaSends < MEDIA_SEND_CONCURRENCY) {
    const next = mediaSendQueue.shift();
    if (!next) return;
    activeMediaSends++;
    void next
      .run()
      .then(next.resolve, next.reject)
      .finally(() => {
        activeMediaSends--;
        drainMediaSendQueue();
      });
  }
}

function withMediaSendSlot<T>(run: () => Promise<T>): Promise<T> {
  if (mediaSendQueue.length >= MEDIA_SEND_QUEUE_MAX) {
    throw new MediaSendUploadError("media send queue is full; retry later", 409);
  }
  return new Promise<T>((resolve, reject) => {
    mediaSendQueue.push({
      run,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    drainMediaSendQueue();
  });
}

function openMediaSource(source: MediaSendSource, mimeType: string) {
  const file = Bun.file(source.path, { type: mimeType });
  if (file.size <= 0 || file.size !== source.sizeBytes) {
    throw new Error("staged media size changed before send");
  }
  return file;
}

function mediaContentTypeNumber(mediaType: MediaSendType): number {
  if (mediaType === "video") return 2;
  if (mediaType === "audio") return 3;
  if (mediaType === "file") return 14;
  return 1;
}

async function determinePlainMediaFlow(
  client: ReturnType<typeof requireClient>,
  accountId: string,
  chatMid: string,
  mediaTypes: MediaSendType[],
): Promise<boolean> {
  const now = Date.now();
  const cached = mediaFlowCache.get(chatMid);
  let flowMap = cached && cached.expiresAt > now ? cached.flowMap : undefined;
  if (!flowMap) {
    try {
      const res = await client.base.talk.determineMediaMessageFlow({
        request: { chatMid },
      });
      flowMap = Object.fromEntries(
        Object.entries(res.flowMap ?? {}).map(([key, value]) => [String(key), Number(value)]),
      );
      const ttl =
        typeof res.cacheTtlMillis === "bigint"
          ? Number(res.cacheTtlMillis)
          : Number(res.cacheTtlMillis ?? 0);
      mediaFlowCache.set(chatMid, {
        flowMap,
        expiresAt: now + Math.max(60_000, Math.min(ttl || 0, 6 * 60 * 60 * 1000)),
      });
      log.info({ accountId, chatMid, flowMap }, "media message flow determined");
    } catch (err) {
      log.warn(
        { accountId, chatMid, err: err instanceof Error ? err.message : String(err) },
        "determineMediaMessageFlow failed",
      );
      return false;
    }
  }
  return mediaTypes.every(
    (type) => flowMap[String(mediaContentTypeNumber(type))] === MEDIA_FLOW_REQSEQ,
  );
}

export async function sendMedia(
  accountId: string,
  chatMid: string,
  source: MediaSendSource,
  opts?: {
    mimeType?: string;
    filename?: string;
    mediaType?: MediaSendType;
  },
): Promise<void> {
  await assertChatUnlocked(accountId, chatMid);
  if (chatMid.startsWith("u")) {
    const blocked = await fetchBlockedContactIds(accountId);
    if (blocked.includes(chatMid)) {
      log.info({ accountId, chatMid }, "sendMedia blocked: user is blocked");
      return;
    }
  }
  return withMediaSendSlot(() =>
    runSendRpc(
      accountId,
      async (signal) => {
        if (!signal) throw new Error("media send abort signal unavailable");
        signal.throwIfAborted();
        const client = requireClient(accountId);
        await resolveMyMid(client, accountId);
        // テキスト送信と同じキャッシュ版を使い、送信ごとの E2EE 鍵再取得を避ける
        try {
          await ensureE2EEIdentityCached(client, accountId);
        } catch (err) {
          log.warn({ accountId, err }, "E2EE ensure before media send failed");
        }

        const mime = opts?.mimeType ?? "image/png";
        const mediaType: MediaSendType =
          opts?.mediaType ??
          (mime.startsWith("video/")
            ? "video"
            : mime.startsWith("audio/")
              ? "audio"
              : mime === "image/gif"
                ? "gif"
                : mime.startsWith("image/")
                  ? "image"
                  : "file");

        const blob = openMediaSource(source, mime);
        const sourceSize = blob.size;
        const filename =
          opts?.filename ??
          (mediaType === "image" || mediaType === "gif"
            ? `screenshot.${mime.includes("jpeg") ? "jpg" : "png"}`
            : "file.bin");

        // Desktop 準拠: REFRESH_MEDIA_FLOW を待たず、送信前にメディア flow を確認する。
        // flow=1 は OBS /r/talk/m/reqseq でサーバー側に message を作らせる。
        let plainMode =
          noE2eePeers.has(chatMid) ||
          (await determinePlainMediaFlow(client, accountId, chatMid, [mediaType]));

        // グループは既存の共有鍵があれば E2EE、無ければ plain（uploadObjTalk）で送る。
        // 鍵が無いのに勝手に新規登録すると本家クライアントと不整合になり画像が見えなくなるため、
        // 新規 register はしない（テキストは plain フォールバックで問題ない）
        if ((chatMid.startsWith("c") || chatMid.startsWith("r")) && !plainMode) {
          try {
            await ensureGroupE2EEKey(client, chatMid);
            if (groupKeyWarmFailed.has(chatMid)) {
              groupKeyWarmFailed.delete(chatMid);
              await ensureGroupKeyReadyForSend(client, accountId, chatMid);
            }
          } catch (err) {
            log.warn(
              { accountId, chatMid, err: err instanceof Error ? err.message : String(err) },
              "group E2EE key setup failed — sending media as plain",
            );
            plainMode = true;
          }
          plainMode = plainMode || noE2eePeers.has(chatMid);
        }

        const tryUpload = async () => {
          signal?.throwIfAborted();
          await client.base.obs.uploadMediaByE2EEFromFile({
            dataPath: source.path,
            size: source.sizeBytes,
            mimeType: mime,
            oType: mediaType,
            to: chatMid,
            filename,
            signal,
          });
        };

        const uploadPlain = async () => {
          // uploadObjTalk が talk 側のメッセージ作成まで面倒を見るため、sendMessage は呼ばない。
          const { objId, objHash } = await client.base.obs.uploadObjTalk(
            chatMid,
            mediaType,
            blob,
            undefined,
            filename,
            undefined,
            undefined,
            signal,
          );
          await importMediaStorageFile(accountId, chatMid, objId, source.path, mime);
          log.info(
            {
              accountId,
              chatMid,
              mediaType,
              size: sourceSize,
              plain: true,
              objId,
              objHash,
            },
            "media sent",
          );
        };

        try {
          if (plainMode) {
            // 平文チャットは E2EE メディアメッセージではなく raw OBS upload で送る。
            await uploadPlain();
            return;
          }
          await tryUpload();
          log.info({ accountId, chatMid, mediaType, size: sourceSize }, "media sent");
          return;
        } catch (err) {
          let errMsg = err instanceof Error ? err.message : String(err);

          if (isSenderKeyError(errMsg)) {
            log.warn(
              { accountId, chatMid, errMsg },
              "media send: invalid sender key — rotating and retrying",
            );
            try {
              await ensureValidE2EEIdentity(client, { forceNewSenderKey: true });
              await tryUpload();
              log.info(
                { accountId, chatMid, mediaType, size: sourceSize, rotated: true },
                "media sent",
              );
              return;
            } catch (retryErr) {
              err = retryErr;
              errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            }
          }

          if (
            (isGroupKeyRecreateError(errMsg) || isMissingGroupKeyError(errMsg)) &&
            (chatMid.startsWith("c") || chatMid.startsWith("r"))
          ) {
            log.warn(
              { accountId, chatMid, errMsg },
              "media send: old/missing group key — recreating and retrying",
            );
            try {
              await recreateE2EEGroupKey(client, chatMid);
              groupKeyWarm.delete(chatMid);
              groupKeyWarmFailed.delete(chatMid);
              await tryUpload();
              log.info(
                {
                  accountId,
                  chatMid,
                  mediaType,
                  size: sourceSize,
                  groupKeyRecreated: true,
                },
                "media sent",
              );
              return;
            } catch (retryErr) {
              err = retryErr;
              errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            }
          }

          if (isRetryPlainError(errMsg) || errMsg.includes("Not support E2EE")) {
            markNoE2eePeer(chatMid, errMsg);
            log.info({ accountId, chatMid, errMsg }, "media E2EE unsupported — using raw OBS");
            await uploadPlain();
            return;
          }

          throw err;
        }
      },
      { timeoutMs: MEDIA_SEND_TIMEOUT_MS, abortOnTimeout: true },
    ),
  );
}

export async function sendMediaBatch(
  accountId: string,
  chatMid: string,
  items: MediaBatchItem[],
): Promise<number> {
  await assertChatUnlocked(accountId, chatMid);
  if (chatMid.startsWith("u")) {
    const blocked = await fetchBlockedContactIds(accountId);
    if (blocked.includes(chatMid)) {
      log.info({ accountId, chatMid }, "sendMediaBatch blocked: user is blocked");
      return 0;
    }
  }

  return withMediaSendSlot(() =>
    runSendRpc(
      accountId,
      async (signal) => {
        if (!signal) throw new Error("media send abort signal unavailable");
        signal.throwIfAborted();
        const client = requireClient(accountId);
        await resolveMyMid(client, accountId);
        try {
          await ensureE2EEIdentityCached(client, accountId);
        } catch (err) {
          log.warn({ accountId, err }, "E2EE ensure before media batch send failed");
        }

        const batchMediaTypes = items.map((item) => {
          const mime = item.mimeType ?? "image/png";
          return (
            item.mediaType ??
            (mime.startsWith("video/")
              ? "video"
              : mime.startsWith("audio/")
                ? "audio"
                : mime === "image/gif"
                  ? "gif"
                  : mime.startsWith("image/")
                    ? "image"
                    : "file")
          );
        });
        let plainMode =
          noE2eePeers.has(chatMid) ||
          (await determinePlainMediaFlow(client, accountId, chatMid, batchMediaTypes));
        if ((chatMid.startsWith("c") || chatMid.startsWith("r")) && !plainMode) {
          try {
            await ensureGroupE2EEKey(client, chatMid);
            if (groupKeyWarmFailed.has(chatMid)) {
              groupKeyWarmFailed.delete(chatMid);
              await ensureGroupKeyReadyForSend(client, accountId, chatMid);
            }
          } catch (err) {
            log.warn(
              { accountId, chatMid, err: err instanceof Error ? err.message : String(err) },
              "group E2EE key setup failed — sending media batch as plain",
            );
            plainMode = true;
          }
          plainMode = plainMode || noE2eePeers.has(chatMid);
        }

        const uploadPlainBatch = async (): Promise<number> => {
          signal?.throwIfAborted();
          // Desktop 準拠: OBS /r/talk/m/reqseq に連番 reqseq でアップロードし、
          // サーバ側にメッセージを生成させる（HAR 実績と同じ経路）。
          // thrift sendMessage を併用すると flow=1 チャットでは履歴に載らないため
          // 失敗時のフォールバック送信も行わない（二重送信になる）。
          const uploaded = await client.base.obs.uploadObjTalkBatch(
            chatMid,
            items.map((item, idx) => ({
              type: (batchMediaTypes[idx] ?? "image") as Parameters<
                typeof client.base.obs.uploadObjTalk
              >[1],
              data: openMediaSource(item, item.mimeType ?? "image/png"),
              filename:
                item.filename ??
                ((item.mediaType ?? "image") === "image" ? "screenshot.png" : "file.bin"),
            })),
            signal,
          );
          // reqseq 生成メッセージは OBS から OID が取れないため、
          // アップロード応答の objId（== 生成メッセージID の実測）をキーに
          // 送信バイトを永続メディアストレージに置く。
          let count = 0;
          for (let i = 0; i < uploaded.length; i++) {
            const result = uploaded[i];
            if (!result || "error" in result) {
              log.warn(
                {
                  accountId,
                  chatMid,
                  index: i,
                  err: result && "error" in result ? String(result.error) : "no result",
                },
                "media batch item failed (partial success kept)",
              );
              continue;
            }
            count++;
            await importMediaStorageFile(
              accountId,
              chatMid,
              result.objId,
              items[i]!.path,
              items[i]!.mimeType ?? "image/png",
            );
          }
          log.info(
            {
              accountId,
              chatMid,
              count,
              total: items.length,
              batch: true,
              plain: true,
              reqseq: true,
            },
            "media batch sent via OBS reqseq",
          );
          return count;
        };

        if (plainMode) return await uploadPlainBatch();

        let count = 0;
        let previousMessageId: string | undefined;
        for (const item of items) {
          signal?.throwIfAborted();
          const mime = item.mimeType ?? "image/png";
          const mediaType: MediaSendType =
            item.mediaType ??
            (mime.startsWith("video/")
              ? "video"
              : mime.startsWith("audio/")
                ? "audio"
                : mime === "image/gif"
                  ? "gif"
                  : mime.startsWith("image/")
                    ? "image"
                    : "file");
          const blob = openMediaSource(item, mime);
          const sourceSize = blob.size;
          const filename =
            item.filename ??
            (mediaType === "image" || mediaType === "gif"
              ? `screenshot.${mime.includes("jpeg") ? "jpg" : "png"}`
              : "file.bin");

          const tryUpload = async () => {
            signal?.throwIfAborted();
            const message = await client.base.obs.uploadMediaByE2EEFromFile({
              dataPath: item.path,
              size: item.sizeBytes,
              mimeType: mime,
              oType: mediaType,
              to: chatMid,
              filename,
              signal,
              ...(previousMessageId
                ? {
                    relatedMessageId: previousMessageId,
                    messageRelationType: "SUBORDINATE",
                  }
                : {}),
            });
            previousMessageId = message.id;
            return message;
          };

          try {
            const message = await tryUpload();
            log.info(
              {
                accountId,
                chatMid,
                mediaType,
                size: sourceSize,
                batch: true,
                messageId: message.id,
                relatedMessageId: message.relatedMessageId,
                messageRelationType: message.messageRelationType,
              },
              "media batch item sent",
            );
            count++;
          } catch (err) {
            let errMsg = err instanceof Error ? err.message : String(err);

            if (isSenderKeyError(errMsg)) {
              log.warn(
                { accountId, chatMid, errMsg },
                "media batch send: invalid sender key — rotating and retrying",
              );
              try {
                await ensureValidE2EEIdentity(client, { forceNewSenderKey: true });
                const message = await tryUpload();
                previousMessageId = message.id;
                count++;
                continue;
              } catch (retryErr) {
                err = retryErr;
                errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              }
            }

            if (
              (isGroupKeyRecreateError(errMsg) || isMissingGroupKeyError(errMsg)) &&
              (chatMid.startsWith("c") || chatMid.startsWith("r"))
            ) {
              log.warn(
                { accountId, chatMid, errMsg },
                "media batch send: old/missing group key — recreating and retrying",
              );
              try {
                await recreateE2EEGroupKey(client, chatMid);
                groupKeyWarm.delete(chatMid);
                groupKeyWarmFailed.delete(chatMid);
                const message = await tryUpload();
                previousMessageId = message.id;
                count++;
                continue;
              } catch (retryErr) {
                err = retryErr;
                errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              }
            }

            if (count === 0 && (isRetryPlainError(errMsg) || errMsg.includes("Not support E2EE"))) {
              markNoE2eePeer(chatMid, errMsg);
              log.info(
                { accountId, chatMid, errMsg },
                "media batch E2EE unsupported — using raw OBS",
              );
              return await uploadPlainBatch();
            }

            // 部分成功をエラーメッセージに含める（リトライ時の二重送信防止のヒント）
            throw new Error(`media send failed after ${count} items: ${errMsg}`);
          }
        }

        return count;
      },
      {
        timeoutMs: Math.min(
          300_000,
          Math.max(MEDIA_SEND_TIMEOUT_MS, MEDIA_SEND_TIMEOUT_MS * items.length),
        ),
        abortOnTimeout: true,
      },
    ),
  );
}

/** スタンプ送信（所持パック / Premium）。E2EE 非対応相手は最初から plain */
export async function sendSticker(
  accountId: string,
  chatMid: string,
  opts?: { packageId?: string; stickerId?: string; isPremium?: boolean },
): Promise<Message | null> {
  await assertChatUnlocked(accountId, chatMid);
  if (chatMid.startsWith("u")) {
    const blocked = await fetchBlockedContactIds(accountId);
    if (blocked.includes(chatMid)) {
      log.info({ accountId, chatMid }, "sendSticker blocked: user is blocked");
      return null;
    }
  }
  return runSendRpc(accountId, async () =>
    sendStickerMessage(accountId, chatMid, async () => {
      const packageId = String(opts?.packageId ?? "11537");
      const stickerId = String(opts?.stickerId ?? "52002734");
      // Premium sticker: STKVER=100, 所持チェック不要
      const premium = Boolean(opts?.isPremium);
      const stkver = premium ? "100" : "1";
      const contentMetadata: Record<string, string> = {
        STKPKGID: packageId,
        STKID: stickerId,
        STKVER: stkver,
        STKTXT: "[スタンプ]",
      };
      if (premium) {
        contentMetadata.STKOPT = "A";
      }
      return {
        contentMetadata,
      };
    }),
  );
}

type CombinationStickerInput = {
  packageId: string;
  stickerId: string;
  x?: number;
  y?: number;
  size?: number;
};

/** frontend sticker-emoji-panel の正規座標空間 (COMBO_EDITOR_SIZE) と同期 */
const COMBO_EDITOR_SPACE = 240;

function buildCombinationStickerLayouts(items: CombinationStickerInput[]): {
  metadata: CombinationStickerMetadata;
  stickers: CombinationStickerStickerData[];
} {
  const canvasWidth = 512;
  const canvasHeight = 512;
  const count = Math.max(1, items.length);

  const toLayoutInfo = (index: number): CombinationStickerLayoutInfo => {
    const item = items[index];
    if (item?.x != null && item?.y != null && item?.size != null) {
      const scale = canvasWidth / COMBO_EDITOR_SPACE;
      const size = Math.max(40, Math.min(canvasWidth, Math.round(item.size * scale)));
      return {
        width: size,
        height: size,
        rotation: 0,
        x: Math.max(0, Math.min(canvasWidth - size, Math.round(item.x * scale))),
        y: Math.max(0, Math.min(canvasHeight - size, Math.round(item.y * scale))),
      };
    }
    switch (count) {
      case 1:
        return { width: 352, height: 352, rotation: 0, x: 80, y: 80 };
      case 2:
        return {
          width: 216,
          height: 216,
          rotation: 0,
          x: index === 0 ? 40 : 256,
          y: 148,
        };
      case 3:
        return index === 0
          ? { width: 240, height: 240, rotation: 0, x: 136, y: 20 }
          : {
              width: 200,
              height: 200,
              rotation: 0,
              x: index === 1 ? 44 : 268,
              y: 248,
            };
      case 4: {
        const col = index % 2;
        const row = Math.floor(index / 2);
        return { width: 192, height: 192, rotation: 0, x: 48 + col * 224, y: 48 + row * 224 };
      }
      case 5:
        if (index < 2) {
          return { width: 176, height: 176, rotation: 0, x: 68 + index * 204, y: 56 };
        }
        return { width: 160, height: 160, rotation: 0, x: 48 + (index - 2) * 148, y: 292 };
      case 6: {
        const col = index % 3;
        const row = Math.floor(index / 3);
        return {
          width: 140,
          height: 140,
          rotation: 0,
          x: 38 + col * 158,
          y: 86 + row * 168,
        };
      }
      default: {
        const cols = count <= 8 ? 3 : 4;
        const rows = Math.ceil(count / cols);
        const cellW = Math.floor((canvasWidth - 72) / cols);
        const cellH = Math.floor((canvasHeight - 72) / rows);
        const col = index % cols;
        const row = Math.floor(index / cols);
        const size = Math.min(cellW, cellH) - 10;
        return {
          width: size,
          height: size,
          rotation: 0,
          x: 36 + col * cellW + Math.floor((cellW - size) / 2),
          y: 36 + row * cellH + Math.floor((cellH - size) / 2),
        };
      }
    }
  };

  const metadata: CombinationStickerMetadata = {
    version: 1,
    canvasWidth,
    canvasHeight,
    stickerLayouts: items.map((item, index) => ({
      layoutInfo: toLayoutInfo(index),
      stickerInfo: {
        stickerId: Number(item.stickerId),
        productId: Number(item.packageId),
        stickerHash: "",
        stickerOptions: "",
        stickerVersion: 1,
      },
    })),
  };

  return {
    metadata,
    stickers: items.map((item) => ({
      packageId: item.packageId,
      stickerId: item.stickerId,
      version: 1,
    })),
  };
}

export async function canCreateCombinationSticker(
  accountId: string,
  packageIds: string[],
): Promise<{ canCreate: boolean; usablePackageIds: string[] }> {
  const client = requireClient(accountId);
  const shop = (
    client.base as unknown as {
      shop: {
        canCreateCombinationSticker: (input: {
          request: { packageIds: string[] };
        }) => Promise<{ canCreate: boolean; usablePackageIds: string[] }>;
      };
    }
  ).shop;
  return await shop.canCreateCombinationSticker({
    request: {
      packageIds,
    },
  });
}

export async function isStickerAvailableForCombinationSticker(
  accountId: string,
  packageId: string,
): Promise<{ availableForCombinationSticker: boolean }> {
  const client = requireClient(accountId);
  const shop = (
    client.base as unknown as {
      shop: {
        isStickerAvailableForCombinationSticker: (input: {
          request: { packageId: string };
        }) => Promise<{ availableForCombinationSticker: boolean }>;
      };
    }
  ).shop;
  return await shop.isStickerAvailableForCombinationSticker({
    request: {
      packageId,
    },
  });
}

export async function createCombinationSticker(
  accountId: string,
  items: CombinationStickerInput[],
  opts?: { idOfPreviousVersionOfCombinationSticker?: string },
): Promise<{ id: string }> {
  if (items.length === 0) {
    throw new Error("at least one sticker is required");
  }
  return await runSendRpc(accountId, async () => {
    return await createCombinationStickerCore(accountId, items, opts);
  });
}

async function createCombinationStickerCore(
  accountId: string,
  items: CombinationStickerInput[],
  opts?: { idOfPreviousVersionOfCombinationSticker?: string },
): Promise<{ id: string }> {
  const client = requireClient(accountId);
  const payload = buildCombinationStickerLayouts(items);
  const shop = (
    client.base as unknown as {
      shop: {
        createCombinationSticker: (input: {
          request: typeof payload & { idOfPreviousVersionOfCombinationSticker: string };
        }) => Promise<{ id: string | number | null | undefined }>;
      };
    }
  ).shop;
  const result = await shop.createCombinationSticker({
    request: {
      ...payload,
      idOfPreviousVersionOfCombinationSticker: opts?.idOfPreviousVersionOfCombinationSticker ?? "",
    },
  });
  return { id: String(result?.id ?? "") };
}

async function sendStickerMessage(
  accountId: string,
  chatMid: string,
  build: (
    client: ReturnType<typeof requireClient>,
    myMid: string,
  ) => Promise<{
    contentMetadata: Record<string, string>;
  }>,
): Promise<Message | null> {
  const client = requireClient(accountId);
  const myMid = await resolveMyMid(client, accountId);
  const built = await build(client, myMid);

  const sendPlain = async () =>
    client.base.talk.sendMessage({
      to: chatMid,
      contentType: "STICKER",
      contentMetadata: built.contentMetadata,
      e2ee: false,
    });

  let sent: unknown;
  if (noE2eePeers.has(chatMid)) {
    sent = await sendPlain();
  } else {
    try {
      await ensureE2EEIdentityCached(client, accountId);
      const envelope = await encryptLetterSealingMessage(client, {
        to: chatMid,
        from: myMid,
        contentType: 7, // STICKER
        payload: {},
      });
      sent = await client.base.talk.sendMessage({
        to: chatMid,
        contentType: "STICKER",
        contentMetadata: { ...built.contentMetadata, ...envelope.contentMetadata },
        chunks: envelope.chunks,
        e2ee: true,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      markNoE2eePeer(chatMid, errMsg);
      log.warn({ accountId, chatMid, errMsg }, "e2ee sticker send failed, trying plain");
      sent = await sendPlain();
    }
  }

  invalidateMessageBoxesCache(accountId);
  invalidateBoxCursorCache(accountId, chatMid);
  if (sent && typeof sent === "object") {
    const raw = sent as Record<string, unknown>;
    const meta = (raw.contentMetadata ?? {}) as Record<string, string>;
    raw.contentMetadata = { ...built.contentMetadata, ...meta };
    raw.contentType = raw.contentType ?? "STICKER";
  }
  const remembered = await rememberSentRaw(accountId, chatMid, myMid, sent);
  return remembered;
}

export async function sendCombinationSticker(
  accountId: string,
  chatMid: string,
  items: CombinationStickerInput[],
  opts?: { idOfPreviousVersionOfCombinationSticker?: string },
): Promise<Message | null> {
  await assertChatUnlocked(accountId, chatMid);
  if (chatMid.startsWith("u")) {
    const blocked = await fetchBlockedContactIds(accountId);
    if (blocked.includes(chatMid)) {
      log.info({ accountId, chatMid }, "sendCombinationSticker blocked: user is blocked");
      return null;
    }
  }
  if (!items.length) {
    throw new Error("at least one sticker is required");
  }
  return runSendRpc(accountId, async () => {
    const created = await createCombinationStickerCore(accountId, items, opts);
    const remembered = await sendStickerMessage(accountId, chatMid, async () => ({
      contentMetadata: { CSSTKID: created.id },
    }));
    const sentMeta = (remembered?.contentMetadata ?? null) as Record<string, unknown> | null;
    log.info(
      {
        accountId,
        chatMid,
        combinationStickerId: created.id,
        count: items.length,
        sentMetaKeys: sentMeta ? Object.keys(sentMeta) : null,
        sentMetaHasCsstk: typeof sentMeta?.CSSTKID === "string" && sentMeta.CSSTKID.length > 0,
      },
      "combination sticker sent",
    );
    return remembered;
  });
}

/** LINE 絵文字 (sticon) 送信 */
export async function sendLineEmoji(
  accountId: string,
  chatMid: string,
  opts: { packageId: string; sticonId: string },
): Promise<void> {
  await assertChatUnlocked(accountId, chatMid);
  if (chatMid.startsWith("u")) {
    const blocked = await fetchBlockedContactIds(accountId);
    if (blocked.includes(chatMid)) {
      log.info({ accountId, chatMid }, "sendLineEmoji blocked: user is blocked");
      return;
    }
  }
  return runSendRpc(accountId, async () => {
    const client = requireClient(accountId);
    const myMid = await resolveMyMid(client, accountId);
    const text = "\uFFFC";
    const replace = JSON.stringify({
      sticon: {
        resources: [
          {
            S: 0,
            E: 1,
            productId: opts.packageId,
            sticonId: opts.sticonId,
            version: 1,
            resourceType: "STATIC",
          },
        ],
      },
    });
    const contentMetadata: Record<string, string> = {
      REPLACE: replace,
      STICON_OWNERSHIP: JSON.stringify([opts.packageId]),
    };

    try {
      await ensureE2EEIdentityCached(client, accountId);
      const envelope = await encryptLetterSealingMessage(client, {
        to: chatMid,
        from: myMid,
        contentType: LETTER_SEALING_CONTENT_TYPE.TEXT,
        payload: { text },
      });
      await client.base.talk.sendMessage({
        to: chatMid,
        contentType: "NONE",
        text,
        contentMetadata: { ...contentMetadata, ...envelope.contentMetadata },
        chunks: envelope.chunks,
        e2ee: true,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn({ accountId, chatMid, errMsg }, "e2ee emoji send failed, trying plain");
      await client.base.talk.sendMessage({
        to: chatMid,
        text,
        contentMetadata,
        e2ee: false,
      });
    }
    log.info(
      { accountId, chatMid, packageId: opts.packageId, sticonId: opts.sticonId },
      "line emoji sent",
    );
  });
}

/** メッセージ送信取り消し */
export async function unsendMessage(accountId: string, messageId: string): Promise<void> {
  // 送信と同じキューで直列化（送信中と同時に H2 セッションを使うと取り消しが落ちることがある）
  return runSendRpc(accountId, async () => {
    const found = await findStoredMessageByIdLocal(accountId, messageId);
    if (!found) {
      throw new Error("MESSAGE_NOT_DESTRUCTIBLE: message timestamp unavailable");
    }
    const chatMid = found?.chatMid;
    if (chatMid) await assertChatUnlocked(accountId, chatMid);
    if (found) {
      const stored = found.message;
      if (
        stored.revokedSnapshot ||
        stored.messageState?.startsWith("revoked") ||
        stored.contentType === "UNSENT" ||
        stored.contentType === "UNSEND"
      ) {
        throw new Error("MESSAGE_ALREADY_REVOKED: this message was already unsent once");
      }
      const premium = await fetchPremiumStatus(accountId);
      if (!canUnsendMessage(stored.createdTime, premium.active)) {
        throw new Error("MESSAGE_NOT_DESTRUCTIBLE: message too old");
      }
    }
    const client = requireClient(accountId);
    await client.base.talk.unsendMessage({
      seq: await client.base.getReqseq(),
      messageId,
    });
    if (chatMid) {
      await markMessageRevoked(accountId, chatMid, messageId);
    }
    log.info({ accountId, messageId }, "message unsent");
  });
}

async function findStoredMessageByIdLocal(
  accountId: string,
  messageId: string,
): Promise<{
  chatMid: string;
  message: StoredMessage;
} | null> {
  return await findStoredMessageById(accountId, messageId);
}

/** メッセージ編集（Desktop: editMessage） */
export async function editMessage(
  accountId: string,
  chatMid: string,
  messageId: string,
  text: string,
): Promise<{ message: Message }> {
  await assertChatUnlocked(accountId, chatMid);
  return runSendRpc(accountId, async () => {
    const client = requireClient(accountId);
    const myMid = await resolveMyMid(client, accountId);
    let res: { message: unknown };
    try {
      res = await client.base.talk.editMessage({
        from: myMid,
        to: chatMid,
        messageId,
        text,
      });
    } catch (err: unknown) {
      const errStr = String(err);
      if (errStr.includes("NOT_PREMIUM") || errStr.includes("non-LYP subscriber")) {
        throw new Error(
          "メッセージ編集はLYPプレミアム会員限定の機能です（LINE仕様により副端末からの編集はLYP会員のみ許可されています）",
        );
      }
      if (errStr.includes("TOO_OLD") || errStr.includes("too old")) {
        throw new Error("メッセージの編集可能時間を過ぎています");
      }
      throw err;
    }
    const mapped = mapDecodedRawToMessage(res.message as unknown as Record<string, unknown>, myMid);
    await upsertMessages(accountId, chatMid, [
      { ...mapped, chatMid, savedAt: new Date().toISOString() },
    ]);
    try {
      logMessageAsync(accountId, chatMid, mapped);
    } catch (err) {
      log.debug({ err }, "logMessageAsync failed during editMessage");
    }
    log.info({ accountId, chatMid, messageId }, "message edited");
    return { message: mapped };
  });
}

/** 編集通知（Desktop: getMessageEditNotice） */
export async function getMessageEditNotice(
  accountId: string,
  chatMid: string,
): Promise<{ count: number; updatedTime: string }> {
  const client = requireClient(accountId);
  const res = await client.base.talk.getMessageEditNotice(chatMid);
  log.info({ accountId, chatMid, res }, "message edit notice");

  // Unix timestamp (ミリ秒想定) を ISO 文字列に変換
  const updatedTime =
    typeof res.updatedTime === "number"
      ? new Date(res.updatedTime).toISOString()
      : String(res.updatedTime);

  return {
    count: res.count,
    updatedTime,
  };
}

// ─── Profile / Chat admin / Contacts (domain facade) ───────────────────────
// Desktop: TalkService_updateProfileAttributes / updateChat / updateContactSetting

/** 自分プロフィール属性更新（表示名・ステメ等） */
export async function updateMyProfile(
  accountId: string,
  input: ProfileUpdateInput,
): Promise<LineProfile> {
  const client = requireClient(accountId);
  const session = wrapSession(client);

  // musicProfile は ANDROIDSECONDARY 等で "music profile update not allowed"
  // → 書き込みは行わずログのみ（取得・表示は fetchProfile 側）
  const { musicProfile, ...attrs } = input;
  if (musicProfile !== undefined) {
    log.info({ accountId }, "musicProfile write skipped (server rejects on this device type)");
  }

  const attrInput: ProfileUpdateInput = { ...attrs };
  if (Object.keys(attrInput).length > 0) {
    await session.profile.update(attrInput);
  }

  myMidCache.delete(accountId);
  myProfileCache.delete(accountId);
  log.info({ accountId, keys: Object.keys(input) }, "my profile updated");

  // getProfile がキュー渋滞で固まるのを避ける
  try {
    return await withTimeout(fetchProfile(accountId), 6_000, "fetchProfile.afterUpdate");
  } catch {
    return {
      mid: "",
      userid: "",
      displayName: input.displayName ?? "",
      phoneticName: input.phoneticName ?? "",
      pictureStatus: "",
      thumbnailUrl: "",
      statusMessage: input.statusMessage ?? "",
      picturePath: "",
      musicProfile: musicProfile ?? "",
      videoProfile: "",
      profileId: "",
    };
  }
}

/** 自分のアバター画像を OBS アップロード + ProfileAttribute.PICTURE 更新 */
export async function updateMyProfileImage(
  accountId: string,
  data: Blob,
): Promise<{ objId: string; objHash: string; profile: LineProfile }> {
  const client = requireClient(accountId);
  const session = wrapSession(client);
  const uploaded = await session.profile.uploadAvatar(data);
  myMidCache.delete(accountId);
  const profile = await fetchProfile(accountId);
  log.info({ accountId, objId: uploaded.objId }, "my profile image updated");
  return { ...uploaded, profile };
}

/** 自分のプロフィール背景 */
export async function updateMyProfileBackground(
  accountId: string,
  data: Blob,
): Promise<{ objId: string; objHash: string; backgroundUrl: string }> {
  const client = requireClient(accountId);
  const session = wrapSession(client);
  const uploaded = await session.profile.uploadBackground(data);
  log.info({ accountId, objId: uploaded.objId }, "my profile background updated");
  const backgroundUrl = backgroundObjToUrl(uploaded.objId) ?? "";
  // プロフィールキャッシュにも反映（起動直後に取れるように）
  const mid = client.base.profile?.mid;
  if (mid) {
    const mem = myProfileCache.get(accountId);
    const profile = mem?.profile;
    if (profile) {
      const next = { ...profile, backgroundUrl };
      myProfileCache.set(accountId, { at: Date.now(), profile: next });
      void vylinePutProfile(accountId, {
        mid,
        displayName: profile.displayName,
        statusMessage: profile.statusMessage,
        musicProfile: profile.musicProfile,
        phoneticName: profile.phoneticName,
        backgroundUrl,
      }).catch(() => undefined);
    }
  }
  return { ...uploaded, backgroundUrl };
}

/** グループ名変更 */
export async function updateChatName(
  accountId: string,
  chatMid: string,
  name: string,
): Promise<void> {
  await assertChatUnlocked(accountId, chatMid);
  const client = requireClient(accountId);
  await wrapSession(client).chat.updateName(chatMid, name);
  log.info({ accountId, chatMid, name }, "chat name updated");
}

/** グループ画像変更（OBS + updateChat PICTURE_STATUS） */
export async function updateChatPicture(
  accountId: string,
  chatMid: string,
  data: Blob,
): Promise<{ picturePath: string; objId: string; objHash: string }> {
  await assertChatUnlocked(accountId, chatMid);
  const client = requireClient(accountId);
  const result = await wrapSession(client).chat.uploadAndSetPicture(chatMid, data);
  log.info({ accountId, chatMid, picturePath: result.picturePath }, "chat picture updated");
  return result;
}

/** 友だち表示名 override（null で解除） */
export async function renameContact(accountId: string, input: ContactRenameInput): Promise<void> {
  await assertChatUnlocked(accountId, input.mid);
  const client = requireClient(accountId);
  await wrapSession(client).contacts.rename(input);
  log.info({ accountId, mid: input.mid }, "contact renamed");
  void vylinePutProfile(accountId, {
    mid: input.mid,
    displayName: input.displayNameOverride ?? input.mid,
  });
}

/** グループ退出 — Desktop: TalkService_deleteSelfFromChat */
export async function leaveChat(
  accountId: string,
  chatMid: string,
): Promise<{ alreadyLeft?: boolean }> {
  await assertChatUnlocked(accountId, chatMid);
  const client = requireClient(accountId);
  try {
    await client.base.talk.deleteSelfFromChat({
      request: { chatMid },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // キック済みなどで既にメンバーでない → 退出済みとして成功扱い
    if (msg.includes("NOT_A_MEMBER") || msg.includes("NOT_AUTHORIZED_DEVICE")) {
      groupProfileMiss.add(`${accountId}:${chatMid}`);
      invalidateMessageBoxesCache(accountId);
      chatsCache.delete(accountId);
      log.info({ accountId, chatMid }, "leaveChat: already not a member — treated as left");
      return { alreadyLeft: true };
    }
    // 空グループ（EMPTY_GROUP）も退出成功扱い
    if (msg.includes("EMPTY_GROUP") || msg.includes("empty group")) {
      groupProfileMiss.add(`${accountId}:${chatMid}`);
      invalidateMessageBoxesCache(accountId);
      chatsCache.delete(accountId);
      log.info({ accountId, chatMid }, "leaveChat: empty group — treated as left");
      return { alreadyLeft: true };
    }
    throw err;
  }
  groupProfileMiss.add(`${accountId}:${chatMid}`);
  invalidateMessageBoxesCache(accountId);
  chatsCache.delete(accountId);
  log.info({ accountId, chatMid }, "left chat");
  return {};
}

/** ブロックリスト — Desktop: TalkService_getBlockedContactIds */
const blockedCache = new Map<string, { at: number; ids: string[] }>();
const BLOCKED_CACHE_TTL_MS = Number(process.env.VYLINE_BLOCKED_CACHE_TTL_MS ?? 5 * 60_000);
const BLOCKED_RPC_TIMEOUT_MS = Number(process.env.VYLINE_BLOCKED_RPC_TIMEOUT_MS ?? 8_000);
const blockedInflight = new Map<string, Promise<string[]>>();

export async function fetchBlockedContactIds(accountId: string): Promise<string[]> {
  const cached = blockedCache.get(accountId);
  if (cached && Date.now() - cached.at < BLOCKED_CACHE_TTL_MS) return cached.ids;
  const inflight = blockedInflight.get(accountId);
  if (inflight) return inflight;
  const task = (async () => {
    try {
      const client = requireClient(accountId);
      const ids = await withTimeout(
        enqueueTalkRpcBackground(accountId, async () =>
          client.base.talk.getBlockedContactIds({ syncReason: "INTERNAL" }),
        ),
        BLOCKED_RPC_TIMEOUT_MS,
        "fetchBlockedContactIds",
      );
      const out = (ids ?? []).map(String);
      blockedCache.set(accountId, { at: Date.now(), ids: out });
      return out;
    } finally {
      blockedInflight.delete(accountId);
    }
  })();
  blockedInflight.set(accountId, task);
  return task;
}

export type BlockVerificationStatus = "blocked" | "not_blocked" | "skipped" | "unknown";

export type BlockVerificationResult = {
  mid: string;
  status: BlockVerificationStatus;
  reason: string;
  official: boolean;
};

const BLOCK_VERIFICATION_MIN_INTERVAL_MS = Number(
  process.env.VYLINE_BLOCK_VERIFICATION_MIN_INTERVAL_MS ?? 120_000,
);
const blockVerificationLastRun = new Map<string, number>();
const blockVerificationInflight = new Map<string, Promise<BlockVerificationResult[]>>();
const blockVerificationLastResults = new Map<string, BlockVerificationResult[]>();

function isOfficialUser(user: { raw?: unknown }): boolean {
  const userType = (user.raw as { userType?: unknown } | undefined)?.userType;
  return userType === 2 || userType === "BOT";
}

/**
 * Beta-only local verification. The sticker-shop check is a read-only gift
 * eligibility request; it never sends or purchases a sticker.
 */
export async function verifyFriendBlockStatus(
  accountId: string,
  targetMid?: string,
): Promise<BlockVerificationResult[]> {
  const inflight = blockVerificationInflight.get(accountId);
  if (inflight) return inflight;

  const now = Date.now();
  const lastRun = blockVerificationLastRun.get(accountId) ?? 0;
  if (now - lastRun < BLOCK_VERIFICATION_MIN_INTERVAL_MS) {
    const cached = blockVerificationLastResults.get(accountId) ?? [];
    if (!targetMid) return cached;
    return cached.filter((result) => result.mid === targetMid).length > 0
      ? cached.filter((result) => result.mid === targetMid)
      : [
          {
            mid: targetMid,
            status: "unknown",
            reason: "確認済み結果を再利用できません。2分後に再確認してください",
            official: false,
          },
        ];
  }

  // ponytail: one sequential list pass is sufficient; per-contact probing would add API load and no stronger evidence.
  const task: Promise<BlockVerificationResult[]> = (async () => {
    blockVerificationLastRun.set(accountId, Date.now());
    try {
      const client = requireClient(accountId);
      const users = await client.fetchUsers();
      const giftResults = await checkStickerGiftEligibility(accountId);
      const friend = users.find((user) => user.mid === targetMid);
      const storedChatByMid = new Map(
        (await getStoredChats(accountId)).map((chat) => [chat.mid, chat]),
      );

      if (targetMid && !friend) {
        return [
          { mid: targetMid, status: "skipped", reason: "not a current friend", official: false },
        ];
      }

      if (targetMid && friend && isOfficialUser(friend)) {
        return [
          {
            mid: targetMid,
            status: "skipped",
            reason: "official account is excluded",
            official: true,
          },
        ];
      }

      const candidates = targetMid
        ? friend && !isOfficialUser(friend)
          ? [friend]
          : []
        : users.filter((user) => !isOfficialUser(user));
      const results = candidates.map((user): BlockVerificationResult => {
        const raw = user.raw as {
          targetProfileDetail?: { profileName?: string; pictureStatus?: string };
          friendDetail?: { user?: { overriddenName?: string } };
          pictureStatus?: string;
        };
        const storedChat = storedChatByMid.get(user.mid);
        const names = new Set(
          [
            storedChat?.name,
            raw.friendDetail?.user?.overriddenName,
            raw.targetProfileDetail?.profileName,
          ].filter((name): name is string => Boolean(name)),
        );
        const pictureUrls = new Set(
          [
            storedChat?.thumbnailUrl,
            pictureStatusToUrl(raw.targetProfileDetail?.pictureStatus ?? raw.pictureStatus),
          ].filter((url): url is string => Boolean(url)),
        );
        const matches = giftResults.filter(
          (result) =>
            names.has(result.name) ||
            Boolean(result.pictureUrl && pictureUrls.has(result.pictureUrl)),
        );
        if (matches.length !== 1) {
          return {
            mid: user.mid,
            status: "unknown",
            reason:
              matches.length === 0
                ? `ギフト可否の対象プロフィールを特定できません（ショップ取得件数: ${giftResults.length}）`
                : "表示名が重複しているため特定できません",
            official: false,
          };
        }
        const gift = matches[0]!;
        const blocked = !gift.giftable && gift.code === 16646;
        return {
          mid: user.mid,
          status: gift.giftable ? "not_blocked" : blocked ? "blocked" : "unknown",
          reason: gift.giftable
            ? "スタンプをギフト可能"
            : blocked
              ? "スタンプをギフト不可（HAR の拒否コード 16646）"
              : `スタンプをギフト不可（理由コード ${gift.code ?? "不明"}）`,
          official: false,
        };
      });
      blockVerificationLastResults.set(accountId, results);
      return results;
    } catch (error) {
      if (targetMid) {
        return [
          {
            mid: targetMid,
            status: "unknown",
            reason: error instanceof Error ? error.message : String(error),
            official: false,
          },
        ];
      }
      throw error;
    } finally {
      blockVerificationInflight.delete(accountId);
    }
  })();
  blockVerificationInflight.set(accountId, task);
  return task;
}

export function invalidateBlockedCache(accountId: string): void {
  blockedCache.delete(accountId);
}

/** グループ作成 — Desktop: TalkService_createChat type=GROUP
 *  ABUSE_BLOCK 検知後は永続禁止（BAN リスク） */
export async function createGroupChat(
  accountId: string,
  name: string,
  memberMids: string[],
): Promise<{ chatMid: string; name: string }> {
  if (await isCreateGroupBanned(accountId)) {
    throw Object.assign(
      new Error("CREATE_GROUP_BANNED: group creation is permanently disabled after ABUSE_BLOCK"),
      {
        code: "CREATE_GROUP_BANNED",
      },
    );
  }

  const client = requireClient(accountId);
  const mids = [...new Set(memberMids.filter((m) => m.startsWith("u")))];
  if (mids.length === 0) throw new Error("memberMids required");

  try {
    const res = await client.base.talk.createChat({
      request: {
        reqSeq: await client.base.getReqseq(),
        type: "GROUP",
        name: name.trim() || "グループ",
        targetUserMids: mids,
        picturePath: "",
      },
    });
    const chat = res?.chat as { chatMid?: string; chatName?: string } | undefined;
    const chatMid = String(chat?.chatMid ?? "");
    if (!chatMid) throw new Error("createChat: no chatMid");
    invalidateMessageBoxesCache(accountId);
    chatsCache.delete(accountId);
    log.info({ accountId, chatMid, members: mids.length }, "group created");
    return { chatMid, name: String(chat?.chatName ?? name) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ABUSE_BLOCK")) {
      await banCreateGroup(accountId, msg);
      throw Object.assign(
        new Error(
          "CREATE_GROUP_BANNED: LINE returned ABUSE_BLOCK. Group creation is permanently disabled to avoid account ban.",
        ),
        { code: "CREATE_GROUP_BANNED", cause: err },
      );
    }
    throw err;
  }
}

/** グループ招待 — Desktop: TalkService_inviteIntoChat */
export async function inviteToGroupChat(
  accountId: string,
  chatMid: string,
  memberMids: string[],
): Promise<void> {
  await assertChatUnlocked(accountId, chatMid);
  const client = requireClient(accountId);
  const mids = [...new Set(memberMids.filter((m) => m.startsWith("u")))];
  if (mids.length === 0) throw new Error("memberMids required");
  await client.base.talk.inviteIntoChat({
    chatMid,
    targetUserMids: mids,
  });
  log.info({ accountId, chatMid, members: mids.length }, "invited to group");
}

/** 連絡先ブロック — Desktop: TalkService_blockContact */
export async function blockContactMid(accountId: string, mid: string): Promise<void> {
  await assertChatUnlocked(accountId, mid);
  const client = requireClient(accountId);
  await client.base.talk.blockContact({
    reqSeq: await client.base.getReqseq(),
    id: mid,
  });
  invalidateBlockedCache(accountId);
  log.info({ accountId, mid }, "contact blocked");
}

export async function unblockContactMid(accountId: string, mid: string): Promise<void> {
  await assertChatUnlocked(accountId, mid);
  const client = requireClient(accountId);
  await client.base.talk.unblockContact({
    reqSeq: await client.base.getReqseq(),
    id: mid,
  });
  invalidateBlockedCache(accountId);
  log.info({ accountId, mid }, "contact unblocked");
}

/**
 * モバイルプッシュ通知の有効/無効 — Desktop: TalkService_setNotificationsEnabled (type=USER)
 *
 * 加えて Settings.notificationEnable（マスタースイッチ）を同じ値に揃える。
 * これが OFF のままだと USER フラグを切り替えても端末に通知が届かない
 * （「有効化したのに効かない」の主因）。
 */
export async function setNotificationsEnabled(
  accountId: string,
  enablement: boolean,
): Promise<{ userFlag: boolean; masterEnable: boolean }> {
  const authService = require("../auth/mod.js").AuthService;
  await authService.tryRefreshToken(accountId);

  const client = requireClient(accountId);
  const mid = client.base.profile?.mid;
  if (!mid) throw new Error("self MID not found — login required");

  await client.base.talk.setNotificationsEnabled({
    reqSeq: await client.base.getReqseq(),
    type: 0,
    target: mid,
    enablement,
  });

  // マスタースイッチの整合
  let masterEnable = enablement;
  try {
    const settings = (await client.base.talk.getSettings({ syncReason: 0 })) as {
      notificationEnable?: boolean;
    };
    if ((settings.notificationEnable ?? true) !== enablement) {
      await client.base.talk.updateSettingsAttributes2({
        reqSeq: await client.base.getReqseq(),
        settings: { notificationEnable: enablement },
        attributesToUpdate: ["NOTIFICATION_ENABLE"],
      });
      log.info({ accountId, enablement }, "Settings.notificationEnable updated");
    } else {
      masterEnable = settings.notificationEnable ?? enablement;
    }
  } catch (err) {
    // マスタースイッチ更新の失敗は警告に留める（USER フラグは反映済み）
    log.warn(
      { accountId, err: err instanceof Error ? err.message : String(err) },
      "Settings.notificationEnable sync failed",
    );
  }

  log.info({ accountId, enablement }, "notificationsEnabled updated");
  return { userFlag: true, masterEnable };
}

/** react RPC は稀に 8s を超えるため専用タイムアウト（通常 15s） */
const REACT_RPC_TIMEOUT_MS = Number(process.env.VYLINE_REACT_RPC_TIMEOUT_MS ?? 15_000);

/** メッセージリアクション — Desktop: TalkService_react */
export async function reactToMessage(
  accountId: string,
  messageId: string,
  reaction: "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG" | "UNDO",
): Promise<void> {
  const found = await findStoredMessageByIdLocal(accountId, messageId);
  if (found) await assertChatUnlocked(accountId, found.chatMid);
  const client = requireClient(accountId);
  // react RPC は稀に 8s 超えるため send キュー + 専用タイムアウトで待つ
  await runSendRpc(
    accountId,
    () =>
      withTimeout(
        client.base.talk.react({
          id: BigInt(messageId),
          reaction,
        }),
        REACT_RPC_TIMEOUT_MS,
        "talk.react",
      ),
    { timeoutMs: REACT_RPC_TIMEOUT_MS + 5_000 },
  );
  log.info({ accountId, messageId, reaction }, "reacted");
}

/** チャットルームのアナウンス一覧 — Desktop: TalkService_getChatRoomAnnouncements */
export async function getChatAnnouncements(
  accountId: string,
  chatMid: string,
): Promise<
  Array<{
    announcementSeq: string;
    type: string;
    text: string;
    link: string;
    creatorMid: string;
    createdTime: number;
  }>
> {
  const client = requireClient(accountId);
  const res = await withTimeout(
    client.base.talk.getChatRoomAnnouncements({ chatRoomMid: chatMid }),
    12_000,
    "getChatRoomAnnouncements",
  );
  const list = (res ?? []) as unknown as Array<{
    announcementSeq: number | bigint;
    type?: number | string;
    contents?: { text?: string; link?: string };
    creatorMid?: string;
    createdTime?: number | bigint;
  }>;
  return list.map((a) => ({
    announcementSeq: String(a.announcementSeq),
    type: a.type === 0 || a.type === "MESSAGE" ? "MESSAGE" : String(a.type ?? "MESSAGE"),
    text: a.contents?.text ?? "",
    link: a.contents?.link ?? "",
    creatorMid: a.creatorMid ?? "",
    createdTime: a.createdTime ? Number(a.createdTime) : 0,
  }));
}

/** メッセージをアナウンスとしてピン留め — Desktop: TalkService_createChatRoomAnnouncement */
export async function announceMessage(
  accountId: string,
  chatMid: string,
  text: string,
  messageId?: string,
): Promise<{ announcementSeq: string }> {
  const client = requireClient(accountId);
  const link = messageId
    ? `line://nv/chatMsg?chatId=${chatMid}&messageId=${messageId}`
    : `line://nv/chat/${chatMid}`;
  const res = await runSendRpc(
    accountId,
    async () =>
      withTimeout(
        client.base.talk.createChatRoomAnnouncement({
          reqSeq: await client.base.getReqseq(),
          chatRoomMid: chatMid,
          type: "MESSAGE",
          contents: { text, link },
        }),
        30_000,
        "createChatRoomAnnouncement",
      ),
    { timeoutMs: 35_000 },
  );
  return { announcementSeq: String((res as { announcementSeq: number | bigint }).announcementSeq) };
}

/** アナウンスの解除（ピン解除）— Desktop: TalkService_removeChatRoomAnnouncement */
export async function removeChatAnnouncement(
  accountId: string,
  chatMid: string,
  announcementSeq: string | number,
): Promise<void> {
  const client = requireClient(accountId);
  await runSendRpc(
    accountId,
    async () =>
      withTimeout(
        client.base.talk.removeChatRoomAnnouncement({
          reqSeq: await client.base.getReqseq(),
          chatRoomMid: chatMid,
          announcementSeq: BigInt(announcementSeq),
        }),
        15_000,
        "removeChatRoomAnnouncement",
      ),
    { timeoutMs: 20_000 },
  );
  log.info({ accountId, chatMid, announcementSeq }, "chat announcement removed");
}

/** 初回インデックス: 上位チャットの履歴を chatdb に先読み */
export async function runAccountIndex(
  accountId: string,
  opts?: { topChats?: number; messagesPerChat?: number },
): Promise<{ chats: number; messages: number }> {
  const top = opts?.topChats ?? 20;
  const per = opts?.messagesPerChat ?? 40;
  const chats = await fetchChats(accountId, { light: true, refresh: true });
  let msgCount = 0;
  const targets = chats.slice(0, top);
  for (const c of targets) {
    try {
      const msgs = await fetchMessages(accountId, c.mid, per, { force: true, lite: true });
      msgCount += msgs.length;
    } catch (err) {
      log.debug({ accountId, chatMid: c.mid, err }, "index chat failed");
    }
  }
  // プロフィールも温める
  const mids = targets
    .map((c) => c.mid)
    .filter((m) => m.startsWith("u"))
    .slice(0, 80);
  if (mids.length) await fetchContactsBatch(accountId, mids);
  log.info({ accountId, chats: targets.length, messages: msgCount }, "account index done");
  return { chats: targets.length, messages: msgCount };
}

async function isBotMid(accountId: string, mid: string): Promise<boolean> {
  try {
    const client = requireClient(accountId);
    const contact = await client.base.talk.getContact({ mid });
    const t = String((contact as { type?: string | number })?.type ?? "");
    const u = t.toUpperCase();
    return (
      u.includes("BOT") ||
      u === "8" ||
      u === "PROMOTION_BOT" ||
      Boolean((contact as { buddyDetail?: unknown })?.buddyDetail)
    );
  } catch {
    return false;
  }
}

// ─── Call ──────────────────────────────────────────────────────────────────

function assertDirectCallAllowed(to: string): void {
  if (!isAllowedCallTarget(to)) {
    throw new CallNotAllowedError(callAllowlistHint());
  }
}

/** 1:1 通話開始（DM のみ + Planet/Andromeda フルセッション） */
export async function startDirectCall(
  accountId: string,
  to: string,
  callType: "AUDIO" | "VIDEO" = "AUDIO",
): Promise<import("../call/callManager.js").CallSessionSnapshot> {
  assertDirectCallAllowed(to);
  await assertChatUnlocked(accountId, to);
  if (await isBotMid(accountId, to)) {
    throw new CallNotAllowedError("BOT / 公式アカウントには通話できません");
  }
  const client = requireClient(accountId);
  const { startManagedCall } = await import("../call/callManager.js");
  const { getVylineProfile } = await import("../vyline/profileBridge.js");
  try {
    return await startManagedCall({
      accountId,
      client,
      to,
      kind: callType,
      desktopProfile: getVylineProfile(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("bot") || msg.includes("INVALID_MID")) {
      throw new CallNotAllowedError("BOT / 公式アカウントには通話できません");
    }
    throw err;
  }
}

export async function stopDirectCall(sessionId: string): Promise<void> {
  const { endManagedCall } = await import("../call/callManager.js");
  await endManagedCall(sessionId);
}

export async function getDirectCallStatus(
  sessionId: string,
): Promise<import("../call/callManager.js").CallSessionSnapshot | null> {
  const { getCallSnapshot } = await import("../call/callManager.js");
  return getCallSnapshot(sessionId);
}

export async function listDirectCalls(
  accountId: string,
): Promise<import("../call/callManager.js").CallSessionSnapshot[]> {
  const { listAccountCalls } = await import("../call/callManager.js");
  return listAccountCalls(accountId);
}

// acquireCallRoute_args:      { to, callType: "AUDIO"|"VIDEO", fromEnvInfo }
// acquireGroupCallRoute_args: { chatMid, mediaType: "AUDIO"|"VIDEO", isInitialHost, capabilities }

/** 1:1 通話ルート確保（デバッグ用。本番発信は startDirectCall） */
export async function acquireCallRoute(
  accountId: string,
  to: string,
  callType: "AUDIO" | "VIDEO" = "AUDIO",
): Promise<CallRoute> {
  assertDirectCallAllowed(to);
  const client = requireClient(accountId);
  const route = await client.call.acquireRoute({ to, callType });
  log.info({ accountId, to, callType }, "1:1 call route acquired");
  return route as unknown as CallRoute;
}

/** グループ通話ルート確保 */
export async function acquireGroupCallRoute(
  accountId: string,
  chatMid: string,
  callType: "AUDIO" | "VIDEO" = "AUDIO",
): Promise<CallRoute> {
  const client = requireClient(accountId);
  const route = await client.call.acquireGroupRoute({
    chatMid,
    mediaType: callType,
    isInitialHost: true,
    capabilities: [],
  } as never);
  log.info({ accountId, chatMid, callType }, "group call route acquired");
  return route as unknown as CallRoute;
}

export type GroupCallStatus = {
  online: boolean;
  chatMid: string;
  hostMid?: string;
  memberMids: string[];
  mediaType?: string;
  started?: number;
};

const groupCallStatusCache = new Map<string, { at: number; status: GroupCallStatus }>();
const GROUP_CALL_STATUS_CACHE_MS = 20_000;
const GROUP_CALL_RPC_TIMEOUT_MS = 10_000;

/**
 * グループ通話状態（CallService.getGroupCall）。
 * 失敗・タイムアウト・未通話は online=false を返す（通話中バッジ表示用）。
 */
export async function getGroupCallStatus(
  accountId: string,
  chatMid: string,
): Promise<GroupCallStatus> {
  const key = `${accountId}:${chatMid}`;
  const cached = groupCallStatusCache.get(key);
  if (cached && Date.now() - cached.at < GROUP_CALL_STATUS_CACHE_MS) {
    return cached.status;
  }
  const client = requireClient(accountId);
  const fallback: GroupCallStatus = {
    online: false,
    chatMid,
    memberMids: [],
  };
  try {
    const res = await withTimeout(
      client.call.getGroupCall(chatMid),
      GROUP_CALL_RPC_TIMEOUT_MS,
      "getGroupCall",
    );
    const gc = (res ?? {}) as {
      online?: boolean;
      chatMid?: string;
      hostMid?: string;
      memberMids?: unknown;
      mediaType?: unknown;
      started?: unknown;
    };
    const status: GroupCallStatus = {
      online: Boolean(gc.online),
      chatMid: String(gc.chatMid ?? chatMid),
      memberMids: Array.isArray(gc.memberMids) ? gc.memberMids.map(String) : [],
    };
    if (gc.hostMid) status.hostMid = String(gc.hostMid);
    if (gc.mediaType != null) status.mediaType = String(gc.mediaType);
    const started = gc.started != null ? Number(gc.started) : Number.NaN;
    if (Number.isFinite(started)) status.started = started;
    groupCallStatusCache.set(key, { at: Date.now(), status });
    return status;
  } catch (err) {
    log.debug({ accountId, chatMid, err }, "getGroupCall failed — offline");
    groupCallStatusCache.set(key, { at: Date.now(), status: fallback });
    return fallback;
  }
}

/** セッションログアウト時などに通話状態キャッシュを破棄 */
export function clearGroupCallStatus(accountId: string): void {
  for (const key of groupCallStatusCache.keys()) {
    if (key.startsWith(`${accountId}:`)) groupCallStatusCache.delete(key);
  }
}

const MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "FILE", "1", "2", "3", "14"]);
/** 一時的な OBS / 復号失敗の連打を抑える短期バックオフ（期限切れにはしない） */
const mediaFailedAt = new Map<string, number>();
const MEDIA_FAILURE_BACKOFF_MS = 30_000;
const MEDIA_FAILURE_MAX_ENTRIES = 2_048;
/** OBS ダウンロードがハングしないよう打ち切る（30s 固まり防止） */
const MEDIA_OBS_TIMEOUT_MS = Number(process.env.VYLINE_MEDIA_OBS_TIMEOUT_MS ?? 15_000);
/** プレビュー/RICHのようにバイト列が必要な応答だけに適用する固定RAM上限。 */
const MEDIA_BUFFERED_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;

function rememberMediaFailure(failureKey: string): void {
  mediaFailedAt.delete(failureKey);
  mediaFailedAt.set(failureKey, Date.now());
  while (mediaFailedAt.size > MEDIA_FAILURE_MAX_ENTRIES) {
    const oldest = mediaFailedAt.keys().next().value as string | undefined;
    if (oldest == null) break;
    mediaFailedAt.delete(oldest);
  }
}

/**
 * OBS からメッセージメディアのバイト列だけ取る。
 * プロトコルスタックの downloadMessageData は metadata.name 必須で落ちるため使わない。
 */
async function downloadObsMessageBytes(
  client: NonNullable<ReturnType<typeof getClient>>,
  messageId: string,
  preview: boolean,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_OBS_TIMEOUT_MS);
  try {
    const response = await downloadObsMessageResponse(
      client,
      messageId,
      controller.signal,
      preview,
    );
    return {
      bytes: await readResponseBytesBounded(response, MEDIA_BUFFERED_RESPONSE_MAX_BYTES),
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
        guessMediaMime(contentType),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Open an OBS body without converting it to Blob/ArrayBuffer. */
async function downloadObsMessageResponse(
  client: NonNullable<ReturnType<typeof getClient>>,
  messageId: string,
  signal: AbortSignal,
  preview = false,
): Promise<Response> {
  const base = client.base as unknown as {
    authToken?: string;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
    request?: { systemType?: string };
  };
  if (!base.authToken) throw new Error("not authenticated");
  return await vylineDownloadObsResponse(
    {
      authToken: base.authToken,
      systemType: base.request?.systemType ?? "",
      fetch: base.fetch.bind(base),
    },
    messageId,
    { preview, signal },
  );
}

/**
 * メディア元メッセージを履歴から探す（最近ページに限定・短時間）。
 * 古いメディアはローカル永続ストレージ / OBS 直取得に委ねる。
 */
async function findMediaSourceMessage(
  client: NonNullable<ReturnType<typeof getClient>>,
  chatMid: string,
  messageId: string,
  box: any,
): Promise<any | null> {
  let endId: bigint;
  try {
    endId = BigInt(messageId) + 1n;
  } catch {
    endId = BigInt(String(box?.lastDeliveredMessageId?.messageId ?? Date.now()));
  }

  let endMessageId: unknown = {
    messageId: endId,
    deliveredTime: BigInt(String(box?.lastDeliveredMessageId?.deliveredTime ?? Date.now())),
  };

  for (let page = 0; page < 5; page++) {
    const batch = (await withTimeout(
      client.base.talk.getPreviousMessagesV2WithRequest({
        request: {
          messageBoxId: (box.id as string) || chatMid,
          endMessageId: endMessageId as never,
          messagesCount: 50,
        },
      }) as Promise<unknown[]>,
      8_000,
      "findMediaSourceMessage",
    )) as unknown[];
    if (!Array.isArray(batch) || batch.length === 0) return null;

    const found = (batch as any[]).find((m) => String(m.id) === messageId);
    if (found) return found;

    const oldest = (batch as any[]).reduce((a, b) =>
      BigInt(String(a.id)) < BigInt(String(b.id)) ? a : b,
    );
    const oldestId = String(oldest.id);
    if (oldestId === messageId) return oldest;
    if (BigInt(oldestId) < BigInt(messageId)) return null;

    endMessageId = {
      messageId: BigInt(oldestId),
      deliveredTime: BigInt(String(oldest.createdTime ?? oldest.deliveredTime ?? 0)),
    };
  }
  return null;
}

/**
 * 画像/動画/音声/ファイルのバイト列を取得（OBS / E2EE）。
 * chatMid は E2EE メディア復号のために必要。
 */
/** RICH 等、OBS ではなく contentMetadata.DOWNLOAD_URL を持つメディアをタイムアウト付きで取得 */
async function downloadUrlBytes(
  url: string,
  fallbackMime = guessMediaMime("IMAGE"),
  ms = 20_000,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetchTrustedLineMediaDownloadUrl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
    const bytes = await readResponseBytesBounded(res, MEDIA_BUFFERED_RESPONSE_MAX_BYTES);
    const contentType = res.headers.get("content-type") || fallbackMime;
    return { bytes, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

function responseLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (raw == null) return undefined;
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

async function readResponseBytesBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = responseLength(response);
  if (declared != null && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`buffered media exceeds ${maxBytes} bytes`);
  }
  if (!response.body) throw new Error("media download returned empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`buffered media exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error("media download returned empty body");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function streamRemoteMediaToStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
  fallbackMime: string,
  timeoutMs: number,
  load: (signal: AbortSignal) => Promise<Response>,
): Promise<MediaStorageStat> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await load(controller.signal);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`media download failed: HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("media download returned empty body");
    const contentType =
      response.headers.get("content-type")?.split(";", 1)[0]?.trim() || fallbackMime;
    return await writeMediaStorageStream(
      accountId,
      chatMid,
      messageId,
      response.body,
      contentType,
      responseLength(response),
    );
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function streamE2eeMediaToStorage(
  client: ReturnType<typeof requireClient>,
  accountId: string,
  chatMid: string,
  messageId: string,
  message: Parameters<typeof client.base.obs.downloadMediaByE2EEToFile>[0],
  contentType: string,
): Promise<MediaStorageStat> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_OBS_TIMEOUT_MS);
  try {
    return await writeMediaStorageProducedFile(
      accountId,
      chatMid,
      messageId,
      contentType,
      async (temporaryPath, guard) => {
        const result = await client.base.obs.downloadMediaByE2EEToFile(
          message,
          temporaryPath,
          guard.maxBytes,
          controller.signal,
          guard.beforeWrite,
        );
        if (!result) throw new Error("E2EE media download returned no file");
        return result.size;
      },
    );
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Stream a confidently plain, original media body into saved-media. E2EE media
 * remains on fetchMessageMedia so its authenticated file decrypt path can run.
 */
export async function fetchPlainMessageMediaToStorage(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<MediaStorageStat | null> {
  let stored: Awaited<ReturnType<typeof findStoredMessageById>>;
  try {
    stored = await findStoredMessageById(accountId, messageId);
  } catch (error) {
    log.debug({ accountId, messageId, error }, "plain media local lookup failed");
    return null;
  }
  if (!stored || stored.chatMid !== chatMid) return null;

  const message = stored.message;
  const meta = (message.contentMetadata ?? {}) as Record<string, unknown>;
  if (meta.e2eeVersion || meta.keyMaterial) return null;

  const client = requireClient(accountId);
  const contentType = message.contentType || "IMAGE";
  const fallbackMime = guessMediaMime(contentType);
  const downloadUrl = typeof meta.DOWNLOAD_URL === "string" ? meta.DOWNLOAD_URL : undefined;
  if (downloadUrl) {
    try {
      return await streamRemoteMediaToStorage(
        accountId,
        chatMid,
        messageId,
        fallbackMime,
        20_000,
        (signal) => fetchTrustedLineMediaDownloadUrl(downloadUrl, { signal }),
      );
    } catch (error) {
      log.debug(
        { messageId, err: error instanceof Error ? error.message : String(error) },
        "streaming media download_url failed, falling back",
      );
      if (!MEDIA_TYPES.has(String(contentType))) return null;
    }
  }

  if (!MEDIA_TYPES.has(String(contentType))) return null;
  try {
    return await streamRemoteMediaToStorage(
      accountId,
      chatMid,
      messageId,
      fallbackMime,
      MEDIA_OBS_TIMEOUT_MS,
      (signal) => downloadObsMessageResponse(client, messageId, signal),
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (messageText.includes("404")) rememberMediaFailure(`${accountId}:${messageId}`);
    throw error;
  }
}

export type MessageMediaFetchResult =
  | { bytes: Uint8Array; contentType: string }
  | { stored: MediaStorageStat };

export async function fetchMessageMedia(
  accountId: string,
  chatMid: string,
  messageId: string,
  preview = true,
): Promise<MessageMediaFetchResult> {
  const client = requireClient(accountId);

  // 失敗直後だけ短期バックオフし、恒久的な再取得不能にはしない。
  const failureKey = `${accountId}:${messageId}`;
  const failedAt = mediaFailedAt.get(failureKey);
  if (failedAt != null) {
    if (Date.now() - failedAt < MEDIA_FAILURE_BACKOFF_MS) {
      throw new Error(`media temporarily unavailable (retry later): ${messageId}`);
    }
    mediaFailedAt.delete(failureKey);
  }

  // まずローカル履歴の contentMetadata（OID/SID）で OBS を試す — Push を切らない
  try {
    const cached = await getMessages(accountId, chatMid, 300);
    const hit = cached.find((m) => m.id === messageId);
    if (hit) {
      // RICH 等: OBS ではなく DOWNLOAD_URL を直接取得（OBS を叩くとハングする）
      const meta = (hit.contentMetadata ?? {}) as Record<string, unknown>;
      const dl = typeof meta.DOWNLOAD_URL === "string" ? meta.DOWNLOAD_URL : undefined;
      if (dl) {
        try {
          if (!preview) {
            return {
              stored: await streamRemoteMediaToStorage(
                accountId,
                chatMid,
                messageId,
                guessMediaMime(hit.contentType || "IMAGE"),
                20_000,
                (signal) => fetchTrustedLineMediaDownloadUrl(dl, { signal }),
              ),
            };
          }
          return await downloadUrlBytes(dl);
        } catch (err) {
          log.debug(
            { messageId, err: err instanceof Error ? err.message : String(err) },
            "media download_url failed, falling back",
          );
        }
      }
      const ct = hit.contentType || "IMAGE";
      // 平文 keyMaterial がある E2EE メディアは envelope 復号 / 履歴 RPC を飛ばして
      // OBS 直取得 + keyMaterial 復号（自送信メッセージなど chunks 無しでも即表示）
      if (meta.keyMaterial && meta.OID && meta.SID && (hit as { to?: string }).to) {
        try {
          return {
            stored: await streamE2eeMediaToStorage(
              client,
              accountId,
              chatMid,
              messageId,
              hit as unknown as Parameters<typeof client.base.obs.downloadMediaByE2EEToFile>[0],
              guessMediaMime(ct),
            ),
          };
        } catch (err) {
          log.debug(
            { messageId, err: err instanceof Error ? err.message : String(err) },
            "media keyMaterial fast path failed, falling back",
          );
        }
      }
      if ((!hit.contentMetadata || !(hit as { chunks?: unknown }).chunks) && !meta.keyMaterial) {
        try {
          if (!preview) {
            return {
              stored: await streamRemoteMediaToStorage(
                accountId,
                chatMid,
                messageId,
                guessMediaMime(ct),
                MEDIA_OBS_TIMEOUT_MS,
                (signal) => downloadObsMessageResponse(client, messageId, signal),
              ),
            };
          }
          return await withTimeout(
            downloadObsMessageBytes(client, messageId, preview, ct),
            MEDIA_OBS_TIMEOUT_MS,
            "obsDownload",
          );
        } catch {
          /* fall through to RPC path */
        }
      }
    }
  } catch {
    /* ignore */
  }

  return runTalkFetchUrgent(accountId, async () => {
    await ensureE2EEIdentityCached(client, accountId).catch(() => undefined);

    const boxes = await fetchMessageBoxesCached(accountId, client);
    const box = boxes.find((b: { id: string }) => b.id === chatMid);

    let endId: bigint;
    try {
      endId = BigInt(messageId) + 1n;
    } catch {
      endId = BigInt(Date.now()) * 1000n;
    }
    const boxOrSynthetic: any = box ?? {
      id: chatMid,
      lastDeliveredMessageId: {
        messageId: endId,
        deliveredTime: BigInt(Date.now()),
      },
    };

    let found: Awaited<ReturnType<typeof findMediaSourceMessage>> = null;
    try {
      found = await findMediaSourceMessage(client, chatMid, messageId, boxOrSynthetic);
    } catch (err) {
      log.debug(
        {
          chatMid,
          messageId,
          err: err instanceof Error ? err.message : String(err),
          hadBox: Boolean(box),
        },
        "findMediaSourceMessage failed, trying OBS",
      );
    }

    if (!found) {
      log.debug(
        { messageId, chatMid, hadBox: Boolean(box) },
        "media message not in history, trying OBS by id",
      );
      let fallbackCt = "IMAGE";
      try {
        const cached = await getMessages(accountId, chatMid, 200);
        const hit = cached.find((m) => m.id === messageId);
        if (hit?.contentType) fallbackCt = hit.contentType;
      } catch {
        /* ignore */
      }
      try {
        if (!preview) {
          return {
            stored: await streamRemoteMediaToStorage(
              accountId,
              chatMid,
              messageId,
              guessMediaMime(fallbackCt),
              MEDIA_OBS_TIMEOUT_MS,
              (signal) => downloadObsMessageResponse(client, messageId, signal),
            ),
          };
        }
        return await withTimeout(
          downloadObsMessageBytes(client, messageId, preview, fallbackCt),
          MEDIA_OBS_TIMEOUT_MS,
          "obsDownload",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 404 は期限切れ/削除 — 500 連打しない
        if (msg.includes("404")) {
          rememberMediaFailure(failureKey);
          throw new Error(`media expired or unavailable (OBS 404): ${messageId}`);
        }
        throw new Error(`message not found in history and OBS fallback failed: ${msg}`);
      }
    }

    // RICH 等: OBS ではなく DOWNLOAD_URL を直接取得（OBS を叩くとハングする）
    const foundMeta = (found.contentMetadata ?? {}) as Record<string, unknown>;
    const foundDl = typeof foundMeta.DOWNLOAD_URL === "string" ? foundMeta.DOWNLOAD_URL : undefined;
    if (foundDl) {
      try {
        if (!preview) {
          return {
            stored: await streamRemoteMediaToStorage(
              accountId,
              chatMid,
              messageId,
              guessMediaMime(String(found.contentType ?? "IMAGE")),
              20_000,
              (signal) => fetchTrustedLineMediaDownloadUrl(foundDl, { signal }),
            ),
          };
        }
        return await downloadUrlBytes(foundDl);
      } catch (err) {
        log.debug(
          { messageId, err: err instanceof Error ? err.message : String(err) },
          "media download_url (RPC path) failed, falling back",
        );
      }
    }

    const ct = String(found.contentType ?? "");
    if (!MEDIA_TYPES.has(ct)) throw new Error(`not a media message: ${ct}`);

    if (found.chunks?.length) {
      try {
        found = await decryptE2EEMessageSafe(client, accountId, chatMid, found);
      } catch (err) {
        log.debug(
          { messageId, chatMid, err: err instanceof Error ? err.message : String(err) },
          "media message decrypt before OBS failed",
        );
      }
    }

    const isGroupLike = chatMid.startsWith("c") || chatMid.startsWith("r");
    const gk = isGroupLike ? groupKeyIdFromMessage(found) : null;
    let groupKeyMissing = false;
    if (gk != null) {
      try {
        await ensureGroupKeyById(client, chatMid, gk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NOT_FOUND") || msg.includes("no valid group key")) {
          groupKeyMissing = true;
          log.debug({ chatMid, gk, err: msg }, "group key not found, will skip E2EE");
        }
      }
    }

    let e2eeFailed = false;

    const tryDownload = async (): Promise<MessageMediaFetchResult> => {
      // グループ鍵が無い場合はE2EE復号をスキップしてOBSに直行
      if (foundMeta.keyMaterial || (found.chunks && !groupKeyMissing)) {
        try {
          return {
            stored: await streamE2eeMediaToStorage(
              client,
              accountId,
              chatMid,
              messageId,
              found,
              guessMediaMime(ct),
            ),
          };
        } catch (err) {
          e2eeFailed = true;
          log.debug({ err, messageId }, "downloadMediaByE2EE failed, trying plain OBS");
          // A plaintext keyMaterial field proves the OBS object is encrypted.
          // Never persist authenticated-decryption failures as if they were originals.
          if (foundMeta.keyMaterial) throw err;
        }
      }

      if (!preview) {
        return {
          stored: await streamRemoteMediaToStorage(
            accountId,
            chatMid,
            messageId,
            guessMediaMime(ct),
            MEDIA_OBS_TIMEOUT_MS,
            (signal) => downloadObsMessageResponse(client, String(found.id), signal),
          ),
        };
      }
      return await withTimeout(
        downloadObsMessageBytes(client, String(found.id), preview, ct),
        MEDIA_OBS_TIMEOUT_MS,
        "obsDownload",
      );
    };

    try {
      return await tryDownload();
    } catch (err) {
      // E2EE に失敗していてグループ鍵がある場合のみ鍵クリアしてリトライ
      // プレーン OBS 失敗のみの場合はリトライ不要（サーバ側の問題）
      if (gk != null && e2eeFailed) {
        await client.base.storage.delete(`e2eeGroupKeys:${chatMid}`).catch(() => undefined);
        await client.base.storage.delete(`e2eeGroupKeys:${chatMid}:${gk}`).catch(() => undefined);
        groupKeyWarm.delete(chatMid);
        groupKeyWarmFailed.delete(chatMid);
        await ensureGroupKeyById(client, chatMid, gk);
        return await tryDownload();
      }
      rememberMediaFailure(failureKey);
      throw err;
    }
  });
}

function guessMediaMime(contentType: string): string {
  switch (String(contentType)) {
    case "IMAGE":
    case "1":
      return "image/jpeg";
    case "VIDEO":
    case "2":
      return "video/mp4";
    case "AUDIO":
    case "3":
      return "audio/m4a";
    default:
      return "application/octet-stream";
  }
}

// ─── Stickers / LINE emoji (sticon) catalog ───────────────────────────────

export type CatalogStickerItem = {
  id: string;
  url: string;
  alt?: string;
  /** 動くスタンプ（パック単位で判定） */
  animated?: boolean;
};

export type CatalogPack = {
  packageId: string;
  name: string;
  type: "sticker" | "emoji";
  tabUrl: string;
  items: CatalogStickerItem[];
};

export type StickersCatalog = {
  premium: {
    active: boolean;
    planType?: string | number;
    validUntil?: number;
    onFreeTrial?: boolean;
    willExpire?: boolean;
  };
  stickerPacks: CatalogPack[];
  emojiPacks: CatalogPack[];
};

const DEFAULT_STICKER_PACKS = ["11537", "11538", "11539"];
const DEFAULT_EMOJI_PACKS = ["5ac1bfd5040ab15980c9b435"];

type StickerMeta = {
  packageId?: number | string;
  title?: Record<string, string> | string;
  stickers?: Array<{ id: number | string }>;
  hasAnimation?: boolean;
};

type SticonMeta = {
  productId?: string;
  orders?: Array<string | number>;
  altTexts?: Record<string, string>;
};

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function packTitle(title: StickerMeta["title"], fallback: string): string {
  if (!title) return fallback;
  if (typeof title === "string") return title;
  return title.ja || title.en || Object.values(title)[0] || fallback;
}

const packMetaCache = new Map<string, { data: CatalogPack | null; at: number }>();
const PACK_META_TTL = 3_600_000; // 1h
const PACK_META_MAX_ENTRIES = 128;

function readPackMetaCache(key: string): CatalogPack | null | undefined {
  const cached = packMetaCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.at >= PACK_META_TTL) {
    packMetaCache.delete(key);
    return undefined;
  }
  packMetaCache.delete(key);
  packMetaCache.set(key, cached);
  return cached.data;
}

function writePackMetaCache(key: string, data: CatalogPack | null): void {
  packMetaCache.delete(key);
  packMetaCache.set(key, { data, at: Date.now() });
  while (packMetaCache.size > PACK_META_MAX_ENTRIES) {
    const oldest = packMetaCache.keys().next().value as string | undefined;
    if (oldest == null) break;
    packMetaCache.delete(oldest);
  }
}

async function loadStickerPack(packageId: string): Promise<CatalogPack | null> {
  const cacheKey = `stk:${packageId}`;
  const cached = readPackMetaCache(cacheKey);
  if (cached !== undefined) return cached;
  const meta = await fetchJsonSafe<StickerMeta>(
    `https://stickershop.line-scdn.net/stickershop/v1/product/${packageId}/android/productInfo.meta`,
  );
  if (!meta?.stickers?.length) {
    writePackMetaCache(cacheKey, null);
    return null;
  }
  const animated = Boolean(meta.hasAnimation);
  const result: CatalogPack = {
    packageId: String(meta.packageId ?? packageId),
    name: packTitle(meta.title, `スタンプ ${packageId}`),
    type: "sticker",
    tabUrl: `https://stickershop.line-scdn.net/stickershop/v1/sticker/${meta.stickers[0]!.id}/android/sticker.png`,
    items: meta.stickers.map((s) => {
      const id = String(s.id);
      return {
        id,
        url: animated
          ? `https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/ANDROID/sticker_animation.png`
          : `https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/android/sticker.png`,
        animated,
      };
    }),
  };
  writePackMetaCache(cacheKey, result);
  return result;
}

async function loadEmojiPack(packageId: string): Promise<CatalogPack | null> {
  const cacheKey = `emoji:${packageId}`;
  const cached = readPackMetaCache(cacheKey);
  if (cached !== undefined) return cached;
  const meta = await fetchJsonSafe<SticonMeta>(
    `https://stickershop.line-scdn.net/sticonshop/v1/sticon/${packageId}/ANDROID/meta.json`,
  );
  if (!meta?.orders?.length) {
    writePackMetaCache(cacheKey, null);
    return null;
  }
  const first = String(meta.orders[0]);
  const result: CatalogPack = {
    packageId: String(meta.productId ?? packageId),
    name: `絵文字 ${String(meta.productId ?? packageId).slice(0, 8)}`,
    type: "emoji",
    tabUrl: `https://stickershop.line-scdn.net/sticonshop/v1/sticon/${packageId}/android/${first}.png`,
    items: meta.orders.map((oid) => {
      const id = String(oid);
      const alt = meta.altTexts?.[id];
      const item: CatalogStickerItem = {
        id,
        url: `https://stickershop.line-scdn.net/sticonshop/v1/sticon/${packageId}/android/${id}.png`,
      };
      if (alt) item.alt = alt;
      return item;
    }),
  };
  writePackMetaCache(cacheKey, result);
  return result;
}

async function listOwnedPackageIds(
  client: NonNullable<ReturnType<typeof getClient>>,
  shopId: string,
): Promise<string[]> {
  const locale = { language: "ja", country: "JP" };
  const ids: string[] = [];
  const PAGE = 100;

  // getOwnedProductSummaries をページネーションで全件取得
  try {
    let offset = 0;
    let totalSize = Number.POSITIVE_INFINITY;
    while (offset < totalSize) {
      const owned = (await client.base.request.request(
        LINEStruct.getOwnedProductSummaries_args({
          shopId,
          offset,
          limit: PAGE,
          locale,
          request: {} as never,
        }),
        "getOwnedProductSummaries",
        4,
        true,
        "/TSHOP4",
      )) as Record<string, unknown>;

      // ProductSummaryList: { productList, totalSize, offset }
      // sticon の場合は sticonList に格納
      let list: Array<{ id?: string }> = [];
      const candidates = [
        (owned as Record<string, unknown>)?.productList,
        (owned as Record<string, unknown>)?.products,
        (owned as Record<string, unknown>)?.productSummaries,
        (owned as Record<string, unknown>)?.sticonList,
        ((owned as Record<string, unknown>)?.result as Record<string, unknown>)?.productList,
        ((owned as Record<string, unknown>)?.result as Record<string, unknown>)?.products,
      ];
      for (const c of candidates) {
        if (Array.isArray(c) && c.length > 0) {
          list = c as Array<{ id?: string }>;
          break;
        }
      }
      for (const p of list) {
        const id = String(p?.id ?? "");
        if (id && !ids.includes(id)) ids.push(id);
      }
      totalSize = Number((owned as Record<string, unknown>)?.totalSize ?? 0);
      if (list.length < PAGE) break;
      offset += PAGE;
      if (offset >= 1000) break; // safety cap
    }
    log.debug({ shopId, count: ids.length }, "getOwnedProductSummaries result");
  } catch (err) {
    log.debug(
      { shopId, err: err instanceof Error ? err.message : String(err) },
      "getOwnedProductSummaries failed",
    );
  }

  // getPurchasedProducts もページネーション
  try {
    let offset = 0;
    let totalSize = Number.POSITIVE_INFINITY;
    while (offset < totalSize) {
      const purchased = (await client.base.request.request(
        LINEStruct.getPurchasedProducts_args({
          shopId,
          offset,
          limit: PAGE,
          locale,
          request: {} as never,
        }),
        "getPurchasedProducts",
        4,
        true,
        "/TSHOP4",
      )) as {
        purchaseRecords?: Array<{ productDetail?: { id?: string } }>;
        totalSize?: number;
      };
      for (const rec of purchased?.purchaseRecords ?? []) {
        const id = String(rec?.productDetail?.id ?? "");
        if (id && !ids.includes(id)) ids.push(id);
      }
      totalSize = Number(purchased?.totalSize ?? 0);
      if ((purchased?.purchaseRecords ?? []).length < PAGE) break;
      offset += PAGE;
      if (offset >= 1000) break;
    }
  } catch (err) {
    log.debug(
      { shopId, err: err instanceof Error ? err.message : String(err) },
      "getPurchasedProducts failed",
    );
  }
  return ids;
}

/** 所持スタンプ / LINE 絵文字 + プレミアム状態。10分間キャッシュ */
const catalogCache = new Map<string, { data: StickersCatalog; at: number }>();
const CATALOG_CACHE_TTL_MS = 10 * 60_000;
const CATALOG_CACHE_MAX_ACCOUNTS = 32;
const CATALOG_REMOTE_CONCURRENCY = 4;

async function mapCatalogBounded<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CATALOG_REMOTE_CONCURRENCY, items.length) }, () => run()),
  );
  return results;
}

function writeCatalogCache(accountId: string, data: StickersCatalog): void {
  catalogCache.delete(accountId);
  catalogCache.set(accountId, { data, at: Date.now() });
  while (catalogCache.size > CATALOG_CACHE_MAX_ACCOUNTS) {
    const oldest = catalogCache.keys().next().value as string | undefined;
    if (oldest == null) break;
    catalogCache.delete(oldest);
  }
}

export async function fetchStickersCatalog(
  accountId: string,
  opts?: { force?: boolean },
): Promise<StickersCatalog> {
  const cached = catalogCache.get(accountId);
  if (cached) {
    if (Date.now() - cached.at >= CATALOG_CACHE_TTL_MS) {
      catalogCache.delete(accountId);
    } else if (!opts?.force) {
      catalogCache.delete(accountId);
      catalogCache.set(accountId, cached);
      return cached.data;
    }
  }

  const client = requireClient(accountId);

  const premium = await fetchPremiumStatus(accountId);

  const stickerIds = [
    ...DEFAULT_STICKER_PACKS,
    ...(await listOwnedPackageIds(client, "stickershop")),
  ];
  const emojiIds = [...DEFAULT_EMOJI_PACKS, ...(await listOwnedPackageIds(client, "sticonshop"))];

  const uniqueStickers = [...new Set(stickerIds)].slice(0, 40);
  const uniqueEmojis = [...new Set(emojiIds)].slice(0, 40);

  const stickerPacks = (await mapCatalogBounded(uniqueStickers, loadStickerPack)).filter(
    (pack): pack is CatalogPack => Boolean(pack),
  );

  const emojiPacks = (await mapCatalogBounded(uniqueEmojis, loadEmojiPack)).filter(
    (pack): pack is CatalogPack => Boolean(pack),
  );

  const result: StickersCatalog = { premium, stickerPacks, emojiPacks };
  writeCatalogCache(accountId, result);

  log.info(
    {
      accountId,
      stickers: stickerPacks.length,
      emojis: emojiPacks.length,
      premium: premium.active,
    },
    "stickers catalog loaded",
  );

  return result;
}
