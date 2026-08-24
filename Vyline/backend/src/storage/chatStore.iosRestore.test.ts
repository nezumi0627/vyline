import { describe, expect, test } from "bun:test";
import {
  mergeChatDbRecords,
  type ChatDbRecords,
  type StoredChat,
  type StoredMessage,
} from "./chatStore.js";

function chat(mid: string, name: string, lastMessageTime = 100): StoredChat {
  return {
    mid,
    name,
    kind: "direct",
    hasMessages: true,
    lastMessageTime,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function message(id: string, chatMid: string, text: string): StoredMessage {
  return {
    id,
    chatMid,
    from: "u-sender",
    to: chatMid,
    text,
    contentType: "NONE",
    createdTime: 100,
    isMyMessage: false,
    savedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("mergeChatDbRecords", () => {
  test("adds missing iOS records without overwriting existing records", () => {
    const target: ChatDbRecords = {
      chats: { "u-chat": chat("u-chat", "Local name", 500) },
      messages: { "u-chat": { "1": message("1", "u-chat", "local") } },
    };

    const result = mergeChatDbRecords(target, {
      chats: {
        "u-chat": chat("u-chat", "Backup name", 700),
        "u-new": chat("u-new", "Imported chat", 200),
      },
      messages: {
        "u-chat": {
          "1": message("1", "u-chat", "backup duplicate"),
          "2": message("2", "u-chat", "imported"),
        },
        "u-new": { "3": message("3", "u-new", "new") },
      },
    });

    expect(result).toEqual({
      importedChats: 1,
      skippedChats: 1,
      importedMessages: 2,
      skippedMessages: 1,
    });
    expect(target.chats["u-chat"]?.name).toBe("Local name");
    expect(target.chats["u-chat"]?.lastMessageTime).toBe(700);
    expect(target.messages["u-chat"]?.["1"]?.text).toBe("local");
    expect(target.messages["u-chat"]?.["2"]?.text).toBe("imported");
  });

  test("is idempotent when the same backup is merged twice", () => {
    const target: ChatDbRecords = { chats: {}, messages: {} };
    const incoming = {
      chats: { "u-chat": chat("u-chat", "Imported chat") },
      messages: { "u-chat": { "1": message("1", "u-chat", "imported") } },
    };

    expect(mergeChatDbRecords(target, incoming)).toEqual({
      importedChats: 1,
      skippedChats: 0,
      importedMessages: 1,
      skippedMessages: 0,
    });
    expect(mergeChatDbRecords(target, incoming)).toEqual({
      importedChats: 0,
      skippedChats: 1,
      importedMessages: 0,
      skippedMessages: 1,
    });
  });
});
