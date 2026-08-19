#!/usr/bin/env bun
/**
 * vyline-search CLI
 *
 *   bun tools/cli.ts unpack
 *   bun tools/cli.ts find sendMessage
 *   bun tools/cli.ts find sendMessage --list-only
 *   bun tools/cli.ts focus --manifest-only
 */

export {};

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help") {
  console.log(`vyline-search — Desktop LINE native symbol tools

Usage:
  bun tools/cli.ts unpack [options]
  bun tools/cli.ts find <term> [terms...] [options]
  bun tools/cli.ts focus [options]

package.json スクリプト（推奨）:
  bun run vyline:unpack -- ...
  bun run vyline:find-native -- <term> ...
  bun run vyline:focus-recovered -- ...

Docs:
  docs/tools/unpack.md
  docs/tools/find-native-symbol.md
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
  console.error(`try: bun run vyline:unpack`);
  process.exit(1);
}
