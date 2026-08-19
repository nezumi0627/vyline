#!/usr/bin/env bun
/**
 * 通話テスト CLI — Desktop 準拠の通話フロー検証
 *
 *   bun run vyline:call-test -- --account main --name 相手名
 *   bun run vyline:call-test -- --account main --to uxxxxxxxx --tone
 */

import { parseArgs } from "node:util";
import { getClient } from "../line/clientManager.js";
import {
  CallNotAllowedError,
  callAllowlistHint,
  startDirectCall,
  stopDirectCall,
  fetchContactProfile,
} from "../service/lineService.js";
import { isAllowedCallTarget } from "../call/allowlist.js";
import { sendTestTone } from "../call/callManager.js";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    account: { type: "string", default: "main" },
    to: { type: "string" },
    name: { type: "string" },
    tone: { type: "boolean", default: false },
    "no-wait": { type: "boolean", default: false },
  },
});

async function resolveToMid(accountId: string): Promise<string> {
  if (values.to) return values.to;
  if (!values.name) {
    console.error("Usage: --to uMID  or  --name ACECRAFT|7sGood");
    process.exit(1);
  }
  const client = getClient(accountId);
  if (!client) throw new Error(`not logged in: ${accountId}`);
  const friends = await client.fetchUsers();
  const q = values.name.toLowerCase();
  const hit = friends.find((u: { mid?: string; displayName?: string }) => {
    const n = (u.displayName ?? "").toLowerCase();
    return n.includes(q) || (u.displayName ?? "").includes(values.name!);
  });
  if (!hit?.mid) throw new Error(`friend not found: ${values.name}`);
  return hit.mid;
}

async function main() {
  const accountId = values.account ?? "main";
  const to = await resolveToMid(accountId);
  const profile = await fetchContactProfile(accountId, to);
  const displayName = profile?.displayName ?? null;
  if (!isAllowedCallTarget(to)) {
    throw new CallNotAllowedError(callAllowlistHint());
  }
  console.log(`[call-test] starting → ${displayName ?? to} (${to})`);
  const session = await startDirectCall(accountId, to, "AUDIO");
  console.log(
    `[call-test] session=${session.sessionId} transport=${session.transport} state=${session.state}`,
  );
  if (values.tone) {
    console.log("[call-test] sending 440Hz test tone (3s)…");
    await sendTestTone(session.sessionId, 3000);
  }
  if (!values["no-wait"]) {
    console.log("[call-test] in-call — Ctrl+C で終了");
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => resolve());
    });
  }
  await stopDirectCall(session.sessionId);
  console.log("[call-test] ended");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
