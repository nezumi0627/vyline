import { describe, expect, test } from "bun:test";
import { anonymousId, redactForDiagnostics } from "./redaction.js";

describe("diagnostic redaction", () => {
  test("removes credentials and PII by field name", () => {
    expect(
      redactForDiagnostics({ authToken: "secret", mid: "u123", text: "hello", count: 2 }),
    ).toEqual({
      authToken: "[REDACTED_SECRET]",
      mid: "[REDACTED_PII]",
      text: "[REDACTED_PII]",
      count: 2,
    });
  });

  test("creates stable anonymous identifiers without exposing the MID", () => {
    expect(anonymousId("u123")).toBe(anonymousId("u123"));
    expect(anonymousId("u123")).not.toContain("u123");
  });
});
