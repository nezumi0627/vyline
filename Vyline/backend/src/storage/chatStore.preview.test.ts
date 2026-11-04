import { describe, expect, test } from "bun:test";
import {
  isRawCallHistoryPreview,
  previewForMessage,
  rebuildChatDbRecords,
  shouldPreserveResolvedLastMessagePreview,
  type ChatDbRecords,
} from "./chatStore.js";

describe("chat preview preservation", () => {
  test("keeps a decrypted preview for the same encrypted message", () => {
    expect(
      shouldPreserveResolvedLastMessagePreview(
        { lastMessageId: "42", lastMessageTime: 100, lastMessagePreview: "復号済み本文" },
        { lastMessageId: "42", lastMessageTime: 100, lastMessagePreview: "暗号化メッセージ" },
      ),
    ).toBe(true);
  });

  test("does not preserve a preview for a different message", () => {
    expect(
      shouldPreserveResolvedLastMessagePreview(
        { lastMessageId: "41", lastMessageTime: 100, lastMessagePreview: "古い本文" },
        { lastMessageId: "42", lastMessageTime: 100, lastMessagePreview: "暗号化メッセージ" },
      ),
    ).toBe(false);
  });

  test("preserves the preview while rebuilding stored chat summaries", () => {
    const records: ChatDbRecords = {
      chats: {
        c1: {
          mid: "c1",
          name: "group",
          kind: "group",
          hasMessages: true,
          lastMessageId: "42",
          lastMessageTime: 100,
          lastMessagePreview: "復号済み本文",
          updatedAt: new Date().toISOString(),
        },
      },
      messages: {
        c1: {
          "42": {
            id: "42",
            chatMid: "c1",
            from: "u1",
            to: "c1",
            text: null,
            contentType: "NONE",
            createdTime: 100,
            isMyMessage: false,
            savedAt: new Date().toISOString(),
          },
        },
      },
    };

    rebuildChatDbRecords(records);
    expect(records.chats.c1?.lastMessagePreview).toBe("復号済み本文");
  });
});

describe("stored message preview", () => {
  const base = { id: "1", from: "u1", to: "u2", createdTime: 100, text: null };

  test("uses ALT_TEXT for rich and flex messages", () => {
    expect(
      previewForMessage({
        ...base,
        contentType: "RICH",
        contentMetadata: { ALT_TEXT: "本日発売のお知らせ" },
      } as never),
    ).toBe("本日発売のお知らせ");
    expect(
      previewForMessage({
        ...base,
        contentType: "FLEX",
        contentMetadata: { ALT_TEXT: "クーポンが届きました" },
      } as never),
    ).toBe("クーポンが届きました");
  });

  test("does not expose the raw call history text", () => {
    const call = { ...base, contentType: "CALL", text: "Call History : 0 millisecs, Result: 77" };
    expect(previewForMessage({ ...call, contentMetadata: {} } as never)).toBe("音声通話");
    expect(
      previewForMessage({ ...call, contentMetadata: { TYPE: "V", RESULT: "CANCELED" } } as never),
    ).toBe("不在着信 · ビデオ通話");
  });

  test("detects the raw call history text saved by older versions", () => {
    expect(isRawCallHistoryPreview("Call History : 0 millisecs, Result: 77")).toBe(true);
    expect(isRawCallHistoryPreview("音声通話")).toBe(false);
    expect(isRawCallHistoryPreview(undefined)).toBe(false);
  });

  test("does not expose raw content type names", () => {
    expect(previewForMessage({ ...base, contentType: "RICH" } as never)).toBe("リッチメッセージ");
    expect(previewForMessage({ ...base, contentType: "POSTNOTIFICATION" } as never)).toBe(
      "投稿のお知らせ",
    );
  });
});
