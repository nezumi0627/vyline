import { describe, expect, test } from "bun:test";
import { historyToChatDb } from "./iosBackupService.js";

describe("historyToChatDb", () => {
  test("maps iOS records into the existing chatdb shape", () => {
    const result = historyToChatDb(
      {
        account: "u-me",
        exportedAt: "2026-08-24T00:00:00.000Z",
        chats: [
          {
            chatMid: "u-peer",
            kind: "dm",
            name: "Peer",
            count: 1,
            firstIso: null,
            lastIso: null,
            file: "u-peer.jsonl",
          },
        ],
        messages: new Map([
          [
            "u-peer",
            [
              {
                id: 42,
                ts: 1_755_984_000_000,
                iso: null,
                contentType: 0,
                sendStatus: 0,
                fromMid: "u-peer",
                fromName: "Peer",
                text: "hello",
                contentMetadata: null,
              },
            ],
          ],
        ]),
      },
      "u-account-fallback",
    );

    expect(result.chats["u-peer"]?.kind).toBe("direct");
    expect(result.messages["u-peer"]?.["42"]).toMatchObject({
      id: "42",
      from: "u-peer",
      to: "u-me",
      contentType: "NONE",
      text: "hello",
      isMyMessage: false,
    });
  });

  test("keeps received group messages addressed to the group chat", () => {
    const result = historyToChatDb(
      {
        account: "u-me",
        exportedAt: "2026-08-24T00:00:00.000Z",
        chats: [
          {
            chatMid: "c-group",
            kind: "group",
            name: "Group",
            count: 1,
            firstIso: null,
            lastIso: null,
            file: "c-group.jsonl",
          },
        ],
        messages: new Map([
          [
            "c-group",
            [
              {
                id: 99,
                ts: 1_755_984_000_000,
                iso: null,
                contentType: 0,
                sendStatus: 0,
                fromMid: "u-peer",
                fromName: "Peer",
                text: "group hello",
                contentMetadata: null,
              },
            ],
          ],
        ]),
      },
      "u-account-fallback",
    );

    expect(result.messages["c-group"]?.["99"]).toMatchObject({
      from: "u-peer",
      to: "c-group",
      isMyMessage: false,
    });
  });
});
