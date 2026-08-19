/**
 * PE / プロセスから Desktop 固有文字列を抽出
 *
 * LINE.exe は Themida 保護のため静的スキャンは弱い。
 * 起動中プロセスのメモリダンプを優先する。
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildIdentity, parseRuntimeApplicationHeader, parseRuntimeUserAgent } from "./identity.js";
import type { DesktopIdentity } from "./types.js";

export interface ExtractResult {
  identity: DesktopIdentity | null;
  samples: string[];
  method: "runtime" | "pe-scan" | "synthetic";
  notes: string[];
}

function extractAsciiStrings(buf: Buffer, min = 8, max = 200): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    if (b >= 0x20 && b <= 0x7e) {
      cur += String.fromCharCode(b);
      if (cur.length > max) cur = "";
    } else {
      if (cur.length >= min) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

function pickDesktopSamples(strings: string[]): string[] {
  const keys = [
    "DESKTOPWIN",
    "DESKTOP:WINDOWS",
    "X-Line-Application",
    "x-line-application",
    "User-Agent: DESKTOP",
    "legy-jp.line-apps.com",
  ];
  return strings.filter((s) => keys.some((k) => s.includes(k))).slice(0, 50);
}

/**
 * 起動中 LINE.exe からメモリ文字列を抽出 (Windows PowerShell)
 * 管理者不要の ReadProcessMemory を試行。
 */
export function dumpRuntimeIdentity(): ExtractResult {
  if (process.platform !== "win32") {
    return { identity: null, samples: [], method: "runtime", notes: ["not win32"] };
  }

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class VylineMem {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int a, bool b, int p);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out int r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern void GetSystemInfo(out SYSTEM_INFO si);
  [DllImport("kernel32.dll")] static extern int VirtualQueryEx(IntPtr h, IntPtr a, out MEMORY_BASIC_INFORMATION m, int l);
  [StructLayout(LayoutKind.Sequential)] public struct SYSTEM_INFO { public ushort p; public ushort r; public IntPtr po; public IntPtr mi; public IntPtr ma; public IntPtr apn; public IntPtr anp; public uint ps; public uint pc; }
  [StructLayout(LayoutKind.Sequential)] public struct MEMORY_BASIC_INFORMATION { public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type; }
  public static List<string> Scan(int pid) {
    var hits = new List<string>();
    var h = OpenProcess(0x0410, false, pid); // QUERY_INFO|VM_READ
    if (h == IntPtr.Zero) return hits;
    SYSTEM_INFO si; GetSystemInfo(out si);
    var addr = si.mi;
    var max = (long)si.ma;
    var needles = new[] { "DESKTOPWIN.", "DESKTOP:WINDOWS:", "X-Line-Application:", "User-Agent: DESKTOP" };
    try {
      while ((long)addr < max && hits.Count < 40) {
        MEMORY_BASIC_INFORMATION mbi;
        if (VirtualQueryEx(h, addr, out mbi, Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION))) == 0) break;
        long size = (long)mbi.RegionSize;
        if (mbi.State == 0x1000 && size > 0 && size < 32*1024*1024 && (mbi.Protect & 0xEE) != 0) {
          var buf = new byte[Math.Min(size, 4*1024*1024)];
          int read;
          if (ReadProcessMemory(h, mbi.BaseAddress, buf, buf.Length, out read) && read > 0) {
            var ascii = Encoding.ASCII.GetString(buf, 0, read);
            foreach (var n in needles) {
              int i = 0;
              while ((i = ascii.IndexOf(n, i, StringComparison.Ordinal)) >= 0 && hits.Count < 40) {
                int end = Math.Min(ascii.Length, i + 120);
                int cut = ascii.IndexOfAny(new[]{'\\0','\\r','\\n'}, i, end-i);
                if (cut < 0) cut = end;
                var s = ascii.Substring(i, cut - i);
                if (!hits.Contains(s)) hits.Add(s);
                i += n.Length;
              }
            }
          }
        }
        long next = (long)mbi.BaseAddress + size;
        if (next <= (long)addr) break;
        addr = new IntPtr(next);
      }
    } finally { CloseHandle(h); }
    return hits;
  }
}
"@
$p = Get-Process -Name LINE -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output 'NO_PROCESS'; exit 0 }
$hits = [VylineMem]::Scan($p.Id)
$hits | ForEach-Object { $_ }
`;

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  const notes: string[] = [];
  if (result.error) {
    notes.push(`spawn error: ${result.error.message}`);
    return { identity: null, samples: [], method: "runtime", notes };
  }
  if (result.status !== 0) {
    notes.push(`ps exit ${result.status}: ${(result.stderr ?? "").slice(0, 200)}`);
  }

  const samples = (result.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l !== "NO_PROCESS");

  if (samples.length === 0) {
    notes.push("LINE.exe not running or no matching strings");
    return { identity: null, samples: [], method: "runtime", notes };
  }

  let identity: DesktopIdentity | null = null;
  for (const s of samples) {
    identity = parseRuntimeApplicationHeader(s) ?? parseRuntimeUserAgent(s) ?? identity;
    if (identity) break;
  }

  notes.push(`runtime samples: ${samples.length}`);
  return { identity, samples, method: "runtime", notes };
}

/** Themida 保護 EXE 向けの弱い静的スキャン + synthetic fallback */
export function extractFromExe(exePath: string, appVersion: string): ExtractResult {
  const notes: string[] = [];
  if (!existsSync(exePath)) {
    return {
      identity: buildIdentity(appVersion),
      samples: [],
      method: "synthetic",
      notes: ["exe missing"],
    };
  }

  // VERSIONINFO 近傍だけ軽く読む (先頭/末尾 8MB) — Themida 本体は読めない
  const buf = readFileSync(exePath);
  const chunks: Buffer[] = [];
  const head = Math.min(buf.length, 8 * 1024 * 1024);
  chunks.push(buf.subarray(0, head));
  if (buf.length > head) {
    chunks.push(buf.subarray(buf.length - Math.min(buf.length, 4 * 1024 * 1024)));
  }

  const strings: string[] = [];
  for (const c of chunks) strings.push(...extractAsciiStrings(c));
  const samples = pickDesktopSamples(strings);
  notes.push(
    `pe ascii strings scanned (partial): ${strings.length}, desktop-like: ${samples.length}`,
  );

  let identity: DesktopIdentity | null = null;
  for (const s of samples) {
    identity = parseRuntimeApplicationHeader(s) ?? parseRuntimeUserAgent(s) ?? identity;
  }

  if (!identity) {
    identity = buildIdentity(appVersion);
    notes.push("Themida: synthesized identity from installed version + host OS");
    return { identity, samples, method: "synthetic", notes };
  }

  return { identity, samples, method: "pe-scan", notes };
}
