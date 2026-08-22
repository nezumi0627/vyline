#!/usr/bin/env bun
/**
 * バージョン一括更新スクリプト。
 *
 * 使い方:
 *   bun run bump -- 0.7.0        # 指定バージョンへ更新
 *   bun run bump -- minor        # 現在のバージョンから相対指定 (major / minor / patch)
 *   bun run bump -- 0.7.0 --tag  # 更新後に git tag v<version> を作成
 *
 * 更新対象（AGENTS.md「バージョン管理」参照）:
 *   - package.json (ルート)
 *   - Vyline/apps/desktop/package.json
 *   - Vyline/apps/desktop/src/lib/store.ts の UPDATE_NOTES.version / title
 *   - README.md のバッジ
 */

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => a !== "--");
const tag = args.includes("--tag");
const spec = args.find((a) => !a.startsWith("--"));

if (!spec) {
  console.error("使い方: bun run bump -- <version|major|minor|patch> [--tag]");
  process.exit(1);
}

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(p: string) {
  return readFileSync(`${ROOT}/${p}`, "utf8");
}
function write(p: string, content: string) {
  writeFileSync(`${ROOT}/${p}`, content);
}

const rootPkg = JSON.parse(read("package.json")) as { version: string };
const current = rootPkg.version;

let next: string;
if (["major", "minor", "patch"].includes(spec)) {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)(-.*)?$/);
  if (!m) throw new Error(`現在のバージョンが不正です: ${current}`);
  const [, maj, min, pat, suffix = ""] = m;
  const bumped = { major: [+maj + 1, 0, 0], minor: [+maj, +min + 1, 0], patch: [+maj, +min, +pat + 1] }[spec as "major" | "minor" | "patch"];
  next = `${bumped[0]}.${bumped[1]}.${bumped[2]}${suffix}`;
} else {
  next = spec;
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  throw new Error(`バージョン形式が不正です: ${next} (例: 1.2.3 / 1.2.3-beta)`);
}

// 1. package.json x2
for (const p of ["package.json", "Vyline/apps/desktop/package.json"]) {
  write(p, read(p).replace(/"version": "[^"]+"/, `"version": "${next}"`));
}

// 2. store.ts UPDATE_NOTES (version と title 内のバージョン部分のみ置換、title 後半は保持)
const storePath = "Vyline/apps/desktop/src/lib/store.ts";
let store = read(storePath);
store = store.replace(
  /(export const UPDATE_NOTES = \{\s*version: ")[^"]+(",\s*title: "Vyline )([^"]*?)((?:\d[\w.-]*)")/,
  `$1${next}$2${next}$4`,
);
write(storePath, store);

// 3. README badge (shields.io は `-` を `--` にエスケープ)
const readmePath = "README.md";
write(
  readmePath,
  read(readmePath).replace(/badge\/version-[\w.-]+-a78bfa/, `badge/version-${next.replaceAll("-", "--")}-a78bfa`),
);

console.log(`バージョンを ${current} → ${next} に更新しました。`);
console.log("次の手動作業:");
console.log(`  - ${storePath}: UPDATE_NOTES.title / items を今回の変更内容に合わせて編集`);
console.log("  - CHANGELOG.md: 新バージョンのエントリを追記");
console.log("  - README.md: 冒頭 NOTE の「現在のバージョン」と「状態」行を確認");

if (tag) {
  const proc = Bun.spawnSync(["git", "tag", `v${next}`]);
  if (proc.exitCode === 0) console.log(`タグ v${next} を作成しました。`);
  else console.error("git tag に失敗しました。");
}
