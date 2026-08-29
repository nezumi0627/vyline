#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const failures = [];

async function read(path) {
  return readFile(join(root, path), "utf8");
}

async function walk(dir) {
  const absolute = join(root, dir);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relative(root, path))));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(relative(root, path));
  }
  return files;
}

function fail(path, message) {
  failures.push(`${path}: ${message}`);
}

const gitmodules = await read(".gitmodules");
if (/github\.com\/nezumi0627\//i.test(gitmodules)) {
  fail(".gitmodules", "old nezumi0627 submodule URL is still present");
}
for (const expected of [
  "tqmane/vyline-search.git",
  "tqmane/vyline-api.git",
  "tqmane/vyline-plugin.git",
  "tqmane/vyline-theme.git",
]) {
  if (!gitmodules.includes(expected)) fail(".gitmodules", `missing ${expected}`);
}

const sourceFiles = await walk("Vyline/apps/desktop/src");
for (const path of sourceFiles) {
  const source = await read(path);
  if (/\b(?:window\.)?setInterval\s*\(\s*async\b/.test(source)) {
    fail(path, "async setInterval can overlap requests; use startSerialPoll");
  }
  if (
    /window\.dispatchEvent\s*\([\s\S]{0,160}vyline:/.test(source) ||
    /window\.(?:addEventListener|removeEventListener)\s*\(\s*["']vyline:/.test(source)
  ) {
    fail(path, "window is being used as a Vyline application event bus; use appEvents");
  }
}

for (const path of [
  "Vyline/apps/desktop/src/pages/LoginPage.tsx",
  "Vyline/apps/desktop/src/components/IosBackupWizard.tsx",
  "Vyline/apps/desktop/src/components/android-backup-panel.tsx",
  "Vyline/apps/desktop/src/components/ios-backup-beta-panel.tsx",
  "Vyline/apps/desktop/src/pages/VylineApp.tsx",
  "Vyline/apps/desktop/src/hooks/useVylineSync.ts",
]) {
  const source = await read(path);
  if (/\b(?:window\.)?setInterval\s*\(/.test(source)) {
    fail(path, "network/state polling must not use setInterval; use startSerialPoll");
  }
}

const settings = await read("Vyline/apps/desktop/src/components/settings-sections.tsx");
const pairingPolls = settings.match(/api\.subdevices\.list\(\)/g)?.length ?? 0;
if (pairingPolls > 2) {
  fail(
    "Vyline/apps/desktop/src/components/settings-sections.tsx",
    `subdevice list has ${pairingPolls} call sites; duplicate pairing poll likely returned`,
  );
}

if (failures.length) {
  console.error("Vyline architecture check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Vyline architecture check passed.");
