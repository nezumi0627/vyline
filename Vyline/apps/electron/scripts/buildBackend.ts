#!/usr/bin/env bun
/**
 * buildBackend.ts — `bun build --compile` で Vyline backend をスタンドアロン実行ファイル化する。
 *
 * 目的: パッケージ済み Electron アプリの利用者に bun ランタイムのインストールを要求しないため、
 * バックエンド（Hono/Bun）を各 OS/arch 向けの単一実行ファイルにコンパイルし、
 * `resources/backend-bin/` に配置して electron-builder の extraResources で同梱する。
 *
 * 使い方:
 *   bun run scripts/buildBackend.ts            # ホスト OS/arch のみ（開発反復用）
 *   bun run scripts/buildBackend.ts --all       # mac(arm64/x64) + linux(x64) + win(x64)
 *   bun run scripts/buildBackend.ts --mac-only  # mac universal 用に arm64+x64 の2本
 */
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const electronAppRoot = join(__dirname, "..");
const backendDir = join(electronAppRoot, "..", "..", "backend");
const backendEntry = join(backendDir, "src", "index.ts");
const outDir = join(electronAppRoot, "resources", "backend-bin");

interface Target {
  bunTarget: string;
  platform: "darwin" | "linux" | "win32";
  arch: "arm64" | "x64";
}

const ALL_TARGETS: Target[] = [
  { bunTarget: "bun-darwin-arm64", platform: "darwin", arch: "arm64" },
  { bunTarget: "bun-darwin-x64", platform: "darwin", arch: "x64" },
  { bunTarget: "bun-linux-x64", platform: "linux", arch: "x64" },
  { bunTarget: "bun-windows-x64", platform: "win32", arch: "x64" },
];

function hostTarget(): Target {
  const platform = process.platform as Target["platform"];
  const arch = process.arch as Target["arch"];
  const found = ALL_TARGETS.find((t) => t.platform === platform && t.arch === arch);
  if (!found) throw new Error(`unsupported host platform/arch: ${platform}/${arch}`);
  return found;
}

function outFile(target: Target): string {
  const ext = target.platform === "win32" ? ".exe" : "";
  return join(outDir, `vyline-backend-${target.platform}-${target.arch}${ext}`);
}

async function compile(target: Target): Promise<void> {
  const dest = outFile(target);
  process.stdout.write(`[buildBackend] compiling ${target.bunTarget} -> ${dest}\n`);
  // node:child_process 経由（sandbox 環境では Bun.spawn の posix_spawn が ENOENT になることがあるため
  // Node 互換レイヤーの spawn を使う）
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "build",
        "--compile",
        "--minify",
        `--target=${target.bunTarget}`,
        backendEntry,
        "--outfile",
        dest,
      ],
      {
        cwd: backendDir,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    throw new Error(`bun build --compile failed for ${target.bunTarget} (exit ${code})`);
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const args = process.argv.slice(2);
  let targets: Target[];
  if (args.includes("--all")) {
    targets = ALL_TARGETS;
  } else if (args.includes("--mac-only")) {
    targets = ALL_TARGETS.filter((t) => t.platform === "darwin");
  } else {
    targets = [hostTarget()];
  }
  for (const t of targets) {
    await compile(t);
  }
  process.stdout.write(`[buildBackend] done: ${targets.length} target(s) -> ${outDir}\n`);
}

await main();
