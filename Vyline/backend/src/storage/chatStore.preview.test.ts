import { describe, expect, test } from "bun:test";
import {
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
