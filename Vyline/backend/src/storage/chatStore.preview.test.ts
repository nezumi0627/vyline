import { describe, expect, test } from "bun:test";
import {
  fillPreviewFromStoredMessage,
  isRawCallHistoryPreview,
  previewForMessage,
  rebuildChatDbRecords,
  shouldPreserveResolvedLastMessagePreview,
  type ChatDbRecords,
  type StoredMessage,
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

  test("treats GC_DURATION zero as a group call marker", () => {
    expect(
      previewForMessage({
        ...base,
        contentType: "CALL",
        contentMetadata: { TYPE: "V", GC_DURATION: 0 },
      } as never),
    ).toBe("グループビデオ通話");
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

describe("fill empty list previews from stored history", () => {
  const chat = { mid: "u1", lastMessageId: "300", lastMessageTime: 300, lastMessagePreview: "" };
  const stored = (createdTime: number) =>
    ({
      id: String(createdTime),
      from: "u1",
      to: "u2",
      createdTime,
      text: "履歴の最後の文",
      contentType: "NONE",
    }) as StoredMessage;

  test("uses the stored message and its time when the history is up to date", () => {
    expect(fillPreviewFromStoredMessage(chat as never, stored(300))).toMatchObject({
      lastMessageId: "300",
      lastMessageTime: 300,
      lastMessagePreview: "履歴の最後の文",
    });
  });

  test("fills only the text when the list points to a message missing from the history", () => {
    expect(fillPreviewFromStoredMessage(chat as never, stored(100))).toMatchObject({
      lastMessageId: "300",
      lastMessageTime: 300,
      lastMessagePreview: "履歴の最後の文",
    });
  });

  test.each(["暗号化メッセージ", "UNSENT", "CHATEVENT"])(
    "preserves meaningful unresolved preview %s",
    (preview) => {
      const current = { ...chat, lastMessagePreview: preview };
      expect(fillPreviewFromStoredMessage(current as never, stored(100))).toBe(current as never);
    },
  );

  test.each(["NONE", "0"])("fills generic unresolved preview %s", (preview) => {
    const current = { ...chat, lastMessagePreview: preview };
    expect(fillPreviewFromStoredMessage(current as never, stored(300))).toMatchObject({
      lastMessagePreview: "履歴の最後の文",
    });
  });

  test("does not replace the summary message on an equal-time older ID", () => {
    const current = { ...chat, lastMessageId: "300", lastMessageTime: 300 };
    const result = fillPreviewFromStoredMessage(
      current as never,
      {
        ...stored(300),
        id: "299",
      } as StoredMessage,
    );
    expect(result).toMatchObject({ lastMessageId: "300", lastMessageTime: 300 });
  });

  test("uses the stored message on an equal-time newer ID", () => {
    const current = { ...chat, lastMessageId: "299", lastMessageTime: 300 };
    const result = fillPreviewFromStoredMessage(
      current as never,
      {
        ...stored(300),
        id: "300",
      } as StoredMessage,
    );
    expect(result).toMatchObject({ lastMessageId: "300", lastMessageTime: 300 });
  });

  test("keeps a resolved preview", () => {
    const resolved = { ...chat, lastMessagePreview: "要約の文" };
    expect(fillPreviewFromStoredMessage(resolved as never, stored(100))).toBe(resolved as never);
  });
});
