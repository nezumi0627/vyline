#!/usr/bin/env bun

const args = process.argv.slice(2);
const result = Bun.spawnSync(["bunx", "@vyline/cli", ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(result.exitCode ?? 1);
