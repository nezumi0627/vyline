import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import {
  HANDOFF_FORMAT,
  HANDOFF_VERSION,
  type HandoffManifest,
  type Platform,
} from "@vyline/types";
import { accountFile, accountDir } from "../storage/accountDirs.js";
import { safePathComponent, writeJsonAtomic } from "../storage/safeFile.js";
import { loadAccountSettings } from "./accountSettingsService.js";
import { anonymousId } from "./redaction.js";

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 16;
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function platform(value: unknown): Platform {
  return value === "web" ? "web" : "desktop";
}

interface ParsedHandoff {
  manifest: HandoffManifest;
  entries: Record<string, Uint8Array>;
}

function parseHandoff(archiveBase64: string): ParsedHandoff {
  if (!archiveBase64 || archiveBase64.length > Math.ceil(MAX_ARCHIVE_BYTES * 1.4))
    throw new Error("handoff archive is too large");
  const archive = Buffer.from(archiveBase64, "base64");
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("handoff archive is too large");
  let extractedBytes = 0;
  let entryCount = 0;
  const entries = unzipSync(archive, {
    filter(file) {
      entryCount++;
      extractedBytes += file.originalSize;
      if (entryCount > MAX_ARCHIVE_ENTRIES || extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error("handoff archive expands beyond safe limits");
      }
      return true;
    },
  });
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("manifest.json is required");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as HandoffManifest;
  if (manifest.format !== HANDOFF_FORMAT || manifest.version !== HANDOFF_VERSION)
    throw new Error("unsupported handoff format");
  if (!manifest.handoffId || !Array.isArray(manifest.files) || manifest.encryption?.mode !== "none")
    throw new Error("invalid handoff manifest");
  for (const file of manifest.files) {
    if (!/^[-a-zA-Z0-9_.]+$/.test(file.path) || file.path.includes(".."))
      throw new Error("unsafe handoff path");
    const data = entries[file.path];
    if (!data || data.byteLength !== file.size || sha256(data) !== file.sha256)
      throw new Error(`handoff integrity check failed: ${file.path}`);
  }
  return { manifest, entries };
}

export function inspectHandoff(
  mid: string,
  archiveBase64: string,
): { manifest: HandoffManifest; files: string[]; matchesCurrentAccount: boolean } {
  const { manifest } = parseHandoff(archiveBase64);
  return {
    manifest,
    files: manifest.files.map((file) => file.path),
    matchesCurrentAccount: manifest.account.midHash === anonymousId(mid),
  };
}

export async function exportHandoff(
  mid: string,
  sourcePlatform: unknown = "desktop",
): Promise<{ filename: string; archiveBase64: string; manifest: HandoffManifest }> {
  const settings = strToU8(JSON.stringify(await loadAccountSettings(mid), null, 2));
  const files = [{ path: "settings.json", data: settings }];
  const manifest: HandoffManifest = {
    format: HANDOFF_FORMAT,
    version: HANDOFF_VERSION,
    handoffId: randomUUID(),
    source: {
      platform: platform(sourcePlatform),
      appVersion: process.env.npm_package_version ?? "dev",
      schemaVersion: 1,
    },
    createdAt: new Date().toISOString(),
    account: { midHash: anonymousId(mid) },
    files: files.map(({ path, data }) => ({ path, sha256: sha256(data), size: data.byteLength })),
    encryption: { mode: "none" },
  };
  const archive = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    ...Object.fromEntries(files.map(({ path, data }) => [path, data])),
  });
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("handoff archive is too large");
  return {
    filename: `${manifest.handoffId}.zip`,
    archiveBase64: Buffer.from(archive).toString("base64"),
    manifest,
  };
}

export async function importHandoff(
  mid: string,
  archiveBase64: string,
  mode: "overwrite" | "merge" | "cancel" = "cancel",
): Promise<{ manifest: HandoffManifest; imported: string[] }> {
  if (mode === "cancel") throw new Error("import cancelled");
  const { manifest, entries } = parseHandoff(archiveBase64);
  const settingsData = entries["settings.json"];
  if (!settingsData) throw new Error("settings.json is required");
  const incoming = JSON.parse(strFromU8(settingsData)) as Record<string, unknown>;
  const current = await loadAccountSettings(mid);
  const next = mode === "merge" ? { ...current, ...incoming } : incoming;
  const dir = accountDir(mid);
  await mkdir(dir, { recursive: true });
  const backup = join(
    DATA_DIR,
    "accounts",
    `${safePathComponent(mid)}.handoff-backup-${Date.now()}`,
  );
  const currentPath = accountFile(mid, "settings.json");
  if (existsSync(currentPath)) await rename(currentPath, backup);
  try {
    await writeJsonAtomic(currentPath, next);
  } catch (error) {
    if (existsSync(backup)) await rename(backup, currentPath).catch(() => undefined);
    throw error;
  }
  await rm(backup, { force: true }).catch(() => undefined);
  await writeFile(
    accountFile(mid, "handoff.json"),
    JSON.stringify({ handoffId: manifest.handoffId, importedAt: new Date().toISOString() }),
  );
  return { manifest, imported: ["settings.json"] };
}
