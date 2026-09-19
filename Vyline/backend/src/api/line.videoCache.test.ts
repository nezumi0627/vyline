import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "vyline-line-video-cache-"));
process.env.VYLINE_DATA_DIR = join(root, "data");
process.env.VYLINE_STORAGE_DIR = join(root, "storage");
process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");

const chatStore = await import("../storage/chatStore.js");
const mediaStorage = await import("../storage/mediaStorage.js");
const lineService = await import("../service/lineService.js");
const { lineRouter } = await import("./lineMediaCompat.js");

const accountId = "legacy-video-cache";
const chatMid = "c-video-cache";

afterEach(() => mock.restore());
afterAll(async () => {
  await chatStore.releaseAccountChatCache(accountId);
  await mediaStorage.clearMediaStorageForAccount(accountId);
  await rm(root, { recursive: true, force: true });
});

test("original video request evicts a legacy preview image cached under the media key", async () => {
  const messageId = "m-video-cache";
  await chatStore.upsertMessages(accountId, chatMid, [
    {
      id: messageId,
      chatMid,
      from: "u-peer",
      to: "u-self",
      text: null,
      contentType: "VIDEO",
      createdTime: Date.now(),
      isMyMessage: false,
      contentMetadata: {},
      savedAt: new Date().toISOString(),
    },
  ]);

  // This is the state left by older builds: thumbnail bytes occupy the original key.
  await mediaStorage.writeMediaStorage(
    accountId,
    chatMid,
    messageId,
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    "image/jpeg",
  );
  expect((await mediaStorage.statMediaStorage(accountId, chatMid, messageId))?.mediaType).toBe(
    "image",
  );

  const fetchMedia = spyOn(lineService, "fetchMessageMedia").mockResolvedValue({
    bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
    contentType: "video/mp4",
  });

  const response = await lineRouter.request(
    `http://localhost/${accountId}/media/${chatMid}/${messageId}?preview=0`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("video/mp4");
  expect(fetchMedia).toHaveBeenCalledTimes(1);
  expect(await mediaStorage.statMediaStorage(accountId, chatMid, messageId)).toBeNull();
});

test("preview request keeps the legacy thumbnail until an original video is requested", async () => {
  const messageId = "m-video-preview";
  await chatStore.upsertMessages(accountId, chatMid, [
    {
      id: messageId,
      chatMid,
      from: "u-peer",
      to: "u-self",
      text: null,
      contentType: "VIDEO",
      createdTime: Date.now(),
      isMyMessage: false,
      contentMetadata: {},
      savedAt: new Date().toISOString(),
    },
  ]);
  const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await mediaStorage.writeMediaStorage(accountId, chatMid, messageId, thumbnail, "image/jpeg");

  const fetchMedia = spyOn(lineService, "fetchMessageMedia");
  const response = await lineRouter.request(
    `http://localhost/${accountId}/media/${chatMid}/${messageId}?preview=1`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(thumbnail);
  expect(fetchMedia).not.toHaveBeenCalled();
  expect((await mediaStorage.statMediaStorage(accountId, chatMid, messageId))?.mediaType).toBe(
    "image",
  );
});
