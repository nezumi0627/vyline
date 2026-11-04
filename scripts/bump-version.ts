#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { resolveNextVersion } from "./versioning";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("--tag"))
  throw new Error("タグは変更をコミットした後に作成してください。bump はタグを作成しません。");
const spec = args[0];
if (!spec || args.length > 1) {
  console.error("使い方: bun run bump -- <major|minor|patch|alpha|beta|rc|promote|version>");
  process.exit(1);
}
const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
const write = (path: string, value: string) => writeFileSync(`${root}/${path}`, value);
const current = (JSON.parse(read("package.json")) as { version: string }).version;
const operation = ["alpha", "beta", "rc"].includes(spec) ? `prerelease:${spec}` : spec;
const next = resolveNextVersion(current, operation);

const productPaths = ["package.json", "Vyline/apps/desktop/package.json"];
const packages = productPaths.map((path) => [path, read(path)] as const);
const storePath = "Vyline/apps/desktop/src/lib/store.ts";
let store = read(storePath);
const titlePattern = /(title: `Vyline \$\{PRODUCT_VERSION\} — )[^`]+(`,)/;
if (!titlePattern.test(store))
  throw new Error(`${storePath} の UPDATE_NOTES.title が見つかりません`);
store = store.replace(titlePattern, "$1リリースノートを入力してください$2");
store = store.replace(
  /(items: \[)[\s\S]*?(\n {2}\],)/m,
  '$1\n    "TODO: 今回の変更内容に書き換えてください",$2',
);

let changelog = read("CHANGELOG.md");
if (!new RegExp(`^## \\[?${next.replaceAll(".", "\\.")}\\]?`, "m").test(changelog)) {
  changelog = `## [${next}] - Unreleased\n\n- TODO: 今回の変更内容を記載してください。\n\n${changelog}`;
}
const releaseLabelJa = next.includes("-") ? "プレリリース" : "安定版";
const releaseLabelEn = next.includes("-") ? "Pre-release" : "Stable";
const readmes = ["README.src.md", "README.en.src.md"].map((path) => {
  const original = read(path);
  if (!/badge\/version-[\w.-]+-[\da-f]{6}/i.test(original))
    throw new Error(`${path} のバージョンバッジが見つかりません`);
  let content = original.replaceAll(current, next);
  content = content.replace(
    /alt="(?:安定版|プレリリース) [^"]+"/,
    `alt="${releaseLabelJa} ${next}"`,
  );
  content = content.replace(
    /alt="(?:Stable|Pre-release) [^"]+"/,
    `alt="${releaseLabelEn} ${next}"`,
  );
  content = content.replace(
    /badge\/version-[\w.-]+-([\da-f]{6})/i,
    `badge/version-${next.replaceAll("-", "--")}-$1`,
  );
  return [path, content] as const;
});
for (const [path, content] of packages) {
  const updated = content.replace(/("version"\s*:\s*")[^"]+/, `$1${next}`);
  if (updated === content) throw new Error(`${path} の version を更新できません`);
  write(path, updated);
}
write(storePath, store);
write("CHANGELOG.md", changelog);
for (const [path, content] of readmes) write(path, content);
const generated = Bun.spawnSync(["bun", "scripts/generate-readmes.ts"]);
if (generated.exitCode !== 0) throw new Error("README 再生成に失敗しました");
console.log(
  `${current} → ${next} に更新しました。UPDATE_NOTESを編集してからコミットしてください。タグはコミット後に作成します。`,
);
