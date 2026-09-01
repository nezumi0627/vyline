import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type WindowsLineTokenKind = "access" | "refresh" | "unknown";

export interface WindowsLineTokenCandidate {
  token: string;
  kind: WindowsLineTokenKind;
  expiresAt?: number;
  tokenId?: string;
  refreshTokenId?: string;
  accessTokenId?: string;
}

export interface WindowsLineTokenPair {
  access?: WindowsLineTokenCandidate;
  refresh?: WindowsLineTokenCandidate;
}

export interface WindowsLineTokenInventory {
  candidates: WindowsLineTokenCandidate[];
  pairs: WindowsLineTokenPair[];
}

export type WindowsLineTokenStatus = "usable" | "unusable";

export interface WindowsLineTokenView {
  index: number;
  kind: WindowsLineTokenKind;
  status: WindowsLineTokenStatus;
  fingerprint: string;
  expiresAt?: number;
  remainingSeconds: number;
  pairedIndex?: number;
}

type JwtPayload = {
  exp?: unknown;
  jti?: unknown;
  rtid?: unknown;
  ati?: unknown;
  scp?: unknown;
  ctype?: unknown;
  rot?: unknown;
};

function decodeJwtPayload(token: string): JwtPayload | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const encoded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as JwtPayload;
  } catch {
    return undefined;
  }
}

export function classifyWindowsLineJwt(token: string): WindowsLineTokenCandidate | undefined {
  const payload = decodeJwtPayload(token);
  if (
    !payload ||
    typeof payload.scp !== "string" ||
    !["LINE_CORE", "LINE_AUTH", "LINE_AUTH_REFRESH"].includes(payload.scp)
  )
    return undefined;
  const expiresAt =
    typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : undefined;
  const tokenId = typeof payload.jti === "string" ? payload.jti : undefined;
  if (payload.ctype !== undefined) {
    return {
      token,
      kind: "access",
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(tokenId === undefined ? {} : { tokenId }),
      ...(typeof payload.rtid === "string" ? { refreshTokenId: payload.rtid } : {}),
    };
  }
  if (payload.ati !== undefined || payload.rot !== undefined) {
    return {
      token,
      kind: "refresh",
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(tokenId === undefined ? {} : { tokenId }),
      ...(typeof payload.ati === "string" ? { accessTokenId: payload.ati } : {}),
    };
  }
  return { token, kind: "unknown", ...(expiresAt === undefined ? {} : { expiresAt }) };
}

export function pairWindowsLineTokens(
  candidates: WindowsLineTokenCandidate[],
): WindowsLineTokenPair[] {
  const access = candidates.filter((candidate) => candidate.kind === "access");
  const refresh = candidates.filter((candidate) => candidate.kind === "refresh");
  const usedRefresh = new Set<WindowsLineTokenCandidate>();
  const pairs: WindowsLineTokenPair[] = [];
  for (const accessToken of access) {
    const refreshToken = refresh.find(
      (candidate) =>
        !usedRefresh.has(candidate) &&
        ((accessToken.refreshTokenId && accessToken.refreshTokenId === candidate.tokenId) ||
          (accessToken.tokenId && accessToken.tokenId === candidate.accessTokenId)),
    );
    if (refreshToken) usedRefresh.add(refreshToken);
    pairs.push({ access: accessToken, ...(refreshToken ? { refresh: refreshToken } : {}) });
  }
  for (const refreshToken of refresh) {
    if (!usedRefresh.has(refreshToken)) pairs.push({ refresh: refreshToken });
  }
  return pairs;
}

export function classifyWindowsLineTokenSet(tokens: string[]): WindowsLineTokenInventory {
  const candidates = [...new Set(tokens)]
    .map((token) => classifyWindowsLineJwt(token))
    .filter((candidate): candidate is WindowsLineTokenCandidate => Boolean(candidate));
  return { candidates, pairs: pairWindowsLineTokens(candidates) };
}

export function describeWindowsLineToken(
  candidate: WindowsLineTokenCandidate,
  index: number,
  pairedIndex?: number,
  now = Date.now(),
): WindowsLineTokenView {
  const expiresAt = candidate.expiresAt;
  const remainingSeconds =
    expiresAt === undefined ? 0 : Math.max(0, Math.floor(expiresAt - now / 1000));
  return {
    index,
    kind: candidate.kind,
    status: remainingSeconds > 0 ? "usable" : "unusable",
    fingerprint: createHash("sha256").update(candidate.token).digest("hex").slice(0, 12),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    remainingSeconds,
    ...(pairedIndex === undefined ? {} : { pairedIndex }),
  };
}

export function describeWindowsLineTokenInventory(
  inventory: WindowsLineTokenInventory,
  now = Date.now(),
): WindowsLineTokenView[] {
  const pairedByCandidate = new Map<WindowsLineTokenCandidate, number>();
  for (const pair of inventory.pairs) {
    if (pair.access && pair.refresh) {
      const accessIndex = inventory.candidates.indexOf(pair.access);
      const refreshIndex = inventory.candidates.indexOf(pair.refresh);
      if (accessIndex >= 0 && refreshIndex >= 0) {
        pairedByCandidate.set(pair.access, refreshIndex);
        pairedByCandidate.set(pair.refresh, accessIndex);
      }
    }
  }
  return inventory.candidates.map((candidate, index) =>
    describeWindowsLineToken(candidate, index, pairedByCandidate.get(candidate), now),
  );
}

function windowsScannerSource(): string {
  return String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
public static class VylineWindowsLineTokenScanner {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr read);
  [DllImport("kernel32.dll")] static extern int VirtualQueryEx(IntPtr process, IntPtr address, out Mbi mbi, uint length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)] public struct Mbi {
    public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect;
    public IntPtr RegionSize; public uint State; public uint Protect; public uint Type;
  }
  static readonly Regex Jwt = new Regex(@"eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+", RegexOptions.Compiled);
  static readonly uint[] Readable = { 0x02, 0x04, 0x08, 0x20, 0x40, 0x80 };
  public static string Scan() {
    var output = new HashSet<string>();
    foreach (var process in Process.GetProcessesByName("LINE")) {
      IntPtr handle = OpenProcess(0x0410, false, process.Id);
      if (handle == IntPtr.Zero) continue;
      IntPtr address = IntPtr.Zero; Mbi mbi;
      try {
        while (VirtualQueryEx(handle, address, out mbi, (uint)Marshal.SizeOf(typeof(Mbi))) != 0) {
          long size = mbi.RegionSize.ToInt64();
          bool readable = Array.Exists(Readable, protection => (mbi.Protect & 0xff) == protection);
          if (mbi.State == 0x1000 && readable && size > 0) {
            for (long offset = 0; offset < size; offset += 64L * 1024 * 1024) {
              int chunkSize = (int)Math.Min(64L * 1024 * 1024, size - offset);
              var buffer = new byte[chunkSize]; IntPtr read;
              var chunkAddress = new IntPtr(mbi.BaseAddress.ToInt64() + offset);
              if (ReadProcessMemory(handle, chunkAddress, buffer, buffer.Length, out read)) {
                string text = Encoding.ASCII.GetString(buffer, 0, (int)read.ToInt64());
                foreach (Match match in Jwt.Matches(text)) if (match.Value.Length > 100) output.Add(match.Value);
              }
            }
          }
          long next = mbi.BaseAddress.ToInt64() + size;
          if (next <= address.ToInt64()) break;
          address = new IntPtr(next);
        }
      } finally { CloseHandle(handle); }
    }
    return string.Join("\n", output);
  }
}`;
}

export async function extractWindowsLineTokens(): Promise<string[]> {
  if (process.platform !== "win32")
    throw new Error("Windows LINE token extraction is only available on Windows");
  const script = `Add-Type -TypeDefinition @'\n${windowsScannerSource()}\n'@ -Language CSharp; [VylineWindowsLineTokenScanner]::Scan()`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    },
  );
  return stdout
    .split(/\r?\n/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export async function inspectWindowsLineTokens(): Promise<WindowsLineTokenInventory> {
  return classifyWindowsLineTokenSet(await extractWindowsLineTokens());
}
