export const SUPPORT_CATEGORIES = {
  login: "ログイン・認証",
  sync: "同期・受信",
  messages: "メッセージ・既読",
  display: "表示・操作",
  backup: "バックアップ・復元",
  other: "その他",
} as const;

export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;

export type SupportReport = {
  category: SupportCategory;
  title: string;
  details: string;
  steps?: string;
  expected?: string;
};

function reportSections(report: SupportReport) {
  const sections: [string, string][] = [
    ["カテゴリ", SUPPORT_CATEGORIES[report.category]],
    ["症状", report.title.trim()],
    ["詳しい状況", report.details.trim()],
    ["再現手順", report.steps?.trim() ?? ""],
    ["期待する動作", report.expected?.trim() ?? ""],
  ];
  return sections.filter(([, value]) => value);
}

export function buildSupportIssueBody(report: SupportReport, version: string): string {
  const parts = reportSections(report).map(([heading, value]) =>
    value ? `### ${heading}\n${value}` : heading,
  );
  if (version) parts.push(`### Vyline\n${version}`);
  parts.push("### 診断データ\n必要に応じて、内容を確認したサポートZIPを添付してください。");
  return parts.join("\n\n");
}

export function buildSupportPrompt(report: SupportReport): string {
  return [
    "あなたはVylineのサポート担当です。以下の報告をもとに、原因候補と安全な確認手順を日本語で案内してください。情報が足りない場合は決めつけず、必要な質問をしてください。認証情報や秘密情報を尋ねないでください。",
    ...reportSections(report).map(([heading, value]) => (value ? `${heading}\n${value}` : heading)),
    "回答には、次に確認する手順を番号付きで含めてください。",
  ].join("\n\n");
}
