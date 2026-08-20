#!/usr/bin/env bun
/**
 * vyline-search CLI
 *
 *   bun run search -- unpack
 *   bun run search -- find sendMessage
 *   bun run search -- find sendMessage --list-only
 *   bun run search -- focus --manifest-only
 */

export {};

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help") {
  console.log(`vyline-search — Desktop LINE native symbol tools

Usage:
  bun run search -- unpack [options]
  bun run search -- find <term> [terms...] [options]
  bun run search -- focus [options]

Shortcuts:
  bun run unpack -- ...
  bun run find -- <term> ...
  bun run focus -- ...

Docs:
  docs/unpack.md
  docs/find-native-symbol.md
`);
  process.exit(cmd ? 0 : 1);
}

if (cmd === "unpack") {
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import("./unpackLine.js");
} else if (cmd === "find") {
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import("./findNativeSymbol.js");
} else if (cmd === "focus") {
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import("./focusRecoveredSource.js");
} else {
  console.error(`unknown command: ${cmd}`);
  console.error(`try: bun run search -- unpack`);
  process.exit(1);
}
