import { describe, expect, test } from "bun:test";
import { mapDesktopMessageRow, mergeRestoredDesktopChat } from "./desktopHistoryRestore.js";

describe("Desktop history normalization", () => {
  test("maps Desktop message rows without inventing read state", () => {
    const message = mapDesktopMessageRow(
      {
        _chatId: "c-group",
        _id: 123,
        _from: "u-sender",
        _to: null,
        _createdTime: 1_700_000_000_000,
        _text: "fixture only",
        _contentType: 0,
        _contentMetadata: '{"MENTION":"fixture"}',
      },
      "u-self",
      "2026-11-03T00:00:00.000Z",
    );

    expect(message).toMatchObject({
      id: "123",
      chatMid: "c-group",
      from: "u-sender",
      to: "c-group",
      contentType: "NONE",
      isMyMessage: false,
      contentMetadata: { MENTION: "fixture" },
    });
    expect(message).not.toHaveProperty("seen");
    expect(message).not.toHaveProperty("readCount");
    expect(message).not.toHaveProperty("readBy");
  });

  test("rejects malformed rows instead of storing under an unknown chat", () => {
    expect(
      mapDesktopMessageRow(
        {
          _chatId: "",
          _id: null,
          _from: "u-sender",
          _to: null,
          _createdTime: -1,
          _text: "ignored",
          _contentType: 0,
          _contentMetadata: null,
        },
        "u-self",
        "2026-11-03T00:00:00.000Z",
      ),
    ).toBeNull();
  });

  test("keeps current chat identity and unread state while marking restored history", () => {
    const chat = mergeRestoredDesktopChat(
      {
        mid: "u-peer",
        name: "Current name",
        kind: "direct",
        hasMessages: true,
        lastMessageTime: 2_000,
        lastMessageId: "20",
        thumbnailUrl: "current-avatar",
        unreadCount: 3,
      },
      { mid: "u-peer", name: "Old name", kind: "direct" },
      { id: "10", createdTime: 1_000, text: "old preview", contentType: "NONE" },
      "2026-11-03T00:00:00.000Z",
    );

    expect(chat).toMatchObject({
      name: "Current name",
      thumbnailUrl: "current-avatar",
      unreadCount: 3,
      lastMessageTime: 2_000,
      lastMessageId: "20",
      restoredHistory: true,
    });
  });
});
