#!/usr/bin/env bun
import { chmod, cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
  version: string;
};
const outputParent = join(root, "dist");
const releaseDir = join(outputParent, "linux");
const stagingDir = join(outputParent, `linux-staging-${randomUUID()}`);
const previousDir = join(outputParent, "linux.previous");
const packageName = `Vyline-linux-x64-${version}`;
const packageDir = join(stagingDir, packageName);
const webDir = join(packageDir, "web");
let previousMoved = false;

function run(command: string, args: string[]) {
  const result = Bun.spawnSync([command, ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${command} failed with exit code ${result.exitCode}`);
}

function capture(command: string, args: string[]): string {
  const result = Bun.spawnSync([command, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(
      `${command} failed with exit code ${result.exitCode}: ${result.stderr?.toString() ?? ""}`,
    );
  return result.stdout.toString();
}

try {
  await mkdir(webDir, { recursive: true });
  run("bun", ["run", "build"]);
  await cp(join(root, "Vyline", "apps", "desktop", "dist"), webDir, { recursive: true });
  await cp(join(root, "openapi.yaml"), join(packageDir, "openapi.yaml"));
  await cp(join(root, "logo", "assets", "color", "128.png"), join(packageDir, "icon.png"));

  const fallbackProfile = join(
    root,
    "Vyline",
    "packages",
    "protocol",
    "data",
    "desktop-profile.fallback.json",
  );
  if (!existsSync(fallbackProfile))
    throw new Error(`Required protocol data is missing: ${fallbackProfile}`);
  await mkdir(join(packageDir, "data"), { recursive: true });
  await cp(fallbackProfile, join(packageDir, "data", "desktop-profile.fallback.json"));
  const packagedFallback = join(packageDir, "data", "desktop-profile.fallback.json");
  if (!existsSync(packagedFallback) || Bun.file(packagedFallback).size === 0)
    throw new Error("Linux package is missing the required desktop profile fallback file");

  const args = ["build", "--compile", "--minify", "--target=bun-linux-x64", "--outfile"];
  run("bun", [
    ...args,
    join(packageDir, "VylineBackend"),
    join(root, "Vyline", "backend", "src", "index.ts"),
  ]);
  run("bun", [...args, join(packageDir, "Vyline"), join(root, "scripts", "linux-launcher.ts")]);
  await cp(join(root, "installer", "install-linux.sh"), join(packageDir, "install.sh"));
  await chmod(join(packageDir, "install.sh"), 0o755);
  await chmod(join(packageDir, "Vyline"), 0o755);
  await chmod(join(packageDir, "VylineBackend"), 0o755);
  const archivePath = join(stagingDir, `${packageName}.tar.gz`);
  run("tar", ["-czf", archivePath, "-C", stagingDir, packageName]);
  const archiveEntries = capture("tar", ["-tzf", archivePath]).split(/\r?\n/);
  if (!archiveEntries.includes(`${packageName}/data/desktop-profile.fallback.json`))
    throw new Error("Linux release archive is missing data/desktop-profile.fallback.json");

  await rm(previousDir, { recursive: true, force: true });
  if (existsSync(releaseDir)) {
    await rename(releaseDir, previousDir);
    previousMoved = true;
  }
  try {
    await rename(stagingDir, releaseDir);
  } catch (error) {
    if (previousMoved && !existsSync(releaseDir)) await rename(previousDir, releaseDir);
    previousMoved = false;
    throw error;
  }
} catch (error) {
  await rm(stagingDir, { recursive: true, force: true });
  if (previousMoved && !existsSync(releaseDir) && existsSync(previousDir)) {
    await rename(previousDir, releaseDir);
  }
  throw error;
}

if (previousMoved) {
  await rm(previousDir, { recursive: true, force: true }).catch((error) => {
    console.warn(`New Linux package is ready; old package cleanup deferred: ${String(error)}`);
  });
}
console.log(`Linux release package created at ${releaseDir}`);
