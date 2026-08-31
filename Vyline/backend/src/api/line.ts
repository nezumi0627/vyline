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
import { statMediaStorage, writeMediaStorage } from "../storage/mediaStorage.js";
import { rebuildAccountChatDb } from "../storage/chatStore.js";
import { BackupStorageLimitError } from "../storage/backupLimits.js";
import { BackupWorkCapacityError } from "../service/diskBackedWorkQueue.js";
import { getProxyConfig, setProxyConfig } from "../proxyConfig.js";
import { getFeatureLocks, unbanCreateGroup } from "../storage/featureLocks.js";
import { getPluginStates, listPlugins, setPluginState } from "../line/pluginManager.js";
import { isPluginActive } from "../line/pluginRuntime.js";
import {
  completeMediaBatchUpload,
  createMediaBatchUpload,
  MediaSendUploadError,
  removeMediaBatchUpload,
  removeStandaloneMediaUpload,
  stageMediaBatchItem,
  stageStandaloneMediaUpload,
  type MediaUploadMetadata,
  type StagedMediaType,
} from "../service/mediaSendStaging.js";
import {
  commentNote,
  createNote,
  deleteNote,
  getNote,
  getNoteLike,
  getGroupHomeUpdates,
  likeNote,
  listNotes,
  listNoteLikes,
  shareNoteToChat,
  unlikeNote,
  updateNote,
  uploadNoteCommentImage,
  uploadNoteMedia,
} from "../service/noteService.js";
import {
  addAlbumPhotos,
  createAlbum,
  deleteAlbum,
  deleteAlbumPhotos,
  downloadAlbumMedia,
  listAlbumPhotos,
  listAlbums,
  previewAlbums,
  shareAlbum,
  updateAlbum,
  uploadAlbumMedia,
} from "../service/albumService.js";
import { getClient, getContentClient } from "../line/clientManager.js";
import {
  fetchProfile,
  fetchContactProfile,
  markAsRead,
  markAllAsRead,
  markAsReadBatch,
  fetchChats,
  fetchBootstrap,
  fetchMessages,
  fetchMessagesSince,
  pollTalkEvents,
  fetchMessageMedia,
  fetchPlainMessageMediaToStorage,
  sendMessage,
  sendMedia,
  sendMediaBatch,
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
  verifyFriendBlockStatus,
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
  loadLockedChats,
  setChatLocked,
  assertChatUnlocked,
  ChatLockedError,
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

const IMAGE_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
const LARGE_CONTENT_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;

function stagedUploadFile(
  upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>>,
  fallbackType: string,
): Blob {
  return Bun.file(upload.path, { type: upload.mimeType || fallbackType });
}

// ─── notes（LINE ノート / Timeline） ───
lineRouter.get("/:accountId/notes", async (c) => {
  const accountId = c.req.param("accountId");
  const homeId = c.req.query("homeId");
  if (!homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(await listNotes(accountId, client, homeId));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/notes/updates", async (c) => {
  const accountId = c.req.param("accountId");
  const revisionRaw = c.req.query("revision");
  const revision = Number(revisionRaw);
  if (!revisionRaw || !Number.isSafeInteger(revision) || revision < 0) {
    return c.json({ ok: false, error: "revision must be a non-negative integer" }, 400);
  }
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(await getGroupHomeUpdates(client, revision));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/notes", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    homeId?: string;
    text?: string;
    sharedPostId?: string;
    stickerIds?: string[];
    stickerPackageIds?: string[];
    mediaObjectIds?: string[];
    mediaObjectTypes?: string[];
    contents?: Record<string, unknown>;
    postInfo?: Record<string, unknown>;
  }>();
  if (
    !body.homeId ||
    (!body.text &&
      !body.sharedPostId &&
      !body.stickerIds?.length &&
      !body.mediaObjectIds?.length &&
      !body.contents)
  ) {
    return c.json({ ok: false, error: "homeId and note content required" }, 400);
  }
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const { homeId, ...input } = body;
    return c.json(await createNote(accountId, client, homeId, input));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.patch("/:accountId/notes/:postId", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const body = await c.req.json<Record<string, unknown> & { homeId?: string }>();
  if (!body.homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const { homeId, ...raw } = body;
    const input = {
      ...(typeof raw.text === "string" ? { text: raw.text } : {}),
      ...(typeof raw.sharedPostId === "string" ? { sharedPostId: raw.sharedPostId } : {}),
      ...(Array.isArray(raw.stickerIds) ? { stickerIds: raw.stickerIds.map(String) } : {}),
      ...(Array.isArray(raw.stickerPackageIds)
        ? { stickerPackageIds: raw.stickerPackageIds.map(String) }
        : {}),
      ...(Array.isArray(raw.mediaObjectIds)
        ? { mediaObjectIds: raw.mediaObjectIds.map(String) }
        : {}),
      ...(Array.isArray(raw.mediaObjectTypes)
        ? { mediaObjectTypes: raw.mediaObjectTypes.map(String) }
        : {}),
      ...(raw.contents && typeof raw.contents === "object"
        ? { contents: raw.contents as Record<string, unknown> }
        : {}),
    };
    return c.json(await updateNote(client, homeId, postId, input));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/notes/:postId/like", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const body = await c.req.json<{ homeId?: string; likeType?: string }>();
  if (!body.homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  const allowed = new Set(["1001", "1002", "1003", "1004", "1005", "1006"]);
  if (body.likeType && !allowed.has(body.likeType)) {
    return c.json({ ok: false, error: "invalid likeType" }, 400);
  }
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(
      await likeNote(
        client,
        body.homeId,
        postId,
        body.likeType as "1001" | "1002" | "1003" | "1004" | "1005" | "1006" | undefined,
      ),
    );
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/notes/:postId/like", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const homeId = c.req.query("homeId");
  if (!homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  try {
    const client = await getContentClient(accountId);
    return c.json(await unlikeNote(client, homeId, postId));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/notes/:postId/like", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const homeId = c.req.query("homeId");
  if (!homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  try {
    const client = await getContentClient(accountId);
    return c.json(await getNoteLike(client, homeId, postId));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/notes/:postId/likes", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const homeId = c.req.query("homeId");
  if (!homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  try {
    const client = await getContentClient(accountId);
    return c.json(await listNoteLikes(client, homeId, postId));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/notes/:postId/comments", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const body = await c.req.json<{ homeId?: string; text?: string; imageObjectId?: string }>();
  if (!body.homeId || (!body.text && !body.imageObjectId)) {
    return c.json({ ok: false, error: "homeId and comment content required" }, 400);
  }
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const contentsList = body.imageObjectId
      ? [
          {
            categoryId: "media",
            extData: {
              objectId: body.imageObjectId,
              type: "PHOTO",
              obsNamespace: "cmt",
              serviceName: "myhome",
            },
          },
        ]
      : undefined;
    return c.json(await commentNote(client, body.homeId, postId, body.text ?? "", contentsList));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/notes/media/:type", async (c) => {
  const accountId = c.req.param("accountId");
  const type = c.req.param("type");
  if (type !== "image" && type !== "video") {
    return c.json({ ok: false, error: "type must be image or video" }, 400);
  }
  let upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>> | null = null;
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    upload = await stageStandaloneMediaUpload(
      c.req.raw,
      mediaUploadMetadata(c),
      type === "video" ? LARGE_CONTENT_UPLOAD_MAX_BYTES : IMAGE_UPLOAD_MAX_BYTES,
    );
    return c.json(
      await uploadNoteMedia(
        client,
        type,
        stagedUploadFile(upload, type === "video" ? "video/mp4" : "image/jpeg"),
      ),
    );
  } catch (err) {
    return handleMediaUploadError(err, c);
  } finally {
    if (upload) await removeStandaloneMediaUpload(upload).catch(() => undefined);
  }
});

lineRouter.post("/:accountId/notes/comment-image", async (c) => {
  const accountId = c.req.param("accountId");
  let upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>> | null = null;
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    upload = await stageStandaloneMediaUpload(
      c.req.raw,
      mediaUploadMetadata(c),
      IMAGE_UPLOAD_MAX_BYTES,
    );
    return c.json(await uploadNoteCommentImage(client, stagedUploadFile(upload, "image/jpeg")));
  } catch (err) {
    return handleMediaUploadError(err, c);
  } finally {
    if (upload) await removeStandaloneMediaUpload(upload).catch(() => undefined);
  }
});

lineRouter.get("/:accountId/notes/:postId", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const homeId = c.req.query("homeId");
  if (!homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(await getNote(accountId, client, homeId, postId));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/notes/:postId", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const homeId = c.req.query("homeId");
  if (!homeId) return c.json({ ok: false, error: "homeId required" }, 400);
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(await deleteNote(accountId, client, homeId, postId));
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/notes/:postId/share", async (c) => {
  const accountId = c.req.param("accountId");
  const postId = c.req.param("postId");
  const body = await c.req.json<{ homeId?: string }>();
  if (!body.homeId) {
    return c.json({ ok: false, error: "homeId required" }, 400);
  }
  try {
    const client = await getContentClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(await shareNoteToChat(accountId, client, body.homeId, postId));
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── albums（固定操作のみ公開し、任意 path proxy は持たない） ───
function albumQuery(c: Context): Record<string, string> {
  return Object.fromEntries(new URL(c.req.url).searchParams.entries());
}

async function albumClient(c: Context) {
  const accountId = c.req.param("accountId");
  if (!accountId) return null;
  try {
    return await getContentClient(accountId);
  } catch {
    return null;
  }
}

lineRouter.get("/:accountId/albums", async (c) => {
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const query = albumQuery(c);
    if (!query.chatId) return c.json({ ok: false, error: "chatId required" }, 400);
    return c.json(
      await listAlbums(
        client,
        query as { chatId: string; cursor?: string; orderBy?: string; include?: string },
      ),
    );
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.get("/:accountId/albums/preview", async (c) => {
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const query = albumQuery(c);
    if (!query.chatId) return c.json({ ok: false, error: "chatId required" }, 400);
    return c.json(
      await previewAlbums(
        client,
        query as { chatId: string; pageSize?: string; thumbnailCount?: string; viewType?: string },
      ),
    );
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.post("/:accountId/albums", async (c) => {
  const body = await c.req.json<{
    chatId?: string;
    title?: string;
    modifyDuplicateTitle?: boolean;
  }>();
  if (!body.chatId || !body.title?.trim())
    return c.json({ ok: false, error: "chatId and title required" }, 400);
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(
      await createAlbum(client, {
        chatId: body.chatId,
        title: body.title.trim(),
        ...(body.modifyDuplicateTitle !== undefined
          ? { modifyDuplicateTitle: body.modifyDuplicateTitle }
          : {}),
      }),
    );
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.patch("/:accountId/albums/:albumId", async (c) => {
  const body = await c.req.json<{ chatId?: string; title?: string }>();
  if (!body.chatId || !body.title?.trim())
    return c.json({ ok: false, error: "chatId and title required" }, 400);
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(
      await updateAlbum(client, c.req.param("albumId"), {
        chatId: body.chatId,
        title: body.title.trim(),
      }),
    );
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.delete("/:accountId/albums/:albumId", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) return c.json({ ok: false, error: "chatId required" }, 400);
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(await deleteAlbum(client, c.req.param("albumId"), chatId));
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.post("/:accountId/albums/:albumId/share", async (c) => {
  const body = await c.req.json<{ chatId?: string }>();
  if (!body.chatId) return c.json({ ok: false, error: "chatId required" }, 400);
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(await shareAlbum(client, c.req.param("albumId"), body.chatId));
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.post("/:accountId/albums/:albumId/media", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) return c.json({ ok: false, error: "chatId required" }, 400);
  let upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>> | null = null;
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    upload = await stageStandaloneMediaUpload(
      c.req.raw,
      mediaUploadMetadata(c),
      LARGE_CONTENT_UPLOAD_MAX_BYTES,
    );
    const contentType = upload.mimeType;
    return c.json(
      await uploadAlbumMedia(client, c.req.param("albumId"), {
        chatId,
        data: stagedUploadFile(upload, "application/octet-stream"),
        ...(contentType ? { contentType } : {}),
      }),
    );
  } catch (err) {
    return handleMediaUploadError(err, c);
  } finally {
    if (upload) await removeStandaloneMediaUpload(upload).catch(() => undefined);
  }
});
lineRouter.post("/:accountId/albums/:albumId/photos", async (c) => {
  const body = await c.req.json<{
    chatId?: string;
    photos?: Parameters<typeof addAlbumPhotos>[2]["photos"];
  }>();
  if (!body.chatId || !body.photos?.length)
    return c.json({ ok: false, error: "chatId and photos required" }, 400);
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(
      await addAlbumPhotos(client, c.req.param("albumId"), {
        chatId: body.chatId,
        albumId: c.req.param("albumId"),
        photos: body.photos,
      }),
    );
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.delete("/:accountId/albums/:albumId/photos", async (c) => {
  const body = await c.req.json<{ chatId?: string; photoIds?: string[] }>();
  if (!body.chatId || !body.photoIds?.length)
    return c.json({ ok: false, error: "chatId and photoIds required" }, 400);
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    return c.json(
      await deleteAlbumPhotos(client, c.req.param("albumId"), body.chatId, body.photoIds),
    );
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.get("/:accountId/albums/:albumId/photos", async (c) => {
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const query = albumQuery(c);
    if (!query.chatId) return c.json({ ok: false, error: "chatId required" }, 400);
    return c.json(
      await listAlbumPhotos(client, c.req.param("albumId"), {
        chatId: query.chatId,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.orderBy !== undefined ? { orderBy: query.orderBy } : {}),
        ...(query.include !== undefined ? { include: query.include } : {}),
        ...(query.filterType !== undefined ? { filterType: query.filterType } : {}),
        ...(query.targetUser !== undefined ? { targetUser: query.targetUser } : {}),
      }),
    );
  } catch (err) {
    return handleError(err, c);
  }
});
lineRouter.get("/:accountId/albums/:albumId/media/:oid", async (c) => {
  try {
    const client = await albumClient(c);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const query = albumQuery(c);
    if (!query.chatId) return c.json({ ok: false, error: "chatId required" }, 400);
    const mediaType = query.mediaType === "video" ? "video" : "image";
    const response = await downloadAlbumMedia(client, c.req.param("albumId"), {
      chatId: query.chatId,
      oid: c.req.param("oid"),
      mediaType,
    });
    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type":
          response.headers.get("content-type") ??
          (mediaType === "video" ? "video/mp4" : "image/jpeg"),
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    return handleError(err, c);
  }
});

// ─── Chat safety locks ─────────────────────────

lineRouter.get("/:accountId/chat-locks", async (c) => {
  return c.json({ ok: true, chatMids: await loadLockedChats(c.req.param("accountId")) });
});

lineRouter.put("/:accountId/chat-locks/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const body = await c.req.json<{ locked?: boolean }>();
  if (typeof body.locked !== "boolean") {
    return c.json({ ok: false, error: "locked must be boolean" }, 400);
  }
  try {
    const chatMids = await setChatLocked(accountId, chatMid, body.locked);
    return c.json({ ok: true, locked: body.locked, chatMids });
  } catch (err) {
    return handleError(err, c);
  }
});
// ─── plugins（ローカルの信頼済みプラグインのみ実行） ───
lineRouter.get("/:accountId/plugins", async (c) => {
  const accountId = c.req.param("accountId");
  const states = getPluginStates(accountId);
  return c.json({
    plugins: listPlugins().map((p) => ({
      ...p,
      enabled: states[p.id] === true,
      active: isPluginActive(accountId, p.id),
    })),
  });
});

lineRouter.post("/:accountId/plugins/:pluginId/:action", async (c) => {
  const accountId = c.req.param("accountId");
  const pluginId = c.req.param("pluginId");
  const action = c.req.param("action");
  if (action !== "enable" && action !== "disable") {
    return c.json({ ok: false, error: "action must be enable or disable" }, 400);
  }
  try {
    await setPluginState(accountId, pluginId, action === "enable");
    return c.json({ ok: true, pluginId, enabled: action === "enable" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const unknownPlugin = msg.startsWith("unknown plugin:");
    log.warn({ err, accountId, pluginId }, "plugin state update failed");
    return c.json(
      { ok: false, error: unknownPlugin ? "unknown plugin" : "plugin state update failed" },
      unknownPlugin ? 404 : 422,
    );
  }
});

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
  if (err instanceof BackupStorageLimitError)
    return c.json({ ok: false, code: "BACKUP_STORAGE_LIMIT", error: err.message }, 507);
  if (err instanceof BackupWorkCapacityError) {
    c.header("Retry-After", "5");
    return c.json({ ok: false, code: "BACKUP_WORK_CAPACITY", error: err.message }, 429);
  }
  if (err instanceof NotLoggedInError || err instanceof LiffNotLoggedInError) {
    return c.json({ ok: false, error: "not logged in" }, 401);
  }
  if (err instanceof CallNotAllowedError) {
    return c.json({ ok: false, error: err.message }, 403);
  }
  if (err instanceof ChatLockedError) {
    return c.json({ ok: false, error: err.message, code: "CHAT_LOCKED" }, 423);
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
    log.warn({ err }, "create group permanently banned");
    return c.json(
      {
        ok: false,
        error: "グループ作成はLINE側で制限されています。",
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
    log.warn({ err }, "line api network error");
    return c.json({ ok: false, error: "upstream service unavailable" }, 502);
  }
  log.error({ err }, "line api error");
  return c.json({ ok: false, error: "internal server error" }, 500);
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
  const localOnly = c.req.query("local") === "1";
  // ネットワーク RPC は従来通り最大100件。ローカル chatdb の再入室復元だけは、
  // 前回ユーザーが見た深度を1回で戻せるよう上限を広げる。
  const limitMax = localOnly ? 10_000 : 100;
  const limit = Math.min(Math.max(1, limitParam), limitMax);
  const beforeMessageId = c.req.query("beforeMessageId") || undefined;
  const beforeDeliveredTimeRaw = c.req.query("beforeDeliveredTime");
  const beforeDeliveredTime = beforeDeliveredTimeRaw ? Number(beforeDeliveredTimeRaw) : undefined;
  const force = c.req.query("force") === "1";

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
    const fetchLimit = localOnly ? limit + 1 : limit;
    const fetched = await fetchMessages(accountId, chatMid, fetchLimit, fetchOpts);
    const hasMore = localOnly ? fetched.length > limit : fetched.length >= limit;
    const messages = localOnly && fetched.length > limit ? fetched.slice(0, limit) : fetched;
    return c.json({
      ok: true,
      messages,
      hasMore,
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

// ─── POST /line/:accountId/chatdb/rebuild ────
// 既存DBを退避して、復元・同期混在後の時系列と最新チャット要約を正規化する。
lineRouter.post("/:accountId/chatdb/rebuild", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    return c.json({ ok: true, ...(await rebuildAccountChatDb(accountId)) });
  } catch (err) {
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

type MediaByteRange = { start: number; end: number };

/** Parse one RFC 7233 byte range. Multiple/invalid/unsatisfiable ranges return "invalid". */
export function parseMediaByteRange(
  header: string | undefined,
  size: number,
): MediaByteRange | null | "invalid" {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size < 0 || !header.startsWith("bytes=")) return "invalid";
  const value = header.slice(6).trim();
  if (!value || value.includes(",")) return "invalid";
  const match = /^(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return "invalid";

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return "invalid";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function storedMediaResponse(
  media: Awaited<ReturnType<typeof statMediaStorage>> & {},
  rangeHeader: string | undefined,
): Response {
  const range = parseMediaByteRange(rangeHeader, media.sizeBytes);
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=604800, immutable",
    "Content-Type": media.contentType,
    "X-Vyline-Media-Cache": "HIT",
  };
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        ...commonHeaders,
        "Content-Length": "0",
        "Content-Range": `bytes */${media.sizeBytes}`,
      },
    });
  }
  if (range) {
    const length = range.end - range.start + 1;
    return new Response(Bun.file(media.path).slice(range.start, range.end + 1), {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${media.sizeBytes}`,
      },
    });
  }
  return new Response(Bun.file(media.path), {
    status: 200,
    headers: { ...commonHeaders, "Content-Length": String(media.sizeBytes) },
  });
}

function bufferedMediaResponse(
  bytes: Uint8Array,
  contentType: string,
  rangeHeader: string | undefined,
): Response {
  const range = parseMediaByteRange(rangeHeader, bytes.byteLength);
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Type": contentType,
  };
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        ...commonHeaders,
        "Content-Length": "0",
        "Content-Range": `bytes */${bytes.byteLength}`,
      },
    });
  }
  const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
  return new Response(body as unknown as BodyInit, {
    status: range ? 206 : 200,
    headers: {
      ...commonHeaders,
      "Content-Length": String(body.byteLength),
      ...(range
        ? { "Content-Range": `bytes ${range.start}-${range.end}/${bytes.byteLength}` }
        : {}),
    },
  });
}

lineRouter.get("/:accountId/media/:chatMid/:messageId", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const messageId = c.req.param("messageId");
  const preview = (c.req.query("preview") ?? "1") !== "0";
  const rangeHeader = c.req.header("Range");

  try {
    // 永続メディアは Bun.file から直接返し、動画を JS heap へ読み込まない。
    const cached = await statMediaStorage(accountId, chatMid, messageId);
    if (cached) {
      return storedMediaResponse(cached, rangeHeader);
    }
    // Plain originals can be copied from LINE to disk with constant JS-heap use.
    // Preview bodies are never written under the original media key, and E2EE
    // stays on the buffered decrypt path below.
    if (!preview) {
      const streamed = await fetchPlainMessageMediaToStorage(accountId, chatMid, messageId);
      if (streamed) return storedMediaResponse(streamed, rangeHeader);
    }
    const fetched = await fetchMessageMedia(accountId, chatMid, messageId, preview);
    if ("stored" in fetched) {
      return storedMediaResponse(fetched.stored, rangeHeader);
    }
    const { bytes, contentType } = fetched;
    // OBS preview を原本キーへ保存すると、その後 preview=0 でもサムネイルを返してしまう。
    // 原本要求だけ永続化し、保存後は同じストリーム/Range 経路で返す。
    if (!preview) {
      await writeMediaStorage(accountId, chatMid, messageId, bytes, contentType);
      const stored = await statMediaStorage(accountId, chatMid, messageId);
      if (stored) return storedMediaResponse(stored, rangeHeader);
    }
    return bufferedMediaResponse(bytes, contentType, rangeHeader);
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      return c.json({ ok: false, error: "not logged in" }, 401);
    }
    // 復号不能は 422（UI はプレースホルダ表示）。500 連打を避ける
    log.warn({ accountId, chatMid, messageId, err }, "media fetch failed");
    return c.json({ ok: false, error: "media unavailable" }, 422);
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

// ─── Binary media upload ──────────────────────

function decodeMediaFilename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    throw new MediaSendUploadError("invalid encoded media filename", 400);
  }
}

function mediaUploadMetadata(c: Context): MediaUploadMetadata {
  const metadata: MediaUploadMetadata = {};
  const mimeType = c.req.header("Content-Type");
  const filename = decodeMediaFilename(c.req.header("X-Vyline-Media-Filename"));
  const mediaType = c.req.header("X-Vyline-Media-Type") as StagedMediaType | undefined;
  if (mimeType) metadata.mimeType = mimeType;
  if (filename) metadata.filename = filename;
  if (mediaType) metadata.mediaType = mediaType;
  return metadata;
}

function serviceMediaOptions(metadata: MediaUploadMetadata): {
  mimeType?: string;
  filename?: string;
  mediaType?: StagedMediaType;
} {
  const options: {
    mimeType?: string;
    filename?: string;
    mediaType?: StagedMediaType;
  } = {};
  if (metadata.mimeType) options.mimeType = metadata.mimeType;
  if (metadata.filename) options.filename = metadata.filename;
  if (metadata.mediaType) options.mediaType = metadata.mediaType;
  return options;
}

function handleMediaUploadError(error: unknown, c: Context) {
  if (error instanceof MediaSendUploadError) {
    return c.json({ ok: false, error: error.message }, error.status);
  }
  return handleError(error, c);
}

// A Blob/File request body is streamed into VYLINE_DATA_DIR before LINE upload.
lineRouter.post("/:accountId/send-media", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.header("X-Vyline-Chat-Mid");
  if (!chatMid) return c.json({ ok: false, error: "X-Vyline-Chat-Mid required" }, 400);
  let upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>> | null = null;
  try {
    upload = await stageStandaloneMediaUpload(c.req.raw, mediaUploadMetadata(c));
    await sendMedia(
      accountId,
      chatMid,
      { path: upload.path, sizeBytes: upload.sizeBytes },
      serviceMediaOptions(upload),
    );
    return c.json({ ok: true });
  } catch (error) {
    return handleMediaUploadError(error, c);
  } finally {
    if (upload) await removeStandaloneMediaUpload(upload).catch(() => undefined);
  }
});

// Batch uploads stage each binary body independently, then preserve the existing
// reqseq/subordinate-message service flow when complete is called.
lineRouter.post("/:accountId/send-media-batch/start", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const body = await c.req.json<{ chatMid?: string; itemCount?: number }>();
    if (!body.chatMid) throw new MediaSendUploadError("chatMid required", 400);
    const upload = await createMediaBatchUpload(accountId, body.chatMid, Number(body.itemCount));
    return c.json({ ok: true, ...upload });
  } catch (error) {
    return handleMediaUploadError(error, c);
  }
});

lineRouter.post("/:accountId/send-media-batch/:uploadId/items/:index", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const result = await stageMediaBatchItem(
      accountId,
      c.req.param("uploadId"),
      Number(c.req.param("index")),
      c.req.raw,
      mediaUploadMetadata(c),
    );
    return c.json({ ok: true, ...result });
  } catch (error) {
    return handleMediaUploadError(error, c);
  }
});

lineRouter.post("/:accountId/send-media-batch/:uploadId/complete", async (c) => {
  const accountId = c.req.param("accountId");
  const uploadId = c.req.param("uploadId");
  let completing = false;
  try {
    const staged = completeMediaBatchUpload(accountId, uploadId);
    completing = true;
    const count = await sendMediaBatch(accountId, staged.chatMid, staged.items);
    return c.json({ ok: true, count });
  } catch (error) {
    return handleMediaUploadError(error, c);
  } finally {
    if (completing) {
      await removeMediaBatchUpload(accountId, uploadId, true).catch(() => undefined);
    }
  }
});

lineRouter.delete("/:accountId/send-media-batch/:uploadId", async (c) => {
  try {
    await removeMediaBatchUpload(c.req.param("accountId"), c.req.param("uploadId"));
    return c.json({ ok: true });
  } catch (error) {
    return handleMediaUploadError(error, c);
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

lineRouter.post("/:accountId/read-batch", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    targets?: Array<{ chatMid?: string; lastMessageId?: string }>;
  }>();
  const targets = (body.targets ?? [])
    .filter((target) => target.chatMid && target.lastMessageId)
    .map((target) => ({ chatMid: target.chatMid!, lastMessageId: target.lastMessageId! }));
  if (targets.length === 0) return c.json({ ok: false, error: "targets required" }, 400);
  try {
    return c.json({ ok: true, count: await markAsReadBatch(accountId, targets) });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/read-all", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req
    .json<{ chatMids?: string[] }>()
    .catch(() => ({}) as { chatMids?: string[] });
  try {
    return c.json({ ok: true, count: await markAllAsRead(accountId, body.chatMids) });
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
  const force = c.req.query("force") === "1";
  const messageIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (messageIds.length === 0) {
    return c.json({ ok: false, error: "ids query required" }, 400);
  }

  // 同一チャットでも要求する messageIds が違えば結果も違う。
  const inflightKey = `${accountId}:${chatMid}:${force ? "force:" : ""}${[...new Set(messageIds)].sort().join(",")}`;

  try {
    const existing = readReceiptInflight.get(inflightKey);
    const task =
      existing ??
      (() => {
        const p = (async (): Promise<ReadReceiptPayload> => {
          const result = await getReadReceiptsForChat(accountId, chatMid, messageIds, { force });
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
// 再取得可能な CDN / アイコンキャッシュだけを削除する。
// 送信済みメディアは /saved-media で明示的に削除する。

lineRouter.delete("/:accountId/vyline/cache", async (c) => {
  try {
    const [{ clearCdnCache }, { clearIconCache }] = await Promise.all([
      import("../storage/cdnAssetCache.js"),
      import("../storage/cdnAssetCache.js"),
    ]);
    const [cdnRemoved, iconRemoved] = await Promise.all([clearCdnCache(), clearIconCache()]);
    const { invalidateVylineStorageInfoCache } = await import("../storage/vylineStorageInfo.js");
    invalidateVylineStorageInfoCache();
    const removed = cdnRemoved + iconRemoved;
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
  let upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>> | null = null;
  try {
    upload = await stageStandaloneMediaUpload(
      c.req.raw,
      mediaUploadMetadata(c),
      IMAGE_UPLOAD_MAX_BYTES,
    );
    const result = await updateMyProfileImage(accountId, stagedUploadFile(upload, "image/jpeg"));
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleMediaUploadError(err, c);
  } finally {
    if (upload) await removeStandaloneMediaUpload(upload).catch(() => undefined);
  }
});

// ─── POST /line/:accountId/profile/background ─

lineRouter.post("/:accountId/profile/background", async (c) => {
  const accountId = c.req.param("accountId");
  let upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>> | null = null;
  try {
    upload = await stageStandaloneMediaUpload(
      c.req.raw,
      mediaUploadMetadata(c),
      IMAGE_UPLOAD_MAX_BYTES,
    );
    const result = await updateMyProfileBackground(
      accountId,
      stagedUploadFile(upload, "image/jpeg"),
    );
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleMediaUploadError(err, c);
  } finally {
    if (upload) await removeStandaloneMediaUpload(upload).catch(() => undefined);
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
  let upload: Awaited<ReturnType<typeof stageStandaloneMediaUpload>> | null = null;
  try {
    upload = await stageStandaloneMediaUpload(
      c.req.raw,
      mediaUploadMetadata(c),
      IMAGE_UPLOAD_MAX_BYTES,
    );
    const result = await updateChatPicture(
      accountId,
      chatMid,
      stagedUploadFile(upload, "image/jpeg"),
    );
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleMediaUploadError(err, c);
  } finally {
    if (upload) await removeStandaloneMediaUpload(upload).catch(() => undefined);
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

// ─── POST /line/:accountId/block-verification ─────────────
// Beta: authoritative friend/block-list check only; no message or sticker probe.
lineRouter.post("/:accountId/block-verification", async (c) => {
  const accountId = c.req.param("accountId");
  const body: { mid?: string } = await c.req.json<{ mid?: string }>().catch(() => ({}));
  try {
    const results = await verifyFriendBlockStatus(accountId, body.mid);
    return c.json({ ok: true, results });
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
    const result = await setNotificationsEnabled(accountId, body.enable);
    return c.json({ ok: true, ...result });
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

// ─── iTunes / Apple Devices: iOS バックアップ復元 ───

lineRouter.get("/:accountId/ios-backups", async (c) => {
  try {
    const { listIosBackups } = await import("../service/iosBackupService.js");
    const devices = await listIosBackups();
    return c.json({
      ok: true,
      devices: devices.map(({ backupRoot: _backupRoot, ...device }) => device),
    });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/restore/ios-backup", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const body = await c.req.json<{ udid?: string; password?: string }>();
    if (!body.udid || !body.password) {
      return c.json({ ok: false, error: "udid と password が必要です" }, 400);
    }
    const { startIosBackupRestore } = await import("../service/iosBackupService.js");
    const session = await startIosBackupRestore(accountId, body.udid, body.password);
    return c.json({ ok: true, sessionId: session.id });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/restore/ios-backup/:sessionId", async (c) => {
  const { getIosBackupSession } = await import("../service/iosBackupService.js");
  const session = getIosBackupSession(c.req.param("accountId"), c.req.param("sessionId"));
  return session
    ? c.json({ ok: true, session })
    : c.json({ ok: false, error: "復元セッションが見つかりません" }, 404);
});

// ─── Android: naver_line DB / LEINs バックアップ復元 ───

lineRouter.get("/:accountId/backup/storage", async (c) => {
  try {
    const { getBackupStorageUsage } = await import("../service/backupService.js");
    const { MAX_UPLOAD_BYTES, MAX_EXTRACT_BYTES } = await import(
      "../service/androidBackupService.js"
    );
    return c.json({
      ok: true,
      storage: await getBackupStorageUsage(c.req.param("accountId")),
      android: { maxUploadBytes: MAX_UPLOAD_BYTES, maxExtractBytes: MAX_EXTRACT_BYTES },
    });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/restore/android-backup", async (c) => {
  const accountId = c.req.param("accountId");
  if (!c.req.raw.body) {
    return c.json({ ok: false, error: "Androidバックアップファイルが必要です" }, 400);
  }
  try {
    const sourceName = c.req.header("X-Vyline-Backup-Name") ?? "naver_line";
    const includeMedia = c.req.query("includeMedia") === "1";
    const { startAndroidBackupRestore } = await import("../service/androidBackupService.js");
    const session = await startAndroidBackupRestore(accountId, sourceName, c.req.raw, includeMedia);
    return c.json({ ok: true, sessionId: session.id });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/restore/android-backup/chunked", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const body = await c.req.json<{
      sourceName?: string;
      includeMedia?: boolean;
      expectedBytes?: number;
    }>();
    const { createAndroidBackupChunkUpload } = await import("../service/androidBackupService.js");
    const upload = await createAndroidBackupChunkUpload(
      accountId,
      body.sourceName ?? "naver_line",
      body.includeMedia === true,
      Number(body.expectedBytes ?? 0),
    );
    return c.json({ ok: true, ...upload });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/restore/android-backup/chunked/:uploadId/chunks/:index", async (c) => {
  const accountId = c.req.param("accountId");
  if (!c.req.raw.body) {
    return c.json({ ok: false, error: "chunkデータが必要です" }, 400);
  }
  try {
    const { appendAndroidBackupChunk } = await import("../service/androidBackupService.js");
    const result = await appendAndroidBackupChunk(
      accountId,
      c.req.param("uploadId"),
      Number(c.req.param("index")),
      c.req.raw,
    );
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/restore/android-backup/chunked/:uploadId/complete", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { completeAndroidBackupChunkUpload } = await import("../service/androidBackupService.js");
    const session = await completeAndroidBackupChunkUpload(accountId, c.req.param("uploadId"));
    return c.json({ ok: true, sessionId: session.id });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/restore/android-backup/chunked/:uploadId", async (c) => {
  try {
    const { cancelAndroidBackupChunkUpload } = await import("../service/androidBackupService.js");
    await cancelAndroidBackupChunkUpload(c.req.param("accountId"), c.req.param("uploadId"));
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/restore/android-backup/:sessionId", async (c) => {
  const { getAndroidBackupSession } = await import("../service/androidBackupService.js");
  const session = getAndroidBackupSession(c.req.param("accountId"), c.req.param("sessionId"));
  return session
    ? c.json({ ok: true, session })
    : c.json({ ok: false, error: "復元セッションが見つかりません" }, 404);
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
  const { createBackup, BackupStorageLimitError } = await import("../service/backupService.js");
  try {
    const summary = await createBackup(accountId, {
      ...(body.chatMids?.length ? { chatMids: body.chatMids } : {}),
      includeMedia: body.includeMedia === true,
    });
    return c.json({ ok: true, summary });
  } catch (err) {
    if (err instanceof BackupStorageLimitError) {
      return c.json({ ok: false, code: "BACKUP_STORAGE_LIMIT", error: err.message }, 507);
    }
    return handleError(err, c);
  }
});

lineRouter.get("/:accountId/backup/list", async (c) => {
  const accountId = c.req.param("accountId");
  const { listBackups, getBackupStorageUsage } = await import("../service/backupService.js");
  try {
    const [data, storage] = await Promise.all([
      listBackups(accountId),
      getBackupStorageUsage(accountId),
    ]);
    return c.json({ ok: true, data, storage });
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

// ─── Credentials: encrypted handoff / channel-token lifecycle ───

lineRouter.post("/:accountId/credentials/handoff/export", async (c) => {
  const accountId = c.req.param("accountId");
  const { passphrase } = await c.req.json<{ passphrase: string }>();
  try {
    const { exportCredentialHandoff } = await import("../storage/tokenStore.js");
    return c.json({ ok: true, bundle: await exportCredentialHandoff(accountId, passphrase) });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/credentials/handoff/import", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    passphrase: string;
    bundle: import("../storage/tokenStore.js").CredentialHandoffBundle;
  }>();
  try {
    const { importCredentialHandoff } = await import("../storage/tokenStore.js");
    await importCredentialHandoff(body.bundle, body.passphrase, accountId);
    return c.json({ ok: true });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.post("/:accountId/credentials/channel/:channelId/reissue", async (c) => {
  const accountId = c.req.param("accountId");
  const channelId = c.req.param("channelId");
  try {
    const client = getClient(accountId);
    if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
    const base = client.base as typeof client.base & {
      channelTokens: { reissue(id: string, approve?: boolean): Promise<string> };
    };
    await base.channelTokens.reissue(channelId, true);
    return c.json({ ok: true, channelId, reissued: true });
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

lineRouter.delete("/:accountId/vyline/cache/cdn", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { clearCdnCache } = await import("../storage/cdnAssetCache.js");
    const removed = await clearCdnCache();
    const { invalidateVylineStorageInfoCache } = await import("../storage/vylineStorageInfo.js");
    invalidateVylineStorageInfoCache();
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
    const { invalidateVylineStorageInfoCache } = await import("../storage/vylineStorageInfo.js");
    invalidateVylineStorageInfoCache();
    return c.json({ ok: true, removed });
  } catch (err) {
    return handleError(err, c);
  }
});

lineRouter.delete("/:accountId/vyline/saved-media", async (c) => {
  const accountId = c.req.param("accountId");
  try {
    const { clearMediaStorage } = await import("../storage/mediaStorage.js");
    const removed = await clearMediaStorage();
    const { invalidateVylineStorageInfoCache } = await import("../storage/vylineStorageInfo.js");
    invalidateVylineStorageInfoCache();
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
    const { clearMediaStorageType } = await import("../storage/mediaStorage.js");
    const removed = await clearMediaStorageType(type as "image" | "video" | "audio" | "file");
    const { invalidateVylineStorageInfoCache } = await import("../storage/vylineStorageInfo.js");
    invalidateVylineStorageInfoCache();
    return c.json({ ok: true, removed, type });
  } catch (err) {
    return handleError(err, c);
  }
});
