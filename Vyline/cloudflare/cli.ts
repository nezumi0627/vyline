import { cp, mkdir, readdir, rm, copyFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const command = Bun.argv[2];
const cloudflareDir = import.meta.dir;
const repoRoot = resolve(cloudflareDir, "../..");
const stageDir = join(cloudflareDir, ".build-context");

function ignoredPath(path: string): boolean {
  const vylineRoot = join(repoRoot, "Vyline");
  const relativePath = relative(vylineRoot, path).split(sep).join("/");
  const parts = relativePath.split("/");
  const name = basename(path);
  const isProtocolFallback =
    relativePath === "packages/protocol/data" ||
    relativePath === "packages/protocol/data/desktop-profile.fallback.json";

  if (parts.includes("data") && !isProtocolFallback) return true;

  return (
    parts.some(
      (part) =>
        [".git", "node_modules", ".codex-worktrees", ".build-context", ".wrangler"].includes(
          part,
        ) ||
        part.startsWith(".tmp") ||
        ["test-results", "coverage", "playwright-report"].includes(part),
    ) ||
    relativePath.startsWith("backend/storage/cache/") ||
    relativePath.startsWith("backend/storage/saved-media/") ||
    name.startsWith(".env") ||
    name === "desktop-e2ee-keys.json" ||
    name === "desktop-e2ee-dump.txt" ||
    name === "tokens.json" ||
    name === "accounts.json" ||
    name.startsWith("storage-") ||
    name.startsWith("chatdb-") ||
    name.endsWith(".session.json")
  );
}

async function stage(): Promise<void> {
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await copyFile(join(repoRoot, "package.json"), join(stageDir, "package.json"));
  await copyFile(join(repoRoot, "bun.lock"), join(stageDir, "bun.lock"));
  for (const folder of ["apps", "backend", "packages"]) {
    await cp(join(repoRoot, "Vyline", folder), join(stageDir, "Vyline", folder), {
      recursive: true,
      filter: (path) => !ignoredPath(path),
    });
  }

  const stagedFiles = await countFiles(stageDir);
  console.log(`Staged ${stagedFiles} source files for the Cloudflare container.`);
}

async function countFiles(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await countFiles(path);
    else if (entry.isFile()) count++;
  }
  return count;
}

if (command === "stage") {
  await stage();
} else if (command === "clean") {
  await rm(stageDir, { recursive: true, force: true });
} else if (command === "dev" || command === "deploy") {
  await stage();
  try {
    const child = Bun.spawn(["bunx", "wrangler", command, ...Bun.argv.slice(3)], {
      cwd: cloudflareDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exitCode = await child.exited;
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
} else {
  console.error("Usage: bun cli.ts <dev|deploy|stage|clean>");
  process.exitCode = 1;
}
