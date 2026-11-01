import { expect, test } from "bun:test";
import { pruneTimedCache } from "./pruneTimedCache.js";

test("removes expired cache entries and evicts the oldest entries at the size limit", () => {
  const cache = new Map([
    ["expired", { expiresAt: 10 }],
    ["oldest", { expiresAt: 100 }],
    ["newer", { expiresAt: 100 }],
  ]);

  pruneTimedCache(cache, (entry) => entry.expiresAt, 20, 2);

  expect([...cache.keys()]).toEqual(["newer"]);
});
