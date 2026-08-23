#!/usr/bin/env bun
import { extractAndParseLineHistory } from "../src/index.js";
import { homedir } from "node:os";
import { join } from "node:path";

const { IOS_BACKUP_ROOT, IOS_UDID, IOS_BACKUP_PASSWORD, IOS_OUTPUT_DIR } = process.env;
const BACKUP_ROOT = IOS_BACKUP_ROOT || join(homedir(), "Apple", "MobileSync", "Backup");
const UDID = IOS_UDID || "00008140-000668921A82801C";
const PASSWORD = IOS_BACKUP_PASSWORD || process.argv[2];
const OUTPUT_DIR = IOS_OUTPUT_DIR || join(process.cwd(), "source", "ios-backup", "line");

if (!PASSWORD) {
  console.error("Usage: IOS_BACKUP_PASSWORD=<password> bun run src/cli.ts");
  console.error("  Or: bun run src/cli.ts <password>");
  console.error("Env vars: IOS_BACKUP_ROOT, IOS_UDID, IOS_OUTPUT_DIR");
  process.exit(1);
}

console.log(`[cli] Backup root: ${BACKUP_ROOT}`);
console.log(`[cli] UDID: ${UDID}`);
console.log(`[cli] Output: ${OUTPUT_DIR}`);

try {
  const result = await extractAndParseLineHistory(
    BACKUP_ROOT,
    UDID,
    PASSWORD,
    OUTPUT_DIR,
    (stage, current, total, message) => {
      console.log(`[${stage}] ${current}/${total}: ${message}`);
    },
  );

  console.log("\n[cli] Done!");
  console.log(`  Extracted: ${result.extracted.lineFiles.length} LINE files`);
  console.log(`  Databases: ${result.extracted.databases.length}`);
  console.log(`  Parsed chats: ${result.parsed.chats.length}`);
  console.log(
    `  Total messages: ${Array.from(result.parsed.messages.values()).reduce((a, b) => a + b.length, 0)}`,
  );
} catch (e) {
  console.error("[cli] Error:", e);
  process.exit(1);
}
