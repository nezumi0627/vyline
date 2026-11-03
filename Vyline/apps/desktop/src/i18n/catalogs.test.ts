import { describe, expect, test } from "bun:test";

const locales = ["en", "zh-TW", "zh-CN", "id", "ko", "es", "fr", "de", "pt-BR", "vi", "th"];

describe("bundled UI locale catalogs", () => {
  test("provide a non-empty value for every inventoried UI string", async () => {
    const source = (await Bun.file(new URL("./source-strings.json", import.meta.url)).json()) as string[];
    const expected = source.filter((key) => key.length > 0);

    for (const locale of locales) {
      const catalog = (await Bun.file(new URL(`./locales/${locale}.json`, import.meta.url)).json()) as Record<
        string,
        string
      >;
      for (const key of expected) {
        expect(typeof catalog[key], `${locale} missing ${key}`).toBe("string");
        expect(catalog[key]!.trim().length, `${locale} has empty translation for ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
