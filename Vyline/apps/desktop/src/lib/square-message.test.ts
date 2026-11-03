import { describe, expect, test } from "bun:test";
import { getSquareStickerUrl } from "./square-message";

describe("getSquareStickerUrl", () => {
  test("uses the fixed CDN and prefers the captured custom sticker ID", () => {
    expect(
      getSquareStickerUrl({
        contentType: "STICKER",
        contentMetadata: { CSSTKID: "12345", STKID: "67890" },
      }),
    ).toBe("https://stickershop.line-scdn.net/stickershop/v1/sticker/12345/android/sticker.png");
  });

  test("supports animated sticker metadata and rejects untrusted path input", () => {
    expect(
      getSquareStickerUrl({ contentType: 7, contentMetadata: { STKID: "42", STKOPT: "A" } }),
    ).toContain("/42/android/sticker_animation.png");
    expect(
      getSquareStickerUrl({ contentType: "STICKER", contentMetadata: { STKID: "../evil" } }),
    ).toBeNull();
    expect(
      getSquareStickerUrl({ contentType: "IMAGE", contentMetadata: { STKID: "42" } }),
    ).toBeNull();
  });
});
