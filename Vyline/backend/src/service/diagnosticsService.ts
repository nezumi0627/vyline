import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DebugContext } from "@vyline/types";
import { redactForDiagnostics } from "./redaction.js";
import { loadAccountSettings } from "./accountSettingsService.js";
import { safePathComponent } from "../storage/safeFile.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const LOG_DIR = process.env.VYLINE_LOG_DIR ?? join(DATA_DIR, "logs");
function logPath(mid: string): string {
  return join(LOG_DIR, `diagnostics-${safePathComponent(mid)}.jsonl`);
}

export async function appendDiagnostic(
  mid: string,
  context: DebugContext,
  details?: unknown,
): Promise<void> {
  const settings = await loadAccountSettings(mid);
  if (!settings.debug.enabled) return;
  await mkdir(LOG_DIR, { recursive: true });
  const entry = redactForDiagnostics({ ...context, details, at: new Date().toISOString() });
  await appendFile(logPath(mid), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function listDiagnostics(mid: string, limit = 200): Promise<unknown[]> {
  const path = logPath(mid);
  if (!existsSync(path)) return [];
  const lines = (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .slice(-Math.min(limit, 1000));
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

export async function clearDiagnostics(mid: string): Promise<void> {
  await rm(logPath(mid), { force: true });
}

export async function exportDiagnostics(mid: string): Promise<string> {
  return JSON.stringify(await listDiagnostics(mid, 1000), null, 2);
}
