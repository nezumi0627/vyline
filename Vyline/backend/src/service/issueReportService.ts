import { loadAccountSettings } from "./accountSettingsService.js";
import { exportDiagnostics } from "./diagnosticsService.js";
import { sanitizeStringValue } from "./redaction.js";

const ISSUE_URL_LIMIT = 7_000;
const ISSUE_URL = "https://github.com/nezumi0627/vyline/issues/new";

function safeInput(value: unknown): string {
  return sanitizeStringValue(typeof value === "string" ? value : "").slice(0, 2_000);
}

export async function buildIssuePreview(
  mid: string,
  input: { summary?: unknown; reproduction?: unknown; expected?: unknown; actual?: unknown },
) {
  const settings = await loadAccountSettings(mid);
  const diagnostics = await exportDiagnostics(mid);
  const occurredAt = new Date().toISOString();
  const safeSettings = {
    diagnosticsEnabled: settings.debug.enabled,
    diagnosticsLevel: settings.debug.level,
    retentionDays: settings.debug.retentionDays,
    reducedMotion: settings.performance.reducedMotion,
    compactLayout: settings.layout.compact,
  };
  const report = [
    "## 問題の概要",
    safeInput(input.summary) || "（ここに問題を記入してください）",
    "",
    "## 再現手順",
    safeInput(input.reproduction) || "（再現手順を記入してください）",
    "",
    "## 期待した結果",
    safeInput(input.expected) || "（期待した結果を記入してください）",
    "",
    "## 実際の結果",
    safeInput(input.actual) || "（実際の結果を記入してください）",
    "",
    "## 自動追加される情報",
    `- Vyline: ${process.env.VYLINE_VERSION ?? process.env.npm_package_version ?? "development"}`,
    `- OS: ${process.platform} ${process.arch}`,
    `- Runtime: Bun ${Bun.version}`,
    `- 発生日時: ${occurredAt}`,
    `- 関連設定: ${JSON.stringify(safeSettings)}`,
    "",
    "<details><summary>サニタイズ済み診断情報</summary>",
    "",
    "```json",
    diagnostics.slice(0, 12_000),
    "```",
    "</details>",
    "",
  ].join("\n");
  const title = safeInput(input.summary).slice(0, 120) || "Vyline issue";
  const prefilledIssueUrl = `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(report)}`;
  const delivery =
    prefilledIssueUrl.length <= ISSUE_URL_LIMIT ? ("github" as const) : ("copy" as const);
  return {
    title,
    report,
    occurredAt,
    delivery,
    issueUrl: delivery === "github" ? prefilledIssueUrl : ISSUE_URL,
  };
}
