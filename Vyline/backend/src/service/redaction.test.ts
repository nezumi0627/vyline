import { describe, expect, test } from "bun:test";
import {
  anonymousId,
  redactError,
  redactForDiagnostics,
  sanitizeStringValue,
} from "./redaction.js";

describe("diagnostic redaction", () => {
  test("removes credentials and personal identifiers from nested shareable data", () => {
    const mid = "u1234567890abcdef1234567890abcdef";
    const fixture = {
      token: "raw-token-value",
      accountId: "account-private-value",
      sessionId: "raw-session-value",
      constantPincode: "123456",
      verifier: "live-login-verifier",
      message: "private chat body",
      details: `request failed Bearer abc.def-123 token=another-secret for ${mid}`,
      nested: {
        authorization: "Basic private-value",
        email: "person@example.com",
        headers: { "x-line-access": "opaque-line-verifier" },
      },
    };

    const encoded = JSON.stringify(redactForDiagnostics(fixture));
    expect(encoded).not.toContain("raw-token-value");
    expect(encoded).not.toContain("account-private-value");
    expect(encoded).not.toContain("raw-session-value");
    expect(encoded).not.toContain("123456");
    expect(encoded).not.toContain("live-login-verifier");
    expect(encoded).not.toContain("private chat body");
    expect(encoded).not.toContain("another-secret");
    expect(encoded).not.toContain(mid);
    expect(encoded).not.toContain("person@example.com");
    expect(encoded).not.toContain("opaque-line-verifier");
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

  test("sanitizes basic authorization embedded in strings", () => {
    const value = sanitizeStringValue("request failed with Authorization: Basic dXNlcjpwYXNz");
    expect(value).not.toContain("dXNlcjpwYXNz");
    expect(value).toContain("[REDACTED_SECRET]");
  });

  test("sanitizes login PINs and verifiers embedded in strings", () => {
    const value = sanitizeStringValue(
      "pincode=123456 verifier=live-verifier pin:654321 x-line-access=opaque-access",
    );
    expect(value).not.toContain("123456");
    expect(value).not.toContain("654321");
    expect(value).not.toContain("live-verifier");
    expect(value).not.toContain("opaque-access");
    expect(value.match(/\[REDACTED_SECRET\]/g)).toHaveLength(4);
  });

  test("summarizes binary payloads without enumerating their bytes", () => {
    expect(redactForDiagnostics({ body: new Uint8Array([1, 2, 3, 4]) })).toEqual({
      body: { type: "Uint8Array", byteLength: 4 },
    });
  });

  test("bounds recursive objects used by structured logging", () => {
    const circular: Record<string, unknown> = { label: "safe" };
    circular.self = circular;

    expect(redactForDiagnostics(circular)).toEqual({
      label: "safe",
      self: "[REDACTED_CIRCULAR]",
    });
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
