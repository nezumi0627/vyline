import { describe, expect, test } from "bun:test";
import { buildSquareThreadTextRequest } from "./squareService.js";

describe("Square thread wire request", () => {
  test("matches the captured text-message shape used by SquareThreadMessage", () => {
    expect(buildSquareThreadTextRequest(7, "room", "thread", "hello")).toEqual({
      reqSeq: 7,
      chatMid: "room",
      threadMid: "thread",
      threadMessage: {
        message: {
          to: "room",
          text: "hello",
          contentType: "NONE",
          toType: "SQUARE_THREAD",
        },
      },
    });
  });
});
