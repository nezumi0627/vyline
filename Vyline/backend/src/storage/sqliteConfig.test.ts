import { expect, test } from "bun:test";
import { getSqliteDurability } from "./sqliteConfig.js";

test("SQLite defaults to WAL and accepts the conservative FUSE profile", () => {
  expect(getSqliteDurability({})).toEqual({ journalMode: "WAL", synchronous: "NORMAL" });
  expect(getSqliteDurability({
    VYLINE_SQLITE_JOURNAL_MODE: "delete",
    VYLINE_SQLITE_SYNCHRONOUS: "full",
  })).toEqual({ journalMode: "DELETE", synchronous: "FULL" });
});

test("SQLite durability settings reject unrecognized pragma values", () => {
  expect(() => getSqliteDurability({ VYLINE_SQLITE_JOURNAL_MODE: "OFF" })).toThrow();
  expect(() => getSqliteDurability({ VYLINE_SQLITE_SYNCHRONOUS: "EXTRA" })).toThrow();
});
