import { describe, expect, test } from "bun:test";
import {
  compareMessagesNewestFirst,
  mergeChatDbRecords,
  rebuildChatDbRecords,
  shouldPreserveResolvedLastMessagePreview,
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
  test("uses message ID as a stable tie-breaker for equal timestamps", () => {
    const sameTime = [message("10", "u-chat", "later"), message("9", "u-chat", "earlier")];
    expect(sameTime.sort(compareMessagesNewestFirst).map((item) => item.id)).toEqual(["10", "9"]);
  });

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
    expect(target.chats["u-chat"]?.lastMessageTime).toBe(100);
    expect(target.messages["u-chat"]?.["1"]?.text).toBe("local");
    expect(target.messages["u-chat"]?.["2"]?.text).toBe("imported");
  });


  test("repairs legacy restored group recipients and preserves restored-history flag", () => {
    const restoredGroup = chat("c-group", "Restored group", 100);
    restoredGroup.kind = "group";
    restoredGroup.restoredHistory = true;
    const received = message("1", "c-group", "from peer");
    received.from = "u-peer";
    received.to = "u-me"; // legacy restore bug
    received.isMyMessage = false;
    const target: ChatDbRecords = {
      chats: { "c-group": restoredGroup },
      messages: { "c-group": { "1": received } },
    };

    rebuildChatDbRecords(target);

    expect(target.messages["c-group"]?.["1"]?.to).toBe("c-group");
    expect(target.chats["c-group"]?.restoredHistory).toBe(true);
  });

  test("repairs a cached c* chat to group and keeps restored-history visibility", () => {
    const existing = chat("c-group", "c-group", 500);
    existing.kind = "direct";
    const imported = chat("c-group", "Restored group", 400);
    imported.kind = "group";
    imported.restoredHistory = true;
    const target: ChatDbRecords = {
      chats: { "c-group": existing },
      messages: { "c-group": { "1": message("1", "c-group", "local") } },
    };

    mergeChatDbRecords(target, {
      chats: { "c-group": imported },
      messages: { "c-group": { "2": message("2", "c-group", "restored") } },
    });

    expect(target.chats["c-group"]).toMatchObject({
      name: "Restored group",
      kind: "group",
      restoredHistory: true,
      hasMessages: true,
    });
    expect(target.messages["c-group"]?.["2"]?.text).toBe("restored");
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

  test("keeps local fields while filling missing text from the backup on an ID conflict", () => {
    const local = message("1", "u-chat", "");
    local.text = null;
    local.contentType = "NONE";
    const imported = message("1", "u-chat", "restored text");
    imported.contentType = "IMAGE";
    imported.contentMetadata = { FILE_NAME: "photo.jpg" };
    const target: ChatDbRecords = {
      chats: { "u-chat": chat("u-chat", "Local") },
      messages: { "u-chat": { "1": local } },
    };

    mergeChatDbRecords(target, { chats: {}, messages: { "u-chat": { "1": imported } } });

    expect(target.messages["u-chat"]?.["1"]?.text).toBe("restored text");
    expect(target.messages["u-chat"]?.["1"]?.contentType).toBe("IMAGE");
    expect(target.messages["u-chat"]?.["1"]?.contentMetadata?.FILE_NAME).toBe("photo.jpg");
  });
});

describe("chat-list preview persistence", () => {
  test(
    "keeps a resolved preview when a light sync returns an E2EE placeholder for the same message",
    () => {
      const existing = chat("u-chat", "Preview chat", 1000);
      existing.lastMessageId = "100";
      existing.lastMessagePreview = "あなた: hello";
      const incoming = chat("u-chat", "Preview chat", 1000);
      incoming.lastMessageId = "100";
      incoming.lastMessagePreview = "暗号化メッセージ";

      expect(shouldPreserveResolvedLastMessagePreview(existing, incoming)).toBe(true);

      incoming.lastMessageId = "101";
      expect(shouldPreserveResolvedLastMessagePreview(existing, incoming)).toBe(false);
    },
  );

  test("rebuilds a useful latest-message preview without opening the chat", () => {
    const own = message("20", "u-chat", "hello from me");
    own.isMyMessage = true;
    const target: ChatDbRecords = {
      chats: { "u-chat": chat("u-chat", "Preview chat", 100) },
      messages: { "u-chat": { "20": own } },
    };

    rebuildChatDbRecords(target);

    expect(target.chats["u-chat"]?.lastMessagePreview).toBe("あなた: hello from me");
    expect(target.chats["u-chat"]?.lastMessageId).toBe("20");
  });
});
