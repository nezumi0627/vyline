import { expect, test } from "bun:test";
import type { Message as LineMessage } from "@vyline/types";
import { mapMessage } from "./mappers";

function lineMessage(overrides: Partial<LineMessage>): LineMessage {
  return {
    id: "message-1",
    from: "u-peer",
    to: "u-self",
    contentType: "TEXT",
    text: "",
    createdTime: 1,
    contentMetadata: {},
    isMyMessage: false,
    ...overrides,
  } as LineMessage;
}

const stickerCdnUrl =
  "https://stickershop.line-scdn.net/stickershop/v1/sticker/796164654/android/sticker.png";
const stickerProxyUrl = `/api/cdn/line?u=${encodeURIComponent(stickerCdnUrl)}`;

test("renders a sticker CDN URL stored as message text as an image", () => {
  const mapped = mapMessage(lineMessage({ text: stickerProxyUrl }), "u-chat", "account-1");

  expect(mapped.kind).toBe("image");
  expect(mapped.imageSrc).toBe(stickerProxyUrl);
});

test("keeps IMAGE content as a normal media message even with sticker metadata and URL text", () => {
  const mapped = mapMessage(
    lineMessage({
      contentType: "IMAGE",
      text: stickerProxyUrl,
      contentMetadata: { STKID: "796164654" },
    }),
    "u-chat",
    "account-1",
  );

  expect(mapped.kind).toBe("image");
  expect(mapped.imageSrc).toBe("/api/line/account-1/media/u-chat/message-1?preview=1&save=1");
});

test("does not persist media when automatic saving is disabled", () => {
  const mapped = mapMessage(lineMessage({ contentType: "IMAGE" }), "u-chat", "account-1", undefined, false);
  expect(mapped.imageSrc).toBe("/api/line/account-1/media/u-chat/message-1?preview=1&save=0");
});

test("does not convert unrelated image URLs in ordinary text to images", () => {
  const mapped = mapMessage(
    lineMessage({ text: "https://example.com/photo.png" }),
    "u-chat",
    "account-1",
  );

  expect(mapped.kind).toBe("text");
  expect(mapped.imageSrc).toBeUndefined();
});

test("does not expose the raw CHATEVENT marker when localized event data is absent", () => {
  const mapped = mapMessage(
    lineMessage({ contentType: "CHATEVENT", text: "(CHATEVENT)", contentMetadata: {} }),
    "u-chat",
    "account-1",
  );

  expect(mapped.kind).toBe("system");
  expect(mapped.text).toBe("チャットイベント");
});
