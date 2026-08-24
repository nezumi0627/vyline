#!/usr/bin/env bun
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const releaseDir = join(root, "dist", "windows"), packageDir = join(releaseDir, "Vyline"), webDir = join(packageDir, "web");
function run(command: string, args: string[]) { const r = Bun.spawnSync([command, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" }); if (r.exitCode !== 0) throw new Error(`${command} failed`); }
function findIscc() { for (const p of ["C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe", "C:\\Program Files\\Inno Setup 6\\ISCC.exe", "iscc"]) if (p === "iscc" || existsSync(p)) return p; throw new Error("Inno Setup (ISCC.exe) is not installed"); }
await rm(releaseDir, { recursive: true, force: true }); await mkdir(webDir, { recursive: true });
run("bun", ["run", "build"]); await cp(join(root, "Vyline", "apps", "desktop", "dist"), webDir, { recursive: true }); await cp(join(root, "openapi.yaml"), join(packageDir, "openapi.yaml"));
const args = ["build", "--compile", "--minify", "--target=bun-windows-x64", `--windows-version=${version.match(/^\d+\.\d+\.\d+/)?.[0] ?? "0.0.0"}.0`, "--windows-hide-console", "--outfile"];
run("bun", [...args, join(packageDir, "VylineBackend.exe"), join(root, "Vyline", "backend", "src", "index.ts")]); run("bun", [...args, join(packageDir, "Vyline.exe"), join(root, "scripts", "windows-launcher.ts")]);
run(findIscc(), [`/DAppVersion=${version}`, `/DSourceDir=${packageDir}`, `/DOutputDir=${releaseDir}`, join(root, "installer", "Vyline.iss")]);
