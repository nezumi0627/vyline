import { describe, expect, test } from "bun:test";
import {
  classifyWindowsLineTokenSet,
  describeWindowsLineTokenInventory,
  pairWindowsLineTokens,
} from "./windowsLineTokenService.js";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

describe("Windows LINE token classification", () => {
  test("classifies and pairs access/refresh credentials by token ids", () => {
    const access = jwt({
      scp: "LINE_CORE",
      ctype: "access",
      jti: "access-1",
      rtid: "refresh-1",
      exp: 2_000_000_000,
    });
    const refresh = jwt({
      scp: "LINE_CORE",
      jti: "refresh-1",
      ati: "access-1",
      rot: true,
      exp: 2_000_000_001,
    });
    const inventory = classifyWindowsLineTokenSet([access, refresh, access]);

    expect(inventory.candidates).toHaveLength(2);
    expect(inventory.pairs).toHaveLength(1);
    expect(inventory.pairs[0]?.access?.kind).toBe("access");
    expect(inventory.pairs[0]?.refresh?.kind).toBe("refresh");
    expect(inventory.pairs[0]?.access?.expiresAt).toBe(2_000_000_000);
  });

  test("does not pair unrelated credentials", () => {
    const access = jwt({ scp: "LINE_CORE", ctype: "access", jti: "access-1", rtid: "refresh-1" });
    const refresh = jwt({ scp: "LINE_CORE", jti: "refresh-2", ati: "access-2", rot: true });
    const pairs = pairWindowsLineTokens([
      classifyWindowsLineTokenSet([access]).candidates[0]!,
      classifyWindowsLineTokenSet([refresh]).candidates[0]!,
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs.filter((pair) => pair.access && pair.refresh)).toHaveLength(0);
  });

  test("describes expiry without exposing the token", () => {
    const access = jwt({ scp: "LINE_CORE", ctype: "access", jti: "access-1", exp: 2_000 });
    const views = describeWindowsLineTokenInventory(
      classifyWindowsLineTokenSet([access]),
      1_000_000,
    );

    expect(views[0]).toMatchObject({ kind: "access", status: "usable", remainingSeconds: 1_000 });
    expect(views[0]?.fingerprint).toHaveLength(12);
    expect(views[0]).not.toHaveProperty("token");
  });
});
