# Dump ASCII windows around "privateKey" hits in LINE.exe memory.
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public static class VylinePrivKeyScan {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool b, int p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern void GetSystemInfo(out SYSTEM_INFO si);
  [DllImport("kernel32.dll", SetLastError=true)] static extern UIntPtr VirtualQueryEx(IntPtr h, IntPtr a, out MEMORY_BASIC_INFORMATION m, UIntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct SYSTEM_INFO {
    public ushort a; public ushort b; public uint page; public IntPtr mi; public IntPtr ma; public IntPtr mask; public uint nproc; public uint ptype; public uint gran; public ushort level; public ushort rev;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type;
  }
  static int IndexOf(byte[] hay, int from, int to, byte[] needle) {
    for (int i = from; i <= to - needle.Length; i++) {
      bool ok = true;
      for (int j = 0; j < needle.Length; j++) if (hay[i+j] != needle[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }
  public static List<string> Scan(int pid) {
    var outp = new List<string>();
    var needle = Encoding.ASCII.GetBytes("\"privateKey\"");
    var h = OpenProcess(0x0410, false, pid);
    if (h == IntPtr.Zero) { outp.Add("OPENFAIL"); return outp; }
    SYSTEM_INFO si; GetSystemInfo(out si);
    long addr = si.mi.ToInt64();
    long max = si.ma.ToInt64();
    if (max <= addr) { addr = 0; max = 0x7FFFFFFFFFFF; }
    try {
      while (addr < max && outp.Count < 80) {
        MEMORY_BASIC_INFORMATION mbi;
        if (VirtualQueryEx(h, new IntPtr(addr), out mbi, new UIntPtr((uint)Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION)))) == UIntPtr.Zero) break;
        long size = mbi.RegionSize.ToInt64();
        if (size <= 0) break;
        if (mbi.State == 0x1000 && size <= 32L*1024*1024 && (mbi.Protect & 0xEE) != 0 && (mbi.Protect & 0x100) == 0) {
          int toRead = (int)Math.Min(size, 8L*1024*1024);
          var buf = new byte[toRead];
          IntPtr nread;
          if (ReadProcessMemory(h, mbi.BaseAddress, buf, buf.Length, out nread) && nread.ToInt64() > 64) {
            int read = (int)nread.ToInt64();
            int from = 0;
            while (from < read && outp.Count < 80) {
              int i = IndexOf(buf, from, read, needle);
              if (i < 0) break;
              int start = Math.Max(0, i - 4000);
              int end = Math.Min(read, i + 2000);
              var sb = new StringBuilder(end - start);
              for (int k = start; k < end; k++) {
                byte b = buf[k];
                sb.Append((b >= 32 && b < 127) ? (char)b : '\n');
              }
              outp.Add("ADDR=0x" + (mbi.BaseAddress.ToInt64()+i).ToString("x") + "\n" + sb.ToString());
              from = i + needle.Length;
            }
          }
        }
        long next = mbi.BaseAddress.ToInt64() + size;
        if (next <= addr) break;
        addr = next;
      }
    } finally { CloseHandle(h); }
    return outp;
  }
}
"@

$proc = Get-Process LINE -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
if (-not $proc) { "NO_PROCESS" | Set-Content -Path $OutFile -Encoding utf8; exit 0 }
$chunks = [VylinePrivKeyScan]::Scan([int]$proc.Id)
($chunks -join "`n=====`n") | Set-Content -Path $OutFile -Encoding utf8
