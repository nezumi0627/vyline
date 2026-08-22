/**
 * LINE 互換 protocol client — LINE 互換クライアント
 *
 * 既定デバイス: ANDROIDSECONDARY（公式 Desktop と同時ログイン可）
 * Desktop 完全エミュ: VYLINE_DEVICE=DESKTOPWIN（公式 Desktop を蹴る）
 */

import { Client } from "@vyline/protocol/stack";
import { BaseClient } from "@vyline/protocol/stack/base";
import { VylineFileStorage } from "../protocol/fileStorage.js";
import type { DesktopProfile } from "../desktop/types.js";
import { patchDesktopTransport } from "../login/patchTransport.js";
import { patchDesktopLogin } from "../login/patchLogin.js";
import { ensureValidE2EEIdentity } from "../login/ensureE2EE.js";
import { getDesktopPcIdentity } from "../login/pcIdentity.js";
import { DESKTOP_TALK_PATH } from "../login/patchTransport.js";
import {
  DEFAULT_DEVICE_MODE,
  isDesktopEmulation,
  kicksOfficialDesktop,
  resolveDeviceMode,
  type VylineDeviceMode,
} from "../login/deviceMode.js";

export type VylineClient = Client;

export interface VylineLoginInit {
  profile: DesktopProfile;
  storagePath: string;
  /** 省略時は VYLINE_DEVICE / ANDROIDSECONDARY */
  deviceMode?: VylineDeviceMode | string;
  desktopKeysPath?: string;
}

export function applyDesktopHeaders(client: Client, profile: DesktopProfile): void {
  patchDesktopTransport(client.base, profile);
}

function createBase(init: VylineLoginInit): { base: BaseClient; mode: VylineDeviceMode } {
  const mode = resolveDeviceMode(init.deviceMode);
  const endpoint = init.profile.hosts.legy || "legy-jp.line-apps.com";

  const base = new BaseClient({
    device: mode,
    ...(isDesktopEmulation(mode) ? { version: init.profile.identity.appVersion } : {}),
    endpoint,
    storage: new VylineFileStorage(init.storagePath),
  });

  if (isDesktopEmulation(mode)) {
    patchDesktopTransport(base, init.profile);
    patchDesktopLogin(base);
    const pc = getDesktopPcIdentity();
    base.log("vyline:init", {
      mode,
      kicksOfficialDesktop: kicksOfficialDesktop(mode),
      appVersion: init.profile.identity.appVersion,
      xLineApplication: init.profile.identity.xLineApplication,
      userAgent: init.profile.identity.userAgent,
      endpoint: base.endpoint,
      qrSystemName: pc.systemName,
      qrModelName: pc.modelName,
    });
  } else {
    // 副端末: プロトコルスタック既定ヘッダー。公式 DESKTOPWIN と共存
    base.log("vyline:init", {
      mode,
      kicksOfficialDesktop: false,
      endpoint: base.endpoint,
      note: "secondary device slot — coexists with official Desktop",
    });
  }

  return { base, mode };
}

async function finalizeLogin(
  base: BaseClient,
  profile: DesktopProfile,
  mode: VylineDeviceMode,
  desktopKeysPath?: string,
): Promise<VylineClient> {
  await base.loginProcess.ready();
  if (isDesktopEmulation(mode)) {
    patchDesktopTransport(base, profile);
  }
  const e2ee = await ensureValidE2EEIdentity(base, desktopKeysPath ? { desktopKeysPath } : {});
  base.log("vyline:e2ee", { phase: "ensure-after-login", mode, ...e2ee });
  return new Client(base);
}

export async function loginWithEmail(
  opts: {
    email: string;
    password: string;
    onPincodeRequest: (pin: string) => void;
    pincode?: string;
  },
  init: VylineLoginInit,
): Promise<VylineClient> {
  const { base, mode } = createBase(init);
  base.on("pincall", opts.onPincodeRequest);
  if (isDesktopEmulation(mode)) {
    patchDesktopTransport(base, init.profile);
  }
  await base.loginProcess.withPassword({
    email: opts.email,
    password: opts.password,
    ...(opts.pincode !== undefined ? { pincode: opts.pincode } : {}),
  });
  return finalizeLogin(base, init.profile, mode, init.desktopKeysPath);
}

export async function loginWithQR(
  opts: {
    onReceiveQRUrl: (url: string) => void;
    onPincodeRequest: (pin: string) => void;
  },
  init: VylineLoginInit,
): Promise<VylineClient> {
  const { base, mode } = createBase(init);
  base.on("qrcall", opts.onReceiveQRUrl);
  base.on("pincall", opts.onPincodeRequest);
  if (isDesktopEmulation(mode)) {
    patchDesktopTransport(base, init.profile);
  }
  await base.loginProcess.withQrCode({});
  return finalizeLogin(base, init.profile, mode, init.desktopKeysPath);
}

export async function loginWithToken(
  authToken: string,
  init: VylineLoginInit,
): Promise<VylineClient> {
  const { base, mode } = createBase(init);
  if (isDesktopEmulation(mode)) {
    patchDesktopTransport(base, init.profile);
  }
  await base.loginProcess.login({ authToken });
  return finalizeLogin(base, init.profile, mode, init.desktopKeysPath);
}

export async function sendText(
  client: VylineClient,
  to: string,
  text: string,
  e2ee = true,
): Promise<unknown> {
  try {
    return await client.base.talk.sendMessage({ to, text, e2ee });
  } catch {
    return await client.base.talk.sendMessage({ to, text });
  }
}

export {
  DESKTOP_TALK_PATH,
  getDesktopPcIdentity,
  resolveDeviceMode,
  kicksOfficialDesktop,
  DEFAULT_DEVICE_MODE,
};
export type { VylineDeviceMode };
