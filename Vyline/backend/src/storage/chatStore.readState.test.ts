import { describe, expect, test } from "bun:test";
import { mergeStoredReadState } from "./chatStore.js";

describe("mergeStoredReadState", () => {
  test("does not turn an unknown group message into read", () => {
    expect(mergeStoredReadState(undefined, {})).toEqual({});
  });

  test("keeps persisted readers when a later response omits them", () => {
    expect(
      mergeStoredReadState({ readBy: ["u-reader-1"], readCount: 1 }, { readBy: [], readCount: 0 }),
    ).toEqual({ readCount: 1, readBy: ["u-reader-1"] });
  });

  test("never rolls a persisted seen flag back to unread", () => {
    expect(mergeStoredReadState({ seen: true }, { seen: false })).toEqual({ seen: true });
  });
});
