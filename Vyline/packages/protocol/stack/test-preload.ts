import { test } from "bun:test";

globalThis.Deno ??= {
  test,
};
