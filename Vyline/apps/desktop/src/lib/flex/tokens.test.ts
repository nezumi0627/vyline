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
    expect(spacingCss("10000000px")).toBe("1000px");
    expect(spacingCss("99999")).toBe("1000px");
    expect(spacingCss("-10000000px")).toBe("-1000px");
    expect(spacingCss("50000%")).toBe("1000%");
  });

  it("passes through non-numeric values such as calc()", () => {
    expect(spacingCss("calc(100% - 8px)")).toBe("calc(100% - 8px)");
  });
});

describe("fontSizeCss", () => {
  it("clamps an oversized remote font size", () => {
    expect(fontSizeCss("1000000px")).toBe("200px");
    expect(fontSizeCss("md")).toBe("16px");
  });
});
