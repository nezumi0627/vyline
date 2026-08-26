import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Windows DesktopではDPAPI(CurrentUser)でユーザーごとの秘密として保存する。 */
export async function protectSecret(value: string): Promise<string> {
  if (process.platform !== "win32")
    throw new Error("OS secure storage is only available on Windows");
  const script =
    "$b=[Convert]::FromBase64String($args[0]); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))";
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
    Buffer.from(value).toString("base64"),
  ]);
  return stdout.trim();
}

export async function unprotectSecret(value: string): Promise<string> {
  if (process.platform !== "win32")
    throw new Error("OS secure storage is only available on Windows");
  const script =
    "$b=[Convert]::FromBase64String($args[0]); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))";
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
    value,
  ]);
  return stdout.trim();
}
