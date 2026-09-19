import { Hono } from "hono";
import { lineRouter as baseLineRouter } from "./line.js";
import { findStoredMessageById } from "../storage/chatStore.js";
import { removeMediaStorageEntry, statMediaStorage } from "../storage/mediaStorage.js";

function isVideoContentType(contentType: unknown): boolean {
  return contentType === 2 || String(contentType ?? "").toUpperCase() === "VIDEO";
}

/**
 * Older builds could persist preview thumbnails under the same key as original media.
 * For videos that leaves a JPEG in the saved-media cache, so a later <video> request
 * receives a still image and stays at 0:00 forever. New preview responses no longer
 * write to that key, but existing installations still need the poisoned entry removed.
 */
async function evictLegacyVideoPreview(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<void> {
  const cached = await statMediaStorage(accountId, chatMid, messageId);
  if (!cached || cached.mediaType !== "image") return;

  const stored = await findStoredMessageById(accountId, messageId);
  if (!stored || stored.chatMid !== chatMid || !isVideoContentType(stored.message.contentType))
    return;

  await removeMediaStorageEntry(accountId, chatMid, messageId);
}

export const lineRouter = new Hono();

lineRouter.use("/:accountId/media/:chatMid/:messageId", async (c, next) => {
  if (c.req.query("preview") === "0") {
    // Cache cleanup is best-effort: an index/read failure must not turn a media GET
    // into a new server error. The existing line router remains the source of truth.
    await evictLegacyVideoPreview(
      c.req.param("accountId"),
      c.req.param("chatMid"),
      c.req.param("messageId"),
    ).catch(() => undefined);
  }
  await next();
});

lineRouter.route("/", baseLineRouter);
