import { describe, expect, test } from "bun:test";
import { resolveCorsOrigin } from "./corsPolicy.js";
import {
  bytesToBlob,
  isMalformedJsonError,
  readLimitedBytes,
  tooLargeContentLength,
} from "./requestLimits.js";

function context(headers: Record<string, string> = {}) {
  return { req: { header: (name: string) => headers[name.toLowerCase()] } } as never;
}

describe("API request safety helpers", () => {
  test("rejects malformed JSON errors without treating normal errors as JSON errors", () => {
    expect(isMalformedJsonError(new SyntaxError("Unexpected token"))).toBe(true);
    expect(isMalformedJsonError(new Error("database unavailable"))).toBe(false);
  });

  test("rejects oversized declared bodies before reading them", () => {
    expect(tooLargeContentLength(context({ "content-length": "101" }), 100)).toBe(true);
    expect(tooLargeContentLength(context({ "content-length": "100" }), 100)).toBe(false);
  });

  test("caps chunked bodies while keeping accepted payloads intact", async () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    const accepted = await readLimitedBytes(
      { req: { raw: request, header: () => undefined } } as never,
      3,
    );
    expect(accepted).toEqual(new Uint8Array([1, 2, 3]));

    const rejected = await readLimitedBytes(
      {
        req: {
          raw: new Request("http://localhost/upload", {
            method: "POST",
            body: new Uint8Array([1, 2, 3, 4]),
          }),
          header: () => undefined,
        },
      } as never,
      3,
    );
    expect(rejected).toBeNull();
  });

  test("does not return a configured fallback for an unapproved CORS origin", () => {
    const allowed = new Set(["https://app.example"]);
    expect(resolveCorsOrigin("https://app.example", allowed, "https://fallback.example")).toBe(
      "https://app.example",
    );
    expect(resolveCorsOrigin("https://evil.example", allowed, "https://fallback.example")).toBe(
      undefined,
    );
    expect(resolveCorsOrigin(undefined, allowed, "https://fallback.example")).toBe(
      "https://fallback.example",
    );
  });

  test("converts bounded bytes to a typed Blob", async () => {
    const blob = bytesToBlob(new Uint8Array([65, 66]), "text/plain");
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(await blob.text()).toBe("AB");
  });
});
