import { expect, test } from "bun:test";
import { shouldThrottleDeltaPoll } from "./deltaPollPolicy.js";

test("does not suppress the next delta poll after a quick failed response", () => {
  expect(shouldThrottleDeltaPoll(false, 800)).toBe(false);
});

test("throttles a successful response and slow failed RPCs", () => {
  expect(shouldThrottleDeltaPoll(true, 800)).toBe(true);
  expect(shouldThrottleDeltaPoll(false, 6_001)).toBe(true);
});
