/**
 * Workspace paths for Vyline-Search.
 *
 * Override with env:
 *   VYLINE_SEARCH_DATA  — root for binaries / outputs / tool caches (default: ./data)
 *   VYLINE_SEARCH_EXE   — default unpacked exe path
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
/** Repo root (parent of src/) */
export const REPO_ROOT = join(_here, "..");

export const DATA_DIR =
  process.env["VYLINE_SEARCH_DATA"]?.trim() || join(REPO_ROOT, "data");

export const GHIDRA_SCRIPTS_DIR = join(REPO_ROOT, "ghidra-scripts");
export const RE_TOOLS_DIR = join(DATA_DIR, "re-tools");
export const OUT_DIR = join(DATA_DIR, "out");
export const GHIDRA_PROJECTS_DIR = join(DATA_DIR, "ghidra-projects");

export function defaultUnpackedExe(): string {
  return (
    process.env["VYLINE_SEARCH_EXE"]?.trim() ||
    join(DATA_DIR, "unpacked_LINE.exe")
  );
}

export function ensureDataLayout(): void {
  for (const p of [DATA_DIR, RE_TOOLS_DIR, OUT_DIR, GHIDRA_PROJECTS_DIR]) {
    mkdirSync(p, { recursive: true });
  }
}

export function assertExists(path: string, hint: string): void {
  if (!existsSync(path)) {
    throw new Error(`${hint}\n  missing: ${path}`);
  }
}
