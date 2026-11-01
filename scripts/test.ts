#!/usr/bin/env bun

// SQLite tests use isolated temporary databases and environment variables.
// Run serially so one test file cannot change another file's process-wide DB
// configuration; production logging avoids starting pretty-transport workers.
const result = Bun.spawnSync(
  [
    process.execPath,
    "test",
    "--parallel=1",
    "--path-ignore-patterns",
    "Vyline-Desktop/**",
    ...process.argv.slice(2),
  ],
  {
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.exit(result.exitCode ?? 1);
