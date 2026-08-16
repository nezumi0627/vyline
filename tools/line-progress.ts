/**
 * tools/line-progress.ts — れんや宛に LINE push で進捗を送る
 *
 * line-bot MCP が未ロードの環境でも Messaging API を直接叩けるようにする。
 * トークンはユーザー .claude.json の mcpServers["line-bot"].env から読む。
 * 使い方: bun tools/line-progress.ts "本文"
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const CLAUDE_JSON = join(homedir(), ".claude.json");

function readLineBotEnv(): { token: string; userId: string } {
  // 環境変数優先（テスト/CI 用）
  if (process.env["CHANNEL_ACCESS_TOKEN"] && process.env["DESTINATION_USER_ID"]) {
    return {
      token: process.env["CHANNEL_ACCESS_TOKEN"],
      userId: process.env["DESTINATION_USER_ID"],
    };
  }
  const raw = readFileSync(CLAUDE_JSON, "utf8");
  const cfg = JSON.parse(raw);
  // プロジェクトスコープ（projects.<path>.mcpServers.line-bot）から探す
  const projects = cfg?.projects ?? {};
  for (const p of Object.values(projects)) {
    const env = (p as { mcpServers?: Record<string, { env?: Record<string, string> }> })?.mcpServers?.["line-bot"]?.env;
    if (env?.CHANNEL_ACCESS_TOKEN && env?.DESTINATION_USER_ID) {
      return { token: env.CHANNEL_ACCESS_TOKEN, userId: env.DESTINATION_USER_ID };
    }
  }
  const env = cfg?.mcpServers?.["line-bot"]?.env;
  const token = env?.CHANNEL_ACCESS_TOKEN;
  const userId = env?.DESTINATION_USER_ID;
  if (!token || !userId) {
    throw new Error("line-bot env not found in .claude.json");
  }
  return { token, userId };
}

const text = process.argv[2];
if (!text) {
  console.error("usage: bun tools/line-progress.ts <message>");
  process.exit(1);
}

const { token, userId } = readLineBotEnv();
const res = await fetch("https://api.line.me/v2/bot/message/push", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    to: userId,
    messages: [{ type: "text", text }],
  }),
});
if (!res.ok) {
  const body = await res.text();
  console.error("LINE push failed:", res.status, body.slice(0, 200));
  process.exit(1);
}
console.log("LINE push sent:", text.slice(0, 50));
