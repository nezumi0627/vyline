import { expect, test } from "bun:test";
import { calculateVisibleRange } from "./useVirtualList.js";

test("virtualized window includes more rows when the viewport grows without scrolling", () => {
  const offsets = Array.from({ length: 100 }, (_, index) => index * 10);
  const narrow = calculateVisibleRange(offsets, 200, 100, 0);
  const expanded = calculateVisibleRange(offsets, 200, 300, 0);

  expect(narrow).toEqual({ startIdx: 20, endIdx: 31 });
  expect(expanded).toEqual({ startIdx: 20, endIdx: 51 });
});

test("keeps a tall row that intersects the viewport start", () => {
  const offsets = [0, 320, 380, 440];
  expect(calculateVisibleRange(offsets, 100, 100, 0)).toEqual({ startIdx: 0, endIdx: 2 });
});
