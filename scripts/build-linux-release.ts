#!/usr/bin/env bun
import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, ".."), { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const releaseDir = join(root, "dist", "linux"), packageDir = join(releaseDir, `Vyline-linux-x64-${version}`), webDir = join(packageDir, "web");
function run(command: string, args: string[]) { const r = Bun.spawnSync([command, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" }); if (r.exitCode !== 0) throw new Error(`${command} failed`); }
await rm(releaseDir, { recursive: true, force: true }); await mkdir(webDir, { recursive: true }); run("bun", ["run", "build"]);
await cp(join(root, "Vyline", "apps", "desktop", "dist"), webDir, { recursive: true }); await cp(join(root, "openapi.yaml"), join(packageDir, "openapi.yaml"));
const args = ["build", "--compile", "--minify", "--target=bun-linux-x64", "--outfile"];
run("bun", [...args, join(packageDir, "VylineBackend"), join(root, "Vyline", "backend", "src", "index.ts")]); run("bun", [...args, join(packageDir, "Vyline"), join(root, "scripts", "linux-launcher.ts")]);
await cp(join(root, "installer", "install-linux.sh"), join(packageDir, "install.sh")); await chmod(join(packageDir, "install.sh"), 0o755); await chmod(join(packageDir, "Vyline"), 0o755); await chmod(join(packageDir, "VylineBackend"), 0o755);
run("tar", ["-czf", join(releaseDir, `Vyline-linux-x64-${version}.tar.gz`), "-C", releaseDir, `Vyline-linux-x64-${version}`]);
