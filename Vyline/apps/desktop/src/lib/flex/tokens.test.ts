import { describe, expect, it } from "bun:test";
import { fontSizeCss, spacingCss } from "./tokens";

describe("spacingCss", () => {
  it("maps the named spacing scale", () => {
    expect(spacingCss("md")).toBe("8px");
    expect(spacingCss("none")).toBe("0px");
  });

  it("keeps ordinary numeric values", () => {
    expect(spacingCss("12")).toBe("12px");
    expect(spacingCss("50%")).toBe("50%");
    expect(spacingCss("-4px")).toBe("-4px");
  });

  it("clamps a remote padding that would blow up the row height", () => {
    // 受信 Flex に paddingAll:"10000000px" が来ると 2000 万 px の行になり、
    // 仮想リストのスクロール位置が飛ぶため上限で丸める。
    expect(spacingCss("10000000px")).toBe("300px");
    expect(spacingCss("99999")).toBe("300px");
    expect(spacingCss("-10000000px")).toBe("-300px");
    expect(spacingCss("50000%")).toBe("100%");
  });

  it("rejects non-literal CSS lengths that could bypass the clamp", () => {
    expect(spacingCss("calc(10000000px)")).toBeUndefined();
    expect(spacingCss("var(--untrusted-size)")).toBeUndefined();
    expect(fontSizeCss("calc(10000000px)")).toBeUndefined();
  });
});

describe("fontSizeCss", () => {
  it("clamps an oversized remote font size", () => {
    expect(fontSizeCss("1000000px")).toBe("200px");
    expect(fontSizeCss("md")).toBe("16px");
  });
});
