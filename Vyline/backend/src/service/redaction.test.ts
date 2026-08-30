import { describe, expect, test } from "bun:test";
import { redactError, redactForDiagnostics, sanitizeStringValue } from "./redaction.js";

describe("diagnostic redaction", () => {
  test("removes credentials and personal identifiers from nested shareable data", () => {
    const mid = "u1234567890abcdef1234567890abcdef";
    const fixture = {
      token: "raw-token-value",
      accountId: "account-private-value",
      sessionId: "raw-session-value",
      message: "private chat body",
      details: `request failed Bearer abc.def-123 token=another-secret for ${mid}`,
      nested: { authorization: "Basic private-value", email: "person@example.com" },
    };

    const encoded = JSON.stringify(redactForDiagnostics(fixture));
    expect(encoded).not.toContain("raw-token-value");
    expect(encoded).not.toContain("account-private-value");
    expect(encoded).not.toContain("raw-session-value");
    expect(encoded).not.toContain("private chat body");
    expect(encoded).not.toContain("another-secret");
    expect(encoded).not.toContain(mid);
    expect(encoded).not.toContain("person@example.com");
    expect(encoded).toContain("[REDACTED_SECRET]");
    expect(encoded).toContain("[REDACTED_MID]");
  });

  test("keeps useful error text while sanitizing secrets inside the error", () => {
    const error = new Error(
      "upload failed: sessionId=session-secret token=token-secret for u1234567890abcdef1234567890abcdef",
    );
    const redacted = redactError(error);

    expect(redacted.message).toContain("upload failed");
    expect(redacted.message).not.toContain("session-secret");
    expect(redacted.message).not.toContain("token-secret");
    expect(redacted.message).not.toContain("u1234567890abcdef1234567890abcdef");
  });

  test("sanitizes JWT-like credentials embedded in strings", () => {
    const value = sanitizeStringValue(
      "authorization=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
    );
    expect(value).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(value).toContain("[REDACTED_SECRET]");
  });
});
