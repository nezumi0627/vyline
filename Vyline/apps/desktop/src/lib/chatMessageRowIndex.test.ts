import { expect, test } from "bun:test";
import { buildChatMessageRowIndex, missingMessagePageRequestKey } from "./chatMessageRowIndex.js";

test("maps every image grouped into one virtual row to that row key", () => {
  const index = buildChatMessageRowIndex([
    {
      key: "day-m1",
      item: { key: "day-m1", kind: "day", label: "today" },
    },
    {
      key: "msg-m1",
      item: {
        key: "msg-m1",
        kind: "msg",
        message: { id: "m1" },
        mediaGroup: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      },
    },
  ]);

  expect(index.get("m1")).toBe("msg-m1");
  expect(index.get("m2")).toBe("msg-m1");
  expect(index.get("m3")).toBe("msg-m1");
  expect(index.has("day-m1")).toBe(false);
});

test("indexes a regular message row without a media group", () => {
  const index = buildChatMessageRowIndex([
    { key: "msg-text", item: { key: "msg-text", kind: "msg", message: { id: "text" } } },
  ]);

  expect(index.get("text")).toBe("msg-text");
});

test("requests each older page once while a jump target is still missing", () => {
  expect(missingMessagePageRequestKey("chat", "target", "oldest", false, true, false, null)).toBe(
    "chat\u0000target\u0000oldest",
  );
  expect(
    missingMessagePageRequestKey(
      "chat",
      "target",
      "older",
      false,
      true,
      false,
      "chat\u0000target\u0000oldest",
    ),
  ).toBe("chat\u0000target\u0000older");
  expect(
    missingMessagePageRequestKey(
      "chat",
      "target",
      "oldest",
      false,
      true,
      false,
      "chat\u0000target\u0000oldest",
    ),
  ).toBeNull();
  expect(
    missingMessagePageRequestKey("chat", "target", "oldest", false, false, false, null),
  ).toBeNull();
  expect(
    missingMessagePageRequestKey("chat", "target", "oldest", true, true, false, null),
  ).toBeNull();
});
