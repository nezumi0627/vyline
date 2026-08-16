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
  fetchStickersCatalog,
  sendLineEmoji,
  unsendMessage,
  acquireCallRoute,
  acquireGroupCallRoute,
  getReadReceiptsForChat,
  fetchChatMemberMids,
  fetchChatMembersDetailed,
  fetchContactsBatch,
  loadNezuProfileCache,
  leaveChat,
  blockContactMid,
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
} from "../service/lineService.js";

const log = childLogger("bff:line");
export const lineRouter = new Hono();

// ─── error helper ─────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Hono Context is generic
function handleError(err: unknown, c: Context<any, any, any>) {
  if (err instanceof NotLoggedInError) {
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
    return c.json({ ok: false, error: "通話を開始できません。相手が通話に対応していない可能性があります。", code: "INVALID_STATE" }, 400);
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
  const isTimeout =
    message.includes("timed out") ||
    message.includes("Timeout") ||
    (err instanceof Error && err.name === "TimeoutError");
  if (isTimeout) {
    log.debug({ err: message }, "line api timeout");
    return c.json({ ok: false, error: "timeout", timedOut: true }, 504);
  }
  const isNetwork =
    /connection|connect|ECONN|ENET|ETIMEDOUT|Unable to connect/i.test(message);
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
  const beforeDeliveredTime = beforeDeliveredTimeRaw
    ? Number(beforeDeliveredTimeRaw)
    : undefined;
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
    const { cursor: next, events, reset, seq } = pollTalkEvents(
      accountId,
      Number.isFinite(cursor) ? cursor : 0,
    );
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
    const { bytes, contentType } = await fetchMessageMedia(
      accountId,
      chatMid,
      messageId,
      preview,
    );
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
  }>();

  if (!body.chatMid || !body.text) {
    return c.json({ ok: false, error: "chatMid and text required" }, 400);
  }

  try {
    const opts: { relatedMessageId?: string; contentMetadata?: Record<string, string> } = {};
    if (body.relatedMessageId) opts.relatedMessageId = body.relatedMessageId;
    if (body.contentMetadata) opts.contentMetadata = body.contentMetadata;
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
  receipts: Awaited<ReturnType<typeof getReadReceiptsForChat>>;
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
          const receipts = await getReadReceiptsForChat(accountId, chatMid, messageIds);
          const payload: ReadReceiptPayload = { receipts };
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
    const { receipts, memberMids } = await task;
    return c.json({ ok: true, receipts, memberMids });
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
    birthday?: {
      year?: string;
      day: string;
      yearEnabled?: boolean;
      dayEnabled?: boolean;
      yearPrivacy?: "PUBLIC" | "PRIVATE";
      dayPrivacy?: "PUBLIC" | "PRIVATE";
    };
  }>();
  try {
    const profile = await updateMyProfile(accountId, body);
    return c.json({ ok: true, profile });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── GET /line/:accountId/nezu/cache ───────────
// Nezu ブランドのプロフィール/グループキャッシュ一括

lineRouter.get("/:accountId/nezu/cache", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const cache = await loadNezuProfileCache(accountId);
    return c.json({ ok: true, ...cache });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── POST /line/:accountId/nezu/warm ───────────
// { mids: string[] } — プロフィールをバッチ温める

lineRouter.post("/:accountId/nezu/warm", async (c) => {
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
      displayNameOverride:
        body.displayNameOverride === undefined
          ? null
          : body.displayNameOverride,
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
