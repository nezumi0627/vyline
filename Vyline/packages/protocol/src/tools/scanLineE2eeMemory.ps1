# Scan running LINE.exe for known E2EE public key bytes and dump nearby regions.
param(
  [Parameter(Mandatory = $true)][string]$NeedlesFile,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$Radius = 768
)

$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class VylineE2eeScan3 {
  const int PROCESS_QUERY_INFORMATION = 0x0400;
  const int PROCESS_VM_READ = 0x0010;
  const int PROCESS_QUERY_LIMITED = 0x1000;

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern void GetSystemInfo(out SYSTEM_INFO si);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern UIntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, UIntPtr len);
  [DllImport("kernel32.dll")] static extern uint GetLastError();

  [StructLayout(LayoutKind.Sequential)]
  public struct SYSTEM_INFO {
    public ushort wProcessorArchitecture;
    public ushort wReserved;
    public uint dwPageSize;
    public IntPtr lpMinimumApplicationAddress;
    public IntPtr lpMaximumApplicationAddress;
    public IntPtr dwActiveProcessorMask;
    public uint dwNumberOfProcessors;
    public uint dwProcessorType;
    public uint dwAllocationGranularity;
    public ushort wProcessorLevel;
    public ushort wProcessorRevision;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public IntPtr RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
  }

  public static string Diagnose(int pid) {
    var h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
    if (h == IntPtr.Zero) {
      h = OpenProcess(PROCESS_QUERY_LIMITED | PROCESS_VM_READ, false, pid);
      if (h == IntPtr.Zero) return "OpenProcess failed lastError=" + GetLastError();
      CloseHandle(h);
      return "OpenProcess ok (limited)";
    }
    CloseHandle(h);
    return "OpenProcess ok bits=" + (IntPtr.Size * 8);
  }

  static bool MatchAt(byte[] buf, int off, byte[] needle) {
    if (off < 0 || off + needle.Length > buf.Length) return false;
    for (int j = 0; j < needle.Length; j++) if (buf[off + j] != needle[j]) return false;
    return true;
  }

  public static List<string> Scan(int pid, string[] needlesHex, int radius) {
    var outp = new List<string>();
    var needles = new List<byte[]>();
    foreach (var h in needlesHex) {
      var b = new byte[h.Length / 2];
      for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(h.Substring(i * 2, 2), 16);
      needles.Add(b);
    }

    var access = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ;
    var hProc = OpenProcess(access, false, pid);
    if (hProc == IntPtr.Zero) {
      hProc = OpenProcess(PROCESS_QUERY_LIMITED | PROCESS_VM_READ, false, pid);
    }
    if (hProc == IntPtr.Zero) {
      outp.Add("ERROR|OpenProcess|" + GetLastError());
      return outp;
    }

    SYSTEM_INFO si; GetSystemInfo(out si);
    long addr = si.lpMinimumApplicationAddress.ToInt64();
    long max = si.lpMaximumApplicationAddress.ToInt64();
    if (addr < 0 || max <= addr) { addr = 0; max = 0x7FFFFFFFFFFF; }
    long regions = 0, readable = 0, bytesRead = 0;
    int mbiSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));

    try {
      while (addr < max && outp.Count < 800) {
        MEMORY_BASIC_INFORMATION mbi;
        var q = VirtualQueryEx(hProc, new IntPtr(addr), out mbi, new UIntPtr((uint)mbiSize));
        if (q == UIntPtr.Zero) {
          outp.Insert(0, "META|vqFail|addr=0x" + addr.ToString("x") + "|err=" + GetLastError() + "|regions=" + regions + "|readable=" + readable);
          break;
        }
        regions++;
        long size = mbi.RegionSize.ToInt64();
        if (size <= 0) {
          outp.Insert(0, "META|badSize|addr=0x" + addr.ToString("x") + "|regions=" + regions);
          break;
        }

        // MEM_COMMIT=0x1000; readable protect mask PAGE_READONLY|READWRITE|WRITECOPY|EXECUTE_READ|EXECUTE_READWRITE|EXECUTE_WRITECOPY
        if (mbi.State == 0x1000 && size <= 32L * 1024 * 1024 && (mbi.Protect & 0xEE) != 0 && (mbi.Protect & 0x100) == 0) {
          readable++;
          int toRead = (int)Math.Min(size, 8L * 1024 * 1024);
          var buf = new byte[toRead];
          IntPtr nread;
          if (ReadProcessMemory(hProc, mbi.BaseAddress, buf, buf.Length, out nread) && nread.ToInt64() > 32) {
            int read = (int)nread.ToInt64();
            bytesRead += read;
            for (int n = 0; n < needles.Count; n++) {
              var needle = needles[n];
              for (int i = 0; i <= read - needle.Length; i++) {
                if (!MatchAt(buf, i, needle)) continue;
                int start = Math.Max(0, i - radius);
                int end = Math.Min(read, i + needle.Length + radius);
                var around = new byte[end - start];
                Buffer.BlockCopy(buf, start, around, 0, around.Length);
                outp.Add(
                  BitConverter.ToString(needle).Replace("-", "").ToLowerInvariant()
                  + "|"
                  + BitConverter.ToString(around).Replace("-", "").ToLowerInvariant()
                );
                if (outp.Count >= 800) break;
                i += Math.Max(1, needle.Length - 1);
              }
            }
          }
        }

        long next = mbi.BaseAddress.ToInt64() + size;
        if (next <= addr) next = addr + size;
        if (next <= addr) break;
        addr = next;
      }
      outp.Insert(0, "META|regions=" + regions + "|readable=" + readable + "|MB=" + (bytesRead / (1024 * 1024)) + "|hits=" + Math.Max(0, outp.Count));
    } finally {
      CloseHandle(hProc);
    }
    return outp;
  }
}
"@

$procs = @(Get-Process LINE -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending)
if ($procs.Count -eq 0) { "NO_PROCESS" | Set-Content -Path $OutFile -Encoding utf8; exit 0 }

$needles = @(Get-Content -Path $NeedlesFile | Where-Object { $_.Trim().Length -gt 0 })
$all = New-Object System.Collections.Generic.List[string]
foreach ($proc in $procs) {
  $diag = [VylineE2eeScan3]::Diagnose([int]$proc.Id)
  $all.Add("DIAG|$diag|pid=$($proc.Id)|wsMB=$([math]::Round($proc.WorkingSet64/1MB))")
  $hits = [VylineE2eeScan3]::Scan([int]$proc.Id, [string[]]$needles, $Radius)
  foreach ($h in $hits) { $all.Add("PID$($proc.Id)|$h") }
}
$all | Set-Content -Path $OutFile -Encoding utf8
