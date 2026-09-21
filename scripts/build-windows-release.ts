#!/usr/bin/env bun
import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
  version: string;
};
const releaseDir = join(root, "dist", "windows");
const stagingDir = join(root, "dist", `windows-staging-${randomUUID()}`);
const previousDir = join(root, "dist", "windows.previous");
const packageDir = join(stagingDir, "Vyline");
const webDir = join(packageDir, "web");
const skipInstaller = Bun.argv.includes("--skip-installer") || Bun.argv.includes("--portable");
function run(command: string, args: string[]) {
  const r = Bun.spawnSync([command, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`${command} failed`);
}
function findIscc() {
  for (const p of [
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
  ])
    if (existsSync(p)) return p;
  const onPath = Bun.which("iscc");
  if (onPath) return onPath;
  throw new Error("Inno Setup (ISCC.exe) is not installed");
}
async function sha256File(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(filePath).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}
await rm(stagingDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
run("bun", ["run", "build"]);
await cp(join(root, "Vyline", "apps", "desktop", "dist"), webDir, { recursive: true });
await cp(join(root, "openapi.yaml"), join(packageDir, "openapi.yaml"));
const args = [
  "build",
  "--compile",
  "--minify",
  "--target=bun-windows-x64",
  `--windows-version=${version.match(/^\d+\.\d+\.\d+/)?.[0] ?? "0.0.0"}.0`,
  "--windows-hide-console",
  "--outfile",
];
run("bun", [
  ...args,
  join(packageDir, "VylineBackend.exe"),
  join(root, "Vyline", "backend", "src", "index.ts"),
]);
run("bun", [...args, join(packageDir, "Vyline.exe"), join(root, "scripts", "windows-launcher.ts")]);
if (!skipInstaller) {
  run(findIscc(), [
    `/DAppVersion=${version}`,
    `/DSourceDir=${packageDir}`,
    `/DOutputDir=${stagingDir}`,
    join(root, "installer", "Vyline.iss"),
  ]);
}

// Keep the last successful package recoverable until the new package is complete.
await rm(previousDir, { recursive: true, force: true });
if (existsSync(releaseDir)) await rename(releaseDir, previousDir);
try {
  await rename(stagingDir, releaseDir);
} catch (error) {
  if (existsSync(previousDir) && !existsSync(releaseDir)) await rename(previousDir, releaseDir);
  throw error;
}

if (skipInstaller) {
  console.log(`Portable Windows package created at ${join(releaseDir, "Vyline")}`);
} else {
  const installerName = `VylineSetup-${version}.exe`;
  const installerPath = join(releaseDir, installerName);
  const installerDigest = await sha256File(installerPath);
  await Bun.write(`${installerPath}.sha256`, `${installerDigest}  ${installerName}\n`);
}
