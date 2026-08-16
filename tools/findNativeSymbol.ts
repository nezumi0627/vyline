/**
 * findNativeSymbol — Desktop LINE (unpacked_LINE.exe) から
 * 指定した word / 関数名を「文字列一覧化 → 参照命令の特定 → 該当関数の逆コンパイル」まで
 * 1コマンドで自動実行する。
 *
 * 使い方 (Vyline-Search 直下):
 *   bun run find -- sendMessage
 *   bun run find -- sendMessage unsendMessage markAsRead
 *   bun run find -- sendMessage --list-only
 *   bun run find -- sendMessage --max-functions 5 --timeout 15
 *   bun run find -- sendMessage --include-all
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import {
  DATA_DIR,
  GHIDRA_PROJECTS_DIR,
  GHIDRA_SCRIPTS_DIR,
  OUT_DIR,
  RE_TOOLS_DIR,
  REPO_ROOT,
  defaultUnpackedExe,
  ensureDataLayout,
} from "./paths.js";

ensureDataLayout();

const NATIVE_SEARCH_DIR = join(OUT_DIR, "native-search");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const rawArgs = process.argv.slice(2);
const terms: string[] = [];
const flags: Record<string, string | boolean> = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i]!;
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = rawArgs[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  } else {
    terms.push(a);
  }
}

if (terms.length === 0) {
  console.error("usage: bun run find -- <word|funcName> [more...] [--options]");
  console.error("  --exe <path>            unpacked exe (default: data/unpacked_LINE.exe or VYLINE_SEARCH_EXE)");
  console.error("  --max-strings <n>       1 term あたりの文字列一覧の上限表示数 (既定: 全件, JSON には常に全件)");
  console.error("  --max-functions <n>     decompile する関数数の上限 (既定: 20)");
  console.error("  --timeout <sec>         関数1つあたりの decompile timeout (既定: 20)");
  console.error("  --max-addresses <n>     この命令数を超える関数は decompile をスキップ (既定: 8000)");
  console.error("  --back-scan <n>         関数開始点推定のための逆走査バイト数 (既定: 8192)");
  console.error("  --list-only             文字列一覧 + xref 特定のみ (decompile しない)");
  console.error("  --include-all           候補を絞らず全 xref を decompile 対象にする");
  console.error("  --no-utf16              UTF-16LE 文字列探索をスキップ (ASCII のみ)");
  console.error("  --skip-setup            Ghidra/JDK の自動セットアップ確認をスキップ");
  process.exit(1);
}

const maxStringsShown = flags["max-strings"] ? Number(flags["max-strings"]) : Number.POSITIVE_INFINITY;
const maxFunctions = flags["include-all"] ? Number.POSITIVE_INFINITY : Number(flags["max-functions"] ?? 20);
const decompileTimeout = Number(flags["timeout"] ?? 20);
const maxAddresses = Number(flags["max-addresses"] ?? 8000);
const backScanBytes = Number(flags["back-scan"] ?? 8192);
const listOnly = Boolean(flags["list-only"]);
const includeUtf16 = !flags["no-utf16"];
const skipSetup = Boolean(flags["skip-setup"]);
const exeOverride = typeof flags["exe"] === "string" ? (flags["exe"] as string) : null;

function slugify(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

const runSlug = terms.map(slugify).join("+");
const outDir = join(NATIVE_SEARCH_DIR, runSlug);
const functionsDir = join(outDir, "functions");

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

function log(msg: string): void {
  console.info(`[findNativeSymbol] ${msg}`);
}

// ---------------------------------------------------------------------------
// 外部ツール自動セットアップ (best-effort)
// ---------------------------------------------------------------------------

function runCmd(cmd: string[], opts?: { env?: Record<string, string> }): { ok: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd,
    cwd: REPO_ROOT,
    env: { ...process.env, ...(opts?.env ?? {}) } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout?.toString() ?? "",
    stderr: proc.stderr?.toString() ?? "",
  };
}

function findGhidraHeadless(ghidraRoot: string): string | null {
  if (!existsSync(ghidraRoot)) return null;
  for (const entry of readdirSync(ghidraRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(ghidraRoot, entry.name, "support", "analyzeHeadless.bat");
    if (existsSync(candidate)) return candidate;
    // ghidra_X.Y_PUBLIC は 1階層ネストしていることがある
    const nested = join(ghidraRoot, entry.name);
    if (existsSync(nested)) {
      for (const inner of readdirSync(nested, { withFileTypes: true })) {
        if (!inner.isDirectory()) continue;
        const c2 = join(nested, inner.name, "support", "analyzeHeadless.bat");
        if (existsSync(c2)) return c2;
      }
    }
  }
  return null;
}

async function ensureGhidra(): Promise<string> {
  const ghidraRoot = join(RE_TOOLS_DIR, "ghidra");
  ensureDir(ghidraRoot);

  let headless = findGhidraHeadless(ghidraRoot);
  if (headless) {
    log(`Ghidra 検出済み: ${headless}`);
    return headless;
  }

  // ローカルに zip があれば展開
  const zips = existsSync(ghidraRoot)
    ? readdirSync(ghidraRoot).filter((f) => f.toLowerCase().endsWith(".zip"))
    : [];
  if (zips.length > 0) {
    const zipPath = join(ghidraRoot, zips[0]!);
    log(`Ghidra zip を展開中: ${zipPath}`);
    const res = runCmd([
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${ghidraRoot}' -Force`,
    ]);
    if (!res.ok) {
      log(`zip 展開に失敗: ${res.stderr.slice(0, 500)}`);
    }
    headless = findGhidraHeadless(ghidraRoot);
    if (headless) return headless;
  }

  // GitHub releases から自動ダウンロード (best-effort)
  log("Ghidra が見つからないため GitHub releases から自動ダウンロードを試みます...");
  try {
    const releaseRes = await fetch("https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/latest", {
      headers: { "User-Agent": "vyline-search" },
    });
    if (!releaseRes.ok) throw new Error(`GitHub API ${releaseRes.status}`);
    const release = (await releaseRes.json()) as { assets: Array<{ name: string; browser_download_url: string }> };
    const asset = release.assets.find((a) => a.name.toLowerCase().endsWith(".zip") && a.name.includes("PUBLIC"));
    if (!asset) throw new Error("PUBLIC zip asset が見つからない");
    const dest = join(ghidraRoot, asset.name);
    log(`ダウンロード中: ${asset.name} (数百MBあるため時間がかかります)`);
    const fileRes = await fetch(asset.browser_download_url);
    if (!fileRes.ok || !fileRes.body) throw new Error(`download failed ${fileRes.status}`);
    await Bun.write(dest, fileRes);
    log(`展開中: ${dest}`);
    const res = runCmd([
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${dest}' -DestinationPath '${ghidraRoot}' -Force`,
    ]);
    if (!res.ok) throw new Error(res.stderr.slice(0, 500));
    headless = findGhidraHeadless(ghidraRoot);
    if (headless) return headless;
    throw new Error("展開後も analyzeHeadless.bat が見つからない");
  } catch (err) {
    throw new Error(
      `Ghidra の自動セットアップに失敗しました: ${err instanceof Error ? err.message : String(err)}\n` +
        `手動で https://github.com/NationalSecurityAgency/ghidra/releases から zip を取得し、\n` +
        `${ghidraRoot} に展開してください。`,
    );
  }
}

function findJdk21Home(): string | null {
  if (process.env["JAVA_HOME"] && existsSync(join(process.env["JAVA_HOME"], "bin", "java.exe"))) {
    const check = runCmd([join(process.env["JAVA_HOME"], "bin", "java.exe"), "-version"]);
    if (/version "2[1-9]/.test(check.stderr) || /version "2[1-9]/.test(check.stdout)) {
      return process.env["JAVA_HOME"];
    }
  }
  const roots = ["C:/Program Files/Microsoft", "C:/Program Files/Eclipse Adoptium", "C:/Program Files/Java", "C:/Program Files/OpenJDK"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const m = entry.name.match(/jdk-?(\d+)/i);
      if (m && Number(m[1]) >= 21) {
        const candidate = join(root, entry.name);
        if (existsSync(join(candidate, "bin", "java.exe"))) return candidate;
      }
    }
  }
  return null;
}

function ensureUnpackedExe(): string {
  if (exeOverride && existsSync(exeOverride)) return exeOverride;
  const defaultExe = defaultUnpackedExe();
  if (existsSync(defaultExe)) return defaultExe;

  throw new Error(
    [
      "unpacked_LINE.exe が見つかりません。Themida 保護を解いた実行ファイルが無いと解析できません。",
      "",
      "  bun run unpack",
      "  # または:",
      `  #   手動で dump を ${defaultExe} に置く`,
      "  #   --exe <path> で直接指定",
      "",
      "詳細: docs/unpack.md",
    ].join("\n"),
  );
}

type KnownProject = { projectDir: string; projectName: string; programName: string };

function resolveGhidraProject(exePath: string): KnownProject {
  const knownProject: KnownProject = {
    projectDir: join(GHIDRA_PROJECTS_DIR, "unpacked-fast"),
    projectName: "LINEUnpackedFast",
    programName: "unpacked_LINE.exe",
  };
  const gpr = join(knownProject.projectDir, `${knownProject.projectName}.gpr`);
  if (existsSync(gpr) && basename(exePath) === knownProject.programName) {
    return knownProject;
  }
  return {
    projectDir: join(GHIDRA_PROJECTS_DIR, "AutoRE"),
    projectName: "AutoRE",
    programName: basename(exePath),
  };
}

function ensureGhidraProjectImported(
  headless: string,
  javaHome: string | null,
  project: KnownProject,
  exePath: string,
): void {
  const gpr = join(project.projectDir, `${project.projectName}.gpr`);
  if (existsSync(gpr)) {
    log(`既存の Ghidra project を再利用: ${project.projectName}`);
    return;
  }
  ensureDir(project.projectDir);
  log(`Ghidra project を新規作成しインポート中 (時間がかかります): ${project.projectName}`);
  const res = runCmd(
    [headless, project.projectDir, project.projectName, "-import", exePath, "-noanalysis"],
    javaHome ? { env: { JAVA_HOME: javaHome } } : undefined,
  );
  if (!res.ok || !existsSync(gpr)) {
    throw new Error(`Ghidra import に失敗しました:\n${res.stdout.slice(-2000)}\n${res.stderr.slice(-2000)}`);
  }
}

// ---------------------------------------------------------------------------
// PE parsing + 生バイト文字列探索
// ---------------------------------------------------------------------------

type Section = {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  sizeOfRawData: number;
  pointerToRawData: number;
  characteristics: number;
};

const IMAGE_SCN_MEM_EXECUTE = 0x20000000;

function parsePeSections(buf: Buffer): { imageBase: bigint; sections: Section[] } {
  const e_lfanew = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(e_lfanew) !== 0x00004550) throw new Error("PE シグネチャ不一致 (対象は PE でない可能性)");
  const coffOff = e_lfanew + 4;
  const numSections = buf.readUInt16LE(coffOff + 2);
  const sizeOfOptHeader = buf.readUInt16LE(coffOff + 16);
  const optHeaderOff = coffOff + 20;
  const magic = buf.readUInt16LE(optHeaderOff);
  const isPE32Plus = magic === 0x20b;
  const imageBaseOff = isPE32Plus ? optHeaderOff + 24 : optHeaderOff + 28;
  const imageBase = isPE32Plus ? buf.readBigUInt64LE(imageBaseOff) : BigInt(buf.readUInt32LE(imageBaseOff));
  const sectionTableOff = optHeaderOff + sizeOfOptHeader;

  const sections: Section[] = [];
  for (let i = 0; i < numSections; i++) {
    const off = sectionTableOff + i * 40;
    const name = buf.subarray(off, off + 8).toString("ascii").replace(/\0+$/, "");
    sections.push({
      name,
      virtualSize: buf.readUInt32LE(off + 8),
      virtualAddress: buf.readUInt32LE(off + 12),
      sizeOfRawData: buf.readUInt32LE(off + 16),
      pointerToRawData: buf.readUInt32LE(off + 20),
      characteristics: buf.readUInt32LE(off + 36),
    });
  }
  return { imageBase, sections };
}

function fileOffsetToRva(sections: Section[], off: number): number | null {
  const s = sections.find((s) => off >= s.pointerToRawData && off < s.pointerToRawData + s.sizeOfRawData);
  if (!s) return null;
  return s.virtualAddress + (off - s.pointerToRawData);
}

function findAllAscii(buf: Buffer, needle: string): number[] {
  const nb = Buffer.from(needle, "ascii");
  const out: number[] = [];
  let from = 0;
  while (true) {
    const idx = buf.indexOf(nb, from);
    if (idx < 0) break;
    out.push(idx);
    from = idx + 1;
  }
  return out;
}

function findAllUtf16(buf: Buffer, needle: string): number[] {
  const nb = Buffer.from(needle, "utf16le");
  const out: number[] = [];
  let from = 0;
  while (true) {
    const idx = buf.indexOf(nb, from);
    if (idx < 0) break;
    out.push(idx);
    from = idx + 2;
  }
  return out;
}

function stringStartAscii(buf: Buffer, off: number): number {
  let i = off;
  while (i > 0) {
    const b = buf[i - 1]!;
    if (b < 0x20 || b > 0x7e) break;
    i--;
  }
  return i;
}

function stringStartUtf16(buf: Buffer, off: number): number {
  let i = off;
  while (i >= 2) {
    const c = buf.readUInt16LE(i - 2);
    if (c < 0x20 || c > 0x7e) break;
    i -= 2;
  }
  return i;
}

function previewAscii(buf: Buffer, off: number, len = 100): string {
  return buf.subarray(off, off + len).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
}

function previewUtf16(buf: Buffer, off: number, len = 100): string {
  const bytes = buf.subarray(off, off + len * 2);
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = bytes.readUInt16LE(i);
    s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ".";
  }
  return s;
}

type StringCategory = "qualifiedName" | "errorCode" | "urlPath" | "debugTag" | "other";

function classify(text: string): StringCategory {
  if (text.includes("::")) return "qualifiedName";
  if (/^\/[A-Za-z0-9/._-]+$/.test(text)) return "urlPath";
  if (/^\[[^\]]+\]/.test(text)) return "debugTag";
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(text)) return "errorCode";
  return "other";
}

const CATEGORY_PRIORITY: Record<StringCategory, number> = {
  qualifiedName: 0,
  errorCode: 1,
  urlPath: 2,
  debugTag: 3,
  other: 4,
};

type StringHit = {
  term: string;
  encoding: "ascii" | "utf16";
  fileOffset: number;
  rva: number | null;
  category: StringCategory;
  preview: string;
};

// ---------------------------------------------------------------------------
// LEA xref 静的スキャン
// ---------------------------------------------------------------------------

const REX_VARIANTS = [0x48, 0x4c];
const MODRM_VARIANTS = [0x05, 0x0d, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d];

type LeaXref = { instrRva: number; targetRva: number; labels: string[]; section: string };

function scanLeaXrefs(buf: Buffer, sections: Section[], targetRvas: Map<number, string[]>): LeaXref[] {
  const hits: LeaXref[] = [];
  for (const sec of sections) {
    if ((sec.characteristics & IMAGE_SCN_MEM_EXECUTE) === 0) continue;
    const start = sec.pointerToRawData;
    const end = Math.min(start + sec.sizeOfRawData, buf.length);
    for (let off = start; off < end - 7; off++) {
      if (!REX_VARIANTS.includes(buf[off]!)) continue;
      if (buf[off + 1] !== 0x8d) continue;
      if (!MODRM_VARIANTS.includes(buf[off + 2]!)) continue;
      const disp32 = buf.readInt32LE(off + 3);
      const instrRva = fileOffsetToRva(sections, off);
      if (instrRva == null) continue;
      const targetRva = instrRva + 7 + disp32;
      const labels = targetRvas.get(targetRva);
      if (labels) hits.push({ instrRva, targetRva, labels, section: sec.name || "(unnamed)" });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`検索語: ${terms.join(", ")}`);
  rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);
  ensureDir(functionsDir);

  let headless: string | null = null;
  let javaHome: string | null = null;
  if (!skipSetup && !listOnly) {
    headless = await ensureGhidra();
    javaHome = findJdk21Home();
    if (!javaHome) {
      log("警告: JDK 21+ が見つかりません。システム既定の java で Ghidra 起動を試みます (失敗する可能性あり)。");
    } else {
      log(`JDK 検出: ${javaHome}`);
    }
  }

  const exePath = ensureUnpackedExe();
  log(`対象バイナリ: ${exePath}`);
  const buf = readFileSync(exePath);
  const { sections } = parsePeSections(buf);

  // --- Step 1: 文字列一覧化 ---
  const stringsByTerm = new Map<string, StringHit[]>();
  for (const term of terms) {
    const hits: StringHit[] = [];
    const seenStarts = new Set<string>();

    for (const off of findAllAscii(buf, term)) {
      const start = stringStartAscii(buf, off);
      const key = `ascii:${start}`;
      if (seenStarts.has(key)) continue;
      seenStarts.add(key);
      const preview = previewAscii(buf, start);
      hits.push({ term, encoding: "ascii", fileOffset: start, rva: fileOffsetToRva(sections, start), category: classify(preview), preview });
    }

    if (includeUtf16) {
      for (const off of findAllUtf16(buf, term)) {
        const start = stringStartUtf16(buf, off);
        const key = `utf16:${start}`;
        if (seenStarts.has(key)) continue;
        seenStarts.add(key);
        const preview = previewUtf16(buf, start);
        hits.push({ term, encoding: "utf16", fileOffset: start, rva: fileOffsetToRva(sections, start), category: classify(preview), preview });
      }
    }

    hits.sort((a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category]);
    stringsByTerm.set(term, hits);
    log(`"${term}": ${hits.length} 件の文字列ヒット`);
  }

  writeFileSync(
    join(outDir, "strings.json"),
    `${JSON.stringify(
      { generatedAt: new Date().toISOString(), exePath, terms: [...stringsByTerm.entries()].map(([term, hits]) => ({ term, total: hits.length, hits })) },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // --- Step 2: LEA xref 静的スキャンで参照命令を特定 ---
  const targetRvas = new Map<number, string[]>();
  const candidateLimit = flags["include-all"] ? Number.POSITIVE_INFINITY : Number(flags["max-strings"] ?? 20);
  for (const [term, hits] of stringsByTerm) {
    for (const h of hits.slice(0, candidateLimit)) {
      if (h.rva == null) continue;
      const arr = targetRvas.get(h.rva) ?? [];
      arr.push(`${term}:${h.category}`);
      targetRvas.set(h.rva, arr);
    }
  }

  log(`xref 静的スキャン対象の文字列: ${targetRvas.size} 件`);
  const leaHits = scanLeaXrefs(buf, sections, targetRvas);
  log(`LEA xref ヒット: ${leaHits.length} 件`);

  writeFileSync(
    join(outDir, "xrefs.json"),
    `${JSON.stringify(
      { generatedAt: new Date().toISOString(), targets: [...targetRvas.entries()].map(([rva, labels]) => ({ rva, labels })), hits: leaHits },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (listOnly) {
    writeReadme({ terms, stringsByTerm, leaHits, decompileResults: null, outDir, maxStringsShown });
    log(`done (list-only) -> ${outDir}`);
    return;
  }

  // --- Step 3: 参照命令から関数を推定し decompile ---
  // qualifiedName / errorCode 系のヒットを優先して decompile 予算を割り当てる
  // (アドレス順のままだと QML プロパティ表のような "other" ノイズが先に予算を使い切ってしまう)
  function bestPriorityOf(labels: string[]): number {
    let best = 99;
    for (const label of labels) {
      const cat = label.split(":").at(-1) as StringCategory | undefined;
      const p = cat && cat in CATEGORY_PRIORITY ? CATEGORY_PRIORITY[cat] : 99;
      if (p < best) best = p;
    }
    return best;
  }
  const sortedLeaHits = [...leaHits].sort((a, b) => bestPriorityOf(a.labels) - bestPriorityOf(b.labels));

  const seenInstr = new Set<number>();
  const rvaTargetLines: string[] = [];
  for (const h of sortedLeaHits) {
    if (seenInstr.has(h.instrRva)) continue;
    seenInstr.add(h.instrRva);
    rvaTargetLines.push(`0x${h.instrRva.toString(16)} ${h.labels.join("+")}`);
    if (rvaTargetLines.length >= maxFunctions) break;
  }

  let decompileResults: unknown = null;
  if (rvaTargetLines.length === 0) {
    log("参照命令が見つからなかったため decompile はスキップします (strings.json / xrefs.json を確認してください)");
  } else if (headless) {
    const project = resolveGhidraProject(exePath);
    ensureGhidraProjectImported(headless, javaHome, project, exePath);

    const rvaListFile = join(outDir, "rva-targets.txt");
    writeFileSync(rvaListFile, `${rvaTargetLines.join("\n")}\n`, "utf8");

    log(`Ghidra headless で ${rvaTargetLines.length} 件の関数を decompile 中...`);
    const res = runCmd(
      [
        headless,
        project.projectDir,
        project.projectName,
        "-process",
        project.programName,
        "-noanalysis",
        "-scriptPath",
        GHIDRA_SCRIPTS_DIR,
        "-postScript",
        "DecompileAtRvas.java",
        rvaListFile,
        functionsDir,
        String(decompileTimeout),
        String(maxAddresses),
        String(backScanBytes),
      ],
      javaHome ? { env: { JAVA_HOME: javaHome } } : undefined,
    );
    if (!res.ok) {
      log(`警告: Ghidra headless が非0終了しました。出力末尾:\n${res.stdout.slice(-1500)}\n${res.stderr.slice(-1500)}`);
    }
    const indexPath = join(functionsDir, "_index.json");
    if (existsSync(indexPath)) {
      decompileResults = JSON.parse(readFileSync(indexPath, "utf8"));
    }
  }

  writeReadme({ terms, stringsByTerm, leaHits, decompileResults, outDir, maxStringsShown });
  log(`done -> ${outDir}`);
}

function writeReadme(args: {
  terms: string[];
  stringsByTerm: Map<string, StringHit[]>;
  leaHits: LeaXref[];
  decompileResults: unknown;
  outDir: string;
  maxStringsShown: number;
}): void {
  const { terms, stringsByTerm, leaHits, decompileResults, outDir, maxStringsShown } = args;
  const lines: string[] = [];
  lines.push(`# findNativeSymbol: ${terms.join(", ")}`);
  lines.push("");
  lines.push(`generatedAt: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 文字列ヒット");
  lines.push("");
  for (const [term, hits] of stringsByTerm) {
    lines.push(`### "${term}" (${hits.length} 件)`);
    lines.push("");
    for (const h of hits.slice(0, Number.isFinite(maxStringsShown) ? maxStringsShown : hits.length)) {
      lines.push(`- \`[${h.category}]\` (${h.encoding}) rva=0x${(h.rva ?? 0).toString(16)}: \`${h.preview.slice(0, 80)}\``);
    }
    if (Number.isFinite(maxStringsShown) && hits.length > maxStringsShown) {
      lines.push(`- ... and ${hits.length - maxStringsShown} more (see strings.json)`);
    }
    lines.push("");
  }

  lines.push("## LEA xref (この文字列を実際にロードしている命令)");
  lines.push("");
  lines.push(`total: ${leaHits.length}`);
  lines.push("");
  for (const h of leaHits.slice(0, 50)) {
    lines.push(`- 0x${h.instrRva.toString(16)} (${h.section}) -> 0x${h.targetRva.toString(16)} [${h.labels.join(", ")}]`);
  }
  lines.push("");

  lines.push("## Decompile 結果");
  lines.push("");
  if (!decompileResults) {
    lines.push("(list-only、または対象0件のため未実施)");
  } else {
    const allResults = (decompileResults as { results?: Array<Record<string, unknown>> }).results ?? [];
    const seenEntry = new Set<string>();
    const results = allResults.filter((r) => {
      const entry = String(r["functionEntry"] ?? r["file"]);
      if (seenEntry.has(entry)) return false;
      seenEntry.add(entry);
      return true;
    });
    lines.push(`total: ${results.length} (重複関数を除く。生ヒットは ${allResults.length} 件)`);
    lines.push("");
    lines.push("| label | function | entry | decompiled | file |");
    lines.push("|---|---|---|---|---|");
    for (const r of results) {
      lines.push(
        `| ${r["label"]} | ${r["functionName"] ?? "-"} | ${r["functionEntry"] ?? "-"} | ${r["decompiled"]} | \`functions/${r["file"]}\` |`,
      );
    }
  }
  lines.push("");
  lines.push("## 出力ファイル");
  lines.push("");
  lines.push("```text");
  lines.push(`${outDir}/`);
  lines.push("  README.md        (このファイル)");
  lines.push("  strings.json     文字列ヒット全件 (term ごと)");
  lines.push("  xrefs.json       LEA xref 全件");
  lines.push("  rva-targets.txt  decompile に渡した命令アドレス一覧");
  lines.push("  functions/       decompile された .c ファイル一式 + _index.json");
  lines.push("```");
  lines.push("");

  writeFileSync(join(outDir, "README.md"), `${lines.join("\n")}\n`, "utf8");
}

await main().catch((err) => {
  console.error(`[findNativeSymbol] エラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
