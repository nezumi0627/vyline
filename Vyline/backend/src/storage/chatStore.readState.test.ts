import { describe, expect, test } from "bun:test";
import { applyLocalReadWatermark, mergeStoredReadState, type StoredMessage } from "./chatStore.js";

describe("mergeStoredReadState", () => {
  test("does not turn an unknown group message into read", () => {
    expect(mergeStoredReadState(undefined, {})).toEqual({});
  });

  test("keeps persisted readers when a later response omits them", () => {
    expect(
      mergeStoredReadState({ readBy: ["u-reader-1"], readCount: 1 }, { readBy: [], readCount: 0 }),
    ).toEqual({ readCount: 1, readBy: ["u-reader-1"] });
  });

  test("never rolls a persisted seen flag back to unread", () => {
    expect(mergeStoredReadState({ seen: true }, { seen: false })).toEqual({ seen: true });
  });
});

describe("applyLocalReadWatermark", () => {
  test("marks every received message through the confirmed read point without changing own receipts", () => {
    const messages: Record<string, StoredMessage> = {
      "100": {
        id: "100",
        chatMid: "u-chat",
        from: "u-peer",
        to: "u-me",
        text: "old",
        contentType: "NONE",
        createdTime: 1,
        isMyMessage: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
      "101": {
        id: "101",
        chatMid: "u-chat",
        from: "u-me",
        to: "u-peer",
        text: "mine",
        contentType: "NONE",
        createdTime: 2,
        isMyMessage: true,
        seen: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
      "102": {
        id: "102",
        chatMid: "u-chat",
        from: "u-peer",
        to: "u-me",
        text: "read",
        contentType: "NONE",
        createdTime: 3,
        isMyMessage: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
      "103": {
        id: "103",
        chatMid: "u-chat",
        from: "u-peer",
        to: "u-me",
        text: "unread",
        contentType: "NONE",
        createdTime: 4,
        isMyMessage: false,
        savedAt: "2026-08-24T00:00:00.000Z",
      },
    };

    applyLocalReadWatermark(messages, "102");

    expect(messages["100"]?.seen).toBe(true);
    expect(messages["101"]?.seen).toBe(false);
    expect(messages["102"]?.seen).toBe(true);
    expect(messages["103"]?.seen).toBeUndefined();
  });
});
