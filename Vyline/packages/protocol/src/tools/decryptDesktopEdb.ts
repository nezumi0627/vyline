/**
 * decryptDesktopEdb.ts
 *
 * LINE Desktop .edb (wxSQLite3) 復号を試みる。
 *
 * 手順:
 * 1. LINE.exe 稼働中にメモリから 32-hex passphrase 候補を収集
 * 2. .edb を共有オープンで読み取り
 * 3. 候補で page1 検証 → 成功したら .sqlite に書き出し
 *
 * Usage:
 *   bun run src/tools/decryptDesktopEdb.ts
 *   bun run src/tools/decryptDesktopEdb.ts --passphrase <32hex>
 *   bun run src/tools/decryptDesktopEdb.ts --edb <path> --out <path>
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
} from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  decryptWxSqlite3File,
  isLikelyWxSqlite3,
  tryPassphraseVariants,
  verifyWxSqlite3Passphrase,
} from "../desktop/wxSqlite3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return undefined;
}

function lineDataDbDir(): string {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(local, "LINE", "Data", "db");
}

function findMainEdb(): string | null {
  const dir = lineDataDbDir();
  if (!existsSync(dir)) return null;
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith(".edb") &&
        !f.startsWith("album_") &&
        !f.startsWith("chatStats_") &&
        !f.startsWith("keep_"),
    )
    .map((f) => {
      const p = join(dir, f);
      return { p, size: statSync(p).size };
    })
    .sort((a, b) => b.size - a.size);
  return files[0]?.p ?? null;
}

/** Read file even if LINE has it locked (Windows share read). */
function readShared(path: string): Buffer {
  const fd = openSync(path, "r");
  try {
    const st = fstatSync(fd);
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, Math.min(1024 * 1024, st.size - off), off);
      if (n <= 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}

function scanPassphrasesFromMemory(): string[] {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class MemScan {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int a, bool b, int pid);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int n, out int read);
  [DllImport("kernel32.dll")] static extern int VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION m, int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect;
    public UIntPtr RegionSize; public uint State; public uint Protect; public uint Type;
  }
  const int PROCESS_VM_READ = 0x0010; const int PROCESS_QUERY_INFORMATION = 0x0400;
  public static List<string> Scan() {
    var found = new HashSet<string>();
    foreach (var p in Process.GetProcessesByName("LINE")) {
      var h = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, p.Id);
      if (h == IntPtr.Zero) continue;
      long addr = 0; var mbi = new MEMORY_BASIC_INFORMATION();
      var buf = new byte[1024 * 1024];
      while (addr < 0x7FFFFFFFFFFF) {
        if (VirtualQueryEx(h, (IntPtr)addr, out mbi, Marshal.SizeOf(mbi)) == 0) break;
        long size = (long)mbi.RegionSize;
        if (mbi.State == 0x1000 && (mbi.Protect == 0x04 || mbi.Protect == 0x02 || mbi.Protect == 0x40 || mbi.Protect == 0x20)) {
          long remaining = size; long off = 0;
          while (remaining > 0) {
            int chunk = (int)Math.Min(remaining, buf.Length);
            int read; if (ReadProcessMemory(h, (IntPtr)(addr + off), buf, chunk, out read) && read > 32) {
              for (int i = 0; i + 32 <= read; i++) {
                bool ok = true;
                for (int k = 0; k < 32; k++) {
                  byte c = buf[i+k];
                  bool hex = (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46);
                  if (!hex) { ok = false; break; }
                }
                if (!ok) continue;
                // boundary: not hex before/after
                if (i > 0) { byte b = buf[i-1]; if ((b>=0x30&&b<=0x39)||(b>=0x61&&b<=0x66)||(b>=0x41&&b<=0x46)) continue; }
                if (i+32 < read) { byte b = buf[i+32]; if ((b>=0x30&&b<=0x39)||(b>=0x61&&b<=0x66)||(b>=0x41&&b<=0x46)) continue; }
                found.Add(Encoding.ASCII.GetString(buf, i, 32).ToLowerInvariant());
                if (found.Count > 5000) { CloseHandle(h); return new List<string>(found); }
              }
            }
            off += chunk; remaining -= chunk;
          }
        }
        long next = addr + size; if (next <= addr) break; addr = next;
      }
      CloseHandle(h);
    }
    return new List<string>(found);
  }
}
"@
[MemScan]::Scan() | ForEach-Object { $_ }
`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  if (r.error) {
    console.error("memory scan failed:", r.error.message);
    return [];
  }
  const lines = (r.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{32}$/.test(s));
  return [...new Set(lines)];
}

async function main() {
  const edbPath = arg("edb") ?? findMainEdb();
  if (!edbPath || !existsSync(edbPath)) {
    console.error("No .edb found. Pass --edb <path> or start LINE Desktop.");
    process.exit(1);
  }
  console.log("edb:", edbPath);

  const file = readShared(edbPath);
  console.log("size:", file.length, "wxSQLite3-like:", isLikelyWxSqlite3(file));
  console.log("hdr16-24:", file.subarray(16, 24).toString("hex"));

  const outDir =
    arg("out-dir") ??
    join(
      process.cwd().includes("vyline") ? "../../../backend/data" : "Vyline/backend/data",
      "edb-export",
    );
  // resolve relative to repo
  const dataDir = join(import.meta.dirname ?? ".", "../../../../backend/data/edb-export");
  const destDir = arg("out-dir") ?? dataDir;
  mkdirSync(destDir, { recursive: true });

  const forced = arg("passphrase");
  const candidates = forced ? [forced] : scanPassphrasesFromMemory();
  console.log("passphrase candidates:", candidates.length);

  if (candidates.length === 0) {
    console.error("No candidates. Start LINE.exe and re-run, or pass --passphrase.");
    process.exit(2);
  }

  // Prefer unique-ish candidates; try both quirks and encodings
  let hit: { passphrase: string; quirk: boolean; pageSize: number } | null = null;
  const pageSizes = [1024, 4096, 2048, 512, 8192];

  outer: for (const cand of candidates) {
    for (const variant of tryPassphraseVariants(cand)) {
      for (const quirk of [true, false]) {
        for (const pageSize of pageSizes) {
          if (verifyWxSqlite3Passphrase(file, variant, { lineQuirk: quirk, pageSize })) {
            hit = { passphrase: cand, quirk, pageSize };
            console.log("HIT", { passphrase: `${cand.slice(0, 6)}…`, quirk, pageSize });
            break outer;
          }
        }
      }
    }
  }

  if (!hit) {
    console.error("No passphrase verified against page1. Dump candidates count only.");
    writeFileSync(
      join(destDir, "passphrase-candidates.json"),
      JSON.stringify({ count: candidates.length, sample: candidates.slice(0, 20) }, null, 2),
    );
    process.exit(3);
  }

  const plain = decryptWxSqlite3File(file, tryPassphraseVariants(hit.passphrase)[0]!, {
    lineQuirk: hit.quirk,
    pageSize: hit.pageSize,
  });
  const outPath = arg("out") ?? join(destDir, basename(edbPath).replace(/\.edb$/i, ".sqlite"));
  writeFileSync(outPath, plain);
  // DO NOT write the passphrase to disk in plaintext logs beyond truncated
  writeFileSync(
    join(destDir, "decrypt-meta.json"),
    JSON.stringify(
      {
        edb: edbPath,
        out: outPath,
        pageSize: hit.pageSize,
        lineQuirk: hit.quirk,
        passphrasePrefix: hit.passphrase.slice(0, 4),
        decryptedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("decrypted →", outPath);
  console.log("header:", plain.subarray(0, 16).toString("utf8"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
