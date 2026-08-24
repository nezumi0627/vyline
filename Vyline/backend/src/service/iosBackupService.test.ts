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
});
