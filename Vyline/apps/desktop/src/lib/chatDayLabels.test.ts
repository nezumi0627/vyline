import { expect, test } from "bun:test";
import { createChatDayLabels } from "./chatDayLabels.js";

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
