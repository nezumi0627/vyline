import { describe, expect, test } from "bun:test";
import { buildAgentIBody, extractAgentIText } from "./agentIService.js";

describe("Agent I request contract", () => {
  test("builds a bounded multi-turn request without raw LINE metadata", () => {
    const body = buildAgentIBody("返信を丁寧にして", [
      { role: "user", text: "明日の予定は？" },
      { role: "assistant", text: "予定を確認します。" },
    ]);

    expect(body.chats).toEqual([
      {
        id: expect.any(String),
        role: "user",
        contents: [{ type: "text", text: "明日の予定は？" }],
      },
      {
        id: expect.any(String),
        role: "assistant",
        contents: [{ type: "text", text: "予定を確認します。" }],
      },
      {
        id: expect.any(String),
        role: "user",
        contents: [{ type: "text", text: "返信を丁寧にして" }],
      },
    ]);
    expect(body.context.agentMode).toBe("multi");
    expect(JSON.stringify(body)).not.toContain("chatMid");
  });

  test("extracts text deltas from SSE payloads", () => {
    const sse = [
      'event: message\ndata: {"type":"compositeMessage-delta","text":"こんにちは"}\n\n',
      'data: {"delta":{"text":"世界"}}\n\n',
    ].join("");

    expect(extractAgentIText(sse)).toBe("こんにちは世界");
  });

  test("does not expose Agent I control event names as the answer", () => {
    const sse = [
      'data: {"type":"agentstate"}\n\n',
      'data: {"type":"compositeMessage-start"}\n\n',
      'data: {"type":"compositeMessage-delta"}\n\n',
      'data: {"type":"attachment"}\n\n',
      'data: {"type":"execution-end"}\n\n',
    ].join("");

    expect(extractAgentIText(sse)).toBe("");
  });

  test("extracts the current Yahoo value.message delta shape", () => {
    const sse = [
      'data: {"type":"compositeMessage-delta","value":{"message":"こんにちは"}}\n\n',
      'data: {"type":"compositeMessage-delta","value":{"message":"世界"}}\n\n',
    ].join("");

    expect(extractAgentIText(sse)).toBe("こんにちは世界");
  });
});
