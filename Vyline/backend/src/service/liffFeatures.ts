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
const credsCache = new Map<string, { creds: LiffCreds; at: number }>();
const CREDS_TTL_MS = 600_000;
// issueLiffView が遅いため、同一キーの取得が重ならないよう in-flight を統合する
const credsInflight = new Map<string, Promise<LiffCreds>>();

async function getCreds(
  client: VylineClient,
  liffId: string,
  chatMid?: string,
): Promise<LiffCreds> {
  const key = `${liffId}:${chatMid ?? ""}`;
  const cached = credsCache.get(key);
  if (cached && Date.now() - cached.at < CREDS_TTL_MS) {
    return cached.creds;
  }
  const inflight = credsInflight.get(key);
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
        credsCache.set(key, { creds, at: Date.now() });
        return creds;
      } catch (err) {
        lastErr = err;
        log.warn({ liffId, attempt }, "issueLiffView failed, retrying");
      }
    }
    throw lastErr;
  })();
  credsInflight.set(key, job);
  try {
    return await job;
  } finally {
    credsInflight.delete(key);
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
  headers?: Record<string, string>;
  tokenHeader?: string;
  serial?: boolean;
}

async function liffFetch(
  url: string,
  creds: LiffCreds,
  opts: LiffFetchOpts = {},
  retries = LIFF_FETCH_MAX_RETRIES,
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
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    log.info({ url: url.slice(0, 80), ms: Date.now() - t0, status: res.status }, "liff fetch");
    if (!res.ok) {
      log.error({ url, status: res.status, text: text.slice(0, 300) }, "liff http error");
      throw new Error(`LIFF API ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      log.error({ url }, "liff fetch timed out");
      throw new Error(`LIFF fetch timed out: ${url}`);
    }
    // 一時的なソケット切断 (ECONNRESET 等) はリトライ
    if (retries > 0) {
      log.warn({ url, err: (err as Error).message, retries }, "liff fetch failed, retrying");
      await new Promise((r) => setTimeout(r, 800));
      return liffFetch(url, creds, opts, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
