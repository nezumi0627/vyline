/**
 * service/liffFeatures.ts
 *
 * LINE の LIFF Web API（スケジュール / あみだくじ / アンケート）を呼ぶ Service 層。
 * LIFF access token は protocol の issueLiffView で取得する。
 *
 * 【同時実行リクエスト制御】
 * リトライ発生時やトークン更新時の競合を防ぐため、重要なLIFF操作は
 * モジュールレベルのキュー(q) でシリアル化する。
 */

import { childLogger } from "../logger.js";
import { getClient } from "../line/clientManager.js";
import type { VylineClient } from "@vyline/protocol";
import { AuthService } from "../auth/mod.js";

const log = childLogger("service:liff");

// ─── リトライ設定 ─────────────────────────────
const LIFF_FETCH_MAX_RETRIES = 4;
const LIFF_FETCH_BASE_DELAY = 800; // ms

export class LiffNotLoggedInError extends Error {}

/** 各機能の LIFF アプリ ID（HTML の <env data-liff-id> / ページ JS から特定） */
export const LIFF_APPS = {
  ladder: "1505962409-q8wjRbnd",
  schedule: "1655112642-8v0aXBwM",
  poll: "1477715170-Pl2JnXpR",
  stickerShop: "1359301715-JKd7Y7j1",
} as const;

const UA_LIFF =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/26.11.0 LIFF";

function requireClient(accountId: string): VylineClient {
  const client = getClient(accountId);
  if (!client) throw new LiffNotLoggedInError(accountId);
  return client;
}

interface LiffCreds {
  accessToken: string;
  idToken: string;
}

// LIFF token は 1 時間有効。issueLiffView が間欠的に遅いためキャッシュを長めに持ち、取得はリトライ
const credsCache = new WeakMap<VylineClient, Map<string, { creds: LiffCreds; at: number }>>();
const CREDS_TTL_MS = 600_000;
// issueLiffView が遅いため、同一キーの取得が重ならないよう in-flight を統合する
const credsInflight = new WeakMap<VylineClient, Map<string, Promise<LiffCreds>>>();

function clientMap<T>(maps: WeakMap<VylineClient, Map<string, T>>, client: VylineClient) {
  let map = maps.get(client);
  if (!map) {
    map = new Map();
    maps.set(client, map);
  }
  return map;
}

async function getCreds(
  client: VylineClient,
  liffId: string,
  chatMid?: string,
): Promise<LiffCreds> {
  const cache = clientMap(credsCache, client);
  const inflights = clientMap(credsInflight, client);
  const key = `${liffId}:${chatMid ?? ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CREDS_TTL_MS) {
    return cached.creds;
  }
  const inflight = inflights.get(key);
  if (inflight) {
    return inflight;
  }
  const job = (async (): Promise<LiffCreds> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const t0 = Date.now();
        const view = await client.liff.issueView(
          chatMid ? { liffId, chatMid, lang: "ja_JP" } : { liffId, lang: "ja_JP" },
        );
        log.info({ liffId, ms: Date.now() - t0, attempt }, "issueLiffView");
        const creds = { accessToken: view.accessToken, idToken: view.idToken };
        cache.set(key, { creds, at: Date.now() });
        return creds;
      } catch (err) {
        lastErr = err;
        log.warn({ liffId, attempt }, "issueLiffView failed, retrying");
      }
    }
    throw lastErr;
  })();
  inflights.set(key, job);
  try {
    return await job;
  } finally {
    if (inflights.get(key) === job) inflights.delete(key);
  }
}

async function getCredsWithoutUserContext(
  client: VylineClient,
  liffId: string,
): Promise<LiffCreds> {
  const cache = clientMap(credsCache, client);
  const inflights = clientMap(credsInflight, client);
  const key = `sticker-shop-user-context:${liffId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CREDS_TTL_MS) return cached.creds;
  const inflight = inflights.get(key);
  if (inflight) return inflight;
  const job = (async (): Promise<LiffCreds> => {
    try {
      // The sticker shop's getFriendProfiles requires the logged-in LIFF
      // context.  This is the same token shape observed in the supplied HAR.
      const view = await client.liff.issueView({
        liffId,
        ...(client.base.profile?.mid ? { chatMid: client.base.profile.mid } : {}),
        lang: "ja_JP",
      });
      const creds = { accessToken: view.accessToken, idToken: view.idToken };
      cache.set(key, { creds, at: Date.now() });
      return creds;
    } catch (error) {
      log.warn(
        { liffId, err: error instanceof Error ? error.message : String(error) },
        "issueLiffView failed; trying without-user-context LIFF token",
      );
      const view = await client.base.liff.getLiffViewWithoutUserContext({ request: { liffId } });
      const creds = { accessToken: view.accessToken, idToken: view.idToken };
      cache.set(key, { creds, at: Date.now() });
      return creds;
    }
  })();
  inflights.set(key, job);
  try {
    return await job;
  } finally {
    if (inflights.get(key) === job) inflights.delete(key);
  }
}

/** モーダル展開時に先読みして issueLiffView の遅延を隠す（失敗は無視） */
export async function liffWarm(
  accountId: string,
  app: keyof typeof LIFF_APPS,
  chatMid: string,
): Promise<void> {
  try {
    const client = requireClient(accountId);
    await getCreds(client, LIFF_APPS[app], chatMid);
  } catch {
    /* warm 失敗は本送信でリカバリ */
  }
}

interface LiffFetchOpts {
  method?: string;
  body?: unknown;
  bodyText?: string;
  headers?: Record<string, string>;
  tokenHeader?: string;
  serial?: boolean;
  maxRetries?: number;
}

async function liffFetch(
  url: string,
  creds: LiffCreds,
  opts: LiffFetchOpts = {},
  retries = opts.maxRetries ?? LIFF_FETCH_MAX_RETRIES,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ja",
    "User-Agent": UA_LIFF,
    ...(opts.tokenHeader === "liff-id"
      ? {
          "x-liff-access-token": creds.accessToken,
          "x-liff-id-token": creds.idToken,
          "x-requested-with": "XMLHttpRequest",
        }
      : { "X-Liff-Token": `Bearer ${creds.accessToken}` }),
    ...opts.headers,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      ...(opts.bodyText !== undefined
        ? { body: opts.bodyText }
        : opts.body !== undefined
          ? { body: JSON.stringify(opts.body) }
          : {}),
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    log.info({ ms: Date.now() - t0, status: res.status }, "liff fetch");
    if (!res.ok) {
      log.error({ status: res.status, responseBytes: text.length }, "liff http error");
      throw new Error(`LIFF API ${res.status}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      log.error("liff fetch timed out");
      throw new Error("LIFF fetch timed out");
    }
    // 一時的なソケット切断 (ECONNRESET 等) はリトライ
    if (retries > 0) {
      log.warn({ err, retries }, "liff fetch failed, retrying");
      await new Promise((r) => setTimeout(r, 800));
      return liffFetch(url, creds, opts, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type StickerFriendProfile = { name: string; token: string; pictureUrl?: string };

function extractStickerFriendProfiles(
  value: unknown,
  out: StickerFriendProfile[] = [],
): StickerFriendProfile[] {
  // Some LIFF/Thrift adapters return the TJSON payload as a JSON string.
  // Normalize that form before walking the response tree.
  if (typeof value === "string") {
    try {
      return extractStickerFriendProfiles(JSON.parse(value), out);
    } catch {
      return out;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) extractStickerFriendProfiles(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  const token = (record["1"] as { str?: unknown } | undefined)?.str;
  const name = (record["2"] as { str?: unknown } | undefined)?.str;
  const pictureUrl = (record["3"] as { str?: unknown } | undefined)?.str;
  if (typeof token === "string" && token.startsWith("V1~") && typeof name === "string") {
    out.push({
      name,
      token,
      ...(typeof pictureUrl === "string" && pictureUrl ? { pictureUrl } : {}),
    });
  }
  for (const child of Object.values(record)) extractStickerFriendProfiles(child, out);
  return out;
}

function stickerGiftResult(value: unknown): { giftable: boolean; code: number | null } {
  const found: { tf?: boolean; code?: number } = {};
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const tf = (record["1"] as { tf?: unknown } | undefined)?.tf;
    const code = (record["2"] as { i32?: unknown } | undefined)?.i32;
    if (tf === true || tf === 1) found.tf = true;
    if (tf === false || tf === 0) found.tf = false;
    if (typeof code === "number") found.code = code;
    Object.values(record).forEach(walk);
  };
  walk(value);
  return { giftable: found.tf === true, code: found.code ?? null };
}

/**
 * Sticker Shop's canFriendReceiveGift check observed in the supplied HAR.
 * This is a read-only eligibility probe; it does not send or purchase a gift.
 */
export async function checkStickerGiftEligibility(
  accountId: string,
): Promise<Array<{ name: string; pictureUrl?: string; giftable: boolean; code: number | null }>> {
  const client = requireClient(accountId);
  const creds = await getCredsWithoutUserContext(client, LIFF_APPS.stickerShop);
  const baseHeaders = {
    Authorization: `Bearer ${creds.accessToken}`,
    "X-Line-Shop-Credential-Type": "access_token",
    "X-LAL": "ja_JP",
    Accept: "application/x-thrift, application/vnd.apache.thrift.json; charset=utf-8",
    "Content-Type": "application/x-thrift, application/vnd.apache.thrift.json; charset=utf-8",
    Origin: "https://stickershop.line.me",
    Referer: "https://stickershop.line.me/",
  };
  const profiles = extractStickerFriendProfiles(
    await liffFetch("https://stickershop.line.me/api/liff", creds, {
      method: "POST",
      bodyText: '[1,"getFriendProfiles",1,0,{"2":{"rec":{}}}]',
      headers: baseHeaders,
      maxRetries: 0,
    }),
  );
  const unique = new Map(
    profiles.map((profile) => [`${profile.name}\u0000${profile.token}`, profile]),
  );
  const results: Array<{
    name: string;
    pictureUrl?: string;
    giftable: boolean;
    code: number | null;
  }> = [];
  for (const profile of unique.values()) {
    const response = await liffFetch("https://stickershop.line.me/api/liff", creds, {
      method: "POST",
      bodyText: `[1,"canFriendReceiveGift",1,0,{"2":{"rec":{"1":{"str":"stickershop"},"2":{"str":"30372800"},"3":{"str":"${profile.token}"}}}}]`,
      headers: baseHeaders,
      maxRetries: 0,
    });
    const result = stickerGiftResult(response);
    results.push({
      name: profile.name,
      ...(profile.pictureUrl ? { pictureUrl: profile.pictureUrl } : {}),
      ...result,
    });
  }
  return results;
}

const W_LINE_ORIGIN = "https://w.line.me";
const W_LINE_REFERER = "https://w.line.me/ladder/static-liff/index.html?env=real";
const POLL_ORIGIN = "https://w.line.me";
const POLL_REFERER = "https://w.line.me/poll/liff/";
/** poll API の X-LINE-Chat-ID はトークン発行時と同じ mid をそのまま使う */
function pollChatId(chatMid: string): string {
  return chatMid;
}

// ── あみだくじ (w.line.me/ladder) ─────────────────────────────

export async function ladderMembers(accountId: string, chatMid: string): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.ladder, chatMid);
  return liffFetch(`https://w.line.me/ladder/user-api/v1/member/list/${chatMid}`, creds, {
    headers: { "X-LINE-ACCEPT-LANGUAGE": "ja" },
  });
}

export async function ladderGenerate(
  accountId: string,
  chatMid: string,
  memberIds: string[],
  options: string[],
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.ladder, chatMid);
  return liffFetch("https://w.line.me/ladder/user-api/v1/ladder/generate", creds, {
    method: "POST",
    body: { chatTypeId: chatMid, memberIds, options, deviceOS: "ios", region: "JP" },
    headers: {
      "X-LINE-ACCEPT-LANGUAGE": "ja",
      "Content-Type": "application/json",
      Origin: W_LINE_ORIGIN,
      Referer: W_LINE_REFERER,
    },
  });
}

export async function ladderResult(
  accountId: string,
  chatMid: string,
  hash: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.ladder, chatMid);
  return liffFetch(`https://w.line.me/ladder/user-api/v1/ladder/result/${hash}?sort=end`, creds, {
    headers: { "X-LINE-ACCEPT-LANGUAGE": "ja" },
  });
}

/** 結果メッセージをグループに送信 */
export async function ladderMessage(
  accountId: string,
  chatMid: string,
  hash: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.ladder, chatMid);
  return liffFetch("https://w.line.me/ladder/user-api/v1/ladder/message", creds, {
    method: "POST",
    body: { ladderHash: hash },
    headers: { "Content-Type": "application/json", Origin: W_LINE_ORIGIN, Referer: W_LINE_REFERER },
  });
}

// ── スケジュール (schedule-web.line.me) ────────────────────────

const SCHEDULE_BASE = "https://schedule-web.line.me/api";

export async function scheduleCreate(
  accountId: string,
  chatMid: string,
  data: { name: string; description?: string; candidates: number[]; pictureId?: number },
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.schedule, chatMid);
  return liffFetch(`${SCHEDULE_BASE}/events`, creds, {
    method: "POST",
    body: {
      name: data.name,
      description: data.description ?? "",
      candidates: data.candidates.map((c) => Math.floor(c / 1000)),
      pictureId: data.pictureId ?? 27,
    },
    tokenHeader: "liff-id",
    headers: { "Content-Type": "application/json", Origin: "https://schedule-web.line.me" },
  });
}

export async function scheduleAnswer(
  accountId: string,
  chatMid: string,
  eventId: string,
  answers: { candidate: number; status: string }[],
  comment?: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.schedule, chatMid);
  return liffFetch(`${SCHEDULE_BASE}/events/${eventId}/answer`, creds, {
    method: "POST",
    body: { answers, comment: comment ?? "" },
    tokenHeader: "liff-id",
    headers: { "Content-Type": "application/json", Origin: "https://schedule-web.line.me" },
  });
}

export async function scheduleShare(
  accountId: string,
  chatMid: string,
  eventId: string,
  groupEncIds: string[],
  comment?: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.schedule, chatMid);
  return liffFetch(`${SCHEDULE_BASE}/events/${eventId}/share`, creds, {
    method: "POST",
    body: { groupEncIds, comment: comment ?? "" },
    tokenHeader: "liff-id",
    headers: { "Content-Type": "application/json", Origin: "https://schedule-web.line.me" },
  });
}

export async function scheduleEvent(
  accountId: string,
  chatMid: string,
  eventId: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.schedule, chatMid);
  return liffFetch(`${SCHEDULE_BASE}/events/${eventId}`, creds, { tokenHeader: "liff-id" });
}

export async function scheduleGroups(accountId: string, chatMid: string): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.schedule, chatMid);
  return liffFetch(`${SCHEDULE_BASE}/graph/groups`, creds, { tokenHeader: "liff-id" });
}

/** 特定グループの encId を取得（チャット単体で共有可能。名前マッチング不要） */
export async function scheduleGroup(accountId: string, chatMid: string): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.schedule, chatMid);
  return liffFetch(`${SCHEDULE_BASE}/graph/groups/${chatMid}`, creds, {
    tokenHeader: "liff-id",
  });
}

export async function scheduleFriends(accountId: string, chatMid: string): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.schedule, chatMid);
  return liffFetch(`${SCHEDULE_BASE}/graph/friends`, creds, { tokenHeader: "liff-id" });
}

// ── アンケート (w.line.me/poll) ───────────────────────────────

const POLL_BASE = "https://w.line.me/poll/ajax/poll/question";

export async function pollCreate(
  accountId: string,
  chatMid: string,
  data: {
    questionType?: string;
    title: string;
    multiple?: boolean;
    anonymous?: boolean;
    editable?: boolean;
    closeDate?: number;
    choiceList: { text: string }[];
  },
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/create`, creds, {
    method: "POST",
    body: {
      questionType: "TEXT",
      title: data.title,
      lineProfile: {},
      multiple: data.multiple ?? true,
      anonymous: data.anonymous ?? false,
      editable: data.editable ?? true,
      ...(data.closeDate ? { closeDate: data.closeDate } : {}),
      titleImage: {},
      choiceList: data.choiceList.map((c) => ({ imageAttachment: {}, text: c.text })),
    },
    headers: {
      "Content-Type": "application/json",
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}

export async function pollList(accountId: string, chatMid: string): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/list?count=20`, creds, {
    headers: {
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}

export async function pollVote(
  accountId: string,
  chatMid: string,
  questionId: string,
  choiceIds: string[],
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/${questionId}/vote`, creds, {
    method: "POST",
    body: choiceIds,
    headers: {
      "Content-Type": "application/json",
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}

export async function pollQuestion(
  accountId: string,
  chatMid: string,
  questionId: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/${questionId}`, creds, {
    headers: {
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}

export async function pollClose(
  accountId: string,
  chatMid: string,
  questionId: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/${questionId}/close`, creds, {
    headers: {
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}

export async function pollRemove(
  accountId: string,
  chatMid: string,
  questionId: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/${questionId}/remove`, creds, {
    headers: {
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}

export async function pollAnnounce(
  accountId: string,
  chatMid: string,
  questionId: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/${questionId}/announce`, creds, {
    method: "POST",
    headers: {
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}

export async function pollRemind(
  accountId: string,
  chatMid: string,
  questionId: string,
): Promise<unknown> {
  const client = requireClient(accountId);
  const creds = await getCreds(client, LIFF_APPS.poll, chatMid);
  return liffFetch(`${POLL_BASE}/${questionId}/remind`, creds, {
    method: "POST",
    headers: {
      "X-LINE-Chat-ID": pollChatId(chatMid),
      Region: "JP",
      Origin: POLL_ORIGIN,
      Referer: POLL_REFERER,
    },
  });
}
