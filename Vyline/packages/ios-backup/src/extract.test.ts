import { describe, expect, test } from "bun:test";
import { getFileDecryptedCopy, isValidBackupFileId, safeExtractComponent } from "./extract.js";

describe("iOS backup extraction security", () => {
  test("accepts only canonical iTunes backup file IDs", () => {
    expect(isValidBackupFileId("a".repeat(40))).toBe(true);
    expect(isValidBackupFileId("../line-secret")).toBe(false);
    expect(isValidBackupFileId("a".repeat(39))).toBe(false);
  });

  test("removes path separators from manifest-controlled output components", () => {
    expect(safeExtractComponent("../../line\\Library:db")).toBe("..__..__line__Library__db");
  });

  test("rejects an invalid file ID before reading a source path", () => {
    expect(() =>
      getFileDecryptedCopy(
        {} as never,
        {
          fileID: "../../line-secret",
          domain: "AppDomain-com.linecorp.line",
          relativePath: "Library/test.db",
          file: new Uint8Array(),
        },
        "ignored",
      ),
    ).toThrow("Invalid backup file ID");
  });
});
