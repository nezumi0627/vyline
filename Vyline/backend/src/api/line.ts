/**
 * api/line.ts  — BFF 層
 *
 * HTTP リクエスト/レスポンスの整形のみ担当。
 * ビジネスロジックは service/lineService.ts に委譲する。
 *
 * GET  /line/:accountId/profile
 * GET  /line/:accountId/chats
 * GET  /line/:accountId/messages/:chatMid?limit=30
 * GET  /line/:accountId/export/:chatMid?format=json|txt
 * GET  /line/:accountId/contact/:targetMid
 * POST /line/:accountId/send        { chatMid, text }
 * POST /line/:accountId/unsend      { messageId }
 * POST /line/:accountId/read        { chatMid }
 * PATCH /line/:accountId/profile    { displayName?, statusMessage?, … }
 * POST  /line/:accountId/profile/image       multipart/raw body
 * POST  /line/:accountId/profile/background  multipart/raw body
 * PATCH /line/:accountId/chats/:chatMid      { name? }
 * POST  /line/:accountId/chats/:chatMid/picture  image body
 * PATCH /line/:accountId/contacts/:mid       { displayNameOverride }
 * POST /line/:accountId/call        { to?, chatMid?, callType, kind }
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { childLogger } from "../logger.js";
import { readMediaCache, writeMediaCache } from "../storage/mediaCache.js";
import { getProxyConfig, setProxyConfig } from "../proxyConfig.js";
import { getFeatureLocks, unbanCreateGroup } from "../storage/featureLocks.js";
import {
  fetchProfile,
  fetchContactProfile,
  markAsRead,
  fetchChats,
  fetchBootstrap,
  fetchMessages,
  fetchMessagesSince,
  pollTalkEvents,
  fetchMessageMedia,
  sendMessage,
  sendMedia,
  sendSticker,
  canCreateCombinationSticker,
  createCombinationSticker,
  isStickerAvailableForCombinationSticker,
  fetchStickersCatalog,
  sendLineEmoji,
  sendCombinationSticker,
  unsendMessage,
  editMessage,
  getMessageEditNotice,
  acquireCallRoute,
  acquireGroupCallRoute,
  getGroupCallStatus,
  getCommonGroupsForUser,
  getReadReceiptsForChat,
  fetchChatMemberMids,
  fetchChatMembersDetailed,
  fetchContactsBatch,
  loadVylineProfileCache,
  leaveChat,
  blockContactMid,
  setNotificationsEnabled,
  unblockContactMid,
  reactToMessage,
  runAccountIndex,
  updateMyProfile,
  updateMyProfileImage,
  updateMyProfileBackground,
  updateChatName,
  updateChatPicture,
  renameContact,
  fetchBlockedContactIds,
  createGroupChat,
  inviteToGroupChat,
  startDirectCall,
  stopDirectCall,
  getDirectCallStatus,
  listDirectCalls,
  CallNotAllowedError,
  NotLoggedInError,
  restoreRevokedMessage,
  getMessageHistory,
} from "../service/lineService.js";
import {
  LiffNotLoggedInError,
  ladderMembers,
  ladderGenerate,
  ladderResult,
  ladderMessage,
  scheduleCreate,
  scheduleAnswer,
  scheduleShare,
  scheduleEvent,
  scheduleGroups,
  scheduleGroup,
  scheduleFriends,
  pollList,
  pollCreate,
  pollVote,
  pollQuestion,
  pollClose,
  pollRemove,
  pollAnnounce,
  liffWarm,
  pollRemind,
} from "../service/liffFeatures.js";

import {
  getChatAnnouncements,
  announceMessage,
  removeChatAnnouncement,
} from "../service/lineService.js";

const log = childLogger("bff:line");
export const lineRouter = new Hono();

// ─── helpers ─────────────────────────────

function isLiffError(res: unknown): { statusCode: number; statusMessage: string } | null {
  if (res && typeof res === "object" && "statusCode" in res && "statusMessage" in res) {
    const code = (res as any).statusCode;
    if (typeof code === "number" && code >= 400) return res as any;
    if (typeof code === "string" && /^(4|5)\d\d$/.test(code)) return res as any;
  }
  return null;
}

// ─── error helper ─────────────────────────────

function handleError(err: unknown, c: Context<any, any, any>) {
  if (err instanceof NotLoggedInError || err instanceof LiffNotLoggedInError) {
    return c.json({ ok: false, error: "not logged in" }, 401);
  }
  if (err instanceof CallNotAllowedError) {
    return c.json({ ok: false, error: err.message }, 403);
  }
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  if (code === "INVALID_STATE" || message.includes("INVALID_STATE")) {
    return c.json(
      {
        ok: false,
        error: "通話を開始できません。相手が通話に対応していない可能性があります。",
        code: "INVALID_STATE",
      },
      400,
    );
  }
  if (code === "CREATE_GROUP_BANNED" || message.includes("CREATE_GROUP_BANNED")) {
    log.warn({ err: message }, "create group permanently banned");
    return c.json(
      {
        ok: false,
        error: message,
        code: "CREATE_GROUP_BANNED",
        createGroupBanned: true,
      },
      403,
    );
  }
  if (
    code === "MESSAGE_NOT_DESTRUCTIBLE" ||
    message.toUpperCase().includes("MESSAGE_NOT_DESTRUCTIBLE")
  ) {
    return c.json(
      {
        ok: false,
        error: "MESSAGE_NOT_DESTRUCTIBLE: message too old",
        code: "MESSAGE_NOT_DESTRUCTIBLE",
      },
      400,
    );
  }
  if (
    code === "MESSAGE_ALREADY_REVOKED" ||
    message.toUpperCase().includes("MESSAGE_ALREADY_REVOKED")
  ) {
    return c.json(
      {
        ok: false,
        error: "このメッセージはすでに送信取り消し済みです。もう一度取り消すことはできません。",
        code: "MESSAGE_ALREADY_REVOKED",
      },
      400,
    );
  }
  const isTimeout =
    message.includes("timed out") ||
    message.includes("Timeout") ||
    (err instanceof Error && err.name === "TimeoutError");
  if (isTimeout) {
    log.debug({ err: message }, "line api timeout");
    return c.json({ ok: false, error: "timeout", timedOut: true }, 504);
  }
  const isNetwork = /connection|connect|ECONN|ENET|ETIMEDOUT|Unable to connect/i.test(message);
  if (isNetwork) {
    log.warn({ err: message }, "line api network error");
    return c.json({ ok: false, error: message }, 502);
  }
  log.error({ err }, "line api error");
  return c.json({ ok: false, error: message }, 500);
}

// ─── GET /line/:accountId/profile ─────────────

lineRouter.get("/:accountId/profile", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const profile = await fetchProfile(accountId);
    return c.json({ ok: true, profile });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/bootstrap ───────────
// Desktop 相当: ローカル DB から即時 hydrate（RPC なし）

lineRouter.get("/:accountId/bootstrap", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const payload = await fetchBootstrap(accountId);
    return c.json({
      ok: true,
      ...payload,
      fromCache: true,
    });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/chats ───────────────

lineRouter.get("/:accountId/chats", async (c) => {
  const accountId = c.req.param("accountId");
  const light = c.req.query("light") === "1";
  const force = c.req.query("force") === "1";
  const refresh = c.req.query("refresh") === "1";
  try {
    const chats = await fetchChats(accountId, { light, force, refresh });
    return c.json({
      ok: true,
      chats,
      fromCache: !force,
    });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/messages/:chatMid ───

lineRouter.get("/:accountId/messages/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const limitParam = Number(c.req.query("limit") ?? "30");
  const limit = Math.min(Math.max(1, limitParam), 100);
  const beforeMessageId = c.req.query("beforeMessageId") || undefined;
  const beforeDeliveredTimeRaw = c.req.query("beforeDeliveredTime");
  const beforeDeliveredTime = beforeDeliveredTimeRaw ? Number(beforeDeliveredTimeRaw) : undefined;
  const force = c.req.query("force") === "1";
  const localOnly = c.req.query("local") === "1";

  try {
    const fetchOpts: {
      beforeMessageId?: string;
      beforeDeliveredTime?: number;
      force?: boolean;
      localOnly?: boolean;
    } = {};
    if (beforeMessageId) fetchOpts.beforeMessageId = beforeMessageId;
    if (beforeDeliveredTime != null && Number.isFinite(beforeDeliveredTime)) {
      fetchOpts.beforeDeliveredTime = beforeDeliveredTime;
    }
    if (force) fetchOpts.force = true;
    if (localOnly) fetchOpts.localOnly = true;
    const messages = await fetchMessages(accountId, chatMid, limit, fetchOpts);
    return c.json({
      ok: true,
      messages,
      hasMore: messages.length >= limit,
      fromCache: localOnly || (!force && !beforeMessageId),
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("timed out") || err.name === "TimeoutError")
    ) {
      return c.json({ ok: true, messages: [], hasMore: false, timedOut: true });
    }
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/events/poll ─────────
// Talk Push バッファから新着メッセージを取得（フロント定期 poll 用）

lineRouter.get("/:accountId/events/poll", async (c) => {
  const accountId = c.req.param("accountId");
  const cursor = Number(c.req.query("cursor") ?? "0");
  try {
    const {
      cursor: next,
      events,
      reset,
      seq,
    } = pollTalkEvents(accountId, Number.isFinite(cursor) ? cursor : 0);
    return c.json({ ok: true, cursor: next, events, reset, seq });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/messages/:chatMid/delta ───
// after より新しいメッセージのみ（Push 取りこぼし fallback）

lineRouter.get("/:accountId/messages/:chatMid/delta", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const after = c.req.query("after") ?? "";
  const limitParam = Number(c.req.query("limit") ?? "25");
  const limit = Math.min(Math.max(1, limitParam), 50);

  if (!after) {
    return c.json({ ok: false, error: "after query required" }, 400);
  }

  try {
    const messages = await fetchMessagesSince(accountId, chatMid, after, limit);
    return c.json({ ok: true, messages });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/media/:chatMid/:messageId ───

lineRouter.get("/:accountId/media/:chatMid/:messageId", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const messageId = c.req.param("messageId");
  const preview = (c.req.query("preview") ?? "1") !== "0";

  try {
    // サーバー側キャッシュ優先（端末乗り換え後も画像を保持）
    const cached = await readMediaCache(accountId, chatMid, messageId);
    if (cached) {
      return new Response(cached.buf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "private, max-age=604800, immutable",
          "X-Vyline-Media-Cache": "HIT",
        },
      });
    }
    const { bytes, contentType } = await fetchMessageMedia(accountId, chatMid, messageId, preview);
    void writeMediaCache(accountId, chatMid, messageId, bytes, contentType);
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      return c.json({ ok: false, error: "not logged in" }, 401);
    }
    const message = err instanceof Error ? err.message : String(err);
    // 復号不能は 422（UI はプレースホルダ表示）。500 連打を避ける
    log.warn({ accountId, chatMid, messageId, err: message }, "media fetch failed");
    return c.json({ ok: false, error: message }, 422);
  }
});

// ─── GET /line/:accountId/export/:chatMid ─────
// format=json|txt — fetchMessages 経由で復号済み履歴をダウンロード

lineRouter.get("/:accountId/export/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const format = (c.req.query("format") ?? "json").toLowerCase();
  const limitParam = Number(c.req.query("limit") ?? "200");
  const limit = Math.min(Math.max(1, limitParam), 500);

  if (format !== "json" && format !== "txt") {
    return c.json({ ok: false, error: "format must be json or txt" }, 400);
  }

  try {
    const messages = await fetchMessages(accountId, chatMid, limit);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `vyline-${chatMid.slice(0, 12)}-${stamp}.${format}`;

    if (format === "txt") {
      const lines = messages
        .slice()
        .sort((a, b) => a.createdTime - b.createdTime)
        .map((m) => {
          const ts = new Date(m.createdTime).toISOString();
          const who = m.isMyMessage ? "me" : m.from;
          const body = m.text ?? `[${m.contentType}]`;
          return `[${ts}] ${who}: ${body}`;
        });
      const body = lines.join("\n") + (lines.length ? "\n" : "");
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      return c.body(body);
    }

    const payload = {
      ok: true as const,
      exportedAt: new Date().toISOString(),
      accountId,
      chatMid,
      count: messages.length,
      messages: messages.slice().sort((a, b) => a.createdTime - b.createdTime),
    };
    c.header("Content-Type", "application/json; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(JSON.stringify(payload, null, 2));
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/contact/:targetMid ──

lineRouter.get("/:accountId/contact/:targetMid", async (c) => {
  const accountId = c.req.param("accountId");
  const targetMid = c.req.param("targetMid");
  try {
    const profile = await fetchContactProfile(accountId, targetMid);
    if (!profile) return c.json({ ok: false, error: "contact not found" }, 404);
    return c.json({ ok: true, profile });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/send ───────────────

lineRouter.post("/:accountId/send", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid?: string;
    text?: string;
    relatedMessageId?: string;
    contentMetadata?: Record<string, string>;
    mute?: boolean;
  }>();

  if (!body.chatMid || !body.text) {
    return c.json({ ok: false, error: "chatMid and text required" }, 400);
  }

  try {
    const opts: {
      relatedMessageId?: string;
      contentMetadata?: Record<string, string>;
      mute?: boolean;
    } = {};
    if (body.relatedMessageId) opts.relatedMessageId = body.relatedMessageId;
    if (body.contentMetadata) opts.contentMetadata = body.contentMetadata;
    if (body.mute) opts.mute = true;
    const message = await sendMessage(accountId, body.chatMid, body.text, opts);
    return c.json({ ok: true, message: message ?? undefined });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/send-sticker ───────
// { chatMid, packageId?, stickerId? }

lineRouter.post("/:accountId/send-sticker", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid?: string;
    packageId?: string;
    stickerId?: string;
    isPremium?: boolean;
  }>();

  if (!body.chatMid) {
    return c.json({ ok: false, error: "chatMid required" }, 400);
  }

  try {
    const opts: { packageId?: string; stickerId?: string; isPremium?: boolean } = {};
    if (body.packageId) opts.packageId = body.packageId;
    if (body.stickerId) opts.stickerId = body.stickerId;
    if (body.isPremium) opts.isPremium = true;
    const message = await sendSticker(accountId, body.chatMid, opts);
    return c.json({ ok: true, message: message ?? undefined });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/stickers ────────────
// 所持スタンプ / LINE絵文字 + プレミアム状態

lineRouter.get("/:accountId/stickers", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const catalog = await fetchStickersCatalog(accountId);
    return c.json({ ok: true, ...catalog });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/combination-stickers/can-create ───────
// { packageIds: string[] }

lineRouter.post("/:accountId/combination-stickers/can-create", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ packageIds?: string[] }>();
  if (!body.packageIds?.length) {
    return c.json({ ok: false, error: "packageIds required" }, 400);
  }
  try {
    const result = await canCreateCombinationSticker(accountId, body.packageIds);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/combination-stickers/available ───────
// { packageId: string }

lineRouter.post("/:accountId/combination-stickers/available", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ packageId?: string }>();
  if (!body.packageId) {
    return c.json({ ok: false, error: "packageId required" }, 400);
  }
  try {
    const result = await isStickerAvailableForCombinationSticker(accountId, body.packageId);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/combination-stickers ───────
// { items: [{ packageId, stickerId }], idOfPreviousVersionOfCombinationSticker? }

lineRouter.post("/:accountId/combination-stickers", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    items?: Array<{ packageId: string; stickerId: string; x?: number; y?: number; size?: number }>;
    idOfPreviousVersionOfCombinationSticker?: string;
  }>();
  if (!body.items?.length) {
    return c.json({ ok: false, error: "items required" }, 400);
  }
  try {
    const result =
      body.idOfPreviousVersionOfCombinationSticker != null
        ? await createCombinationSticker(accountId, body.items, {
            idOfPreviousVersionOfCombinationSticker: body.idOfPreviousVersionOfCombinationSticker,
          })
        : await createCombinationSticker(accountId, body.items);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/send-combination-sticker ───────
// { chatMid, items: [{ packageId, stickerId }], idOfPreviousVersionOfCombinationSticker? }

lineRouter.post("/:accountId/send-combination-sticker", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid?: string;
    items?: Array<{ packageId: string; stickerId: string; x?: number; y?: number; size?: number }>;
    idOfPreviousVersionOfCombinationSticker?: string;
  }>();
  if (!body.chatMid) {
    return c.json({ ok: false, error: "chatMid required" }, 400);
  }
  if (!body.items?.length) {
    return c.json({ ok: false, error: "items required" }, 400);
  }
  try {
    const message = await sendCombinationSticker(
      accountId,
      body.chatMid,
      body.items,
      body.idOfPreviousVersionOfCombinationSticker != null
        ? {
            idOfPreviousVersionOfCombinationSticker: body.idOfPreviousVersionOfCombinationSticker,
          }
        : undefined,
    );
    return c.json({ ok: true, message: message ?? undefined });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/send-emoji ─────────
// { chatMid, packageId, sticonId }

lineRouter.post("/:accountId/send-emoji", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid?: string;
    packageId?: string;
    sticonId?: string;
  }>();
  if (!body.chatMid || !body.packageId || !body.sticonId) {
    return c.json({ ok: false, error: "chatMid, packageId, sticonId required" }, 400);
  }
  try {
    await sendLineEmoji(accountId, body.chatMid, {
      packageId: body.packageId,
      sticonId: body.sticonId,
    });
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/send-media ─────────
// { chatMid, dataBase64, mimeType?, filename?, mediaType? }

lineRouter.post("/:accountId/send-media", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid?: string;
    dataBase64?: string;
    mimeType?: string;
    filename?: string;
    mediaType?: "image" | "video" | "audio" | "file" | "gif";
  }>();

  if (!body.chatMid || !body.dataBase64) {
    return c.json({ ok: false, error: "chatMid and dataBase64 required" }, 400);
  }
  if (body.dataBase64.length > 12_000_000) {
    return c.json({ ok: false, error: "file too large" }, 413);
  }

  try {
    const opts: {
      mimeType?: string;
      filename?: string;
      mediaType?: "image" | "video" | "audio" | "file" | "gif";
    } = {};
    if (body.mimeType) opts.mimeType = body.mimeType;
    if (body.filename) opts.filename = body.filename;
    if (body.mediaType) opts.mediaType = body.mediaType;
    await sendMedia(accountId, body.chatMid, body.dataBase64, opts);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/send-media-batch ───────
// { chatMid, items: [{ dataBase64, mimeType?, filename?, mediaType? }] }

lineRouter.post("/:accountId/send-media-batch", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid?: string;
    items?: Array<{
      dataBase64?: string;
      mimeType?: string;
      filename?: string;
      mediaType?: "image" | "video" | "audio" | "file" | "gif";
    }>;
  }>();

  if (!body.chatMid || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ ok: false, error: "chatMid and items required" }, 400);
  }

  try {
    let count = 0;
    for (const item of body.items) {
      if (!item?.dataBase64) continue;
      if (item.dataBase64.length > 12_000_000) {
        return c.json({ ok: false, error: "file too large" }, 413);
      }
      const opts: {
        mimeType?: string;
        filename?: string;
        mediaType?: "image" | "video" | "audio" | "file" | "gif";
      } = {};
      if (item.mimeType) opts.mimeType = item.mimeType;
      if (item.filename) opts.filename = item.filename;
      if (item.mediaType) opts.mediaType = item.mediaType;
      await sendMedia(accountId, body.chatMid, item.dataBase64, opts);
      count++;
    }
    return c.json({ ok: true, count });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/unsend ─────────────

lineRouter.post("/:accountId/unsend", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ messageId?: string }>();

  if (!body.messageId) {
    return c.json({ ok: false, error: "messageId required" }, 400);
  }

  try {
    await unsendMessage(accountId, body.messageId);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/restore ─────────────

lineRouter.post("/:accountId/restore", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ messageId?: string }>();

  if (!body.messageId) {
    return c.json({ ok: false, error: "messageId required" }, 400);
  }

  try {
    const chatMid = c.req.query("chatMid") ?? "";
    const restored = await restoreRevokedMessage(accountId, chatMid, body.messageId);
    if (!restored) {
      return c.json({ ok: false, error: "no history to restore" }, 400);
    }
    return c.json({ ok: true, text: restored.text, contentType: restored.contentType });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/messages/:chatMid/:messageId/history ──

lineRouter.get("/:accountId/messages/:chatMid/:messageId/history", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const messageId = c.req.param("messageId");

  try {
    const history = await getMessageHistory(accountId, chatMid, messageId);
    return c.json({ ok: true, history });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/edit ───────────────

lineRouter.post("/:accountId/edit", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ chatMid?: string; messageId?: string; text?: string }>();

  if (!body.chatMid || !body.messageId || !body.text) {
    return c.json({ ok: false, error: "chatMid, messageId and text required" }, 400);
  }

  try {
    const res = await editMessage(accountId, body.chatMid, body.messageId, body.text);
    return c.json({ ok: true, message: res.message });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/edit-notice/:chatMid ──

lineRouter.get("/:accountId/edit-notice/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");

  try {
    const res = await getMessageEditNotice(accountId, chatMid);
    return c.json({ ok: true, ...res });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/read ───────────────

lineRouter.post("/:accountId/read", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ chatMid?: string; lastMessageId?: string }>();

  if (!body.chatMid) {
    return c.json({ ok: false, error: "chatMid required" }, 400);
  }

  try {
    await markAsRead(accountId, body.chatMid, body.lastMessageId);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/read-receipts/:chatMid ───
// 自分の送信メッセージの既読状態を軽量取得（ポーリング用）

type ReadReceiptPayload = {
  receipts: Awaited<ReturnType<typeof getReadReceiptsForChat>>["receipts"];
  peerReadUpTo?: string;
  memberReadWatermarks?: Array<{ mid: string; upTo: string }>;
  memberMids?: string[];
};

const readReceiptInflight = new Map<string, Promise<ReadReceiptPayload>>();

lineRouter.get("/:accountId/read-receipts/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const idsParam = c.req.query("ids") ?? "";
  const messageIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (messageIds.length === 0) {
    return c.json({ ok: false, error: "ids query required" }, 400);
  }

  const inflightKey = `${accountId}:${chatMid}`;

  try {
    const existing = readReceiptInflight.get(inflightKey);
    const task =
      existing ??
      (() => {
        const p = (async (): Promise<ReadReceiptPayload> => {
          const result = await getReadReceiptsForChat(accountId, chatMid, messageIds);
          const payload: ReadReceiptPayload = {
            receipts: result.receipts,
            ...(result.peerReadUpTo ? { peerReadUpTo: result.peerReadUpTo } : {}),
            ...(result.memberReadWatermarks
              ? { memberReadWatermarks: result.memberReadWatermarks }
              : {}),
          };
          if (chatMid.startsWith("c") || chatMid.startsWith("r")) {
            try {
              payload.memberMids = await fetchChatMemberMids(accountId, chatMid);
            } catch (err) {
              log.debug({ accountId, chatMid, err }, "fetchChatMemberMids skipped");
            }
          }
          return payload;
        })();
        readReceiptInflight.set(inflightKey, p);
        void p.finally(() => {
          if (readReceiptInflight.get(inflightKey) === p) {
            readReceiptInflight.delete(inflightKey);
          }
        });
        return p;
      })();
    const { receipts, peerReadUpTo, memberReadWatermarks, memberMids } = await task;
    return c.json({ ok: true, receipts, peerReadUpTo, memberReadWatermarks, memberMids });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── PATCH /line/:accountId/profile ───────────
// Desktop: TalkService_updateProfileAttributes

lineRouter.patch("/:accountId/profile", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    displayName?: string;
    statusMessage?: string;
    phoneticName?: string;
    musicProfile?: string;
    allowSearchByUserid?: boolean;
    allowSearchByEmail?: boolean;
    hiddenFromList?: boolean;
  }>();
  try {
    const profile = await updateMyProfile(accountId, body);
    return c.json({ ok: true, profile });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/vyline/cache ───────────
// Vyline ブランドのプロフィール/グループキャッシュ一括

lineRouter.get("/:accountId/vyline/cache", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const cache = await loadVylineProfileCache(accountId);
    return c.json({ ok: true, ...cache });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── DELETE /line/:accountId/vyline/cache ─────────
// メディア一時キャッシュ（data/media-cache）を削除

lineRouter.delete("/:accountId/vyline/cache", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { clearMediaCache } = await import("../storage/mediaCache.js");
    const removed = await clearMediaCache();
    return c.json({ ok: true, removed });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/vyline/warm ───────────
// { mids: string[] } — プロフィールをバッチ温める

lineRouter.post("/:accountId/vyline/warm", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ mids?: string[] }>();
  const mids = Array.isArray(body.mids) ? body.mids.slice(0, 200) : [];
  try {
    const map = await fetchContactsBatch(accountId, mids);
    const profiles = Object.fromEntries(
      [...map.entries()].map(([mid, p]) => [
        mid,
        {
          mid: p.mid,
          displayName: p.displayName,
          thumbnailUrl: p.thumbnailUrl,
          statusMessage: p.statusMessage,
          musicProfile: p.musicProfile,
          birthday: p.birthday?.display,
          backgroundUrl: p.backgroundUrl,
        },
      ]),
    );
    return c.json({ ok: true, profiles, count: map.size });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/chats/:chatMid/members

lineRouter.get("/:accountId/chats/:chatMid/members", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const result = await fetchChatMembersDetailed(accountId, chatMid);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/profile/image ──────

lineRouter.post("/:accountId/profile/image", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) {
      return c.json({ ok: false, error: "empty body" }, 400);
    }
    const mime = c.req.header("content-type") ?? "image/jpeg";
    const result = await updateMyProfileImage(accountId, buf, mime);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/profile/background ─

lineRouter.post("/:accountId/profile/background", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) {
      return c.json({ ok: false, error: "empty body" }, 400);
    }
    const mime = c.req.header("content-type") ?? "image/jpeg";
    const result = await updateMyProfileBackground(accountId, buf, mime);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/common-groups/:targetMid ─
// 共通のグループ（VylineCache 一括読み・RPC なし）

lineRouter.get("/:accountId/common-groups/:targetMid", async (c) => {
  const accountId = c.req.param("accountId");
  const targetMid = c.req.param("targetMid");
  const exclude = c.req.query("exclude");
  try {
    const groups = await getCommonGroupsForUser(
      accountId,
      targetMid,
      exclude ? { excludeChatMid: exclude } : undefined,
    );
    return c.json({ ok: true, groups });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── PATCH /line/:accountId/chats/:chatMid ────
// Desktop: TalkService_updateChat (NAME)

lineRouter.patch("/:accountId/chats/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const body = await c.req.json<{ name?: string }>();
  if (!body.name || !body.name.trim()) {
    return c.json({ ok: false, error: "name required" }, 400);
  }
  try {
    await updateChatName(accountId, chatMid, body.name.trim());
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/chats/:chatMid/picture

lineRouter.post("/:accountId/chats/:chatMid/picture", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) {
      return c.json({ ok: false, error: "empty body" }, 400);
    }
    const mime = c.req.header("content-type") ?? "image/jpeg";
    const result = await updateChatPicture(accountId, chatMid, buf, mime);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── PATCH /line/:accountId/contacts/:mid ─────
// Desktop: TalkService_updateContactSetting (display name override)

lineRouter.patch("/:accountId/contacts/:mid", async (c) => {
  const accountId = c.req.param("accountId");
  const mid = c.req.param("mid");
  const body = await c.req.json<{ displayNameOverride?: string | null }>();
  try {
    await renameContact(accountId, {
      mid,
      displayNameOverride: body.displayNameOverride === undefined ? null : body.displayNameOverride,
    });
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST leave / block / react / index ────────

lineRouter.post("/:accountId/chats/:chatMid/leave", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const result = await leaveChat(accountId, chatMid);
    return c.json({ ok: true, alreadyLeft: result.alreadyLeft === true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/contacts/:mid/block", async (c) => {
  const accountId = c.req.param("accountId");
  const mid = c.req.param("mid");
  try {
    await blockContactMid(accountId, mid);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/contacts/:mid/block", async (c) => {
  const accountId = c.req.param("accountId");
  const mid = c.req.param("mid");
  try {
    await unblockContactMid(accountId, mid);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/blocked", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const mids = await fetchBlockedContactIds(accountId);
    return c.json({ ok: true, mids });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/notifications ────────
// モバイルプッシュ通知の有効/無効を切替 (TalkService_setNotificationsEnabled, type=USER)

lineRouter.post("/:accountId/notifications", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ enable?: boolean }>();
  if (body.enable === undefined) {
    return c.json({ ok: false, error: "enable required" }, 400);
  }
  try {
    await setNotificationsEnabled(accountId, body.enable);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/chats/create-group", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ name?: string; memberMids?: string[] }>();
  if (!body.memberMids?.length) {
    return c.json({ ok: false, error: "memberMids required" }, 400);
  }
  try {
    const chat = await createGroupChat(accountId, body.name ?? "グループ", body.memberMids);
    return c.json({ ok: true, chat });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/feature-locks", async (c) => {
  const accountId = c.req.param("accountId");
  const locks = await getFeatureLocks(accountId);
  return c.json({
    ok: true,
    locks: {
      createGroupBanned: locks.createGroupBanned === true,
      createGroupBannedAt: locks.createGroupBannedAt ?? null,
      createGroupBannedReason: locks.createGroupBannedReason ?? null,
    },
  });
});

lineRouter.delete("/:accountId/feature-locks/create-group-ban", async (c) => {
  const accountId = c.req.param("accountId");
  await unbanCreateGroup(accountId);
  const locks = await getFeatureLocks(accountId);
  return c.json({
    ok: true,
    locks: {
      createGroupBanned: locks.createGroupBanned === true,
      createGroupBannedAt: locks.createGroupBannedAt ?? null,
      createGroupBannedReason: locks.createGroupBannedReason ?? null,
    },
  });
});

lineRouter.post("/:accountId/chats/:chatMid/invite", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const body = await c.req.json<{ memberMids?: string[] }>();
  if (!body.memberMids?.length) {
    return c.json({ ok: false, error: "memberMids required" }, 400);
  }
  // u から始まる MID のみ許可
  const valid = body.memberMids.filter((m) => m.startsWith("u"));
  if (valid.length === 0) {
    return c.json({ ok: false, error: "有効な MID (u...) がありません" }, 400);
  }
  const rejected = body.memberMids.length - valid.length;
  try {
    await inviteToGroupChat(accountId, chatMid, valid);
    return c.json({
      ok: true,
      invited: valid.length,
      ...(rejected > 0 ? { rejected, hint: "u 以外の MID は除外されました" } : {}),
    });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/proxy", async (c) => {
  void c.req.param("accountId");
  return c.json({ ok: true, proxy: getProxyConfig() });
});

lineRouter.put("/:accountId/proxy", async (c) => {
  void c.req.param("accountId");
  const body = await c.req.json<{ enabled?: boolean; url?: string }>();
  const proxy = setProxyConfig({
    enabled: Boolean(body.enabled),
    url: body.url ?? "",
  });
  return c.json({ ok: true, proxy });
});

lineRouter.post("/:accountId/messages/:messageId/react", async (c) => {
  const accountId = c.req.param("accountId");
  const messageId = c.req.param("messageId");
  const body = await c.req.json<{
    reaction?: "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG" | "UNDO";
  }>();
  if (!body.reaction) return c.json({ ok: false, error: "reaction required" }, 400);
  try {
    await reactToMessage(accountId, messageId, body.reaction);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Desktop: 古いメッセージは MESSAGE_NOT_FOUND / "Message too old for reaction"
    if (
      msg.includes("MESSAGE_NOT_FOUND") ||
      msg.includes("too old for reaction") ||
      msg.includes("Message too old")
    ) {
      return c.json(
        {
          ok: false,
          error: "このメッセージはリアクションできません（古すぎるか削除済み）",
          code: "REACTION_TOO_OLD",
        },
        400,
      );
    }
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/index", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const result = await runAccountIndex(accountId);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/restore/desktop ────
// Desktop 抽出鍵の再取り込み + E2EE identity 修復

lineRouter.post("/:accountId/restore/desktop", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { restoreFromDesktop } = await import("../service/restoreDesktop.js");
    const result = await restoreFromDesktop(accountId);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/restore/status ──────

lineRouter.get("/:accountId/restore/status", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { getRestoreStatus } = await import("../service/restoreDesktop.js");
    const status = await getRestoreStatus(accountId);
    return c.json({ ok: true, ...status });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/call ────────────────
// kind=route のみ route 返却。start/end/status は /call/start 等。

lineRouter.post("/:accountId/call/start", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ to: string; callType?: "AUDIO" | "VIDEO" }>();
  if (!body.to) return c.json({ ok: false, error: "to required" }, 400);
  try {
    const session = await startDirectCall(accountId, body.to, body.callType ?? "AUDIO");
    return c.json({ ok: true, session });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/call/end", async (c) => {
  const body = await c.req.json<{ sessionId: string }>();
  if (!body.sessionId) return c.json({ ok: false, error: "sessionId required" }, 400);
  try {
    await stopDirectCall(body.sessionId);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/call/status", async (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId) return c.json({ ok: false, error: "sessionId required" }, 400);
  const session = await getDirectCallStatus(sessionId);
  if (!session) return c.json({ ok: false, error: "not found" }, 404);
  return c.json({ ok: true, session });
});

lineRouter.get("/:accountId/call/active", async (c) => {
  const accountId = c.req.param("accountId");
  const sessions = await listDirectCalls(accountId);
  return c.json({ ok: true, sessions });
});

// グループ通話状態（通話中バッジ表示用）
lineRouter.get("/:accountId/call/group-status", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.query("chatMid");
  if (!chatMid) return c.json({ ok: false, error: "chatMid required" }, 400);
  try {
    const status = await getGroupCallStatus(accountId, chatMid);
    return c.json({ ok: true, ...status });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/call", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    to?: string;
    chatMid?: string;
    callType?: "AUDIO" | "VIDEO";
    kind?: "direct" | "group";
  }>();

  const callType = body.callType ?? "AUDIO";

  try {
    let route;
    if (body.kind === "group" && body.chatMid) {
      route = await acquireGroupCallRoute(accountId, body.chatMid, callType);
    } else if (body.to) {
      route = await acquireCallRoute(accountId, body.to, callType);
    } else {
      return c.json({ ok: false, error: "to or chatMid required" }, 400);
    }
    return c.json({ ok: true, route });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── LIFF 機能: あみだくじ ─────────────────────────────────

lineRouter.post("/:accountId/liff/warm", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ app: "ladder" | "schedule" | "poll"; chatMid: string }>();
  try {
    await liffWarm(accountId, body.app, body.chatMid);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/ladder/members/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const ladderRes = await ladderMembers(accountId, chatMid);
    const liffErr = isLiffError(ladderRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: ladderRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/ladder/generate", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ chatMid: string; memberIds: string[]; options: string[] }>();
  try {
    const ladderRes = await ladderGenerate(accountId, body.chatMid, body.memberIds, body.options);
    const liffErr = isLiffError(ladderRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: ladderRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/ladder/result/:chatMid/:hash", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const hash = c.req.param("hash");
  try {
    const ladderRes = await ladderResult(accountId, chatMid, hash);
    const liffErr = isLiffError(ladderRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: ladderRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/ladder/message", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ chatMid: string; hash: string }>();
  try {
    const ladderRes = await ladderMessage(accountId, body.chatMid, body.hash);
    const liffErr = isLiffError(ladderRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: ladderRes });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── LIFF 機能: スケジュール ────────────────────────────────

lineRouter.post("/:accountId/schedule/events", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid: string;
    name: string;
    description?: string;
    candidates: number[];
    pictureId?: number;
  }>();
  try {
    const schedRes = await scheduleCreate(accountId, body.chatMid, body);
    const liffErr = isLiffError(schedRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: schedRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/schedule/events/:eventId/answer", async (c) => {
  const accountId = c.req.param("accountId");
  const eventId = c.req.param("eventId");
  const body = await c.req.json<{
    chatMid: string;
    answers: { candidate: number; status: string }[];
    comment?: string;
  }>();
  try {
    const ansRes = await scheduleAnswer(
      accountId,
      body.chatMid,
      eventId,
      body.answers,
      body.comment,
    );
    const liffErr = isLiffError(ansRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: ansRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/schedule/events/:eventId/share", async (c) => {
  const accountId = c.req.param("accountId");
  const eventId = c.req.param("eventId");
  const body = await c.req.json<{ chatMid: string; groupEncIds: string[]; comment?: string }>();
  try {
    const schedRes = await scheduleShare(
      accountId,
      body.chatMid,
      eventId,
      body.groupEncIds,
      body.comment,
    );
    const liffErr = isLiffError(schedRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: schedRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/schedule/events/:eventId/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const eventId = c.req.param("eventId");
  const chatMid = c.req.param("chatMid");
  try {
    const schedRes = await scheduleEvent(accountId, chatMid, eventId);
    const liffErr = isLiffError(schedRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: schedRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/schedule/groups/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const schedRes = await scheduleGroups(accountId, chatMid);
    const liffErr = isLiffError(schedRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: schedRes });
  } catch (err) {
    return handleError(err, c);
  }
});

// 特定グループの encId を直接取得（共有先決定のための名前マッチングを不要にする）
lineRouter.get("/:accountId/schedule/group/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const schedRes = await scheduleGroup(accountId, chatMid);
    const liffErr = isLiffError(schedRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: schedRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/schedule/friends/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const schedRes = await scheduleFriends(accountId, chatMid);
    const liffErr = isLiffError(schedRes);
    if (liffErr) return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    return c.json({ ok: true, data: schedRes });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── LIFF 機能: アンケート ─────────────────────────────────

lineRouter.post("/:accountId/poll/create", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    chatMid: string;
    title: string;
    multiple?: boolean;
    anonymous?: boolean;
    closeDate?: number;
    choiceList: { text: string }[];
  }>();
  try {
    const pollRes = await pollCreate(accountId, body.chatMid, body);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      log.error({ accountId, chatMid: body.chatMid, liffErr, pollRes }, "poll create liff error");
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/poll/:questionId/vote", async (c) => {
  const accountId = c.req.param("accountId");
  const questionId = c.req.param("questionId");
  const body = await c.req.json<{ chatMid: string; choiceIds: string[] }>();
  try {
    const pollRes = await pollVote(accountId, body.chatMid, questionId, body.choiceIds);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/poll/:questionId/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const questionId = c.req.param("questionId");
  const chatMid = c.req.param("chatMid");
  try {
    const pollRes = await pollQuestion(accountId, chatMid, questionId);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/poll/:questionId/close/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const questionId = c.req.param("questionId");
  const chatMid = c.req.param("chatMid");
  try {
    const pollRes = await pollClose(accountId, chatMid, questionId);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/poll/:questionId/remove/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const questionId = c.req.param("questionId");
  const chatMid = c.req.param("chatMid");
  try {
    const pollRes = await pollRemove(accountId, chatMid, questionId);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/poll/:questionId/announce", async (c) => {
  const accountId = c.req.param("accountId");
  const questionId = c.req.param("questionId");
  const body = await c.req.json<{ chatMid: string }>();
  try {
    const pollRes = await pollAnnounce(accountId, body.chatMid, questionId);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/poll/:questionId/remind", async (c) => {
  const accountId = c.req.param("accountId");
  const questionId = c.req.param("questionId");
  const body = await c.req.json<{ chatMid: string }>();
  try {
    const pollRes = await pollRemind(accountId, body.chatMid, questionId);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/poll/list/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    const pollRes = await pollList(accountId, chatMid);
    const liffErr = isLiffError(pollRes);
    if (liffErr) {
      return c.json({ ok: false, error: liffErr.statusMessage }, 502);
    }
    return c.json({ ok: true, data: pollRes });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── チャットルーム アナウンス（ピン留め） ─────────────────

lineRouter.get("/:accountId/announcements/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  try {
    return c.json({ ok: true, data: await getChatAnnouncements(accountId, chatMid) });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/announcements", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ chatMid: string; text: string; messageId?: string }>();
  if (!body.chatMid || !body.text?.trim()) {
    return c.json({ ok: false, error: "chatMid と text が必要です" }, 400);
  }
  try {
    return c.json({
      ok: true,
      data: await announceMessage(accountId, body.chatMid, body.text.trim(), body.messageId),
    });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/announcements/:chatMid/:seq", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const seq = c.req.param("seq");
  try {
    await removeChatAnnouncement(accountId, chatMid, seq);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── VylineBackup: スナップショット作成 / 一覧 / 復元 ───

lineRouter.get("/:accountId/backup/chats", async (c) => {
  const accountId = c.req.param("accountId");
  const { getBackupChatList } = await import("../service/backupService.js");
  try {
    return c.json({ ok: true, data: await getBackupChatList(accountId) });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/backup/create", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ chatMids?: string[]; includeMedia?: boolean }>();
  const { createBackup } = await import("../service/backupService.js");
  try {
    const summary = await createBackup(accountId, {
      ...(body.chatMids?.length ? { chatMids: body.chatMids } : {}),
      includeMedia: body.includeMedia === true,
    });
    return c.json({ ok: true, summary });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/backup/list", async (c) => {
  const accountId = c.req.param("accountId");
  const { listBackups } = await import("../service/backupService.js");
  try {
    return c.json({ ok: true, data: await listBackups(accountId) });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/backup/restore", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    backupId: string;
    chatMids?: string[];
    includeMedia?: boolean;
  }>();
  const { restoreBackup } = await import("../service/backupService.js");
  try {
    const result = await restoreBackup(accountId, body.backupId, {
      ...(body.chatMids?.length ? { chatMids: body.chatMids } : {}),
      includeMedia: body.includeMedia === true,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/backup/:backupId", async (c) => {
  const accountId = c.req.param("accountId");
  const backupId = c.req.param("backupId");
  const { deleteBackup } = await import("../service/backupService.js");
  try {
    return c.json({ ok: await deleteBackup(accountId, backupId) });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/log", async (c) => {
  const accountId = c.req.param("accountId");
  const { readRecentMessageLog } = await import("../storage/messageLog.js");
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 2000);
  try {
    return c.json({ ok: true, data: await readRecentMessageLog(accountId, limit) });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── Vyline Storage ────────────────────────────────────────

lineRouter.get("/:accountId/vyline/storage", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { getVylineStorageInfo } = await import("../storage/vylineStorageInfo.js");
    const info = await getVylineStorageInfo();
    return c.json(info);
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/vyline/cache", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { clearCdnCache } = await import("../storage/cdnAssetCache.js");
    const removed = await clearCdnCache();
    return c.json({ ok: true, removed });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/vyline/cache/cdn", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { clearCdnCache } = await import("../storage/cdnAssetCache.js");
    const removed = await clearCdnCache();
    return c.json({ ok: true, removed });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/vyline/cache/icons", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { clearIconCache } = await import("../storage/cdnAssetCache.js");
    const removed = await clearIconCache();
    return c.json({ ok: true, removed });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/vyline/saved-media", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { clearMediaCache } = await import("../storage/mediaCache.js");
    const removed = await clearMediaCache();
    return c.json({ ok: true, removed });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/vyline/saved-media/:type", async (c) => {
  const accountId = c.req.param("accountId");
  const type = c.req.param("type");
  const validTypes = new Set(["image", "video", "audio", "file"]);
  if (!validTypes.has(type)) {
    return c.json({ ok: false, error: "invalid media type" }, 400);
  }
  try {
    const { clearMediaCacheType } = await import("../storage/mediaCache.js");
    const removed = await clearMediaCacheType(type as "image" | "video" | "audio" | "file");
    return c.json({ ok: true, removed, type });
  } catch (err) {
    return handleError(err, c);
  }
});
