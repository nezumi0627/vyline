import { readFileSync } from "node:fs";
import { isValidVersion } from "./versioning";

const read = (path: string) => readFileSync(path, "utf8");
const root = JSON.parse(read("package.json")) as { version: string };
const desktop = JSON.parse(read("Vyline/apps/desktop/package.json")) as { version: string };
const version = root.version;
const notes = read("Vyline/apps/desktop/src/lib/store.ts");
const changelog = read("CHANGELOG.md");
const badgeVersion = version.replaceAll("-", "--");

const failures: string[] = [];
if (!isValidVersion(version)) failures.push(`root package.json の version が不正: ${version}`);
if (desktop.version !== version)
  failures.push(
    `Desktop package.json の version が製品バージョン ${version} と不一致: ${desktop.version}`,
  );
if (!notes.includes("version: PRODUCT_VERSION") || !notes.includes("${PRODUCT_VERSION}"))
  failures.push("UPDATE_NOTES の version/title は正本 PRODUCT_VERSION を参照してください");
const updateItems = /items: \[([\s\S]*?)\]/.exec(notes)?.[1] ?? "";
if (
  /title: `[^`]*(?:入力してください|TODO)/.test(notes) ||
  !updateItems.trim() ||
  /TODO|入力してください/.test(updateItems)
)
  failures.push("UPDATE_NOTES のタイトルまたは項目が未記入です");
if (!changelog.includes(`## [${version}]`))
  failures.push(`CHANGELOG.md に ## [${version}] のリリース項目がありません`);
for (const path of ["README.src.md", "README.en.src.md", "README.md", "README.en.md"]) {
  const escaped = badgeVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`badge/version-${escaped}-[\\da-f]{6}`, "i").test(read(path)))
    failures.push(`${path} のバージョンバッジが ${version} と不一致です`);
}

const releaseTag = process.env.GITHUB_REF_NAME;
if (releaseTag) {
  if (releaseTag !== `v${version}`)
    failures.push(`タグ ${releaseTag} が製品バージョン v${version} と不一致です`);
  const { execFileSync } = await import("node:child_process");
  try {
    const taggedCommit = execFileSync("git", ["rev-list", "-n", "1", `refs/tags/${releaseTag}`], {
      encoding: "utf8",
    }).trim();
    if (taggedCommit !== process.env.GITHUB_SHA)
      failures.push(
        `タグ ${releaseTag} はイベントのコミット ${process.env.GITHUB_SHA} を指していません`,
      );
  } catch {
    failures.push(`タグ ${releaseTag} のコミットを確認できません`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(
  `製品バージョン ${version}: package / UPDATE_NOTES / CHANGELOG / README は一致しています。`,
);
