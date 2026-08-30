import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DPAPI_INPUT_ENV = "VYLINE_DPAPI_INPUT";

async function runDpapi(script: string, input: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      // With -Command, trailing CLI values become PowerShell source rather than $args.
      // Pass the value through the child-only environment instead, keeping it out of
      // the command line and avoiding script injection from persisted data.
      env: { ...process.env, [DPAPI_INPUT_ENV]: input },
    },
  );
  return stdout.trim();
}

/** Windows DesktopではDPAPI(CurrentUser)でユーザーごとの秘密として保存する。 */
export async function protectSecret(value: string): Promise<string> {
  if (process.platform !== "win32")
    throw new Error("OS secure storage is only available on Windows");
  const script =
    "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:VYLINE_DPAPI_INPUT); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))";
  return runDpapi(script, Buffer.from(value).toString("base64"));
}

export async function unprotectSecret(value: string): Promise<string> {
  if (process.platform !== "win32")
    throw new Error("OS secure storage is only available on Windows");
  const script =
    "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:VYLINE_DPAPI_INPUT); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))";
  return runDpapi(script, value);
}
