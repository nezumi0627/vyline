import { expect, test } from "bun:test";
import { createChatDayLabels, formatChatListTime } from "./chatDayLabels.js";

test("labels each local day once relative to today and yesterday", () => {
  const today = new Date(2026, 4, 20, 12).getTime();
  const labels = createChatDayLabels(
    [
      { createdAt: new Date(2026, 4, 19, 9).getTime() },
      { createdAt: new Date(2026, 4, 20, 10).getTime() },
      { createdAt: new Date(2026, 4, 18, 8).getTime() },
      { createdAt: new Date(2026, 4, 19, 20).getTime() },
    ],
    new Date(today),
  );
  expect(labels).toEqual(["昨日", "今日", "5月18日", "昨日"]);
});

test("formats chat list timestamp for today, yesterday, within 7 days, and older dates", () => {
  const now = new Date(2026, 10, 3, 16, 30); // 2026-11-03 (Tue)
  expect(formatChatListTime(new Date(2026, 10, 3, 20, 8).getTime(), now, "ja")).toBe("20:08");
  expect(formatChatListTime(new Date(2026, 10, 2, 23, 59).getTime(), now, "ja")).toBe("昨日");
  expect(formatChatListTime(new Date(2026, 10, 2, 23, 59).getTime(), now, "en")).toBe("yesterday");
  expect(formatChatListTime(new Date(2026, 9, 30, 10, 0).getTime(), now, "ja")).toBe("金曜日");
  expect(formatChatListTime(new Date(2026, 9, 30, 10, 0).getTime(), now, "en")).toBe("Fri");
  expect(formatChatListTime(new Date(2026, 9, 20, 10, 0).getTime(), now, "ja")).toBe("10/20");
  expect(formatChatListTime(new Date(2025, 9, 20, 10, 0).getTime(), now, "ja")).toBe("2025/10/20");
});
