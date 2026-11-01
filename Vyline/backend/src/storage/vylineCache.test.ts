import { describe, expect, test } from "bun:test";
import { vylineGroupNeedsRefresh } from "./vylineCache.js";

const fresh = Date.now();

describe("group cache refresh", () => {
  test("refreshes when only part of the member list resolved", () => {
    expect(
      vylineGroupNeedsRefresh({
        chatMid: "c1234567890abcdef1234567890abcdef",
        name: "Group",
        memberMids: ["u1234567890abcdef1234567890abcdef", "uabcdef1234567890abcdef1234567890"],
        members: [
          { mid: "u1234567890abcdef1234567890abcdef", displayName: "Alice" },
          {
            mid: "uabcdef1234567890abcdef1234567890",
            displayName: "uabcdef1234567890abcdef1234567890",
          },
        ],
        updatedAt: fresh,
      }),
    ).toBe(true);
  });

  test("refreshes when member records are missing", () => {
    expect(
      vylineGroupNeedsRefresh({
        chatMid: "c1234567890abcdef1234567890abcdef",
        name: "Group",
        memberMids: ["u1234567890abcdef1234567890abcdef", "uabcdef1234567890abcdef1234567890"],
        members: [{ mid: "u1234567890abcdef1234567890abcdef", displayName: "Alice" }],
        updatedAt: fresh,
      }),
    ).toBe(true);
  });

  test("keeps a fresh fully resolved group", () => {
    expect(
      vylineGroupNeedsRefresh({
        chatMid: "c1234567890abcdef1234567890abcdef",
        name: "Group",
        memberMids: ["u1234567890abcdef1234567890abcdef"],
        members: [{ mid: "u1234567890abcdef1234567890abcdef", displayName: "Alice" }],
        updatedAt: fresh,
      }),
    ).toBe(false);
  });
});
