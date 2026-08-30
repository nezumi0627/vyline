import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DebugContext, LogLevel } from "@vyline/types";
import { redactForDiagnostics } from "./redaction.js";
import { safePathComponent, writeTextAtomic } from "../storage/safeFile.js";
import { loadAccountSettings } from "./accountSettingsService.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const LOG_DIR = process.env.VYLINE_LOG_DIR ?? join(DATA_DIR, "logs");
const MAX_LOG_BYTES = 1024 * 1024;
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const writes = new Map<string, Promise<void>>();
const prunedAt = new Map<string, number>();

function serialize(mid: string, work: () => Promise<void>): Promise<void> {
  const next = (writes.get(mid) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(mid, next);
  return next.finally(() => {
    if (writes.get(mid) === next) writes.delete(mid);
  });
}
function logPath(mid: string): string {
  return join(LOG_DIR, `diagnostics-${safePathComponent(mid)}.jsonl`);
}

export async function appendDiagnostic(
  mid: string,
  context: DebugContext,
  details?: unknown,
  level: LogLevel = "info",
): Promise<void> {
  return serialize(mid, async () => {
    const { debug } = await loadAccountSettings(mid);
    if (!debug.enabled || LEVELS[level] < LEVELS[debug.level]) return;
    await mkdir(LOG_DIR, { recursive: true });
    const path = logPath(mid);
    // Rotate a bounded file instead of growing it on every synchronization poll.
    if (
      Date.now() - (prunedAt.get(mid) ?? 0) >= 3_600_000 ||
      ((await stat(path).catch(() => null))?.size ?? 0) >= MAX_LOG_BYTES
    ) {
      const recent = await readDiagnostics(mid, 500);
      await writeTextAtomic(path, `${recent.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
      prunedAt.set(mid, Date.now());
    }
    const entry = redactForDiagnostics({
      ...context,
      details,
      level,
      at: new Date().toISOString(),
    });
    await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  });
}

async function readDiagnostics(mid: string, limit: number): Promise<unknown[]> {
  const path = logPath(mid);
  if (!existsSync(path)) return [];
  const { debug } = await loadAccountSettings(mid);
  const days = Number.isFinite(debug.retentionDays)
    ? Math.max(1, Math.min(debug.retentionDays, 90))
    : 14;
  const cutoff = Date.now() - days * 86_400_000;
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 1000)) : 200;
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
  return lines
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        return Date.parse(entry.at) >= cutoff ? [redactForDiagnostics(entry)] : [];
      } catch {
        return [];
      }
    })
    .slice(-count);
}

export async function listDiagnostics(mid: string, limit = 200): Promise<unknown[]> {
  await writes.get(mid)?.catch(() => undefined);
  return readDiagnostics(mid, limit);
}

export async function clearDiagnostics(mid: string): Promise<void> {
  await serialize(mid, () => rm(logPath(mid), { force: true }));
  prunedAt.delete(mid);
}

export async function exportDiagnostics(mid: string): Promise<string> {
  return JSON.stringify(await listDiagnostics(mid, 1000), null, 2);
}
