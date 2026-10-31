import { expect, test } from "bun:test";
import { adjustScrollTopForAnchor, isAtScrollEnd } from "./virtualScrollAnchor.js";

test("keeps the anchored row at the same viewport position when rows above it change height", () => {
  const cases = [
    { scrollTop: 250, previousAnchorTop: 200, nextAnchorTop: 320 },
    { scrollTop: 250, previousAnchorTop: 200, nextAnchorTop: 140 },
  ];

  for (const item of cases) {
    const nextScrollTop = adjustScrollTopForAnchor(
      item.scrollTop,
      item.previousAnchorTop,
      item.nextAnchorTop,
    );
    expect(item.nextAnchorTop - nextScrollTop).toBe(item.previousAnchorTop - item.scrollTop);
  }
});

test("does not produce a negative scroll position when the anchored row is removed above the viewport", () => {
  expect(adjustScrollTopForAnchor(40, 200, 0)).toBe(0);
});

test("recognizes a reader at the bottom before asynchronous row measurements", () => {
  expect(isAtScrollEnd(2000, 600, 1400)).toBe(true);
  expect(isAtScrollEnd(2000, 600, 1397)).toBe(false);
  expect(isAtScrollEnd(2000, 600, 1399)).toBe(true);
});
