/**
 * reportDesktopDelta — インストール済み LINE Desktop とキャッシュ profile の差分レポート
 *
 * 使い方 (リポジトリルート):
 *   bun run vyline:delta
 *   bun Vyline/packages/protocol/src/tools/reportDesktopDelta.ts
 *
 * 出力:
 *   docs/reports/desktop-delta-YYYYMMDD.md
 *   docs/reports/desktop-delta-YYYYMMDD.json
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectInstalledDesktop, readUpdateLogOsHint } from "../desktop/version.js";
import {
  defaultLineRoot,
  lineBinDir,
  lineDataDir,
  lineIniPath,
  updateLogPath,
  versionExePath,
  UPDATE_INFO_URL,
} from "../desktop/paths.js";
import {
  defaultVylineDataDir,
  loadCachedProfile,
  loadFallbackProfile,
  profileJsonPath,
} from "../desktop/persist.js";
import {
  FEATURE_IDS,
  suggestedFeaturesOnDesktopUpdate,
  type FeatureModule,
} from "../modules.map.js";

const _here = dirname(fileURLToPath(import.meta.url));
/** E:\projects\Vyline */
const REPO_ROOT = join(_here, "../../../../../");

function yyyymmdd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function resolveDataDir(): string {
  if (process.env.VYLINE_DESKTOP_DATA_DIR) return process.env.VYLINE_DESKTOP_DATA_DIR;
  if (process.env.VYLINE_DATA_DIR) {
    return join(process.env.VYLINE_DATA_DIR, "vyline");
  }
  // backend が使う data/vyline を優先、なければパッケージ .cache
  const backendVyline = join(REPO_ROOT, "Vyline", "backend", "data", "vyline");
  if (existsSync(profileJsonPath(backendVyline))) return backendVyline;
  return defaultVylineDataDir();
}

export interface DesktopDeltaReport {
  generatedAt: string;
  platform: string;
  lineRoot: string;
  installed: {
    found: boolean;
    version: string | null;
    exePath: string | null;
    exeSha256: string | null;
    exeSize: number | null;
    iniPath: string | null;
    updateLogPath: string | null;
    osHint?: { appVersion?: string; osVersion?: string };
  };
  cached: {
    found: boolean;
    profilePath: string;
    appVersion: string | null;
    exeSha256: string | null;
    detectionMethod: string | null;
    userAgent: string | null;
    xLineApplication: string | null;
    source: "cache" | "fallback" | "none";
  };
  delta: {
    versionChanged: boolean;
    shaChanged: boolean;
    previousVersion: string | null;
    currentVersion: string | null;
    status: "updated" | "unchanged" | "no-install" | "no-cache";
  };
  localAppDataPaths: Record<string, string>;
  suggestedModules: Array<{
    id: string;
    title: string;
    priority: string;
    vylineFiles: string[];
    desktopSearchStrings: string[];
    analysisDocs: string[];
  }>;
  notes: string[];
  cdnUpdateInfoUrl: string;
}

function buildLocalPaths(lineRoot: string, version: string | null): Record<string, string> {
  const paths: Record<string, string> = {
    lineRoot,
    bin: lineBinDir(lineRoot),
    data: lineDataDir(lineRoot),
    ini: lineIniPath(lineRoot),
    updateLog: updateLogPath(lineRoot),
  };
  if (version) {
    paths.exe = versionExePath(lineRoot, version);
    paths.versionDir = join(lineBinDir(lineRoot), version);
  }
  return paths;
}

function modulesForReport(features: FeatureModule[]) {
  return features.map((f) => ({
    id: f.id,
    title: f.title,
    priority: f.priority,
    vylineFiles: f.vylineFiles,
    desktopSearchStrings: f.desktop.searchStrings,
    analysisDocs: f.analysisDocs,
  }));
}

export function buildDesktopDeltaReport(opts?: {
  lineRoot?: string;
  dataDir?: string;
  /** true のとき priority に関係なく全 feature を列挙 */
  allModules?: boolean;
}): DesktopDeltaReport {
  const lineRoot = defaultLineRoot(opts?.lineRoot);
  const dataDir = opts?.dataDir ?? resolveDataDir();
  const notes: string[] = [];

  console.info(`[vyline:delta] lineRoot=${lineRoot}`);
  console.info(`[vyline:delta] dataDir=${dataDir}`);

  const installed = detectInstalledDesktop(lineRoot);
  const cached = loadCachedProfile(dataDir);
  const fallback = loadFallbackProfile();
  const profile = cached ?? fallback;
  const profileSource: DesktopDeltaReport["cached"]["source"] = cached ? "cache" : "fallback";

  if (!cached) {
    notes.push(
      `キャッシュ profile なし (${profileJsonPath(dataDir)}) — fallback ${fallback.identity.appVersion} と比較`,
    );
  }

  let osHint: { appVersion?: string; osVersion?: string } | undefined;
  if (installed) {
    osHint = readUpdateLogOsHint(installed.updateLogPath);
    console.info(
      `[vyline:delta] installed=${installed.version} sha=${installed.exeSha256.slice(0, 12)}…`,
    );
  } else {
    notes.push("LINE Desktop インストールが検出できなかった (Windows + %LOCALAPPDATA%\\LINE 想定)");
    console.warn("[vyline:delta] LINE Desktop not found");
  }

  const prevVer = profile.identity.appVersion;
  const curVer = installed?.version ?? null;
  const versionChanged = Boolean(curVer && prevVer && curVer !== prevVer);
  const shaChanged = Boolean(
    installed && profile.source.exeSha256 && installed.exeSha256 !== profile.source.exeSha256,
  );

  let status: DesktopDeltaReport["delta"]["status"];
  if (!installed) status = "no-install";
  else if (!cached) status = "no-cache";
  else if (versionChanged || shaChanged) status = "updated";
  else status = "unchanged";

  if (versionChanged) {
    notes.push(`appVersion: ${prevVer} → ${curVer}`);
  } else if (shaChanged) {
    notes.push(`appVersion は同じ (${curVer}) だが exeSha256 が変化 — 再抽出を推奨`);
  } else if (status === "unchanged") {
    notes.push("キャッシュとインストール版は一致 (差分なし)");
  }

  // 更新あり / キャッシュ無し / SHA 変化時、または --all は全機能を候補に出す
  const suggestAll =
    opts?.allModules === true || status === "updated" || status === "no-cache" || shaChanged;
  const suggested = suggestAll
    ? suggestedFeaturesOnDesktopUpdate()
    : suggestedFeaturesOnDesktopUpdate().filter((f) => f.priority === "high");

  if (!suggestAll) {
    notes.push(
      "差分なしのため high priority モジュールのみ列挙 (全件は bun run vyline:delta -- --all)",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    lineRoot,
    installed: {
      found: Boolean(installed),
      version: installed?.version ?? null,
      exePath: installed?.exePath ?? null,
      exeSha256: installed?.exeSha256 ?? null,
      exeSize: installed?.exeSize ?? null,
      iniPath: installed?.iniPath ?? null,
      updateLogPath: installed?.updateLogPath ?? null,
      ...(osHint !== undefined ? { osHint } : {}),
    },
    cached: {
      found: Boolean(cached),
      profilePath: profileJsonPath(dataDir),
      appVersion: profile.identity.appVersion,
      exeSha256: profile.source.exeSha256 || null,
      detectionMethod: profile.source.detectionMethod,
      userAgent: profile.identity.userAgent,
      xLineApplication: profile.identity.xLineApplication,
      source: cached ? "cache" : profileSource,
    },
    delta: {
      versionChanged,
      shaChanged,
      previousVersion: prevVer,
      currentVersion: curVer,
      status,
    },
    localAppDataPaths: buildLocalPaths(lineRoot, curVer),
    suggestedModules: modulesForReport(suggested),
    notes,
    cdnUpdateInfoUrl: UPDATE_INFO_URL,
  };
}

function renderMarkdown(report: DesktopDeltaReport): string {
  const lines: string[] = [];
  lines.push("# Desktop Delta Report");
  lines.push("");
  lines.push(`生成: ${report.generatedAt}`);
  lines.push(`status: **${report.delta.status}**`);
  lines.push("");
  lines.push("## バージョン");
  lines.push("");
  lines.push("| | 値 |");
  lines.push("|---|---|");
  lines.push(`| キャッシュ (or fallback) | \`${report.delta.previousVersion ?? "-"}\` |`);
  lines.push(`| インストール | \`${report.delta.currentVersion ?? "-"}\` |`);
  lines.push(`| versionChanged | ${report.delta.versionChanged} |`);
  lines.push(`| shaChanged | ${report.delta.shaChanged} |`);
  lines.push(`| profile source | ${report.cached.source} |`);
  lines.push(`| detectionMethod | ${report.cached.detectionMethod ?? "-"} |`);
  lines.push("");

  if (report.cached.userAgent) {
    lines.push("### Identity (cached/fallback)");
    lines.push("");
    lines.push("```");
    lines.push(`UA:  ${report.cached.userAgent}`);
    lines.push(`XLA: ${report.cached.xLineApplication}`);
    lines.push("```");
    lines.push("");
  }

  lines.push("## %LOCALAPPDATA%\\LINE パス");
  lines.push("");
  lines.push(`lineRoot: \`${report.lineRoot}\``);
  lines.push("");
  for (const [k, v] of Object.entries(report.localAppDataPaths)) {
    lines.push(`- **${k}**: \`${v}\``);
  }
  lines.push("");

  if (report.installed.exeSha256) {
    lines.push(`exeSha256 (installed): \`${report.installed.exeSha256}\``);
    lines.push("");
  }

  lines.push("## 再確認すべきモジュール (modules.map)");
  lines.push("");
  lines.push(`全 feature id: ${FEATURE_IDS.join(", ")}`);
  lines.push("");
  for (const m of report.suggestedModules) {
    lines.push(`### ${m.id} — ${m.title} (\`${m.priority}\`)`);
    lines.push("");
    lines.push("**Vyline files**");
    for (const f of m.vylineFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
    lines.push("**Desktop search strings**");
    lines.push("");
    lines.push("```");
    lines.push(m.desktopSearchStrings.join("\n"));
    lines.push("```");
    lines.push("");
    if (m.analysisDocs.length) {
      lines.push("**Analysis docs**");
      for (const d of m.analysisDocs) {
        // docs/reports/ → docs/... は ../ 相対
        const rel = d.startsWith("docs/") ? `../${d.slice("docs/".length)}` : d;
        lines.push(`- [${d}](${rel})`);
      }
      lines.push("");
    }
  }

  lines.push("## Notes");
  lines.push("");
  for (const n of report.notes) {
    lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push("## 次のアクション");
  lines.push("");
  lines.push("1. 上記モジュールを優先度順に確認する");
  lines.push("2. LINE.exe から searchStrings を strings / メモリダンプで探す");
  lines.push("3. 差分があれば `docs/analysis/<feature>.md` にメモし、対応ソースを直す");
  lines.push("4. 必要なら VylineUpdater.refresh() または `POST /debug/vyline/refresh`");
  lines.push(`5. CDN: ${report.cdnUpdateInfoUrl}`);
  lines.push("");
  lines.push("詳細: [docs/tools/desktop-delta.md](../tools/desktop-delta.md)");
  lines.push("");
  return lines.join("\n");
}

function writeReports(report: DesktopDeltaReport): { md: string; json: string } {
  const stamp = yyyymmdd();
  const reportsDir = join(REPO_ROOT, "docs", "reports");
  mkdirSync(reportsDir, { recursive: true });

  const mdPath = join(reportsDir, `desktop-delta-${stamp}.md`);
  const jsonPath = join(reportsDir, `desktop-delta-${stamp}.json`);

  writeFileSync(mdPath, renderMarkdown(report), "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // data/ にも JSON コピー (gitignore されやすい)
  const dataOut = join(resolveDataDir(), `desktop-delta-${stamp}.json`);
  mkdirSync(dirname(dataOut), { recursive: true });
  writeFileSync(dataOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return { md: mdPath, json: jsonPath };
}

async function main(): Promise<void> {
  const allModules = process.argv.includes("--all");
  console.info("[vyline:delta] building Desktop delta report…");
  if (allModules) console.info("[vyline:delta] --all: listing every feature module");
  const report = buildDesktopDeltaReport({ allModules });
  const out = writeReports(report);
  console.info(`[vyline:delta] status=${report.delta.status}`);
  console.info(
    `[vyline:delta] ${report.delta.previousVersion ?? "?"} → ${report.delta.currentVersion ?? "?"}`,
  );
  console.info(`[vyline:delta] wrote ${out.md}`);
  console.info(`[vyline:delta] wrote ${out.json}`);
  console.info(
    `[vyline:delta] suggested modules: ${report.suggestedModules.map((m) => m.id).join(", ")}`,
  );
}

if (import.meta.main) {
  await main();
}
