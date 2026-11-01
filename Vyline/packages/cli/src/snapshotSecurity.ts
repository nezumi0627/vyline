import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export const MAX_SNAPSHOT_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_SNAPSHOT_EXTRACTED_BYTES = 512 * 1024 * 1024;
export const MAX_SNAPSHOT_FILES = 20_000;

export function validateSnapshotArchiveEntries(entries: string[]): void {
  if (entries.length > MAX_SNAPSHOT_FILES) {
    throw new Error(`Snapshot contains too many files (limit: ${MAX_SNAPSHOT_FILES})`);
  }
  for (const rawEntry of entries) {
    const entry = rawEntry.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!entry || entry.startsWith("/") || /^[A-Za-z]:\//.test(entry)) {
      throw new Error(`Unsafe snapshot path: ${rawEntry}`);
    }
    const parts = entry.split("/");
    if (parts.includes("..") || (parts[0] !== "payload" && entry !== "manifest.json")) {
      throw new Error(`Unsafe snapshot path: ${rawEntry}`);
    }
  }
}

export async function measureSnapshotTree(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Snapshot extraction produced a symbolic link");
      }
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported snapshot entry type: ${entry.name}`);
      }
      files += 1;
      bytes += (await lstat(path)).size;
      if (files > MAX_SNAPSHOT_FILES || bytes > MAX_SNAPSHOT_EXTRACTED_BYTES) {
        return { files, bytes };
      }
    }
  }
  return { files, bytes };
}
