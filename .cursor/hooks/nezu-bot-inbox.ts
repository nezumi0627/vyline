/**
 * Cursor hook: inject pending Nezu BOT inbox into agent context.
 * Events: sessionStart, stop
 *
 * Reads JSON from stdin, writes JSON to stdout.
 */
import { loadPendingSummary } from "../../tools/nezu-bot/watchLib.ts";

const input = await Bun.stdin.text();
let event = "";
try {
  const j = JSON.parse(input || "{}") as { hook_event_name?: string; event?: string };
  event = j.hook_event_name ?? j.event ?? "";
} catch {
  event = "";
}

const pending = loadPendingSummary();

if (pending.length === 0) {
  console.log("{}");
  process.exit(0);
}

const lines = pending.map(
  (p, i) =>
    `${i + 1}. [${p.id}] (${p.kind}) ${p.text ?? "(no text)"} @ ${p.receivedAt}`,
);

const context = [
  "## Nezu BOT inbox — 未処理の指示があります（最優先）",
  "",
  ...lines,
  "",
  "手順: `bun tools/nezu-bot/pollInbox.ts --ack <id>` → 実行 → `--done <id>` → `bun tools/nezu-bot/pushReply.ts \"…\"`",
  "詳細: docs/tools/nezu-bot-agent.md",
].join("\n");

if (event === "stop") {
  console.log(
    JSON.stringify({
      followup_message:
        "Nezu BOT inbox に未処理の指示が残っています。pollInbox → ack → 実行 → done → pushReply を続けてください。",
    }),
  );
} else {
  // sessionStart and unknown events: inject context
  console.log(JSON.stringify({ additional_context: context }));
}
