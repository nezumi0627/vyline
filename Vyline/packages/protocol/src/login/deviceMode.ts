/**
 * デバイスモード
 *
 * DESKTOPWIN 同士は公式 Desktop セッションを蹴る。
 * 既定は ANDROIDSECONDARY（副端末スロット）で同時ログイン可能。
 *
 * env:
 *   VYLINE_DEVICE=ANDROIDSECONDARY | IOSIPAD | DESKTOPWIN | DESKTOPMAC
 */

export type VylineDeviceMode = "ANDROIDSECONDARY" | "IOSIPAD" | "DESKTOPWIN" | "DESKTOPMAC";

const ALLOWED = new Set<VylineDeviceMode>([
  "ANDROIDSECONDARY",
  "IOSIPAD",
  "DESKTOPWIN",
  "DESKTOPMAC",
]);

/** 公式 Desktop と同時利用する既定（v3p 認証・Desktop を蹴らない） */
export const DEFAULT_DEVICE_MODE: VylineDeviceMode = "IOSIPAD";

export function resolveDeviceMode(override?: string | null): VylineDeviceMode {
  const raw = (override ?? process.env.VYLINE_DEVICE ?? DEFAULT_DEVICE_MODE).trim().toUpperCase();
  if (ALLOWED.has(raw as VylineDeviceMode)) {
    return raw as VylineDeviceMode;
  }
  return DEFAULT_DEVICE_MODE;
}

/** DESKTOPWIN/MAC は同一スロットを占有 → 公式 Desktop と競合 */
export function kicksOfficialDesktop(mode: VylineDeviceMode): boolean {
  return mode === "DESKTOPWIN" || mode === "DESKTOPMAC";
}

export function isDesktopEmulation(mode: VylineDeviceMode): boolean {
  return mode === "DESKTOPWIN" || mode === "DESKTOPMAC";
}
