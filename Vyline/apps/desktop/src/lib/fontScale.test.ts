import { expect, test } from "bun:test";
import { applyFontScale } from "./fontScale";

test("font scale updates text scale without changing the root rem size", () => {
  const values = new Map<string, string>();
  const root = {
    style: {
      fontSize: "16px",
      setProperty: (name: string, value: string) => values.set(name, value),
    },
  } as unknown as HTMLElement;

  applyFontScale(root, 1.2);

  expect(values.get("--vy-font-scale")).toBe("1.2");
  expect(root.style.fontSize).toBe("16px");
});

test("invalid text scale falls back to the default", () => {
  const values = new Map<string, string>();
  const root = {
    style: { setProperty: (name: string, value: string) => values.set(name, value) },
  } as unknown as HTMLElement;

  applyFontScale(root, Number.NaN);

  expect(values.get("--vy-font-scale")).toBe("1");
});
