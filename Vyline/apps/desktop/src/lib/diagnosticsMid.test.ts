import { describe, expect, test } from "bun:test";
import { resolveDiagnosticsMid } from "./diagnosticsMid";

describe("resolveDiagnosticsMid", () => {
  test("uses the profile MID, or the account ID when it is itself a MID", () => {
    expect(
      resolveDiagnosticsMid(
        "u11111111111111111111111111111111",
        "u22222222222222222222222222222222",
      ),
    ).toBe("u11111111111111111111111111111111");
    expect(resolveDiagnosticsMid(undefined, "u22222222222222222222222222222222")).toBe(
      "u22222222222222222222222222222222",
    );
  });

  test("rejects malformed identifiers", () => {
    expect(resolveDiagnosticsMid(undefined, "local-account-id")).toBeUndefined();
    expect(resolveDiagnosticsMid("bad-mid", "local-account-id")).toBeUndefined();
  });
});
