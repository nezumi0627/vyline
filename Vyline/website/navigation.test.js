import { describe, expect, test } from "bun:test";
import {
  legacySearchState,
  matchesDocument,
  normalizeSearch,
  searchExcerpt,
} from "./navigation.js";

describe("documentation discovery", () => {
  test("restores legacy root search terms and installation categories without using the technical-only directory", () => {
    expect(
      legacySearchState(
        "https://example.test/vyline/?q=Docker&category=インストール#docs",
        "/vyline/",
      ),
    ).toEqual({ query: "Docker", category: "インストール" });
    expect(legacySearchState("https://example.test/vyline/?category=はじめに", "/vyline/")).toEqual(
      { query: "", category: "はじめに" },
    );
    expect(legacySearchState("https://example.test/vyline/?q=E2EE", "/vyline/")).toEqual({
      query: "E2EE",
      category: "all",
    });
    expect(legacySearchState("https://example.test/vyline/docs/?q=E2EE", "/vyline/")).toBeNull();
    expect(legacySearchState("https://example.test/vyline/#docs", "/vyline/")).toBeNull();
  });
  test("normalizes full-width Latin input and invisible characters", () => {
    expect(normalizeSearch("Ｄｏｃｋｅｒ\u200b")).toBe("docker");
  });
  test("combines all search terms with the selected category", () => {
    const doc = { category: "データ", search: "バックアップ iOS 暗号化 履歴" };
    expect(matchesDocument(doc, "iOS 履歴", "データ")).toBe(true);
    expect(matchesDocument(doc, "iOS 履歴", "開発")).toBe(false);
    expect(matchesDocument(doc, "iOS Docker", "all")).toBe(false);
    expect(matchesDocument(doc, "", "all")).toBe(true);
  });
  test("returns a readable excerpt only for body matches", () => {
    expect(searchExcerpt("導入 Docker composeで起動", "compose", 3)).toContain("compose");
    expect(searchExcerpt("テーマ 見た目を変える", "テーマ", 4)).toBe("");
    expect(searchExcerpt("テーマ 見た目を変える", "missing", 4)).toBe("");
  });
  test("finds body matches even when a query term also matches the title", () => {
    const prefix = "Docker 導入ガイド ";
    expect(
      searchExcerpt(`${prefix}composeで起動する手順`, "Docker compose", prefix.length),
    ).toContain("compose");
    expect(searchExcerpt(`${prefix}Dockerをインストール`, "Docker", prefix.length)).toContain(
      "docker",
    );
    expect(searchExcerpt(`${prefix}別の内容`, "Docker", prefix.length)).toBe("");
  });
});
