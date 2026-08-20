/**
 * updateLine — LINE Desktop を最新版へ更新する。
 *
 * 手順:
 *   1. インストール版の検出
 *   2. update_info.json から対象版を解決
 *   3. LINE.zip / lib.zip をダウンロード
 *   4. bin/<version>/ と bin/shared/<sharedVersion>/ に展開
 *   5. LINE.ini の last_updated_version を更新
 *   6. (任意) --unpack で新 LINE.exe を Themida unpack
 *
 *   bun run update
 *   bun run update -- --unpack
 *   bun run update -- --force        # 最新でも再ダウンロード
 *   bun run update -- --dry-run      # ダウンロード/展開せず対象版のみ表示
 *   bun run update -- --prune-old    # 古いバージョンフォルダを削除
 *   bun run update -- --unpack-out <path>
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { defaultLineRoot, lineBinDir, lineIniPath } from "./paths.js";
import {
  compareVersions,
  detectInstalledDesktop,
  fetchUpdateInfo,
  lineZipUrl,
  osVersionString,
  resolveTargetVersion,
  sharedLibZipUrl,
} from "./lineVersions.js";

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
  console.log(`usage: bun run update [options]

  --force             最新版でも再ダウンロードして展開
  --dry-run           対象版の確認のみ行い、書き込みしない
  --prune-old         古いバージョンフォルダを削除（起動中のバージョンは除く）
  --unpack            更新後に新 LINE.exe を Themida unpack
  --unpack-out <path>  unpack 出力先（既定: tools/data/unpacked_LINE.exe）
  --line-root <path>   LINE ルート（既定: %LOCALAPPDATA%\\LINE / VYLINE_LINE_ROOT / NEZU_LINE_ROOT）
  --channel <name>     real | beta | rc | debug（既定: real）
`);
  process.exit(0);
}

const _here = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(_here, "..");

const force = Boolean(flags["force"]);
const dryRun = Boolean(flags["dry-run"]);
const pruneOld = Boolean(flags["prune-old"]);
const doUnpack = Boolean(flags["unpack"]);
const unpackOut =
  typeof flags["unpack-out"] === "string"
    ? (flags["unpack-out"] as string)
    : join(TOOLS_DIR, "data", "unpacked_LINE.exe");
const channel = typeof flags["channel"] === "string" ? (flags["channel"] as string) : "real";
const lineRoot = typeof flags["line-root"] === "string" ? (flags["line-root"] as string) : undefined;

function log(msg: string): void {
  console.info(`[update] ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[update] ⚠ ${msg}`);
}

function localAppData(): string {
  return process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
}

function listRunningLinePids(): number[] {
  try {
    const out = execSync(
      "powershell.exe -NoProfile -Command \"(Get-Process -Name LINE -ErrorAction SilentlyContinue).Id -join ','\"",
      { encoding: "utf8" },
    ).trim();
    if (!out) return [];
    return out
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function download(url: string, dest: string): void {
  mkdirSync(join(dest, ".."), { recursive: true });
  log(`download: ${url}`);
  log(`  -> ${dest} (${(sizeOf(url)).toFixed(1)} MB)`);
  const res = spawnSync("curl.exe", ["-sS", "-L", "--fail", "--retry", "3", "-o", dest, url], {
    stdio: "pipe",
  });
  if (res.status !== 0 || !existsSync(dest)) {
    throw new Error(
      `ダウンロード失敗: ${url}\n${res.stderr?.toString().slice(0, 500) ?? ""}`,
    );
  }
}

function sizeOf(url: string): number {
  try {
    const res = spawnSync("curl.exe", ["-sS", "-I", url], { stdio: "pipe" });
    const m = res.stdout?.toString().match(/content-length:\s*(\d+)/i);
    return m ? Number(m[1]) / 1024 / 1024 : 0;
  } catch {
    return 0;
  }
}

function extractZip(zip: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  log(`extract: ${zip} -> ${dest}`);
  // bsdtar (Windows 同梱) を優先、無ければ PowerShell Expand-Archive
  let res = spawnSync("tar.exe", ["-xf", zip, "-C", dest], { stdio: "pipe" });
  if (res.status !== 0) {
    log("tar 失敗 — PowerShell Expand-Archive にフォールバック");
    res = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zip}' -DestinationPath '${dest}' -Force`,
      ],
      { stdio: "pipe" },
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `ZIP 展開失敗:\n${res.stderr?.toString().slice(0, 800) ?? ""}`,
    );
  }
}

function updateIni(iniPath: string, version: string): void {
  if (!existsSync(iniPath)) return;
  const buf = readFileSync(iniPath);
  const utf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  let text: string;
  if (utf16) text = buf.toString("utf16le");
  else if (buf.includes(0) && buf.length > 4) text = buf.toString("utf16le");
  else text = buf.toString("utf8");

  const before = text;
  text = text.replace(
    /last_updated_version\s*=\s*\d+\.\d+\.\d+\.\d+/i,
    `last_updated_version=${version}`,
  );
  text = text.replace(
    /last_notify_updated_version\s*=\s*\d+\.\d+\.\d+\.\d+/i,
    `last_notify_updated_version=${version}`,
  );
  if (text === before) {
    text += `\nlast_updated_version=${version}\n`;
  }
  const out = utf16 ? Buffer.from(`\ufeff${text}`, "utf16le") : Buffer.from(text, "utf8");
  writeFileSync(iniPath, out);
  log(`LINE.ini 更新: last_updated_version=${version}`);
}

function pruneOldVersions(keep: string[], binDir: string): void {
  const olds = readdirSync(binDir)
    .filter((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n))
    .filter((n) => !keep.includes(n));
  for (const old of olds) {
    const p = join(binDir, old);
    log(`古いバージョン削除: ${old}`);
    rmSync(p, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const root = defaultLineRoot(lineRoot);
  const binDir = lineBinDir(root);
  const iniPath = lineIniPath(root);

  if (!existsSync(binDir)) {
    throw new Error(`LINE のインストール先が見つかりません: ${binDir}`);
  }

  const installed = detectInstalledDesktop(lineRoot);
  const os = osVersionString();
  const systemType = process.arch === "x64" ? "x64" : "x86";
  const info = await fetchUpdateInfo(
    channel === "real"
      ? "https://desktop.line-scdn.net/win/v2/real/update_info.json"
      : `https://linedt.line-objects-dev.com/win/v2/${channel}/update_info.json`,
  );

  const current = installed?.version ?? null;
  if (!current) throw new Error("インストール済み LINE のバージョンを特定できませんでした。");
  log(`installed: ${current}`);
  log(`running  : os=${os} system=${systemType}`);

  const target = resolveTargetVersion(info, current, os, systemType);
  if (!target) {
    warn("現在のバージョンに適用される更新対象エントリが見つかりません（最新の可能性）。");
    const latest = info.infos.map((e) => e.version).sort(compareVersions).at(-1);
    log(`update_info 上の最新: ${latest ?? "不明"}`);
    return;
  }

  const targetVersion = target.version;
  const sharedVersion = target.shared_version ?? info.shared.version;
  const needUpdate = compareVersions(targetVersion, current) > 0;

  log(`target : ${targetVersion} (type=${target.type}, shared=${sharedVersion})`);
  log(`url    : ${lineZipUrl(info, targetVersion)}`);

  if (!needUpdate && !force) {
    log(`✓ 既に最新です (${current})`);
    return;
  }
  if (dryRun) {
    log(`[dry-run] 更新対象: ${current} → ${targetVersion} (shared ${sharedVersion})`);
    return;
  }

  const running = listRunningLinePids();
  if (running.length > 0) {
    warn(`LINE が稼働中です (pid: ${running.join(", ")})。次回起動で新バージョンが使われます。`);
  }

  const workDir = join(process.env.TEMP ?? "C:\\Windows\\Temp", "vyline-update");
  mkdirSync(workDir, { recursive: true });
  const lineZip = join(workDir, "LINE.zip");
  const libZip = join(workDir, "lib.zip");

  const verDir = join(binDir, targetVersion);
  if (existsSync(verDir) && force) {
    rmSync(verDir, { recursive: true, force: true });
  }

  download(lineZipUrl(info, targetVersion), lineZip);
  const sharedDest = join(binDir, "shared", sharedVersion);
  if (!existsSync(join(verDir, "LINE.exe"))) {
    extractZip(lineZip, verDir);
  } else {
    log(`既に ${verDir}\\LINE.exe が存在。LINE.zip の展開をスキップ。`);
  }

  if (target.shared_version || compareVersions(sharedVersion, info.shared.version) >= 0) {
    if (!existsSync(join(sharedDest, "lib.txt"))) {
      download(sharedLibZipUrl(info, sharedVersion), libZip);
      extractZip(libZip, sharedDest);
    } else {
      log(`既に ${sharedDest} が存在。lib.zip の展開をスキップ。`);
    }
  }

  const newExe = join(verDir, "LINE.exe");
  if (!existsSync(newExe)) {
    throw new Error(`展開後も LINE.exe がありません: ${newExe}`);
  }

  updateIni(iniPath, targetVersion);

  if (pruneOld) {
    pruneOldVersions([targetVersion, "shared", "current", "old"], binDir);
  }

  log(`✓ 更新完了: ${current} → ${targetVersion} (${(statSync(newExe).size / 1024 / 1024).toFixed(1)} MB)`);
  log(`  exe: ${newExe}`);
  log(`  次: 再起動後 LINE は ${targetVersion} を使用します`);

  // ---- 任意: Themida unpack ----
  if (doUnpack) {
    mkdirSync(join(unpackOut, ".."), { recursive: true });
    log("unpack を実行します (unlicense が LINE.exe を起動します)…");
    const unpackRes = spawnSync(
      "bun",
      [join(TOOLS_DIR, "src", "unpackLine.ts"), "--exe", newExe, "--out", unpackOut],
      { stdio: "inherit" },
    );
    if (unpackRes.status !== 0) {
      throw new Error("unpack に失敗しました。--unpack-out の設定を確認してください。");
    }
    log(`unpacked -> ${unpackOut}`);
  }
}

await main().catch((err) => {
  console.error(`[update] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
