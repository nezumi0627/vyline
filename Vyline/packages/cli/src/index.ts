#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoUrl = "https://github.com/nezumi0627/vyline";
const archiveUrl = "https://github.com/nezumi0627/vyline/archive/refs/heads/main.tar.gz";
const commandSet = new Set([
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

type RunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number;
};

const [command = "help", ...args] = process.argv.slice(2);

if (!commandSet.has(command)) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

try {
  await dispatch(command, args);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function dispatch(commandName: string, commandArgs: string[]) {
  if (commandName === "help") {
    printHelp();
  } else if (commandName === "init") {
    await init();
  } else if (commandName === "doctor") {
    await doctor(true);
  } else if (commandName === "fix") {
    await fix(commandArgs);
  } else if (commandName === "dev") {
    await runRepoScript("dev");
  } else if (commandName === "start") {
    await runRepoScript("server");
  } else if (commandName === "install") {
    await install(commandArgs);
  } else if (commandName === "snapshot") {
    await snapshot(commandArgs);
  } else if (commandName === "plugin") {
    await plugin(commandArgs);
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
    await doctor(true);
  } else if (choice === "Repair setup") {
    await fix([]);
  } else if (choice === "Create plugin") {
    await plugin(["create", await prompt("Plugin name", "my-vyline-plugin")]);
  } else if (choice === "Create snapshot") {
    await snapshot(["create", await prompt("Snapshot name", "manual")]);
  } else {
    await install([]);
  }
}

async function doctor(verbose: boolean) {
  const root = await findRepoRoot();
  const checks: Check[] = [
    commandCheck("Bun", "bun", ["--version"], "Install Bun 1.4.0 or newer."),
    commandCheck("Git", "git", ["--version"], "Install Git or use vyl install."),
    {
      name: "Repository root",
      ok: root !== null,
      detail: root ?? "not inside Vyline repository",
      fix: "Run vyl install or cd into a Vyline checkout.",
    },
  ];

  if (root) {
    checks.push(
      existsCheck(
        "Backend",
        join(root, "Vyline/backend/src/index.ts"),
        "Run git submodule update --init --recursive.",
      ),
    );
    checks.push(
      existsCheck(
        "Desktop app",
        join(root, "Vyline/apps/desktop/package.json"),
        "Restore the apps/desktop workspace.",
      ),
    );
    checks.push(
      existsCheck(
        "Protocol package",
        join(root, "Vyline/packages/protocol/package.json"),
        "Run git submodule update --init --recursive.",
      ),
    );
    checks.push(existsCheck("Root node_modules", join(root, "node_modules"), "Run bun install."));
    checks.push(
      existsCheck(
        "Environment file",
        join(root, ".env"),
        "Copy .env.example to .env, then edit secrets.",
      ),
    );
    checks.push(await writableCheck("Data directory", join(root, "data")));
    checks.push(await writableCheck("Storage directory", join(root, "storage")));
  }

  if (verbose) {
    console.log("Vyline Doctor\n");
    for (const check of checks) {
      console.log(`${check.ok ? "✅" : "❌"} ${check.name}: ${check.detail}`);
      if (!check.ok && check.fix) {
        console.log(`   fix: ${check.fix}`);
      }
    }
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
  return { checks, failed };
}

async function fix(fixArgs: string[]) {
  const root = await requireRepoRoot();
  console.log("Repairing Vyline setup...");

  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(join(root, "storage"), { recursive: true });

  const envPath = join(root, ".env");
  const examplePath = join(root, ".env.example");
  if (!existsSync(envPath) && existsSync(examplePath)) {
    await cp(examplePath, envPath);
    console.log("Created .env from .env.example");
  }

  if (existsSync(join(root, ".git"))) {
    runChecked("git", ["submodule", "update", "--init", "--recursive"], root);
  }

  runChecked("bun", ["install"], root);
  if (fixArgs.includes("--build")) {
    runChecked("bun", ["run", "build"], root);
  }

  await doctor(true);
}

async function runRepoScript(script: string) {
  runChecked("bun", ["run", script], await requireRepoRoot(), true);
}

async function install(installArgs: string[]) {
  const target = resolve(
    installArgs[0] ?? (await prompt("Install directory", join(homedir(), "Vyline"))),
  );
  const mode = await select("Install mode", ["Release/archive first", "Developer shallow clone"]);

  await mkdir(dirname(target), { recursive: true });

  if (mode === "Developer shallow clone") {
    runChecked(
      "git",
      ["clone", "--depth", "1", "--recurse-submodules", "--shallow-submodules", repoUrl, target],
      process.cwd(),
      true,
    );
  } else {
    await installArchive(target);
  }

  console.log(`Installed to ${target}`);
  console.log(`Next: cd "${target}" && bun install && bun run vyl doctor`);
}

async function installArchive(target: string) {
  const tempFile = join(tmpdir(), `vyline-${randomUUID()}.tar.gz`);
  console.log("Downloading Vyline archive...");
  await download(archiveUrl, tempFile);
  await mkdir(target, { recursive: true });
  runChecked("tar", ["-xzf", tempFile, "--strip-components", "1", "-C", target]);
  await rm(tempFile, { force: true });
  console.log(
    "Archive install completed. Some source submodules are not included in archive mode.",
  );
}

async function snapshot(snapshotArgs: string[]) {
  const action = snapshotArgs[0] ?? "help";
  const root = (await findRepoRoot()) ?? process.cwd();
  const snapshotDir = option(snapshotArgs, "--snapshots") ?? join(root, "snapshots");
  const dataDir =
    option(snapshotArgs, "--data-dir") ?? process.env.VYLINE_DATA_DIR ?? join(root, "data");

  if (action === "help") {
    printSnapshotHelp();
  } else if (action === "create") {
    await createSnapshot(dataDir, snapshotDir, snapshotArgs[1]);
  } else if (action === "list") {
    await listSnapshots(snapshotDir);
  } else if (action === "restore") {
    await restoreSnapshot(
      resolveRequired(snapshotArgs[1], "snapshot restore requires an archive path"),
      dataDir,
      snapshotArgs.includes("--force"),
    );
  } else if (action === "schedule") {
    await scheduleSnapshot(snapshotArgs[1] ?? "daily", root, dataDir, snapshotDir);
  } else {
    throw new Error(`Unknown snapshot action: ${action}`);
  }
}

function printSnapshotHelp() {
  console.log(`Snapshot commands:
  vyl snapshot create [name]
  vyl snapshot list
  vyl snapshot restore <archive> [--force]
  vyl snapshot schedule hourly|daily|weekly
`);
}

async function createSnapshot(dataDir: string, snapshotDir: string, name = "manual") {
  await mkdir(dataDir, { recursive: true });
  await mkdir(snapshotDir, { recursive: true });

  const safeName = sanitize(name);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archive = join(snapshotDir, `vyline-snapshot-${timestamp}-${safeName}.tar.gz`);
  const stage = join(tmpdir(), `vyline-snapshot-${randomUUID()}`);

  await mkdir(join(stage, "payload"), { recursive: true });
  await cp(dataDir, join(stage, "payload"), { recursive: true, force: true });
  await writeFile(join(stage, "manifest.json"), snapshotManifest(safeName, dataDir));
  runChecked("tar", ["-czf", archive, "-C", stage, "."]);
  await rm(stage, { recursive: true, force: true });

  console.log(`Created snapshot: ${archive}`);
  console.log(`sha256: ${await sha256(archive)}`);
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

async function restoreSnapshot(archive: string, dataDir: string, force: boolean) {
  if (!existsSync(archive)) {
    throw new Error(`Snapshot not found: ${archive}`);
  }

  const stage = join(tmpdir(), `vyline-restore-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  runChecked("tar", ["-xzf", archive, "-C", stage]);

  const payload = join(stage, "payload");
  if (!existsSync(payload)) {
    throw new Error("Invalid snapshot: payload directory is missing");
  }

  if (existsSync(dataDir)) {
    if (!force) {
      throw new Error("Data directory already exists. Re-run with --force to replace it safely.");
    }
    const backupPath = `${dataDir}.before-restore-${Date.now()}`;
    await rename(dataDir, backupPath);
    console.log(`Moved current data to ${backupPath}`);
  }

  await mkdir(dirname(dataDir), { recursive: true });
  await cp(payload, dataDir, { recursive: true });
  await rm(stage, { recursive: true, force: true });
  console.log(`Restored snapshot to ${dataDir}`);
}

async function scheduleSnapshot(
  interval: string,
  root: string,
  dataDir: string,
  snapshotDir: string,
) {
  if (!["hourly", "daily", "weekly"].includes(interval)) {
    throw new Error("Use one of: hourly, daily, weekly");
  }

  const command = [
    "bun",
    resolve(process.argv[1]),
    "snapshot create auto",
    "--data-dir",
    quote(dataDir),
    "--snapshots",
    quote(snapshotDir),
  ].join(" ");
  const configDir = join(root, ".vyline");
  const configPath = join(configDir, "snapshot-schedule.json");
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, json({ interval, command, updatedAt: new Date().toISOString() }));

  if (platform() === "win32") {
    registerWindowsSnapshotTask(interval, command);
  } else {
    console.log("Saved schedule config. Add this command to cron/systemd timer:");
    console.log(command);
  }

  console.log(`Schedule saved to ${configPath}`);
}

function registerWindowsSnapshotTask(interval: string, command: string) {
  const scheduleMap: Record<string, string[]> = {
    hourly: ["/SC", "HOURLY"],
    daily: ["/SC", "DAILY", "/ST", "03:00"],
    weekly: ["/SC", "WEEKLY", "/D", "SUN", "/ST", "03:00"],
  };
  const result = run("schtasks", [
    "/Create",
    "/F",
    "/TN",
    "VylineSnapshot",
    "/TR",
    command,
    ...scheduleMap[interval],
  ]);

  if (result.ok) {
    console.log("Registered Windows scheduled task: VylineSnapshot");
  } else {
    console.log("Saved schedule config, but Windows task registration failed.");
    console.log(result.stderr.trim());
  }
}

async function plugin(pluginArgs: string[]) {
  if ((pluginArgs[0] ?? "help") !== "create") {
    console.log("Usage: vyl plugin create <name>");
    return;
  }

  const name = pluginArgs[1] ?? (await prompt("Plugin name", "my-vyline-plugin"));
  const root = await findRepoRoot();
  const target = resolve(root ?? process.cwd(), "plugins", sanitize(name));
  runChecked(
    "bun",
    ["Vyline/packages/create-plugin/src/index.ts", target],
    root ?? process.cwd(),
    true,
  );
}

async function findRepoRoot() {
  let current = process.cwd();
  while (true) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath) && (await isVylinePackage(packagePath, current))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function isVylinePackage(packagePath: string, directory: string) {
  try {
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    return pkg.name === "vyline" && existsSync(join(directory, "Vyline"));
  } catch {
    return false;
  }
}

async function requireRepoRoot() {
  const root = await findRepoRoot();
  if (!root) {
    throw new Error("Not inside a Vyline repository. Use `vyl install` first.");
  }
  return root;
}

function commandCheck(name: string, command: string, args: string[], fix: string): Check {
  const result = run(command, args);
  return {
    name,
    ok: result.ok,
    detail: result.ok ? result.stdout.trim() : "not found",
    fix,
  };
}

function existsCheck(name: string, filePath: string, fix: string): Check {
  return {
    name,
    ok: existsSync(filePath),
    detail: existsSync(filePath) ? filePath : "missing",
    fix,
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
    return {
      name,
      ok: false,
      detail: String(error),
      fix: `Check permissions for ${dirPath}.`,
    };
  }
}

function run(commandName: string, runArgs: string[], cwd = process.cwd()): RunResult {
  const result = spawnSync(commandName, runArgs, {
    cwd,
    encoding: "utf8",
    shell: platform() === "win32",
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

function runChecked(commandName: string, runArgs: string[], cwd = process.cwd(), inherit = false) {
  const result = spawnSync(commandName, runArgs, {
    cwd,
    shell: platform() === "win32",
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${commandName} ${runArgs.join(" ")} failed with exit code ${result.status}`);
  }
}

async function prompt(label: string, defaultValue: string) {
  process.stdout.write(`${label} (${defaultValue}): `);
  const value = (await readLine()).trim();
  return value || defaultValue;
}

async function select(label: string, choices: string[]) {
  console.log(label);
  choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice}`));
  const answer = await prompt("Choose", "1");
  const index = Number.parseInt(answer, 10) - 1;
  return choices[index] ?? choices[0];
}

async function readLine() {
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

function option(optionArgs: string[], name: string) {
  const index = optionArgs.indexOf(name);
  return index >= 0 ? optionArgs[index + 1] : undefined;
}

function resolveRequired(value: string | undefined, message: string) {
  if (!value) {
    throw new Error(message);
  }
  return resolve(value);
}

function snapshotManifest(name: string, dataDir: string) {
  return json({
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    source: resolve(dataDir),
    format: "vyline.snapshot.v1",
  });
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sanitize(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vyline"
  );
}

function quote(value: string) {
  if (platform() === "win32") {
    return `\"${value}\"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function sha256(filePath: string) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}
