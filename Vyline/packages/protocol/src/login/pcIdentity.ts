/**
 * Desktop PC 端末情報 — QR login の systemName / modelName、loginV2 fid12 に使う
 * LINE Desktop が端末一覧に出す名前と揃える
 */

import { hostname as osHostname } from "node:os";
import { spawnSync } from "node:child_process";

export interface DesktopPcIdentity {
  /** QR fid2 — ホスト名 (例: NEZUMINDOWS) */
  systemName: string;
  /** QR fid3 / loginV2 fid12 — 製品モデル */
  modelName: string;
}

function readWmiModel(): string | null {
  if (process.platform !== "win32") return null;
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).Model"],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (r.status !== 0) return null;
  const model = (r.stdout ?? "").trim();
  return model.length > 0 ? model : null;
}

let cached: DesktopPcIdentity | null = null;

export function getDesktopPcIdentity(): DesktopPcIdentity {
  if (cached) return cached;
  const systemName = (process.env.COMPUTERNAME ?? osHostname() ?? "DESKTOP").split(".")[0]!;
  const modelName = readWmiModel() ?? "System Product Name";
  cached = { systemName, modelName };
  return cached;
}
