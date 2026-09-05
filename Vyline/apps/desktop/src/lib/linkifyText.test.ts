import { describe, expect, it } from "bun:test";
import { splitTextLinks } from "./linkifyText.js";

describe("splitTextLinks", () => {
  it("turns http, https, and www URLs into links", () => {
    expect(splitTextLinks("a https://example.com/x b www.example.jp")).toEqual([
      { type: "text", value: "a " },
      { type: "link", value: "https://example.com/x", href: "https://example.com/x" },
      { type: "text", value: " b " },
      { type: "link", value: "www.example.jp", href: "https://www.example.jp" },
    ]);
  });

  it("keeps sentence punctuation outside the link", () => {
    expect(splitTextLinks("見て：https://example.com/a?x=1。" )).toEqual([
      { type: "text", value: "見て：" },
      { type: "link", value: "https://example.com/a?x=1", href: "https://example.com/a?x=1" },
      { type: "text", value: "。" },
    ]);
  });

  it("preserves balanced parentheses in a URL", () => {
    expect(splitTextLinks("https://example.com/a_(b) text")[0]).toEqual({
      type: "link",
      value: "https://example.com/a_(b)",
      href: "https://example.com/a_(b)",
    });
  });
});
