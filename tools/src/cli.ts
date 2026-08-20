#!/usr/bin/env bun
/**
 * vyline-search CLI
 *
 *   bun run search -- unpack
 *   bun run search -- find sendMessage
 *   bun run search -- find sendMessage --list-only
 *   bun run search -- focus --manifest-only
 *   bun run search -- check --json
 *   bun run search -- update --unpack
 *   bun run search -- versions
 */

export {};

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help") {
  console.log(`vyline-search — Desktop LINE native symbol tools

Usage:
  bun run search -- unpack [options]
  bun run search -- find <term> [terms...] [options]
  bun run search -- focus [options]
  bun run search -- check [options]     # インストール版 / 実行中版 / 最新版の比較
  bun run search -- latest [options]    # 最新版のみ表示
  bun run search -- update [options]    # LINE Desktop を最新版へ更新
  bun run search -- versions [options]  # インストール済みバージョン一覧

Shortcuts:
  bun run unpack -- ...
  bun run find -- <term> ...
  bun run focus -- ...
  bun run check -- ...
  bun run latest -- ...
  bun run update -- ...
  bun run versions -- ...

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
} else if (cmd === "check") {
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import("./checkVersion.js");
} else if (cmd === "latest") {
  process.env["VYLINE_SEARCH_MODE"] = "latest";
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import("./checkVersion.js");
} else if (cmd === "update") {
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import("./updateLine.js");
} else if (cmd === "versions") {
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import("./versions.js");
} else {
  console.error(`unknown command: ${cmd}`);
  console.error(`try: bun run search -- unpack`);
  process.exit(1);
}
