import { describe, expect, it } from "bun:test";
import { accountIdValidationError, isValidAccountId, suggestAccountId } from "./accountIds.js";

describe("account IDs", () => {
  it("suggests a unique slot for every additional account", () => {
    expect(suggestAccountId([])).toBe("main");
    expect(suggestAccountId(["main"])).toBe("account-2");
    expect(suggestAccountId(["main", "account-2", "account-3"])).toBe("account-4");
  });

  it("rejects aliases that would overwrite an existing session", () => {
    expect(accountIdValidationError("main", ["main", "account-2"])).toContain("既に使われています");
    expect(accountIdValidationError("main", ["main"], "main")).toBeNull();
  });

  it("accepts filesystem and URL safe aliases", () => {
    expect(isValidAccountId("account-2_test.main")).toBe(true);
    expect(isValidAccountId("bad account")).toBe(false);
  });
});
