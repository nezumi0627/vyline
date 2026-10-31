import { expect, test } from "bun:test";
import { isNoAnswerCallFailure } from "./callAllowlist.js";

test("classifies a remote release or signaling timeout as no answer", () => {
  expect(isNoAnswerCallFailure("PLANET call released: relPhrase=busy")).toBe(true);
  expect(isNoAnswerCallFailure("PLANET reply timeout")).toBe(true);
});

test("does not mistake a local active-call conflict or unrelated error for no answer", () => {
  expect(isNoAnswerCallFailure("通話中: sessionId=local-call")).toBe(false);
  expect(isNoAnswerCallFailure("network unavailable")).toBe(false);
});
