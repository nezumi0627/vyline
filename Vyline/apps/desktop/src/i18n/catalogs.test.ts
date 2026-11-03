import { describe, expect, test } from "bun:test";

const locales = ["en", "zh-TW", "zh-CN", "id", "ko", "es", "fr", "de", "pt-BR", "vi", "th"];

describe("bundled UI locale catalogs", () => {
  test("provide a non-empty value for every inventoried UI string", async () => {
    const source = (await Bun.file(
      new URL("./source-strings.json", import.meta.url),
    ).json()) as string[];
    const expected = source.filter((key) => key.length > 0);

    for (const locale of locales) {
      const catalog = (await Bun.file(
        new URL(`./locales/${locale}.json`, import.meta.url),
      ).json()) as Record<string, string>;
      for (const key of expected) {
        expect(typeof catalog[key], `${locale} missing ${key}`).toBe("string");
        expect(
          catalog[key]!.trim().length,
          `${locale} has empty translation for ${key}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  test("localizes optional URL hints and accurately describes credential redaction", async () => {
    const optionalUrlHints: Record<string, string> = {
      en: "https://… (optional)",
      "zh-TW": "https://…（選填）",
      "zh-CN": "https://…（可选）",
      id: "https://… (opsional)",
      ko: "https://… (선택)",
      es: "https://… (opcional)",
      fr: "https://… (facultatif)",
      de: "https://… (optional)",
      "pt-BR": "https://… (opcional)",
      vi: "https://… (tùy chọn)",
      th: "https://… (ไม่บังคับ)",
    };

    for (const [locale, expected] of Object.entries(optionalUrlHints)) {
      const catalog = (await Bun.file(
        new URL(`./locales/${locale}.json`, import.meta.url),
      ).json()) as Record<string, string>;
      expect(catalog["https://…（任意）"], `${locale} optional URL hint`).toBe(expected);
    }

    const english = (await Bun.file(
      new URL("./locales/en.json", import.meta.url),
    ).json()) as Record<string, string>;
    expect(
      english[
        "ZIPにはバージョン、端末・LINE接続情報、設定、テーマ、入力した相談内容が入ります。認証情報は伏せ、ZIPはこの端末に保存します。"
      ],
    ).toContain("Credentials are redacted");
  });
});
