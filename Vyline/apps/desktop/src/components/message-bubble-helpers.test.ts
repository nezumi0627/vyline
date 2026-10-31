import { expect, test } from "bun:test";
import { formatCallDuration, mentionLabel } from "./message-bubble-helpers";

test("blank mention placeholders use the resolved name", () => {
  for (const value of ["@⠀", "@ \t", "\u2800\u2800", "@\u200B", "@", ""]) {
    expect(mentionLabel(value, false, "れんや")).toBe("れんや");
  }
  expect(mentionLabel("@⠀", false)).toBe("メンバー");
  expect(mentionLabel("@⠀", true)).toBe("ALL");
  expect(mentionLabel("@Alice Smith", false, "Renamed")).toBe("Alice Smith");
});

test("call durations roll seconds into minutes and hours", () => {
  for (const value of [undefined, 0, -1, NaN, Infinity]) {
    expect(formatCallDuration(value)).toBeNull();
  }
  expect(formatCallDuration(9)).toBe("9秒");
  expect(formatCallDuration(59.6)).toBe("1分00秒");
  expect(formatCallDuration(61)).toBe("1分01秒");
  expect(formatCallDuration(3600)).toBe("1時間0分00秒");
  expect(formatCallDuration(3661)).toBe("1時間1分01秒");
  expect(formatCallDuration(90061)).toBe("25時間1分01秒");
});
