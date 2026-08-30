import { describe, expect, it } from "bun:test";
import type { Chat, Message } from "../types/index.js";
import {
  hydrateBootstrapChatPreviews,
  isSameLastMessage,
  isUnresolvedChatPreview,
  mergeResolvedChatPreviews,
} from "./chatPreview.js";

function chat(
  mid: string,
  lastMessageId: string,
  lastMessageTime: number,
  lastMessagePreview: string,
): Chat {
  return {
    mid,
    name: mid,
    hasMessages: true,
    kind: "direct",
    lastMessageId,
    lastMessageTime,
    lastMessagePreview,
  };
}

function message(id: string, createdTime: number, text: string): Message {
  return {
    id,
    from: "u-peer",
    to: "u-me",
    text,
    contentType: "NONE",
    createdTime,
    isMyMessage: false,
  };
}

describe("chat preview hydration", () => {
  it("recognizes placeholders that must not overwrite a resolved preview", () => {
    expect(isUnresolvedChatPreview("暗号化メッセージ")).toBe(true);
    expect(isUnresolvedChatPreview("UNSENT")).toBe(true);
    expect(isUnresolvedChatPreview("hello")).toBe(false);
  });

  it("preserves a resolved preview for the same message during a light refresh", () => {
    const previous = [chat("u-chat", "100", 1000, "あなた: hello")];
    const incoming = [chat("u-chat", "100", 1000, "暗号化メッセージ")];

    expect(mergeResolvedChatPreviews(previous, incoming)[0]?.lastMessagePreview).toBe(
      "あなた: hello",
    );
  });

  it("does not preserve a stale preview when a newer message arrived", () => {
    const previous = [chat("u-chat", "100", 1000, "old")];
    const incoming = [chat("u-chat", "101", 1100, "暗号化メッセージ")];

    expect(mergeResolvedChatPreviews(previous, incoming)[0]?.lastMessagePreview).toBe(
      "暗号化メッセージ",
    );
    expect(isSameLastMessage(previous[0]!, incoming[0]!)).toBe(false);
  });

  it("hydrates the list from the newest decoded bootstrap message without opening a chat", () => {
    const chats = [chat("u-chat", "100", 1000, "暗号化メッセージ")];
    const messagesByChat = { "u-chat": [message("100", 1000, "hello")] };

    expect(
      hydrateBootstrapChatPreviews(chats, messagesByChat, (m) => m.text ?? "")[0]
        ?.lastMessagePreview,
    ).toBe("hello");
  });

  it("ignores a bootstrap message that is older than the chat cursor", () => {
    const chats = [chat("u-chat", "101", 1100, "暗号化メッセージ")];
    const messagesByChat = { "u-chat": [message("100", 1000, "old")] };

    expect(
      hydrateBootstrapChatPreviews(chats, messagesByChat, (m) => m.text ?? "")[0]
        ?.lastMessagePreview,
    ).toBe("暗号化メッセージ");
  });
});
