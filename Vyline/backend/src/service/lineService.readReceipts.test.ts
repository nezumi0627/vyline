import { describe, expect, it } from "bun:test";
import type { Message } from "@vyline/types";
import {
  attachGroupReadReceipts,
  memberReadWatermarks,
  normalizeMessageReadRanges,
} from "./lineService";

describe("attachGroupReadReceipts", () => {
  it("preserves readers from earlier polls while adding new readers", () => {
    const message = {
      id: "100",
      isMyMessage: true,
      readBy: ["u-old"],
      readCount: 1,
    } as unknown as Message;

    attachGroupReadReceipts(
      [message],
      [
        { mid: "u-new", upTo: 100n },
        { mid: "u-old", upTo: 100n },
      ],
    );

    expect(message.readBy).toEqual(["u-old", "u-new"]);
    expect(message.readCount).toBe(2);
  });

  it("reads the actual TMessageReadRange map shape with one entry per member", () => {
    const marks = memberReadWatermarks(
      [
        {
          chatId: "c-group",
          ranges: {
            "u-reader": { startMessageId: "1", endMessageId: "123" },
          },
        },
      ],
      "c-group",
      "u-self",
    );

    expect(marks).toEqual([{ mid: "u-reader", upTo: 123n }]);
  });

  it("unwraps the thrift success wrapper returned by the raw request client", () => {
    expect(
      normalizeMessageReadRanges({
        success: [{ chatId: "c-group", ranges: {} }],
      }),
    ).toEqual([{ chatId: "c-group", ranges: {} }]);
  });
});
