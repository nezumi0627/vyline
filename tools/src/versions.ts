/**
 * versions — インストール済み LINE Desktop バージョンの一覧表示。
 *
 *   bun run versions
 *   bun run versions -- --json
 *   bun run versions -- --line-root "C:\path\to\LINE"
 *
 * 対象はインストール済みバージョン（%LOCALAPPDATA%\LINE\bin\<version>\LINE.exe）のみ。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  currentExeVersion,
  listInstalledVersions,
} from "./lineVersions.js";
import { defaultLineRoot, lineBinDir } from "./paths.js";

const rawArgs = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i]!;
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = rawArgs[i + 1];
  if (next && !next.startsWith("--")) {
    flags[key] = next;
    i++;
  } else {
    flags[key] = true;
  }
}

if (flags["help"] || flags["h"]) {
  console.log(`usage: bun run versions [options]

  --line-root <path>   LINE ルート（既定: %LOCALAPPDATA%\\LINE / VYLINE_LINE_ROOT / NEZU_LINE_ROOT）
  --json               機械可読 JSON 出力
`);
  process.exit(0);
}

const jsonOut = Boolean(flags["json"]);
const lineRoot = typeof flags["line-root"] === "string" ? (flags["line-root"] as string) : undefined;

const root = defaultLineRoot(lineRoot);
const versions = listInstalledVersions(lineRoot);
const currentVer = currentExeVersion(root);
const currentExe = join(lineBinDir(root), "current", "LINE.exe");

if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        lineRoot: root,
        current: {
          version: currentVer,
          exePath: existsSync(currentExe) ? currentExe : null,
        },
        versions,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`LINE root : ${root}`);
if (versions.length === 0) {
  console.log("インストール済みバージョンは見つかりません。");
  process.exit(0);
}
console.log("");
console.log("インストール済みバージョン:");
console.log("");
for (const v of versions) {
  const cur = v.isCurrent ? " (current)" : "";
  console.log(`  ${v.version}${cur}`);
  console.log(`    exe    : ${v.exePath}`);
  console.log(`    size   : ${(v.exeSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    sha256 : ${v.exeSha256.slice(0, 16)}…`);
  console.log(`    mtime  : ${new Date(v.folderMtimeMs).toLocaleString("ja-JP")}`);
}
console.log("");
if (currentVer && !versions.some((v) => v.isCurrent)) {
  console.log(`※ bin/current → ${currentVer}（バージョンフォルダは統合済みのため一覧に無し）`);
}
console.log("");
console.log("選択: bun run vyline:unpack -- --version <version>");
console.log("比較: bun run vyline:check -- --version <version>");
console.log("一覧: bun run vyline:versions");
