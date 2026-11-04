import { expect, test } from "bun:test";
import { callPreviewLabel } from "./callPreview.js";

test("labels call records like the backend list preview", () => {
  expect(callPreviewLabel(undefined)).toBe("音声通話");
  expect(callPreviewLabel({ video: false, group: false, outcome: "ended" })).toBe("音声通話");
  expect(callPreviewLabel({ video: true, group: false, outcome: "missed" })).toBe(
    "不在着信 · ビデオ通話",
  );
  expect(callPreviewLabel({ video: false, group: true, outcome: "ended" })).toBe("グループ通話");
  expect(callPreviewLabel({ video: true, group: true, outcome: "declined" })).toBe(
    "グループビデオ通話",
  );
});
