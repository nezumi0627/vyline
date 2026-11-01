import { expect, test } from "bun:test";
import { segmentTextWithMentions } from "./mention";

// REPLACE の E は終端オフセット（exclusive）。長さとして扱うと、
// スタンプの後ろに続く本文を飲み込んでしまう。
test("sticon E is an exclusive end offset, not a length", () => {
  // 本文: A ￼ ￼ ￼ B （￼=U+FFFC, 長さ5）。スタンプは index 1..4（=1,2,3 の3文字）。
  const text = "A￼￼￼B";
  const segs = segmentTextWithMentions(
    text,
    [{ productId: "p", sticonId: "s", S: 1, E: 4 }],
    [{ S: 0, E: 1, mid: `u${"1".repeat(32)}` }],
  );

  // 末尾の "B" が残ること（旧実装は E を長さと解釈し end=5 で飲み込んでいた）。
  expect(segs[segs.length - 1]).toEqual({ type: "text", value: "B" });
  expect(segs.some((s) => s.type === "sticon")).toBe(true);
});
