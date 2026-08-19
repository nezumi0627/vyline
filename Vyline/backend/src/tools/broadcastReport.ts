/**
 * LINE Official Account への進捗ブロードキャスト用ヘルパー
 *
 * 使い方:
 *   bun Vyline/backend/src/tools/broadcastReport.ts "Phase1 完了" "詳細..."
 *
 * 注意: Messaging API の broadcast。友達への個人送信ではない。
 * MCP 経由で送る場合は agent が CallMcpTool(broadcast_*) を使う。
 */

export type PhaseReport = {
  phase: number | string;
  title: string;
  body: string;
  status: "start" | "done" | "blocked" | "wip";
};

export function formatPhaseReport(r: PhaseReport): string {
  const mark =
    r.status === "done" ? "✅" : r.status === "blocked" ? "⛔" : r.status === "start" ? "🚀" : "🔧";
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return [
    `【Vyline 進捗 #${r.phase} ${mark}】`,
    r.title,
    `時刻: ${now}`,
    "",
    r.body,
    "",
    "— push/commit なし / 勝手送信なし —",
  ].join("\n");
}

if (import.meta.main) {
  const title = process.argv[2] ?? "進捗";
  const body = process.argv[3] ?? "";
  console.log(
    formatPhaseReport({
      phase: process.argv[4] ?? "?",
      title,
      body,
      status: (process.argv[5] as PhaseReport["status"]) ?? "wip",
    }),
  );
  console.log("\n(本文を LINE MCP broadcast_text_message に渡してください)");
}
