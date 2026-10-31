import { expect, test } from "bun:test";
import { resolveInitialChatScrollPosition } from "./initialChatScroll";

test("does not fall back to latest while an unread target can still be fetched", () => {
  expect(resolveInitialChatScrollPosition("message-10", undefined, true)).toBe("waiting");
});

test("uses latest only when no unread target exists", () => {
  expect(resolveInitialChatScrollPosition(null, undefined, true)).toBe("latest");
});

test("jumps to the resolved row and distinguishes an exhausted missing target", () => {
  expect(resolveInitialChatScrollPosition("message-10", "row-10", false)).toBe("target");
  expect(resolveInitialChatScrollPosition("message-10", undefined, false)).toBe("missing");
});
