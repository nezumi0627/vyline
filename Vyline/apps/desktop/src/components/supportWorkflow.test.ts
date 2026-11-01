import { describe, expect, test } from "bun:test";
import { buildSupportIssueBody, buildSupportPrompt } from "./supportWorkflow.js";

const report = {
  category: "sync" as const,
  title: "チャットが更新されない",
  details: "再起動しても新着が出ません。",
  steps: "1. Vylineを起動\n2. 受信を待つ",
  expected: "新着が一覧に出る",
};

describe("support workflow", () => {
  test("formats a GitHub report with actionable reproduction fields", () => {
    const body = buildSupportIssueBody(report, "0.6.0-beta");
    expect(body).toContain("### カテゴリ\n同期・受信");
    expect(body).toContain("### Vyline\n0.6.0-beta");
    expect(body).toContain("再現手順\n1. Vylineを起動\n2. 受信を待つ");
    expect(body).toContain("期待する動作\n新着が一覧に出る");
  });

  test("builds a support-focused assistant prompt without inventing missing details", () => {
    const prompt = buildSupportPrompt(report);
    expect(prompt).toContain("Vylineのサポート担当");
    expect(prompt).toContain("チャットが更新されない");
    expect(prompt).toContain("再起動しても新着が出ません。");
    expect(prompt).toContain("次に確認する手順");
    expect(prompt).not.toContain("Vyline: undefined");
  });
});
