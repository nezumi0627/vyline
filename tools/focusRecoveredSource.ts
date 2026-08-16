/**
 * focusRecoveredSource
 *
 * recovered native source をキーワードで絞り込み、data/out/focused/ に再配置・manifest 化する。
 *
 *   bun run focus --
 *   bun run focus -- --manifest-only
 *   bun run focus -- --group storage=Storage|Index
 *   bun run focus -- --source-dir <path> --out-dir <path>
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { DATA_DIR, OUT_DIR, ensureDataLayout } from "./paths.js";

ensureDataLayout();

type FocusGroup = {
  id: string;
  description: string;
  pattern: RegExp;
};

type FocusEntry = {
  file: string;
  relativePath: string;
  order: number | null;
  entry: string | null;
  symbol: string;
  status: "decompiled" | "skipped_large" | "failed" | "unknown";
};

const args = process.argv.slice(2);

const DEFAULT_GROUPS: FocusGroup[] = [
  {
    id: "storage",
    description: "Storage / Query / Index / Migrator 系",
    pattern:
      /(Storage|Index|Migrator|Condition|Schema|Query|insert|select|update|remove|load|count|sort|create|drop)/i,
  },
  {
    id: "qhttp",
    description: "QHttp / request-response / socket IO 系",
    pattern:
      /(QHttp|Request|Response|Server|Header|Body|Url|socket|listen|flush|write|remote|connection|http)/i,
  },
  {
    id: "qt-meta",
    description: "Qt meta-object / translation 系",
    pattern: /(qt_|metaObject|metacall|metacast|static_metacall|\btr\b)/i,
  },
];

function argValue(name: string): string | null {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function argValues(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) out.push(args[i + 1]!);
  }
  return out;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else out.push(path);
    }
  }
  return out;
}

function parseGroups(): FocusGroup[] {
  const extra = argValues("--group");
  if (extra.length === 0) return DEFAULT_GROUPS;
  return extra.map((raw) => {
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--group は name=regex 形式で指定してください: ${raw}`);
    }
    const id = raw.slice(0, eq);
    const pattern = raw.slice(eq + 1);
    return {
      id,
      description: `custom: ${pattern}`,
      pattern: new RegExp(pattern, "i"),
    };
  });
}

function parseFileMeta(path: string): FocusEntry {
  const base = path.split(/[/\\]/).at(-1) ?? path;
  const m = base.match(/^(\d+)_([0-9a-fA-F]+)_(.+)\.c$/);
  const text = readFileSync(path, "utf8");
  const status: FocusEntry["status"] = text.includes("decompiled: true")
    ? "decompiled"
    : text.includes("skipped_large: true")
      ? "skipped_large"
      : text.includes("decompiled: false")
        ? "failed"
        : "unknown";
  return {
    file: base,
    relativePath: path,
    order: m?.[1] ? Number(m[1]) : null,
    entry: m?.[2] ?? null,
    symbol: m?.[3] ?? base.replace(/\.c$/, ""),
    status,
  };
}

function renderGroupReadme(group: FocusGroup, entries: FocusEntry[]): string {
  const decompiled = entries.filter((e) => e.status === "decompiled").length;
  const failed = entries.filter((e) => e.status === "failed").length;
  const skipped = entries.filter((e) => e.status === "skipped_large").length;
  const lines: string[] = [];
  lines.push(`# ${group.id}`);
  lines.push("");
  lines.push(group.description);
  lines.push("");
  lines.push(`- total: ${entries.length}`);
  lines.push(`- decompiled: ${decompiled}`);
  lines.push(`- skipped_large: ${skipped}`);
  lines.push(`- failed: ${failed}`);
  lines.push("");
  lines.push(`## Files`);
  lines.push("");
  for (const entry of entries.slice(0, 100)) {
    lines.push(`- \`${entry.file}\` (${entry.status})`);
  }
  if (entries.length > 100) {
    lines.push("");
    lines.push(`... and ${entries.length - 100} more`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderIndexReadme(
  groups: Array<{ group: FocusGroup; entries: FocusEntry[] }>,
  totalFiles: number,
  sourceDir: string,
): string {
  const lines: string[] = [];
  lines.push(`# Focused Recovered Source`);
  lines.push("");
  lines.push(`source: \`${sourceDir}\``);
  lines.push(`generatedAt: ${new Date().toISOString()}`);
  lines.push(`totalNativeFiles: ${totalFiles}`);
  lines.push("");
  lines.push(`## Groups`);
  lines.push("");
  for (const { group, entries } of groups) {
    const ok = entries.filter((e) => e.status === "decompiled").length;
    lines.push(`- \`${group.id}\`: ${entries.length} files (${ok} decompiled)`);
  }
  lines.push("");
  lines.push(`## Usage`);
  lines.push("");
  lines.push("```powershell");
  lines.push("bun run focus");
  lines.push("bun run focus -- --manifest-only");
  lines.push("bun run focus -- --group storage=Storage|Index");
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const sourceDir =
    argValue("--source-dir") ??
    join(DATA_DIR, "recovered", "src", "native", "LINE.exe");
  const outDir = argValue("--out-dir") ?? join(OUT_DIR, "focused");
  const manifestOnly = args.includes("--manifest-only");

  if (!existsSync(sourceDir)) {
    throw new Error(
      [
        `source dir が見つかりません: ${sourceDir}`,
        "全件 decompile 済みの .c ツリーを --source-dir で渡すか、",
        `data/recovered/src/native/LINE.exe に配置してください。`,
      ].join("\n"),
    );
  }

  rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);

  const groups = parseGroups();
  const files = listFilesRecursive(sourceDir).filter((p) => p.endsWith(".c"));
  const entries = files.map(parseFileMeta).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const grouped = groups.map((group) => ({
    group,
    entries: entries.filter((entry) => group.pattern.test(entry.file)),
  }));

  for (const { group, entries } of grouped) {
    const groupDir = join(outDir, group.id);
    ensureDir(groupDir);
    writeFileSync(
      join(groupDir, "manifest.json"),
      `${JSON.stringify(
        {
          group: group.id,
          description: group.description,
          total: entries.length,
          entries: entries.map((entry) => ({
            ...entry,
            relativePath: relative(DATA_DIR, entry.relativePath),
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(join(groupDir, "README.md"), renderGroupReadme(group, entries), "utf8");

    if (!manifestOnly) {
      const targetSrcDir = join(groupDir, "src");
      ensureDir(targetSrcDir);
      for (const entry of entries) {
        copyFileSync(entry.relativePath, join(targetSrcDir, entry.file));
      }
    }
  }

  writeFileSync(
    join(outDir, "index.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceDir,
        totalFiles: entries.length,
        groups: grouped.map(({ group, entries }) => ({
          id: group.id,
          description: group.description,
          total: entries.length,
          decompiled: entries.filter((e) => e.status === "decompiled").length,
          failed: entries.filter((e) => e.status === "failed").length,
          skippedLarge: entries.filter((e) => e.status === "skipped_large").length,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(outDir, "README.md"),
    renderIndexReadme(grouped, entries.length, sourceDir),
    "utf8",
  );

  console.info(`[focusRecoveredSource] done → ${outDir}`);
}

await main().catch((err) => {
  console.error(`[focusRecoveredSource] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
