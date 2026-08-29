import { describe, expect, it } from "bun:test";
import type { Message } from "../types/index.js";
import {
  mergeHistoryMessages,
  trimHistoryWindows,
  type ChatHistoryWindow,
} from "./chatHistoryWindow.js";

function message(id: string, createdTime: number, text = id): Message {
  return {
    id,
    from: "u-peer",
    to: "u-me",
    text,
    contentType: "NONE",
    createdTime,
    isMyMessage: false,
    contentMetadata: null,
  };
}

describe("chat history window", () => {
  it("merges pages without duplicates and keeps oldest-first order", () => {
    const merged = mergeHistoryMessages(
      [message("20", 20), message("30", 30)],
      [message("10", 10), message("20", 20, "updated")],
    );

    expect(merged.map((item) => item.id)).toEqual(["10", "20", "30"]);
    expect(merged[1]?.text).toBe("updated");
  });

  it("evicts least-recent inactive windows but never the active chat", () => {
    const windows = new Map<string, ChatHistoryWindow>([
      ["old", { messages: [message("1", 1), message("2", 2)], hasMore: true, touchedAt: 1 }],
      ["active", { messages: [message("3", 3), message("4", 4)], hasMore: true, touchedAt: 2 }],
      ["new", { messages: [message("5", 5), message("6", 6)], hasMore: true, touchedAt: 3 }],
    ]);

    trimHistoryWindows(windows, "active", 4);

    expect(windows.has("active")).toBe(true);
    expect(windows.has("old")).toBe(false);
    expect(windows.has("new")).toBe(true);
  });
});
