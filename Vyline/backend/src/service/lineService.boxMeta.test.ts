import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "vyline-boxmeta-"));
process.env.VYLINE_DATA_DIR = dataDir;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("No network in boxMeta regressions");
}) as unknown as typeof fetch;

const { boxMeta, incomingIdFromRawMessages } = await import("./lineService.js");

afterAll(() => {
  globalThis.fetch = originalFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("chat list box meta", () => {
  test("skips CHATEVENT and uses the previous normal message", () => {
    const meta = boxMeta({
      lastDeliveredMessageId: { messageId: 300n, deliveredTime: 3000n },
      lastMessages: [
        { id: "300", contentType: "CHATEVENT", deliveredTime: 3000 },
        { id: "200", contentType: "NONE", text: "会議室空いてないよ", createdTime: 2000 },
      ],
    });
    expect(meta.lastMessagePreview).toBe("会議室空いてないよ");
    expect(meta.lastMessageTime).toBe(2000);
    expect(meta.lastMessageId).toBe("200");
  });

  test("shows neither preview nor time when only events remain", () => {
    const meta = boxMeta({
      lastDeliveredMessageId: { messageId: 300n, deliveredTime: 3000n },
      lastMessages: [{ id: "300", contentType: 18, deliveredTime: 3000 }],
    });
    expect(meta.lastMessagePreview).toBe("");
    expect(meta.lastMessageTime).toBe(0);
    expect(meta.lastMessageId).toBeUndefined();
  });

  test("keeps normal messages unchanged", () => {
    const meta = boxMeta({
      lastDeliveredMessageId: { messageId: 400n, deliveredTime: 4000n },
      lastMessages: [{ id: "400", contentType: "NONE", text: "こんにちは", deliveredTime: 4000 }],
    });
    expect(meta.lastMessagePreview).toBe("こんにちは");
    expect(meta.lastMessageTime).toBe(4000);
    expect(meta.lastMessageId).toBe("400");
  });

  test("finds the latest incoming message behind an outgoing message", () => {
    const meta = boxMeta(
      {
        lastDeliveredMessageId: { messageId: 300n, deliveredTime: 3000n },
        lastMessages: [
          { id: "300", from: "u-self", contentType: "NONE", text: "sent", deliveredTime: 3000 },
          { id: "250", from: "u-peer", contentType: "NONE", text: "received", deliveredTime: 2500 },
        ],
      },
      "u-self",
    );

    expect(meta.lastMessageId).toBe("300");
    expect(meta.lastIncomingMessageId).toBe("250");
  });

  test("finds an incoming watermark beyond two consecutive outgoing messages", () => {
    const meta = boxMeta(
      {
        lastDeliveredMessageId: { messageId: 300n, deliveredTime: 3000n },
        lastMessages: [
          { id: "300", from: "u-self", contentType: "NONE", deliveredTime: 3000 },
          { id: "290", from: "u-self", contentType: "NONE", deliveredTime: 2900 },
          { id: "280", from: "u-peer", contentType: "NONE", deliveredTime: 2800 },
        ],
      },
      "u-self",
    );

    expect(meta.lastMessageId).toBe("300");
    expect(meta.lastIncomingMessageId).toBe("280");
  });

  test("finds the latest incoming ID from history beyond the MessageBox window", () => {
    const messages = Array.from({ length: 240 }, (_, index) => ({
      id: String(500 - index),
      from: "u-self",
      contentType: "NONE",
    }));
    messages[239] = { id: "260", from: "u-peer", contentType: "NONE" };
    messages[238] = { id: "261", from: "u-self", contentType: "NONE" };

    expect(incomingIdFromRawMessages(messages, "u-self")).toBe("260");
  });
});
