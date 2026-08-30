import { describe, expect, it } from "bun:test";
import {
  addChatPane,
  closeChatPaneAt,
  equalChatPaneSizes,
  replaceFocusedChatPane,
  resizeAdjacentChatPanes,
} from "./chatPanes.js";

describe("chat pane state", () => {
  it("adds unique panes up to four and focuses an existing pane", () => {
    const two = addChatPane(["a"], [100], "b");
    expect(two.ids).toEqual(["a", "b"]);
    expect(two.sizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100);

    const existing = addChatPane(two.ids, two.sizes, "a");
    expect(existing.added).toBe(false);
    expect(existing.focusedIndex).toBe(0);

    const full = addChatPane(["a", "b", "c", "d"], equalChatPaneSizes(4), "e");
    expect(full.full).toBe(true);
    expect(full.ids).toEqual(["a", "b", "c", "d"]);
  });

  it("replaces only the focused pane on a normal click", () => {
    expect(replaceFocusedChatPane(["a", "b"], [40, 60], 1, "c")).toEqual({
      ids: ["a", "c"],
      sizes: [40, 60],
      focusedIndex: 1,
    });
  });

  it("closes a pane and keeps a valid focus", () => {
    const result = closeChatPaneAt(["a", "b", "c"], [20, 30, 50], 2, 1);
    expect(result.ids).toEqual(["a", "c"]);
    expect(result.sizes[0]).toBeCloseTo(20 / 0.7);
    expect(result.sizes[1]).toBeCloseTo(50 / 0.7);
    expect(result.focusedIndex).toBe(1);
  });

  it("resizes only adjacent panes while enforcing their minimum", () => {
    expect(resizeAdjacentChatPanes([50, 50], 0, 20, 25)).toEqual([70, 30]);
    expect(resizeAdjacentChatPanes([50, 50], 0, 40, 25)).toEqual([75, 25]);
  });
});
