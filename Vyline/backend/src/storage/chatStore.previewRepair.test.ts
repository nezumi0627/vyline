import { describe, expect, test } from "bun:test";
import {
  repairStoredChatSummaries,
  type ChatDbRecords,
  type StoredMessage,
} from "./chatStore.js";

function storedMessage(chatMid: string, id: string, createdTime: number, text: string): StoredMessage {
  return {
    id,
    chatMid,
    from: "u-peer",
    to: "u-self",
    text,
    contentType: "NONE",
    createdTime,
    isMyMessage: false,
    savedAt: new Date(createdTime).toISOString(),
  };
}

describe("legacy chat summary repair", () => {
  test("restores an old chat preview without opening the talk", () => {
    const target: ChatDbRecords = {
      chats: {
        "u-old": {
          mid: "u-old",
          name: "Old chat",
          kind: "direct",
          hasMessages: true,
          lastMessageTime: 100,
          lastMessageId: "10",
          lastMessagePreview: "",
          updatedAt: new Date(100).toISOString(),
        },
      },
      messages: {
        "u-old": {
          "10": storedMessage("u-old", "10", 100, "old but visible"),
        },
      },
    };

    expect(repairStoredChatSummaries(target)).toBe(1);
    expect(target.chats["u-old"]?.lastMessagePreview).toBe("old but visible");
  });

  test("does not move a live chat cursor backwards", () => {
    const target: ChatDbRecords = {
      chats: {
        "u-live": {
          mid: "u-live",
          name: "Live chat",
          kind: "direct",
          hasMessages: true,
          lastMessageTime: 200,
          lastMessageId: "20",
          lastMessagePreview: "暗号化メッセージ",
          updatedAt: new Date(200).toISOString(),
        },
      },
      messages: {
        "u-live": {
          "10": storedMessage("u-live", "10", 100, "older local message"),
        },
      },
    };

    expect(repairStoredChatSummaries(target)).toBe(0);
    expect(target.chats["u-live"]?.lastMessageId).toBe("20");
  });

  test("uses an older stored message when a newer chat event has no useful preview", () => {
    const target: ChatDbRecords = {
      chats: {
        "c-event": {
          mid: "c-event",
          name: "Event group",
          kind: "group",
          hasMessages: true,
          lastMessageTime: 500,
          lastMessageId: "50",
          lastMessagePreview: "CHATEVENT",
          updatedAt: new Date(500).toISOString(),
        },
      },
      messages: {
        "c-event": {
          "40": storedMessage("c-event", "40", 400, "イベント前の最後の本文"),
        },
      },
    };

    expect(repairStoredChatSummaries(target)).toBe(1);
    expect(target.chats["c-event"]?.lastMessagePreview).toBe("イベント前の最後の本文");
    expect(target.chats["c-event"]?.lastMessageId).toBe("50");
    expect(target.chats["c-event"]?.lastMessageTime).toBe(500);
  });

  test("replaces legacy CHATEVENT and stale same-cursor previews from the stored message", () => {
    const target: ChatDbRecords = {
      chats: {
        "c-old": {
          mid: "c-old",
          name: "Old group",
          kind: "group",
          hasMessages: true,
          lastMessageTime: 300,
          lastMessageId: "30",
          lastMessagePreview: "CHATEVENT",
          updatedAt: new Date(300).toISOString(),
        },
      },
      messages: {
        "c-old": {
          "30": storedMessage("c-old", "30", 300, "復元された最後のメッセージ"),
        },
      },
    };

    expect(repairStoredChatSummaries(target)).toBe(1);
    expect(target.chats["c-old"]?.lastMessagePreview).toBe("復元された最後のメッセージ");
  });

});
