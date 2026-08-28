#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const repoUrl = "https://github.com/nezumi0627/vyline";
const branchArchiveUrl = "https://github.com/nezumi0627/vyline/archive/refs/heads/main.tar.gz";
const commands = new Set([
  "help",
  "init",
  "doctor",
  "fix",
  "dev",
  "start",
  "install",
  "snapshot",
  "plugin",
]);

type Check = {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
};

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  if (!commands.has(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "init") {
    await init();
    return;
  }

  if (command === "doctor") {
    await doctor({ verbose: true });
    return;
  }

  if (command === "fix") {
    await fix(args);
    return;
  }

  if (command === "dev") {
    await runRepoScript("dev");
    return;
  }

  if (command === "start") {
    await runRepoScript("server");
    return;
  }

  if (command === "install") {
    await install(args);
    return;
  }

  if (command === "snapshot") {
    await snapshot(args);
    return;
  }

  if (command === "plugin") {
    await plugin(args);
  }
}

function printHelp() {
  console.log(`Vyline CLI (vyl)

Usage:
  vyl init                         Interactive setup
  vyl install                      Install without a full manual clone
  vyl doctor                       Check local Vyline health
  vyl fix [--build]                Repair common setup issues
  vyl dev                          Start backend + frontend
  vyl start                        Start backend server
  vyl plugin create <name>          Create a plugin template
  vyl snapshot create [name]        Create a snapshot archive
  vyl snapshot list                 List snapshots
  vyl snapshot restore <archive>    Restore a snapshot
  vyl snapshot schedule daily       Save or register periodic snapshots
`);
}

async function init() {
  console.log("Vyline interactive setup\n");
  const choice = await select("What do you want to do?", [
    "Start development server",
    "Run doctor",
    "Repair setup",
    "Create plugin",
    "Create snapshot",
    "Install from archive",
  ]);

  if (choice === "Start development server") {
    await runRepoScript("dev");
  } else if (choice === "Run doctor") {
    await doctor({ verbose: true });
  } else if (choice === "Repair setup") {
    await fix([]);
  } else if (choice === "Create plugin") {
    const name = await prompt("Plugin name", "my-vyline-plugin");
    await plugin(["create", name]);
  } else if (choice === "Create snapshot") {
    const name = await prompt("Snapshot name", "manual");
    await snapshot(["create", name]);
  } else {
    await install([]);
  }
}

async function doctor(options: { verbose: boolean }) {
  const root = await findRepoRoot();
  const checks: Check[] = [];
  const bunVersion = run("bun", ["--version"]);
  const gitVersion = run("git", ["--version"]);

  checks.push({
    name: "Bun",
    ok: bunVersion.ok,
    detail: bunVersion.ok ? bunVersion.stdout.trim() : "not found",
    fix: "Install Bun 1.4.0 or newer.",
  });
  checks.push({
    name: "Git",
    ok: gitVersion.ok,
    detail: gitVersion.ok ? gitVersion.stdout.trim() : "not found",
    fix: "Install Git or use vyl install for archive-based setup.",
  });
  checks.push({
    name: "Repository root",
    ok: root !== null,
    detail: root ?? "not inside Vyline repository",
    fix: "Run vyl install or cd into a Vyline checkout.",
  });

  if (root) {
    checks.push(await existsCheck("Backend", join(root, "Vyline/backend/src/index.ts"), "Run git submodule update --init --recursive."));
    checks.push(await existsCheck("Desktop app", join(root, "Vyline/apps/desktop/package.json"), "Restore the apps/desktop workspace."));
    checks.push(await existsCheck("Protocol package", join(root, "Vyline/packages/protocol/package.json"), "Run git submodule update --init --recursive."));
    checks.push(await existsCheck("Root node_modules", join(root, "node_modules"), "Run bun install."));
    checks.push(await existsCheck("Environment file", join(root, ".env"), "Copy .env.example to .env, then edit secrets."));
    checks.push(await writableCheck("Data directory", join(root, "data")));
    checks.push(await writableCheck("Storage directory", join(root, "storage")));
  }

  const failed = checks.filter((check) => !check.ok);

  if (options.verbose) {
    console.log("Vyline Doctor\n");
    for (const check of checks) {
      console.log(`${check.ok ? "✅" : "❌"} ${check.name}: ${check.detail}`);
      if (!check.ok && check.fix) {
        console.log(`   fix: ${check.fix}`);
      }
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }

  return { checks, failed };
}

async function fix(args: string[]) {
  const root = await findRepoRoot();
  if (!root) {
    console.error("Cannot repair: this is not a Vyline repository. Try `vyl install` first.");
    process.exit(1);
  }

  console.log("Repairing Vyline setup...");
  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(join(root, "storage"), { recursive: true });

  const envPath = join(root, ".env");
  const envExamplePath = join(root, ".env.example");
  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    await cp(envExamplePath, envPath);
    console.log("Created .env from .env.example");
  }

  if (existsSync(join(root, ".git"))) {
    runChecked("git", ["submodule", "update", "--init", "--recursive"], root);
  }

  runChecked("bun", ["install"], root);

  if (args.includes("--build")) {
    runChecked("bun", ["run", "build"], root);
  }

  await doctor({ verbose: true });
}

async function runRepoScript(script: string) {
  const root = await findRepoRoot();
  if (!root) {
    console.error("Not inside a Vyline repository. Use `vyl install` or `vyl init` first.");
    process.exit(1);
  }
  runChecked("bun", ["run", script], root, true);
}

async function install(args: string[]) {
  const target = resolve(args[0] ?? (await prompt("Install directory", join(homedir(), "Vyline"))));
  const mode = await select("Install mode", ["Release/archive first", "Developer shallow clone"]);

  await mkdir(dirname(target), { recursive: true });

  if (mode === "Developer shallow clone") {
    runChecked("git", ["clone", "--depth", "1", "--recurse-submodules", "--shallow-submodules", repoUrl, target], process.cwd(), true);
  } else {
    const tempFile = join(tmpdir(), `vyline-${randomUUID()}.tar.gz`);
    console.log("Downloading Vyline archive...");
    await download(branchArchiveUrl, tempFile);
    await mkdir(target, { recursive: true });
    runChecked("tar", ["-xzf", tempFile, "--strip-components", "1", "-C", target], process.cwd());
    await rm(tempFile, { force: true });
    console.log("Archive install completed. Some source submodules are not included in archive mode.");
  }

  console.log(`Installed to ${target}`);
  console.log(`Next: cd "${target}" && bun install && bun run vyl doctor`);
}

async function snapshot(args: string[]) {
  const action = args[0] ?? "help";
  const root = (await findRepoRoot()) ?? process.cwd();
  const snapshotDir = option(args, "--snapshots") ?? join(root, "snapshots");
  const dataDir = option(args, "--data-dir") ?? process.env.VYLINE_DATA_DIR ?? join(root, "data");

  if (action === "help") {
    console.log(`Snapshot commands:
  vyl snapshot create [name]
  vyl snapshot list
  vyl snapshot restore <archive> [--force]
  vyl snapshot schedule hourly|daily|weekly
`);
    return;
  }

  if (action === "create") {
    await createSnapshot({ dataDir, snapshotDir, name: args[1] });
    return;
  }

  if (action === "list") {
    await listSnapshots(snapshotDir);
    return;
  }

  if (action === "restore") {
    const archive = args[1];
    if (!archive) {
      throw new Error("snapshot restore requires an archive path");
    }
    await restoreSnapshot({ archive: resolve(archive), dataDir, force: args.includes("--force") });
    return;
  }

  if (action === "schedule") {
    await scheduleSnapshot({ interval: args[1] ?? "daily", root, dataDir, snapshotDir });
    return;
  }

  throw new Error(`Unknown snapshot action: ${action}`);
}

async function createSnapshot(options: { dataDir: string; snapshotDir: string; name?: string }) {
  if (!existsSync(options.dataDir)) {
    await mkdir(options.dataDir, { recursive: true });
  }
  await mkdir(options.snapshotDir, { recursive: true });

  const safeName = sanitize(options.name ?? "manual");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archive = join(options.snapshotDir, `vyline-snapshot-${timestamp}-${safeName}.tar.gz`);
  const stage = join(tmpdir(), `vyline-snapshot-${randomUUID()}`);
  await mkdir(join(stage, "payload"), { recursive: true });
  await cp(options.dataDir, join(stage, "payload"), { recursive: true, force: true });
  await writeFile(
    join(stage, "manifest.json"),
    JSON.stringify(
      {
        id: randomUUID(),
        name: safeName,
        createdAt: new Date().toISOString(),
        source: resolve(options.dataDir),
        format: "vyline.snapshot.v1",
      },
      null,
      2,
    ),
  );
  runChecked("tar", ["-czf", archive, "-C", stage, "."], process.cwd());
  await rm(stage, { recursive: true, force: true });

  const hash = await sha256(archive);
  console.log(`Created snapshot: ${archive}`);
  console.log(`sha256: ${hash}`);
}

async function listSnapshots(snapshotDir: string) {
  if (!existsSync(snapshotDir)) {
    console.log("No snapshots yet.");
    return;
  }
  const entries = (await readdir(snapshotDir)).filter((name) => name.endsWith(".tar.gz"));
  if (entries.length === 0) {
    console.log("No snapshots yet.");
    return;
  }
  for (const entry of entries.sort().reverse()) {
    const info = await stat(join(snapshotDir, entry));
    console.log(`${entry}  ${(info.size / 1024 / 1024).toFixed(2)} MB`);
  }
}

async function restoreSnapshot(options: { archive: string; dataDir: string; force: boolean }) {
  if (!existsSync(options.archive)) {
    throw new Error(`Snapshot not found: ${options.archive}`);
  }

  const stage = join(tmpdir(), `vyline-restore-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  runChecked("tar", ["-xzf", options.archive, "-C", stage], process.cwd());

  const payload = join(stage, "payload");
  if (!existsSync(payload)) {
    throw new Error("Invalid snapshot: payload directory is missing");
  }

  if (existsSync(options.dataDir)) {
    if (!options.force) {
      throw new Error("Data directory already exists. Re-run with --force to replace it safely.");
    }
    const backupPath = `${options.dataDir}.before-restore-${Date.now()}`;
    await rename(options.dataDir, backupPath);
    console.log(`Moved current data to ${backupPath}`);
  }

  await mkdir(dirname(options.dataDir), { recursive: true });
  await cp(payload, options.dataDir, { recursive: true });
  await rm(stage, { recursive: true, force: true });
  console.log(`Restored snapshot to ${options.dataDir}`);
}

async function scheduleSnapshot(options: { interval: string; root: string; dataDir: string; snapshotDir: string }) {
  const allowed = new Set(["hourly", "daily", "weekly"]);
  if (!allowed.has(options.interval)) {
    throw new Error("Use one of: hourly, daily, weekly");
  }

  const configDir = join(options.root, ".vyline");
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "snapshot-schedule.json");
  const command = `bun ${resolve(process.argv[1])} snapshot create auto --data-dir ${quote(options.dataDir)} --snapshots ${quote(options.snapshotDir)}`;
  await writeFile(
    configPath,
    JSON.stringify({ interval: options.interval, command, updatedAt: new Date().toISOString() }, null, 2),
  );

  if (platform() === "win32") {
    const scheduleMap: Record<string, string[]> = {
      hourly: ["/SC", "HOURLY"],
      daily: ["/SC", "DAILY", "/ST", "03:00"],
      weekly: ["/SC", "WEEKLY", "/D", "SUN", "/ST", "03:00"],
    };
    const result = run("schtasks", ["/Create", "/F", "/TN", "VylineSnapshot", "/TR", command, ...scheduleMap[options.interval]]);
    if (result.ok) {
      console.log("Registered Windows scheduled task: VylineSnapshot");
    } else {
      console.log("Saved schedule config, but Windows task registration failed.");
      console.log(result.stderr.trim());
    }
  } else {
    console.log("Saved schedule config. Add this command to cron/systemd timer:");
    console.log(command);
  }

  console.log(`Schedule saved to ${configPath}`);
}

async function plugin(args: string[]) {
  const action = args[0] ?? "help";
  if (action !== "create") {
    console.log("Usage: vyl plugin create <name>");
    return;
  }
  const name = args[1] ?? (await prompt("Plugin name", "my-vyline-plugin"));
  const root = await findRepoRoot();
  const target = resolve(root ?? process.cwd(), "plugins", sanitize(name));
  runChecked("bun", ["Vyline/packages/create-plugin/src/index.ts", target], root ?? process.cwd(), true);
}

async function findRepoRoot() {
  let current = process.cwd();
  while (true) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(await readFile(packagePath, "utf8"));
        if (pkg.name === "vyline" && existsSync(join(current, "Vyline"))) {
          return current;
        }
      } catch {
        // keep walking
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function existsCheck(name: string, filePath: string, fixText: string): Promise<Check> {
  return {
    name,
    ok: existsSync(filePath),
    detail: existsSync(filePath) ? filePath : "missing",
    fix: fixText,
  };
}

async function writableCheck(name: string, dirPath: string): Promise<Check> {
  try {
    await mkdir(dirPath, { recursive: true });
    const probe = join(dirPath, `.probe-${randomUUID()}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return { name, ok: true, detail: dirPath };
  } catch (error) {
    return { name, ok: false, detail: String(error), fix: `Check permissions for ${dirPath}.` };
  }
}

function run(command: string, args: string[], cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: platform() === "win32" });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

function runChecked(command: string, args: string[], cwd = process.cwd(), inherit = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: inherit ? undefined : "utf8",
    shell: platform() === "win32",
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function prompt(label: string, defaultValue: string) {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  process.stdout.write(`${label}${suffix}: `);
  const value = (await readStdinLine()).trim();
  return value || defaultValue;
}

async function select(label: string, choices: string[]) {
  console.log(label);
  choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice}`));
  const answer = await prompt("Choose", "1");
  const index = Number.parseInt(answer, 10) - 1;
  return choices[index] ?? choices[0];
}

async function readStdinLine() {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    chunks.push(value);
    if (new TextDecoder().decode(value).includes("\n")) {
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks)).replace(/\r?\n$/, "");
}

async function download(url: string, target: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  await Bun.write(target, response);
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function sanitize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "vyline";
}

function quote(value: string) {
  return platform() === "win32" ? `\"${value}\"` : `'${value.replaceAll("'", "'\\''")}'`;
}

async function sha256(filePath: string) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
