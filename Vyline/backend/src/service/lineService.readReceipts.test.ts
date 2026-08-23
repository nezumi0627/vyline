import { describe, expect, it } from "bun:test";
import type { Message } from "@vyline/types";
import { attachGroupReadReceipts } from "./lineService";

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
});
