import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DebugContext } from "@vyline/types";
import { redactForDiagnostics } from "./redaction.js";
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
  const entries = await listDiagnostics(mid, 1000);
  return JSON.stringify(
    {
      vylineVersion: process.env.npm_package_version ?? "dev",
      os: `${process.platform} ${process.arch}`,
      feature: "diagnostics",
      errorSummary: "ユーザーが確認したエラー概要を入力してください",
      reproductionSteps: [],
      generatedAt: new Date().toISOString(),
      metadata: { entryCount: entries.length },
      sanitized: true,
      sanitization: "フィールド名に基づき秘密情報・個人情報・本文・URL・パスを除外済み",
      entries,
    },
    null,
    2,
  );
}
