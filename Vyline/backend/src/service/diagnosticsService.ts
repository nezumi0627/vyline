import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DebugContext, LogLevel } from "@vyline/types";
import { safePathComponent, writeTextAtomic } from "../storage/safeFile.js";
import { listSavedSessions } from "../storage/tokenStore.js";
import { loadAccountSettings, saveAccountSettings } from "./accountSettingsService.js";
import { anonymousId, redactForDiagnostics } from "./redaction.js";

const MAX_LOG_BYTES = 1024 * 1024;
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const writes = new Map<string, Promise<unknown>>();

function logDir(): string {
  const dataDir = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
  return process.env.VYLINE_LOG_DIR ?? join(dataDir, "logs");
}

function serialize<T>(mid: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(mid) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(mid, next);
  return next.finally(() => {
    if (writes.get(mid) === next) writes.delete(mid);
  });
}
function logPath(mid: string): string {
  return join(logDir(), `diagnostics-${anonymousId(mid)}.jsonl`);
}

function legacyLogPath(mid: string): string {
  return join(logDir(), `diagnostics-${safePathComponent(mid)}.jsonl`);
}

async function migrateLegacyLog(mid: string): Promise<void> {
  const legacy = legacyLogPath(mid);
  const current = logPath(mid);
  if (legacy !== current && existsSync(legacy) && !existsSync(current)) {
    await mkdir(logDir(), { recursive: true });
    await rename(legacy, current).catch(() => undefined);
  }
}

function parseDiagnostics(content: string, cutoff: number): unknown[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as { at?: unknown };
        const timestamp = typeof entry.at === "string" ? Date.parse(entry.at) : Number.NaN;
        return Number.isFinite(timestamp) && timestamp >= cutoff
          ? [redactForDiagnostics(entry)]
          : [];
      } catch {
        return [];
      }
    });
}

async function readLogFiles(path: string): Promise<string[]> {
  return Promise.all(
    [`${path}.1`, path].map(async (candidate) =>
      existsSync(candidate) ? readFile(candidate, "utf8").catch(() => "") : "",
    ),
  );
}

async function maintainLog(mid: string, retentionDays: number, incomingBytes = 0): Promise<void> {
  await migrateLegacyLog(mid);
  const path = logPath(mid);
  const rotated = `${path}.1`;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  if (existsSync(rotated) && (await stat(rotated)).mtimeMs < cutoff) {
    await rm(rotated, { force: true });
  }
  if (existsSync(path) && (await stat(path)).mtimeMs < cutoff) {
    await rm(path, { force: true });
  }
  if (existsSync(path) && (await stat(path)).size + incomingBytes > MAX_LOG_BYTES) {
    const recent = parseDiagnostics((await readLogFiles(path)).join("\n"), cutoff).slice(-500);
    const content = recent.length > 0 ? `${recent.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
    await writeTextAtomic(rotated, content);
    await rm(path, { force: true });
  }
}

export async function appendDiagnostic(
  mid: string,
  context: DebugContext,
  details?: unknown,
  level: LogLevel = "info",
): Promise<boolean> {
  return serialize(mid, async () => {
    const settings = await loadAccountSettings(mid);
    if (!settings.debug.enabled || LEVELS[level] < LEVELS[settings.debug.level]) return false;
    await mkdir(logDir(), { recursive: true, mode: 0o700 });
    const entry = redactForDiagnostics({
      ...context,
      details,
      level,
      at: new Date().toISOString(),
    });
    const line = `${JSON.stringify(entry)}\n`;
    await maintainLog(mid, settings.debug.retentionDays, Buffer.byteLength(line));
    await appendFile(logPath(mid), line, { encoding: "utf8", mode: 0o600 });
    return true;
  });
}

async function readDiagnostics(mid: string, limit: number): Promise<unknown[]> {
  const { debug } = await loadAccountSettings(mid);
  await maintainLog(mid, debug.retentionDays);
  const path = logPath(mid);
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 1000)) : 200;
  const cutoff = Date.now() - debug.retentionDays * 86_400_000;
  return parseDiagnostics((await readLogFiles(path)).join("\n"), cutoff).slice(-count);
}

export function listDiagnostics(mid: string, limit = 200): Promise<unknown[]> {
  return serialize(mid, () => readDiagnostics(mid, limit));
}

export function clearDiagnostics(mid: string): Promise<void> {
  return serialize(mid, async () => {
    await Promise.all([
      rm(logPath(mid), { force: true }),
      rm(`${logPath(mid)}.1`, { force: true }),
      rm(legacyLogPath(mid), { force: true }),
    ]);
  });
}

export async function exportDiagnostics(mid: string): Promise<string> {
  return JSON.stringify(await listDiagnostics(mid, 1000), null, 2);
}

export async function diagnosticsStatus(mid: string) {
  const settings = await loadAccountSettings(mid);
  await maintainLog(mid, settings.debug.retentionDays);
  const path = logPath(mid);
  const rotated = `${path}.1`;
  const [currentSize, rotatedSize] = await Promise.all([
    existsSync(path)
      ? stat(path)
          .then((value) => value.size)
          .catch(() => 0)
      : 0,
    existsSync(rotated)
      ? stat(rotated)
          .then((value) => value.size)
          .catch(() => 0)
      : 0,
  ]);
  return {
    enabled: settings.debug.enabled,
    retentionDays: settings.debug.retentionDays,
    level: settings.debug.level,
    allowAutoShare: settings.debug.allowAutoShare,
    sizeBytes: currentSize + rotatedSize,
    entryCount: (await listDiagnostics(mid, 1000)).length,
  };
}

export async function configureDiagnostics(
  mid: string,
  patch: { enabled?: boolean; retentionDays?: number; level?: LogLevel; allowAutoShare?: boolean },
) {
  const current = await loadAccountSettings(mid);
  const retentionDays = Math.max(
    1,
    Math.min(30, Math.round(patch.retentionDays ?? current.debug.retentionDays)),
  );
  const settings = await saveAccountSettings(mid, {
    debug: {
      ...current.debug,
      ...patch,
      retentionDays,
    },
  });
  return diagnosticsStatus(mid);
}

export async function initializeDiagnostics(): Promise<void> {
  const sessions = await listSavedSessions();
  await Promise.all(
    sessions.flatMap((session) => {
      const mid =
        session.mid ?? (/^u[0-9a-f]{32}$/i.test(session.accountId) ? session.accountId : "");
      if (!mid) return [];
      return [
        appendDiagnostic(
          mid,
          {
            appVersion: process.env.npm_package_version ?? "dev",
            buildNumber: process.env.VYLINE_BUILD_NUMBER ?? "dev",
            platform: "desktop",
            runtime: `Bun ${Bun.version}`,
            os: process.platform,
            account: { count: sessions.length, midHash: anonymousId(mid) },
          },
          { event: "backend_started" },
        ),
      ];
    }),
  );
}

export async function appendDiagnosticToKnownAccounts(
  context: Omit<DebugContext, "account">,
  details: unknown,
  level: LogLevel,
): Promise<void> {
  const sessions = await listSavedSessions();
  await Promise.all(
    sessions.flatMap((session) => {
      const mid =
        session.mid ?? (/^u[0-9a-f]{32}$/i.test(session.accountId) ? session.accountId : "");
      return mid
        ? [
            appendDiagnostic(
              mid,
              { ...context, account: { count: sessions.length, midHash: anonymousId(mid) } },
              details,
              level,
            ),
          ]
        : [];
    }),
  );
}
