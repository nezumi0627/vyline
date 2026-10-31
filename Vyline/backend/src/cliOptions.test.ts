import { expect, test } from "bun:test";
import { parseCliArgs } from "./cliOptions.js";

test("CLI boolean flags reject inline values instead of silently enabling the flag", () => {
  expect(() => parseCliArgs(["history", "--refresh=false"])).toThrow("--refresh does not accept a value");
});

test("CLI options reject duplicate keys", () => {
  expect(() => parseCliArgs(["history", "--limit", "10", "--limit", "20"])).toThrow("Duplicate option: --limit");
});

test("CLI options accept explicit values and bare boolean flags", () => {
  expect(parseCliArgs(["history", "--chat=c1", "--limit", "25", "--refresh"])).toEqual({
    command: "history",
    options: { chat: "c1", limit: "25", refresh: true },
  });
});
