import { expect, test } from "bun:test";
import { previewUrlsForText } from "./messageUrls";

test("URL preview limit defaults to three and supports disabling previews", () => {
  const text = "https://example.com/a https://example.org/b https://example.net/c https://example.dev/d";

  expect(previewUrlsForText(text)).toHaveLength(3);
  expect(previewUrlsForText(text, 1)).toHaveLength(1);
  expect(previewUrlsForText(text, 0)).toHaveLength(0);
});
