import { describe, expect, test } from "bun:test";
import {
  buildAgentIBody,
  clearAgentIYahooCookie,
  extractAgentIText,
  readBoundedAgentIResponse,
  hasAgentIYahooCookie,
  askAgentI,
  resetAgentISession,
  setAgentIYahooCookie,
} from "./agentIService.js";

describe("Agent I request contract", () => {
  test("rejects an Agent I response above the configured byte limit", async () => {
    const response = new Response("oversized", { headers: { "content-length": "9" } });
    await expect(readBoundedAgentIResponse(response, 8)).rejects.toThrow(
      "Agent I response too large: 9 bytes",
    );
  });

  test("bounds a streamed Agent I response when content-length is absent", async () => {
    const streamed = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12345678"));
          controller.enqueue(new TextEncoder().encode("9"));
          controller.close();
        },
      }),
    );
    await expect(readBoundedAgentIResponse(streamed, 8)).rejects.toThrow(
      "Agent I response exceeded 8 bytes",
    );
  });

  test("keeps Yahoo credentials scoped to an account and clears them on reset", () => {
    const accountA = "agent-i-auth-test-a";
    const accountB = "agent-i-auth-test-b";
    setAgentIYahooCookie(accountA, "A1=secret; B=opaque");
    try {
      expect(hasAgentIYahooCookie(accountA)).toBe(true);
      expect(hasAgentIYahooCookie(accountB)).toBe(false);
      resetAgentISession(accountA);
      expect(hasAgentIYahooCookie(accountA)).toBe(false);
    } finally {
      clearAgentIYahooCookie(accountA);
      clearAgentIYahooCookie(accountB);
    }
  });

  test("rejects malformed or header-injecting Yahoo credentials", () => {
    expect(() => setAgentIYahooCookie("agent-i-invalid", "not-a-cookie")).toThrow(
      "Yahoo Cookie形式が正しくありません",
    );
    expect(() => setAgentIYahooCookie("agent-i-invalid", "A=1\r\nInjected: yes")).toThrow(
      "Yahoo Cookie形式が正しくありません",
    );
    expect(() => setAgentIYahooCookie("agent-i-invalid", "A=1\tB=2")).toThrow(
      "Yahoo Cookie形式が正しくありません",
    );
    expect(() => setAgentIYahooCookie("agent-i-invalid", `A=${"x".repeat(16_384)}`)).toThrow(
      "Yahoo Cookie形式が正しくありません",
    );
  });

  test("requires an explicitly registered Yahoo cookie in authenticated mode", async () => {
    await expect(askAgentI("agent-i-missing-auth", "hello", [], "authenticated")).rejects.toThrow(
      "ログイン済みモードにはYahoo Cookieの登録が必要です",
    );
  });

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
