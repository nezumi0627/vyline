/**
 * checkVersion — LINE Desktop のバージョン確認。
 *
 *   インストール版 / 実行中版 / 最新版(update_info) を取得し、比較結果を表示する。
 *
 *   bun run check
 *   bun run check -- --json
 *   bun run check -- --line-root "C:\path\to\LINE"
 *   bun run check -- --channel beta        # update_info の channel を切り替え
 */

import { existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { defaultLineRoot, lineBinDir } from "./paths.js";
import {
  UPDATE_INFO_URL,
  compareVersions,
  detectInstalledDesktop,
  fetchUpdateInfo,
  listInstalledVersions,
  osVersionString,
  resolveTargetVersion,
} from "./lineVersions.js";

const CHANNELS: Record<string, string> = {
  real: "https://desktop.line-scdn.net/win/v2/real/update_info.json",
  beta: "https://linedt.line-objects-dev.com/win/v2/beta/update_info.json",
  rc: "https://linedt.line-objects-dev.com/win/v2/rc/update_info.json",
  debug: "https://linedt.line-objects-dev.com/win/v2/debug/update_info.json",
};

const rawArgs = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i]!;
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = rawArgs[i + 1];
  if (next && !next.startsWith("--")) {
    flags[key] = next;
    i++;
  } else {
    flags[key] = true;
  }
}

if (flags["help"] || flags["h"]) {
  console.log(`usage: bun run check [options]

  --line-root <path>   LINE ルート（既定: %LOCALAPPDATA%\\LINE / VYLINE_LINE_ROOT / NEZU_LINE_ROOT）
  --channel <name>     real | beta | rc | debug（既定: real）
  --version <ver>      インストール済みバージョンを明示指定して比較（例: 26.3.0.3916）
  --json               機械可読 JSON 出力
`);
  process.exit(0);
}

function runningLineVersion(): string | null {
  try {
    const out = execSync(
      'powershell.exe -NoProfile -Command "(Get-Process -Name LINE -ErrorAction SilentlyContinue | Select-Object -First 1).Path"',
      { encoding: "utf8" },
    ).trim();
    if (!out) return null;
    const m = out.match(/\\(\d+\.\d+\.\d+\.\d+)\\LINE\.exe$/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

const channel = typeof flags["channel"] === "string" ? (flags["channel"] as string) : "real";
const url = CHANNELS[channel] ?? UPDATE_INFO_URL;
const jsonOut = Boolean(flags["json"]);
const lineRoot = typeof flags["line-root"] === "string" ? (flags["line-root"] as string) : undefined;
const versionSelect =
  typeof flags["version"] === "string" ? (flags["version"] as string) : null;

// --version 指定時はインストール済みバージョンから明示選択（なければエラー）
let installed = detectInstalledDesktop(lineRoot);
if (versionSelect) {
  const sel = listInstalledVersions(lineRoot).find((v) => v.version === versionSelect);
  if (!sel) {
    const avail = listInstalledVersions(lineRoot)
      .map((v) => `  ${v.version}${v.isCurrent ? " (current)" : ""}`)
      .join("\n");
    console.error(
      [
        `指定バージョン ${versionSelect} はインストールされていません。`,
        "インストール済み:",
        avail || "  （なし）",
        "一覧: bun run vyline:versions",
      ].join("\n"),
    );
    process.exit(1);
  }
  installed = {
    version: sel.version,
    exePath: sel.exePath,
    iniPath: installed?.iniPath ?? "",
    exeSize: sel.exeSize,
    exeSha256: sel.exeSha256,
  };
}
const info = await fetchUpdateInfo(url);
const os = osVersionString();
const systemType = process.arch === "x64" ? "x64" : "x86";
const target = resolveTargetVersion(info, installed?.version ?? "0.0.0.0", os, systemType);
const latest = target?.version ?? info.infos.map((e) => e.version).sort(compareVersions).at(-1) ?? null;
const running = runningLineVersion();

const updateAvailable =
  installed !== null && latest !== null && compareVersions(latest, installed.version) > 0;

// `latest` コマンド: 最新版のバージョン文字列のみ出力
if (process.env["VYLINE_SEARCH_MODE"] === "latest") {
  if (jsonOut) {
    console.log(
      JSON.stringify({ latest, channel, checkedAt: new Date().toISOString() }, null, 2),
    );
  } else if (latest) {
    console.log(latest);
  } else {
    process.exit(1);
  }
  process.exit(0);
}

if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        channel,
        updateInfoUrl: url,
        os: { osVersion: os, systemType, arch: process.arch },
        installed: installed
          ? {
              version: installed.version,
              exePath: installed.exePath,
              exeSha256: installed.exeSha256,
            }
          : null,
        runningVersion: running,
        latest: {
          version: latest,
          targetEntry: target
            ? {
                version: target.version,
                targetRange: target.target,
                osRange: target.os,
                type: target.type,
                sharedVersion: target.shared_version ?? null,
              }
            : null,
        },
        updateAvailable,
        binVersions: existsSync(lineBinDir(defaultLineRoot(lineRoot)))
          ? readdirSync(lineBinDir(defaultLineRoot(lineRoot)))
              .filter((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n))
              .sort(compareVersions)
          : [],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`channel : ${channel}`);
console.log(`os      : ${os} (${systemType} / ${process.arch})`);
console.log("");
console.log(`installed : ${installed?.version ?? "(未検出)"}`);
if (installed) {
  console.log(`  exe   : ${installed.exePath}`);
  console.log(`  sha256: ${installed.exeSha256.slice(0, 16)}…`);
}
console.log(`running   : ${running ?? "(LINE 未起動)"}`);
console.log(`latest    : ${latest ?? "(取得不可)"}`);
if (target) {
  console.log(
    `  target: ${target.target} / os ${target.os} / type ${target.type}` +
      (target.shared_version ? ` / shared ${target.shared_version}` : ""),
  );
}
console.log("");
if (installed === null) {
  console.log("※ LINE Desktop が検出されませんでした。");
} else if (!updateAvailable) {
  console.log(`✓ 最新です (${installed.version})`);
} else {
  console.log(`↑ 更新あり: ${installed.version} → ${latest}`);
}
